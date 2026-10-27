// Proves the database enforces access by itself: raw SQL as meetup_api, no API code involved.
import { describe, expect, it } from 'vitest';
import { env } from './env.ts';
import { asPersona, M, token, type Persona } from './helpers.ts';

const view = (p: Persona | null) =>
  asPersona(p, async (tx) => ({
    meetups: (await tx`select id from public.meetups order by id`).map((r) => r.id),
    exact: (await tx`select meetup_id from public.meetup_locations order by meetup_id`).map((r) => r.meetup_id),
    rsvps: (await tx`select count(*)::int as n from public.rsvps`)[0]!.n,
    groups: (await tx`select count(*)::int as n from public.groups`)[0]!.n,
  }));

describe('RLS as meetup_api with each persona’s claims', () => {
  it.each<[Persona | null, string[], string[]]>([
    [null, [], []], // no claims: fails closed
    ['taylor', [], []],
    ['sam', [M.saturday, M.weeknight], []],
    ['jordan', [M.saturday, M.weeknight], [M.saturday, M.weeknight]], // RSVP'd + creator
    ['avery', [M.saturday, M.weeknight], [M.saturday]],
    ['riley', [M.saturday, M.weeknight, M.riverside], [M.saturday]],
  ])('%s sees exactly the allowed rows', async (p, meetups, exact) => {
    const v = await view(p);
    expect(v.meetups).toEqual([...meetups].sort());
    expect(v.exact).toEqual([...exact].sort());
    if (!meetups.length) expect(v).toMatchObject({ rsvps: 0, groups: 0 });
  });

  it.each<Persona>(['taylor', 'sam', 'jordan', 'avery', 'riley'])('home location is unreadable for %s', async (p) => {
    await expect(asPersona(p, (tx) => tx`select home_lat, home_lng from public.users`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it('a forged creator is refused by the column grant', async () => {
    const insert = asPersona('sam', (tx) =>
      tx`insert into public.meetups (group_id, created_by, title, starts_at)
         values ('b2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'x', now() + interval '1 day')`,
    );
    await expect(insert).rejects.toThrow(/permission denied/);
  });

  it('a claims-less transaction after one with claims still sees nothing (pooled connection)', async () => {
    await view('riley');
    expect(await view(null)).toEqual({ meetups: [], exact: [], rsvps: 0, groups: 0 });
  });
});

describe('a user token sent straight to the Data API reaches nothing', () => {
  it.each(['meetups?select=id', 'meetup_locations?select=*', 'rsvps?select=*', 'users?select=home_lat'])(
    'GET /rest/v1/%s is refused',
    async (path) => {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${await token('sam')}` },
      });
      expect([401, 403, 404]).toContain(r.status);
      expect(await r.text()).not.toMatch(/c3000000|North gate|40\.0/);
    },
  );

  it('POST /rest/v1/rsvps is refused', async () => {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rsvps`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${await token('sam')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ meetup_id: M.weeknight, user_id: 'a1000000-0000-4000-8000-000000000003' }),
    });
    expect([401, 403, 404]).toContain(r.status);
  });
});
