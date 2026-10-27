import { describe, expect, it } from 'vitest';
import { EXACT, G, get, M } from './helpers.ts';

const exactOf = (id: string) => ({ kind: 'exact', ...EXACT[id] });

describe('outsider (Taylor, in no group)', () => {
  it('has no groups', async () => {
    expect((await get('taylor', '/groups')).body).toEqual({ groups: [] });
  });

  it.each([G.maple, G.riverside])('cannot list meetups of group %s', async (g) => {
    const r = await get('taylor', `/groups/${g}/meetups`);
    expect(r.status).toBe(404);
  });

  it.each(Object.values(M))('cannot read meetup %s, its attendees or its location', async (id) => {
    const r = await get('taylor', `/meetups/${id}`);
    expect(r.status).toBe(404);
    expect(r.text).not.toMatch(/attendee|lat|placeName/i);
  });

  it('gets the same 404 for a real meetup as for a made-up id', async () => {
    const real = await get('taylor', `/meetups/${M.saturday}`);
    const fake = await get('taylor', '/meetups/00000000-0000-4000-8000-000000000000');
    expect(real).toEqual(fake);
  });
});

describe('member who has not RSVP’d (Sam)', () => {
  it('sees their group and its meetups, soonest first', async () => {
    expect((await get('sam', '/groups')).body.groups.map((g: any) => g.name)).toEqual(['Maple Street Walkers']);
    const list = (await get('sam', `/groups/${G.maple}/meetups`)).body.meetups;
    expect(list.map((m: any) => m.title)).toEqual(['Saturday morning loop', 'Weeknight short walk']);
  });

  it('sees attendees but only the approximate area: no exact point, no place name', async () => {
    const { meetup } = (await get('sam', `/meetups/${M.saturday}`)).body;
    expect(meetup.attendees.map((a: any) => a.displayName).sort()).toEqual(['Jordan Price', 'Riley Chen']);
    expect(meetup.location.kind).toBe('approximate');
    expect(meetup.location).not.toHaveProperty('placeName');
    expect(meetup.location.lat).not.toBe(EXACT[M.saturday]!.lat);
  });

  it('cannot see another group', async () => {
    expect((await get('sam', `/meetups/${M.riverside}`)).status).toBe(404);
  });
});

describe('member who has RSVP’d (Jordan)', () => {
  it('sees the exact point and place name for that meetup', async () => {
    expect((await get('jordan', `/meetups/${M.saturday}`)).body.meetup.location).toEqual(exactOf(M.saturday));
  });
});

describe('creator (Avery)', () => {
  it('sees the exact point without an RSVP', async () => {
    const { meetup } = (await get('avery', `/meetups/${M.saturday}`)).body;
    expect(meetup.isCreator).toBe(true);
    expect(meetup.hasRsvp).toBe(false);
    expect(meetup.location).toEqual(exactOf(M.saturday));
  });
});

describe('multi-group member (Riley: both groups, RSVP’d to Saturday only)', () => {
  it('lists the meetups of both groups', async () => {
    expect((await get('riley', '/groups')).body.groups).toHaveLength(2);
    expect((await get('riley', `/groups/${G.maple}/meetups`)).body.meetups).toHaveLength(2);
    expect((await get('riley', `/groups/${G.riverside}/meetups`)).body.meetups).toHaveLength(1);
  });

  it('map data follows Riley’s own status in each meetup', async () => {
    const kind = async (id: string) => (await get('riley', `/meetups/${id}`)).body.meetup.location.kind;
    expect(await kind(M.saturday)).toBe('exact'); // RSVP'd
    expect(await kind(M.weeknight)).toBe('approximate'); // same group, no RSVP
    expect(await kind(M.riverside)).toBe('approximate'); // other group, no RSVP
  });

  it('an RSVP to one meetup grants nothing for another', async () => {
    const list = (await get('riley', `/groups/${G.maple}/meetups`)).body.meetups;
    expect(list.find((m: any) => m.id === M.saturday).hasRsvp).toBe(true);
    expect(list.find((m: any) => m.id === M.weeknight).hasRsvp).toBe(false);
  });
});
