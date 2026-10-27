import { describe, expect, it } from 'vitest';
import { call, cancel, EXACT, G, get, insertMeetup, M, ownerSql, rsvp, U, withdraw } from './helpers.ts';

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const draft = {
  groupId: G.maple,
  title: 'Evening loop',
  startsAt: inHours(24),
  placeName: 'Fountain plaza, Town Green',
  lat: 39.999134,
  lng: -99.999461,
};
const create = (who: 'sam' | 'taylor', body: object) => call(who, 'POST', '/meetups', body);

describe('create', () => {
  it('a member creates a meetup; creator comes from the token', async () => {
    const r = await create('sam', draft);
    expect(r.status).toBe(201);
    expect(r.body.meetup.isCreator).toBe(true);
    expect(r.body.meetup.location.kind).toBe('exact');
    const [row] = await ownerSql`select created_by from public.meetups where id = ${r.body.meetup.id}`;
    expect(row!.created_by).toBe(U.sam);
  });

  it.each([
    ['a past start', { startsAt: inHours(-1) }],
    ['a start equal to now', { startsAt: new Date().toISOString() }],
    ['a start without timezone', { startsAt: '2031-01-01T10:00:00' }],
    ['a blank title', { title: '   ' }],
    ['an 81-character title', { title: 'x'.repeat(81) }],
    ['a client-supplied creator', { createdBy: U.avery }],
  ])('rejects %s with 400', async (_, patch) => {
    const r = await create('sam', { ...draft, ...patch });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('invalid_input');
  });

  it('an outsider cannot create in a group they are not in (404)', async () => {
    expect((await create('taylor', draft)).status).toBe(404);
  });
});

describe('cancel', () => {
  it('only the creator can cancel', async () => {
    expect((await cancel('sam', M.saturday)).status).toBe(403); // member, not creator
    expect((await cancel('jordan', M.saturday)).status).toBe(403); // attendee, not creator
    expect((await cancel('taylor', M.saturday)).status).toBe(404); // outsider learns nothing
    expect((await cancel('avery', M.saturday)).body.meetup.status).toBe('cancelled');
  });

  it('is final and stays visible to the group, marked cancelled, attendees kept', async () => {
    await cancel('avery', M.saturday);
    expect((await cancel('avery', M.saturday)).status).toBe(409);
    const item = (await get('sam', `/groups/${G.maple}/meetups`)).body.meetups.find((m: any) => m.id === M.saturday);
    expect(item.status).toBe('cancelled');
    expect(item.cancelledAt).not.toBeNull();
    expect((await get('sam', `/meetups/${M.saturday}`)).body.meetup.attendeeCount).toBe(2);
  });

  it('a cancelled meetup cannot be reopened, not even by the database owner', async () => {
    await cancel('avery', M.saturday);
    const [row] = await ownerSql`select status from public.meetups where id = ${M.saturday}`;
    expect(row!.status).toBe('cancelled');
    await expect(ownerSql`update public.meetups set status = 'scheduled' where id = ${M.saturday}`).rejects.toThrow(
      /cannot be changed/,
    );
  });
});

describe('rsvp and withdraw', () => {
  it('RSVP reveals the exact point; withdraw takes it back', async () => {
    expect((await rsvp('sam', M.weeknight)).body.meetup.location).toEqual({ kind: 'exact', ...EXACT[M.weeknight] });
    expect((await withdraw('sam', M.weeknight)).body.meetup.location.kind).toBe('approximate');
  });

  it('RSVP twice leaves one RSVP and no error', async () => {
    await rsvp('sam', M.weeknight);
    const again = await rsvp('sam', M.weeknight);
    expect(again.status).toBe(200);
    expect(again.body.meetup.attendeeCount).toBe(1);
  });

  it('no RSVP to a cancelled meetup', async () => {
    await cancel('avery', M.saturday);
    const r = await rsvp('sam', M.saturday);
    expect(r.status).toBe(409);
  });

  it('no RSVP to a meetup that has started', async () => {
    const started = await insertMeetup({ group: G.maple, creator: 'avery', startsAt: '-5 minutes' });
    expect((await rsvp('sam', started)).status).toBe(409);
  });

  it('an existing RSVP can still be withdrawn from a cancelled meetup', async () => {
    await cancel('avery', M.saturday);
    const r = await withdraw('jordan', M.saturday);
    expect(r.status).toBe(200);
    expect(r.body.meetup.attendees.map((a: any) => a.displayName)).toEqual(['Riley Chen']);
  });

  it('withdraw without an RSVP is a no-op', async () => {
    expect((await withdraw('sam', M.weeknight)).status).toBe(200);
  });

  it('an outsider cannot RSVP or withdraw (404)', async () => {
    expect((await rsvp('taylor', M.riverside)).status).toBe(404);
    expect((await withdraw('taylor', M.riverside)).status).toBe(404);
  });
});
