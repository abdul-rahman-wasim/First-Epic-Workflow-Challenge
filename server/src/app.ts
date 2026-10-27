import {
  ApiError,
  CreateMeetupInput,
  GroupIdParam,
  GroupMeetupsResponse,
  MeetupIdParam,
  MeetupResponse,
  MyGroupsResponse,
  type ErrorCode,
} from '@altair/shared';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import type { z } from 'zod';
import type { Claims, VerifyToken } from './auth.ts';
import { asUser, type Tx } from './db.ts';
import * as q from './queries.ts';

export type Deps = { sql: Sql; verifyToken: VerifyToken };
type Env = { Variables: { claims: Claims } };

const STATUS: Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 500> = {
  invalid_input: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  internal: 500,
};

class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

const notFound = () => new HttpError('not_found', 'This meetup isn’t available');

// Visibility and state are pre-checked, so DB rejections here mean bad data or a race.
function fromDbError(err: unknown): HttpError {
  const pg = err as { code?: string; constraint_name?: string };
  if (pg.code === '23514' && pg.constraint_name) return new HttpError('invalid_input', 'Some details need fixing');
  if (pg.code === '23514') return new HttpError('conflict', 'This meetup isn’t open for that right now'); // trigger raise
  if (pg.code === '42501') return new HttpError('conflict', 'This meetup just changed. Refresh and try again'); // RLS check
  return new HttpError('internal', 'Something went wrong on our side. Please try again');
}

function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  throw new HttpError('invalid_input', 'Some details need fixing', issues);
}

// Responses pass through the shared schema too: an unlisted field fails here instead of leaking.
function send<S extends z.ZodType>(c: Context, schema: S, body: z.infer<S>, status: 200 | 201 = 200) {
  return c.json(schema.parse(body), status);
}

export function createApp({ sql, verifyToken }: Deps) {
  const app = new Hono<Env>().basePath('/api');

  app.onError((err, c) => {
    const e = err instanceof HttpError ? err : fromDbError(err);
    if (e.code === 'internal') console.error(err);
    const body = { error: { code: e.code, message: e.message, ...(e.issues && { issues: e.issues }) } };
    return c.json(ApiError.parse(body), STATUS[e.code]);
  });

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));

  app.use('*', async (c, next) => {
    const token = c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1];
    const claims = token ? await verifyToken(token) : null;
    if (!claims) throw new HttpError('unauthorized', 'Please sign in to continue');
    c.set('claims', claims);
    await next();
  });

  const db = <T>(c: Context<Env>, fn: (tx: Tx) => Promise<T>) => asUser(sql, c.get('claims'), fn);

  const detailOr404 = async (tx: Tx, meetupId: string) => {
    const meetup = await q.meetupDetail(tx, meetupId);
    if (!meetup) throw notFound();
    return { meetup };
  };

  // ---------- reads ----------

  app.get('/groups', async (c) => {
    const groups = await db(c, q.myGroups);
    return send(c, MyGroupsResponse, { groups });
  });

  app.get('/groups/:groupId/meetups', async (c) => {
    const { groupId } = parse(GroupIdParam, c.req.param());
    const meetups = await db(c, async (tx) => {
      if (!(await q.groupVisible(tx, groupId))) throw new HttpError('not_found', 'This group isn’t available');
      return q.groupMeetups(tx, groupId);
    });
    return send(c, GroupMeetupsResponse, { meetups });
  });

  app.get('/meetups/:meetupId', async (c) => {
    const { meetupId } = parse(MeetupIdParam, c.req.param());
    return send(c, MeetupResponse, await db(c, (tx) => detailOr404(tx, meetupId)));
  });

  // ---------- writes ----------
  // Check order: visible (404) → allowed (403) → state (409). Outsiders only ever see 404.

  app.post('/meetups', async (c) => {
    const input = parse(CreateMeetupInput, await c.req.json().catch(() => undefined));
    const body = await db(c, async (tx) => {
      if (!(await q.groupVisible(tx, input.groupId))) throw new HttpError('not_found', 'This group isn’t available');
      // Re-check on the DB clock, which the insert policy uses; the API clock may differ.
      if (!(await q.startsInFuture(tx, input.startsAt))) {
        throw new HttpError('invalid_input', 'Some details need fixing', [
          { path: 'startsAt', message: 'Start time must be in the future' },
        ]);
      }
      const id = await q.createMeetup(tx, input);
      return detailOr404(tx, id);
    });
    return send(c, MeetupResponse, body, 201);
  });

  app.post('/meetups/:meetupId/cancel', async (c) => {
    const { meetupId } = parse(MeetupIdParam, c.req.param());
    const body = await db(c, async (tx) => {
      const t = await q.writeTarget(tx, meetupId);
      if (!t) throw notFound();
      if (!t.isCreator) throw new HttpError('forbidden', 'Only the person who created this meetup can cancel it');
      if (t.status === 'cancelled') throw new HttpError('conflict', 'This meetup is already cancelled');
      // 0 rows: a concurrent cancel or membership change won; RLS skipped the row.
      if (!(await q.cancelMeetup(tx, meetupId))) throw new HttpError('conflict', 'This meetup is already cancelled');
      return detailOr404(tx, meetupId);
    });
    return send(c, MeetupResponse, body);
  });

  app.put('/meetups/:meetupId/rsvp', async (c) => {
    const { meetupId } = parse(MeetupIdParam, c.req.param());
    const body = await db(c, async (tx) => {
      const t = await q.writeTarget(tx, meetupId);
      if (!t) throw notFound();
      if (t.status === 'cancelled') throw new HttpError('conflict', 'This meetup was cancelled, so it isn’t taking RSVPs');
      if (t.started) throw new HttpError('conflict', 'This meetup has already started, so it isn’t taking new RSVPs');
      await q.rsvp(tx, meetupId);
      return detailOr404(tx, meetupId);
    });
    return send(c, MeetupResponse, body);
  });

  app.delete('/meetups/:meetupId/rsvp', async (c) => {
    const { meetupId } = parse(MeetupIdParam, c.req.param());
    const body = await db(c, async (tx) => {
      if (!(await q.writeTarget(tx, meetupId))) throw notFound();
      await q.withdraw(tx, meetupId);
      return detailOr404(tx, meetupId);
    });
    return send(c, MeetupResponse, body);
  });

  return app;
}
