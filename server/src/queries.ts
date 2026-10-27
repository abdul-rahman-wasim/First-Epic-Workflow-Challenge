import type { CreateMeetupInput, MeetupDetail, MeetupListItem, MyGroup } from '@altair/shared';
import type { Tx } from './db.ts';

// Every query runs inside asUser(): RLS limits rows to what the caller may see.

export const APPROX_LABEL = 'Approximate area — RSVP to see the exact spot';

export async function myGroups(tx: Tx): Promise<MyGroup[]> {
  // RLS: only groups the caller belongs to.
  return tx<MyGroup[]>`select id, name from public.groups order by name`;
}

export async function groupVisible(tx: Tx, groupId: string): Promise<boolean> {
  const rows = await tx`select 1 from public.groups where id = ${groupId}`;
  return rows.length > 0;
}

type MeetupRow = {
  id: string;
  group_id: string;
  group_name: string;
  title: string;
  starts_at: Date;
  status: 'scheduled' | 'cancelled';
  cancelled_at: Date | null;
  is_creator: boolean;
  has_rsvp: boolean;
  attendee_count: number;
};

const toListItem = (r: MeetupRow): MeetupListItem => ({
  id: r.id,
  groupId: r.group_id,
  title: r.title,
  startsAt: r.starts_at.toISOString(),
  status: r.status,
  cancelledAt: r.cancelled_at?.toISOString() ?? null,
  isCreator: r.is_creator,
  hasRsvp: r.has_rsvp,
  attendeeCount: r.attendee_count,
});

const meetupColumns = (tx: Tx) => tx`
  m.id, m.group_id, g.name as group_name, m.title, m.starts_at, m.status, m.cancelled_at,
  m.created_by = private.uid() as is_creator,
  exists (select 1 from public.rsvps r where r.meetup_id = m.id and r.user_id = private.uid()) as has_rsvp,
  (select count(*) from public.rsvps r where r.meetup_id = m.id)::int as attendee_count
`;

export async function groupMeetups(tx: Tx, groupId: string): Promise<MeetupListItem[]> {
  const rows = await tx<MeetupRow[]>`
    select ${meetupColumns(tx)}
    from public.meetups m join public.groups g on g.id = m.group_id
    where m.group_id = ${groupId}
    -- upcoming first (soonest first), then past (most recent first)
    order by m.starts_at < now(), abs(extract(epoch from m.starts_at - now())), m.id`;
  return rows.map(toListItem);
}

export async function meetupDetail(tx: Tx, meetupId: string): Promise<MeetupDetail | null> {
  const [m] = await tx<(MeetupRow & { approx_lat: number; approx_lng: number; approx_radius_m: number })[]>`
    select ${meetupColumns(tx)}, m.approx_lat, m.approx_lng, m.approx_radius_m
    from public.meetups m join public.groups g on g.id = m.group_id
    where m.id = ${meetupId}`;
  if (!m) return null;

  const attendees = await tx<{ userId: string; displayName: string }[]>`
    select u.id as "userId", u.display_name as "displayName"
    from public.rsvps r join public.users u on u.id = r.user_id
    where r.meetup_id = ${meetupId}
    order by r.created_at, u.id`;

  // RLS returns this row only to the creator and attendees.
  const [exact] = await tx<{ place_name: string; lat: number; lng: number }[]>`
    select place_name, lat, lng from public.meetup_locations where meetup_id = ${meetupId}`;

  return {
    ...toListItem(m),
    groupName: m.group_name,
    attendees: [...attendees],
    location: exact
      ? { kind: 'exact', placeName: exact.place_name, lat: exact.lat, lng: exact.lng }
      : { kind: 'approximate', lat: m.approx_lat, lng: m.approx_lng, radiusM: m.approx_radius_m, label: APPROX_LABEL },
  };
}

// State used to pick the precise error before a write. null = not visible (404).
export type WriteTarget = { isCreator: boolean; status: 'scheduled' | 'cancelled'; started: boolean };

export async function writeTarget(tx: Tx, meetupId: string): Promise<WriteTarget | null> {
  const [r] = await tx<{ is_creator: boolean; status: 'scheduled' | 'cancelled'; started: boolean }[]>`
    select created_by = private.uid() as is_creator, status, starts_at <= now() as started
    from public.meetups where id = ${meetupId}`;
  return r ? { isCreator: r.is_creator, status: r.status, started: r.started } : null;
}

export async function createMeetup(tx: Tx, input: CreateMeetupInput): Promise<string> {
  // created_by comes from the column default (verified claims), never from input.
  const [m] = await tx<{ id: string }[]>`
    insert into public.meetups (group_id, title, starts_at)
    values (${input.groupId}, ${input.title}, ${input.startsAt})
    returning id`;
  await tx`
    insert into public.meetup_locations (meetup_id, place_name, lat, lng)
    values (${m!.id}, ${input.placeName}, ${input.lat}, ${input.lng})`;
  return m!.id;
}

export async function startsInFuture(tx: Tx, startsAt: string): Promise<boolean> {
  const [r] = await tx<{ ok: boolean }[]>`select ${startsAt}::timestamptz > now() as ok`;
  return r!.ok;
}

// Returns false when RLS matched no row (not creator, not member, or already cancelled).
export async function cancelMeetup(tx: Tx, meetupId: string): Promise<boolean> {
  const r = await tx`update public.meetups set status = 'cancelled' where id = ${meetupId}`;
  return r.count > 0;
}

export async function rsvp(tx: Tx, meetupId: string): Promise<void> {
  await tx`
    insert into public.rsvps (meetup_id, user_id) values (${meetupId}, private.uid())
    on conflict do nothing`;
}

export async function withdraw(tx: Tx, meetupId: string): Promise<void> {
  await tx`delete from public.rsvps where meetup_id = ${meetupId} and user_id = private.uid()`;
}
