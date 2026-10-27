// Bonus: creator-only edit of a meetup.
import { describe, expect, it } from 'vitest';
import { asPersona, call, cancel, EXACT, G, get, insertMeetup, leaveGroup, M, metersBetween, ownerSql, rsvp, type Persona } from './helpers.ts';

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const edit = (who: Persona, id: string, body: object) => call(who, 'PATCH', `/meetups/${id}`, body);
// A real public place ~3 km from the seed points, far enough to land in another grid cell.
const MOVED = { placeName: 'Fountain plaza, Town Green', lat: 39.999134, lng: -99.999461 };

describe('who can edit', () => {
  it('the creator edits title and start time', async () => {
    const startsAt = inHours(48);
    const r = await edit('avery', M.saturday, { title: 'Saturday long loop', startsAt });
    expect(r.status).toBe(200);
    expect(r.body.meetup).toMatchObject({ title: 'Saturday long loop', startsAt });
    const item = (await get('sam', `/groups/${G.maple}/meetups`)).body.meetups.find((m: any) => m.id === M.saturday);
    expect(item.title).toBe('Saturday long loop');
  });

  it('a member who did not create it gets 403; an attendee too', async () => {
    expect((await edit('sam', M.saturday, { title: 'Mine now' })).status).toBe(403);
    expect((await edit('jordan', M.saturday, { title: 'Mine now' })).status).toBe(403);
  });

  it('an outsider gets 404, the same as for a missing meetup', async () => {
    const real = await edit('taylor', M.saturday, { title: 'x' });
    const fake = await edit('taylor', '00000000-0000-4000-8000-000000000000', { title: 'x' });
    expect(real.status).toBe(404);
    expect(real.text).toBe(fake.text);
  });

  it('a creator who left the group can no longer edit (404)', async () => {
    await leaveGroup('avery', G.maple);
    expect((await edit('avery', M.saturday, { title: 'x' })).status).toBe(404);
  });
});

describe('what can be edited', () => {
  it('a cancelled meetup cannot be edited', async () => {
    await cancel('avery', M.saturday);
    const r = await edit('avery', M.saturday, { title: 'Back on' });
    expect(r.status).toBe(409);
    expect((await get('avery', `/meetups/${M.saturday}`)).body.meetup.status).toBe('cancelled');
  });

  it('a meetup that has started cannot be edited', async () => {
    const started = await insertMeetup({ group: G.maple, creator: 'avery', startsAt: '-5 minutes' });
    expect((await edit('avery', started, { title: 'x' })).status).toBe(409);
  });

  it.each<[string, () => object]>([
    ['a past start', () => ({ startsAt: inHours(-1) })],
    ['a start inside the 3-hour lead time', () => ({ startsAt: inHours(2) })],
    ['a blank title', () => ({ title: ' ' })],
    ['an empty change', () => ({})],
    ['a status change', () => ({ status: 'cancelled' })],
    ['a group change', () => ({ groupId: G.riverside })],
    ['half a coordinate', () => ({ lat: 40 })],
  ])('rejects %s with 400', async (_, body) => {
    const r = await edit('avery', M.saturday, body());
    expect(r.status).toBe(400);
  });
});

describe('moving the meeting point', () => {
  it('recomputes the approximate area; attendees see the new exact point, others only the new area', async () => {
    const [before] = await ownerSql`select approx_lat, approx_lng from public.meetups where id = ${M.saturday}`;
    expect((await edit('avery', M.saturday, MOVED)).body.meetup.location).toEqual({ kind: 'exact', ...MOVED });

    const [after] = await ownerSql`select approx_lat, approx_lng, approx_radius_m from public.meetups where id = ${M.saturday}`;
    expect(after).not.toEqual(before);
    expect(metersBetween(MOVED, { lat: after!.approx_lat, lng: after!.approx_lng })).toBeLessThanOrEqual(after!.approx_radius_m);

    expect((await get('jordan', `/meetups/${M.saturday}`)).body.meetup.location).toEqual({ kind: 'exact', ...MOVED });
    const sam = (await get('sam', `/meetups/${M.saturday}`)).body.meetup.location;
    expect(sam.kind).toBe('approximate');
    expect(sam).not.toHaveProperty('placeName');
    expect(sam.lat).toBe(after!.approx_lat);
  });

  it('renaming the place keeps the pin where it was', async () => {
    const r = await edit('avery', M.saturday, { placeName: 'Main gate, Linden Park' });
    expect(r.body.meetup.location).toMatchObject({ placeName: 'Main gate, Linden Park', lat: EXACT[M.saturday]!.lat });
  });
});

describe('the database enforces edits by itself', () => {
  it('a non-creator’s UPDATE matches no row', async () => {
    const r = await asPersona('sam', (tx) => tx`update public.meetups set title = 'x' where id = ${M.saturday}`);
    expect(r.count).toBe(0);
  });

  it('the creator cannot move the meetup to another group or reassign it (no column grant)', async () => {
    await expect(asPersona('avery', (tx) => tx`update public.meetups set group_id = ${G.riverside} where id = ${M.saturday}`)).rejects.toThrow(/permission denied/);
    await expect(asPersona('avery', (tx) => tx`update public.meetups set created_by = created_by where id = ${M.saturday}`)).rejects.toThrow(/permission denied/);
  });

  it('the creator cannot set a past start, even in raw SQL', async () => {
    await expect(
      asPersona('avery', (tx) => tx`update public.meetups set starts_at = now() - interval '1 hour' where id = ${M.saturday}`),
    ).rejects.toThrow(/row-level security/);
  });

  it('cancelling and editing in one statement is refused', async () => {
    await expect(
      asPersona('avery', (tx) => tx`update public.meetups set status = 'cancelled', title = 'x' where id = ${M.saturday}`),
    ).rejects.toThrow(/separate changes/);
  });

  it('RSVPs keep working after an edit', async () => {
    expect((await edit('jordan', M.weeknight, { title: 'Weeknight loop' })).status).toBe(200);
    expect((await rsvp('sam', M.weeknight)).body.meetup.title).toBe('Weeknight loop');
  });
});
