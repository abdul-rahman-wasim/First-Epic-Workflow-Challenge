// Edge cases from docs/PLAN.md §13 (E-numbers match the plan).
import { describe, expect, it } from 'vitest';
import { call, cancel, G, get, insertMeetup, joinGroup, leaveGroup, M, ownerSql, rsvp, token, U, withdraw } from './helpers.ts';

describe('membership changes', () => {
  it('E1: an attendee who leaves the group loses the meetup, attendees and exact point', async () => {
    expect((await rsvp('sam', M.weeknight)).body.meetup.location.kind).toBe('exact');
    await leaveGroup('sam', G.maple);
    expect((await get('sam', `/meetups/${M.weeknight}`)).status).toBe(404);
    expect((await get('sam', `/groups/${G.maple}/meetups`)).status).toBe(404);
  });

  it('E2/E4: rejoining does not restore exact access; the old RSVP is gone', async () => {
    await rsvp('sam', M.weeknight);
    await leaveGroup('sam', G.maple);
    await joinGroup('sam', G.maple);
    const { meetup } = (await get('sam', `/meetups/${M.weeknight}`)).body;
    expect(meetup.location.kind).toBe('approximate');
    expect(meetup.hasRsvp).toBe(false);
  });

  it('E3: a creator who leaves can no longer see or cancel the meetup', async () => {
    await leaveGroup('avery', G.maple);
    expect((await cancel('avery', M.saturday)).status).toBe(404);
    expect((await get('jordan', `/meetups/${M.saturday}`)).body.meetup.status).toBe('scheduled');
  });
});

describe('timing', () => {
  it('E7: RSVP at the start time is rejected', async () => {
    const now = await insertMeetup({ group: G.maple, creator: 'avery', startsAt: '0 seconds' });
    expect((await rsvp('sam', now)).status).toBe(409);
  });

  it('E10: a meetup that has started can still be cancelled by its creator', async () => {
    const started = await insertMeetup({ group: G.maple, creator: 'avery', startsAt: '-10 minutes' });
    expect((await cancel('avery', started)).body.meetup.status).toBe('cancelled');
  });

  it('E11: an attendee can withdraw after the start', async () => {
    // Real sequence: RSVP before the start, then withdraw after it. (The DB refuses even the
    // owner an RSVP on a started meetup, so the fixture can't shortcut this.)
    await Promise.all([token('sam'), token('jordan')]); // sign in first: keep the window for the RSVP
    const soon = await insertMeetup({ group: G.maple, creator: 'avery', startsAt: '12 seconds' });
    expect((await rsvp('sam', soon)).body.meetup.hasRsvp).toBe(true);
    const [left] = await ownerSql<{ s: number }[]>`
      select greatest(0, extract(epoch from starts_at - now()))::float8 as s from public.meetups where id = ${soon}`;
    await new Promise((r) => setTimeout(r, left!.s * 1000 + 1_000));
    expect((await rsvp('jordan', soon)).status).toBe(409); // started: no new RSVPs
    expect((await withdraw('sam', soon)).body.meetup.hasRsvp).toBe(false);
  });

  it('the DB refuses an RSVP on a started meetup even from the owner', async () => {
    const started = await insertMeetup({ group: G.maple, creator: 'avery', startsAt: '-10 minutes' });
    await expect(ownerSql`insert into public.rsvps (meetup_id, user_id) values (${started}, ${U.sam})`).rejects.toThrow(
      /not open for RSVPs/,
    );
  });
});

describe('probing and tokens', () => {
  it('E8: an outsider gets the same 404 for a started, a cancelled and a missing meetup', async () => {
    const started = await insertMeetup({ group: G.maple, creator: 'avery', startsAt: '-1 hour' });
    await cancel('avery', M.saturday);
    const res = await Promise.all(
      [started, M.saturday, '00000000-0000-4000-8000-000000000000'].map((id) => rsvp('taylor', id)),
    );
    expect(res.map((r) => r.status)).toEqual([404, 404, 404]);
    expect(res[0]!.body.error.code).toBe('not_found');
    expect(new Set(res.map((r) => r.text)).size).toBe(1);
  });

  it('E9: a member who can see a meetup but did not create it gets 403 on cancel', async () => {
    expect((await cancel('riley', M.riverside)).status).toBe(403);
  });

  it('E17: missing, garbage and tampered tokens get 401', async () => {
    const valid = await token('sam');
    const tampered = valid.slice(0, -4) + (valid.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    for (const raw of [undefined, 'garbage', tampered]) {
      const r = raw === undefined ? await get(null, '/groups') : await call(null, 'GET', '/groups', undefined, raw);
      expect(r.status).toBe(401);
    }
  });

  it('E15: malformed ids and bodies get 400', async () => {
    expect((await get('sam', '/meetups/not-a-uuid')).status).toBe(400);
    expect((await call('sam', 'POST', '/meetups', { title: 'x' })).status).toBe(400);
    expect((await call('sam', 'POST', '/meetups', 'just a string')).status).toBe(400);
  });
});
