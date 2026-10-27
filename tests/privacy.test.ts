import { describe, expect, it } from 'vitest';
import {
  call,
  cancel,
  EXACT,
  G,
  get,
  HOME_VALUES,
  insertMeetup,
  M,
  metersBetween,
  ownerSql,
  PERSONAS,
  responses,
  rsvp,
  withdraw,
} from './helpers.ts';

describe('approximate area (computed in the DB)', () => {
  it.each(Object.keys(EXACT))('%s: ≥ 300 m, not centered on the exact point, exact point inside', async (id) => {
    const [a] = await ownerSql`select approx_lat as lat, approx_lng as lng, approx_radius_m as r from public.meetups where id = ${id}`;
    const d = metersBetween(EXACT[id]!, a as any);
    expect(a!.r).toBeGreaterThanOrEqual(300);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThanOrEqual(a!.r);
  });

  it('every meetup at the same place gets the same circle (no averaging attack)', async () => {
    const a =await insertMeetup({ group: G.maple, creator: 'avery', startsAt: '1 day' });
    const b = await insertMeetup({ group: G.maple, creator: 'jordan', startsAt: '2 days' });
    const rows = await ownerSql`select approx_lat, approx_lng from public.meetups where id in ${ownerSql([a, b])}`;
    expect(rows[0]).toEqual(rows[1]);
  });

  it('what a non-attendee receives matches the stored area, nothing more', async () => {
    const { meetup } = (await get('sam', `/meetups/${M.saturday}`)).body;
    const [a] = await ownerSql`select approx_lat, approx_lng, approx_radius_m from public.meetups where id = ${M.saturday}`;
    expect(meetup.location).toEqual({
      kind: 'approximate',
      lat: a!.approx_lat,
      lng: a!.approx_lng,
      radiusM: a!.approx_radius_m,
      label: expect.any(String),
    });
  });
});

describe('home location never leaves the server', () => {
  it('no response from any read or write contains a home field or a seeded home value', async () => {
    responses.length = 0;
    const paths = ['/groups', ...Object.values(G).map((g) => `/groups/${g}/meetups`), ...Object.values(M).map((id) => `/meetups/${id}`)];
    await Promise.all(PERSONAS.map(async (p) => { for (const path of paths) await get(p, path); }));
    // Every write endpoint, including ones whose responses list attendees.
    const created = await call('sam', 'POST', '/meetups', {
      groupId: G.maple,
      title: 'Privacy walk',
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      placeName: 'Fountain plaza, Town Green',
      lat: 39.999134,
      lng: -99.999461,
    });
    await rsvp('riley', created.body.meetup.id);
    await rsvp('sam', M.weeknight);
    await withdraw('riley', M.saturday);
    await cancel('sam', created.body.meetup.id);
    await rsvp('casey', M.riverside);
    expect(responses.length).toBeGreaterThan(50);

    const all = responses.join('\n');
    expect(all).not.toMatch(/home_?lat|home_?lng/i);
    for (const v of HOME_VALUES) expect(all).not.toContain(v);
  }, 120_000); // ~60 calls to the hosted project
});
