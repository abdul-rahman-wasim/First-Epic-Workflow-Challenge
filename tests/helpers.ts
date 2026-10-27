import { createApp } from '../server/src/app.ts';
import { createVerifier, type Claims } from '../server/src/auth.ts';
import { asUser, type Tx } from '../server/src/db.ts';
import { SUPABASE_ROOT_CA } from '../server/src/supabase-ca.ts';
import postgres from 'postgres';
import { env, projectRef } from './env.ts';

// ---------- seed cast (ids from supabase/seed.sql) ----------

export const U = {
  avery: 'a1000000-0000-4000-8000-000000000001',
  jordan: 'a1000000-0000-4000-8000-000000000002',
  sam: 'a1000000-0000-4000-8000-000000000003',
  riley: 'a1000000-0000-4000-8000-000000000004',
  morgan: 'a1000000-0000-4000-8000-000000000005',
  casey: 'a1000000-0000-4000-8000-000000000006',
  taylor: 'a1000000-0000-4000-8000-000000000007',
  quinn: 'a1000000-0000-4000-8000-000000000008',
} as const;
export type Persona = keyof typeof U;

export const G = { maple: 'b2000000-0000-4000-8000-000000000001', riverside: 'b2000000-0000-4000-8000-000000000002' };

export const M = {
  saturday: 'c3000000-0000-4000-8000-000000000001', // Maple, Avery; RSVPs Jordan + Riley
  weeknight: 'c3000000-0000-4000-8000-000000000002', // Maple, Jordan; no RSVPs
  riverside: 'c3000000-0000-4000-8000-000000000003', // Riverside, Morgan; RSVP Casey
};

export const EXACT = {
  [M.saturday]: { placeName: 'North gate, Linden Park', lat: 40.012046, lng: -99.984517 },
  [M.weeknight]: { placeName: 'Front steps, Elm Avenue Library', lat: 40.003318, lng: -99.979762 },
  [M.riverside]: { placeName: 'Boathouse lot, Riverside Path', lat: 39.985239, lng: -100.009683 },
};

// Seeded private home coordinates: must never appear in any response.
export const HOME_VALUES = ['40.004812', '-99.993127', '40.007395', '-99.98864', '39.998263', '-99.995418'];

// ---------- connections ----------

const ssl = { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true };
const common = { host: env.MEETUP_API_DB_HOST, database: 'postgres', ssl, prepare: false, max: 2, onnotice: () => {} } as const;

// Same role and pooler as the deployed API.
export const apiSql = postgres({ ...common, port: 6543, username: `meetup_api.${projectRef}`, password: env.MEETUP_API_DB_PASSWORD });
// Database owner: fixtures only (resets, a meetup that has already started, membership changes).
export const ownerSql = postgres({ ...common, port: 5432, username: `postgres.${projectRef}`, password: env.SUPABASE_DB_PASSWORD });

export const app = createApp({ sql: apiSql, verifyToken: createVerifier(env.SUPABASE_URL) });

export async function closeConnections() {
  await Promise.all([apiSql.end(), ownerSql.end()]);
}

// ---------- auth ----------

const tokens = new Map<Persona, string>();

export async function token(p: Persona): Promise<string> {
  const cached = tokens.get(p);
  if (cached) return cached;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${p}@example.test`, password: 'altair-fixture-pass' }),
  });
  if (!r.ok) throw new Error(`sign-in failed for ${p}: ${r.status}`);
  const t = (await r.json()).access_token as string;
  tokens.set(p, t);
  return t;
}

// ---------- calling the API in-process ----------

export type Res = { status: number; body: any; text: string };
export const responses: string[] = []; // every body, for the home-location scan

export async function call(who: Persona | null, method: string, path: string, body?: unknown, rawToken?: string): Promise<Res> {
  const auth = rawToken ?? (who ? await token(who) : undefined);
  const res = await app.request(`/api${path}`, {
    method,
    headers: { ...(auth && { Authorization: `Bearer ${auth}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  responses.push(text);
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

export const get = (who: Persona | null, path: string) => call(who, 'GET', path);
export const rsvp = (who: Persona, id: string) => call(who, 'PUT', `/meetups/${id}/rsvp`);
export const withdraw = (who: Persona, id: string) => call(who, 'DELETE', `/meetups/${id}/rsvp`);
export const cancel = (who: Persona, id: string) => call(who, 'POST', `/meetups/${id}/cancel`);

// Raw SQL as meetup_api with a persona's claims: proves RLS itself, without the API.
export const asPersona = <T>(p: Persona | null, fn: (tx: Tx) => Promise<T>) =>
  p ? asUser(apiSql, { sub: U[p], role: 'authenticated' } as Claims, fn) : apiSql.begin(fn as any) as Promise<T>;

// ---------- fixtures (as owner) ----------

const MEMBERSHIPS: [string, string][] = [
  [G.maple, U.avery], [G.maple, U.jordan], [G.maple, U.sam], [G.maple, U.riley],
  [G.riverside, U.riley], [G.riverside, U.morgan], [G.riverside, U.casey], [G.riverside, U.quinn],
];

// Back to the seed state: memberships, the three reference meetups and their RSVPs.
export async function resetFixtures() {
  await ownerSql.begin(async (tx) => {
    await tx`truncate public.meetups cascade`;
    await tx`delete from public.group_memberships`;
    for (const [g, u] of MEMBERSHIPS) await tx`insert into public.group_memberships (group_id, user_id) values (${g}, ${u})`;
    await tx`insert into public.meetups (id, group_id, created_by, title, starts_at) values
      (${M.saturday}, ${G.maple}, ${U.avery}, 'Saturday morning loop', now() + interval '7 days'),
      (${M.weeknight}, ${G.maple}, ${U.jordan}, 'Weeknight short walk', now() + interval '10 days'),
      (${M.riverside}, ${G.riverside}, ${U.morgan}, 'Riverside sunrise walk', now() + interval '8 days')`;
    for (const [id, l] of Object.entries(EXACT)) {
      await tx`insert into public.meetup_locations (meetup_id, place_name, lat, lng) values (${id}, ${l.placeName}, ${l.lat}, ${l.lng})`;
    }
    await tx`insert into public.rsvps (meetup_id, user_id) values
      (${M.saturday}, ${U.jordan}), (${M.saturday}, ${U.riley}), (${M.riverside}, ${U.casey})`;
  });
}

// A meetup inserted directly as owner, e.g. one that has already started.
export async function insertMeetup(o: { group: string; creator: Persona; startsAt: string; title?: string }) {
  return ownerSql.begin(async (tx) => {
    const [m] = await tx<{ id: string }[]>`
      insert into public.meetups (group_id, created_by, title, starts_at)
      values (${o.group}, ${U[o.creator]}, ${o.title ?? 'Fixture walk'}, now() + ${o.startsAt}::interval)
      returning id`;
    await tx`insert into public.meetup_locations (meetup_id, place_name, lat, lng)
      values (${m!.id}, 'Fountain plaza, Town Green', 39.999134, -99.999461)`;
    return m!.id;
  });
}

export const leaveGroup = (p: Persona, group: string) =>
  ownerSql`delete from public.group_memberships where group_id = ${group} and user_id = ${U[p]}`;
export const joinGroup = (p: Persona, group: string) =>
  ownerSql`insert into public.group_memberships (group_id, user_id) values (${group}, ${U[p]})`;

// ---------- geometry ----------

export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
