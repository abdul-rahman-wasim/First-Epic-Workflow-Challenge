-- =====================================================================
-- Meetups and RSVPs, with access model D.
--
-- Who can do what (enforced here, in the database):
--   outsider              nothing: no meetup, attendee, location, or group
--   member, no RSVP       read meetups, attendees, approximate area; RSVP
--   member, RSVP'd        + exact meeting point and place name; withdraw
--   creator               + exact point; cancel (one-way, final)
--
-- How it is enforced:
--   * anon / authenticated have no privileges on any slice table, so a
--     user token sent straight to the Data API reads and writes nothing.
--   * The API connects as meetup_api (nobypassrls, minimal grants) and puts
--     the verified JWT claims on each transaction. private.uid() reads them.
--   * Every rule is an RLS policy on meetup_api. Missing claims mean
--     private.uid() is null, so every policy fails closed.
--   * The exact point lives in its own table (meetup_locations) so RLS can
--     withhold the whole row from members who have not RSVP'd.
-- =====================================================================

-- ---------------------------------------------------------------------
-- API role. Created without login; the password is set once by hand
-- (see README), so no credential is ever stored in a migration.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'meetup_api') then
    create role meetup_api nologin nobypassrls noinherit;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- private schema: helpers used by policies. Never exposed to the Data API
-- and never granted to anon/authenticated.
-- ---------------------------------------------------------------------
create schema private;
revoke all on schema private from public;
grant usage on schema private to meetup_api;

-- New functions are executable by PUBLIC by default; stop that here so each
-- helper is granted explicitly.
alter default privileges in schema private revoke execute on functions from public;

-- The caller's user id, from the claims the API set after verifying the JWT.
-- Our own version of auth.uid(): meetup_api has no access to the auth schema.
create function private.uid()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.meetups (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid not null references public.groups (id) on delete cascade,
  -- Set from the verified claims, never from the request body.
  created_by       uuid not null default private.uid()
                   references public.users (id) on delete cascade,
  title            text not null
                   check (title = btrim(title) and char_length(title) between 1 and 80),
  starts_at        timestamptz not null,
  status           text not null default 'scheduled'
                   check (status in ('scheduled', 'cancelled')),
  cancelled_at     timestamptz,
  -- Approximate area shown to members who have not RSVP'd. Filled by a
  -- trigger from the exact point; never sent by the client.
  approx_lat       double precision,
  approx_lng       double precision,
  approx_radius_m  integer check (approx_radius_m >= 300),
  created_at       timestamptz not null default now(),
  check ((status = 'cancelled') = (cancelled_at is not null))
);

create index meetups_group_id_starts_at_idx on public.meetups (group_id, starts_at);
create index meetups_created_by_idx on public.meetups (created_by);

-- Exact meeting point. Separate table so RLS can withhold the whole row.
create table public.meetup_locations (
  meetup_id   uuid primary key references public.meetups (id) on delete cascade,
  place_name  text not null
              check (place_name = btrim(place_name) and char_length(place_name) between 1 and 120),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180)
);

create table public.rsvps (
  meetup_id   uuid not null references public.meetups (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (meetup_id, user_id)
);

create index rsvps_user_id_idx on public.rsvps (user_id);

alter table public.meetups          enable row level security;
alter table public.meetup_locations enable row level security;
alter table public.rsvps            enable row level security;

-- ---------------------------------------------------------------------
-- Policy helpers. security definer so they can read membership without
-- recursing through RLS; each one checks against private.uid() itself.
-- ---------------------------------------------------------------------
create function private.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_memberships m
    where m.group_id = p_group_id and m.user_id = private.uid()
  )
$$;

create function private.shares_group_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_memberships mine
    join public.group_memberships theirs on theirs.group_id = mine.group_id
    where mine.user_id = private.uid() and theirs.user_id = p_user_id
  )
$$;

create function private.is_meetup_member(p_meetup_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.meetups mt
    join public.group_memberships m on m.group_id = mt.group_id
    where mt.id = p_meetup_id and m.user_id = private.uid()
  )
$$;

-- Exact point: a *current* member who is the creator or has an RSVP.
-- Requiring membership matters: an RSVP row alone must not keep access
-- after someone leaves the group.
create function private.can_see_exact(p_meetup_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.meetups mt
    join public.group_memberships m on m.group_id = mt.group_id
    where mt.id = p_meetup_id
      and m.user_id = private.uid()
      and (
        mt.created_by = private.uid()
        or exists (
          select 1 from public.rsvps r
          where r.meetup_id = mt.id and r.user_id = private.uid()
        )
      )
  )
$$;

create function private.is_meetup_creator(p_meetup_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.meetups mt
    where mt.id = p_meetup_id and mt.created_by = private.uid()
  )
$$;

-- New RSVPs only for members, only while scheduled and not yet started.
create function private.can_rsvp(p_meetup_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.meetups mt
    join public.group_memberships m on m.group_id = mt.group_id
    where mt.id = p_meetup_id
      and m.user_id = private.uid()
      and mt.status = 'scheduled'
      and mt.starts_at > now()
  )
$$;

grant execute on function
  private.uid(),
  private.is_group_member(uuid),
  private.shares_group_with(uuid),
  private.is_meetup_member(uuid),
  private.can_see_exact(uuid),
  private.is_meetup_creator(uuid),
  private.can_rsvp(uuid)
to meetup_api;

-- ---------------------------------------------------------------------
-- Approximate area: snap the exact point to a fixed ~800 m grid and use a
-- 600 m circle around the cell center. 600 m exceeds the cell's
-- half-diagonal (~566 m), so the exact point is always inside the circle.
-- Deterministic per place: every meetup at the same spot gets the same
-- circle, so overlaying many meetups reveals nothing new (a per-meetup
-- random offset would not have that property).
-- ---------------------------------------------------------------------
create function private.approx_area(
  p_lat double precision,
  p_lng double precision,
  out lat double precision,
  out lng double precision,
  out radius_m integer
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  cell_m      constant double precision := 800;
  m_per_deg   constant double precision := 111320;
  dlat        double precision := cell_m / m_per_deg;
  dlng        double precision;
begin
  lat := (floor(p_lat / dlat) + 0.5) * dlat;
  -- Longitude cell width uses the cell-center latitude so it stays fixed
  -- for every point in the same row of cells.
  dlng := cell_m / (m_per_deg * cos(radians(lat)));
  lng := (floor(p_lng / dlng) + 0.5) * dlng;
  radius_m := 600;
end
$$;

-- When the exact point is inserted, store the approximate area on the
-- meetup. Runs as the owner because meetup_api cannot write these columns.
create function private.set_meetup_approx_area()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
begin
  a := private.approx_area(new.lat, new.lng);
  update public.meetups
     set approx_lat = a.lat, approx_lng = a.lng, approx_radius_m = a.radius_m
   where id = new.meetup_id;
  return null;
end
$$;

create trigger meetup_locations_set_approx_area
after insert on public.meetup_locations
for each row execute function private.set_meetup_approx_area();

-- Every meetup must have a location (and so an approximate area) by the end
-- of the transaction that created it. Create = insert meetup + location in
-- one transaction.
create function private.assert_meetup_has_area()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.meetups
    where id = new.id and approx_lat is not null
  ) then
    raise exception 'meetup % has no meeting point', new.id
      using errcode = '23514';
  end if;
  return null;
end
$$;

create constraint trigger meetups_require_area
after insert on public.meetups
deferrable initially deferred
for each row execute function private.assert_meetup_has_area();

-- Meetups are immutable except for one transition: scheduled -> cancelled.
-- Cancelling is final. The approximate area may be filled once (by the
-- trigger above) and never changed.
create function private.guard_meetup_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'cancelled' then
    raise exception 'cancelled meetups cannot be changed' using errcode = '23514';
  end if;

  if (new.id, new.group_id, new.created_by, new.title, new.starts_at, new.created_at)
     is distinct from
     (old.id, old.group_id, old.created_by, old.title, old.starts_at, old.created_at) then
    raise exception 'only the status of a meetup can change' using errcode = '23514';
  end if;

  if old.approx_lat is not null
     and (new.approx_lat, new.approx_lng, new.approx_radius_m)
         is distinct from (old.approx_lat, old.approx_lng, old.approx_radius_m) then
    raise exception 'the approximate area cannot change' using errcode = '23514';
  end if;

  if new.status = 'cancelled' and old.status = 'scheduled' then
    new.cancelled_at := now();
  else
    new.cancelled_at := old.cancelled_at;
  end if;

  return new;
end
$$;

create trigger meetups_guard_update
before update on public.meetups
for each row execute function private.guard_meetup_update();

-- Leaving a group drops that member's RSVPs for the group's meetups, so a
-- later rejoin cannot silently restore exact-location access.
create function private.drop_rsvps_on_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.rsvps r
   using public.meetups mt
   where r.meetup_id = mt.id
     and mt.group_id = old.group_id
     and r.user_id = old.user_id;
  return null;
end
$$;

create trigger group_memberships_drop_rsvps_on_leave
after delete on public.group_memberships
for each row execute function private.drop_rsvps_on_leave();

-- ---------------------------------------------------------------------
-- Privileges. User roles get nothing; meetup_api gets the minimum.
-- ---------------------------------------------------------------------
revoke all on
  public.users, public.groups, public.group_memberships,
  public.meetups, public.meetup_locations, public.rsvps
from anon, authenticated;

grant usage on schema public to meetup_api;

-- Only id and display_name: home_lat / home_lng are never readable.
grant select (id, display_name) on public.users to meetup_api;
grant select on public.groups, public.group_memberships to meetup_api;
grant select on public.meetups, public.meetup_locations, public.rsvps to meetup_api;

-- Column-level insert: the client can never set id, created_by, status,
-- cancelled_at, or the approximate area.
grant insert (group_id, title, starts_at) on public.meetups to meetup_api;
grant update (status) on public.meetups to meetup_api;
grant insert (meetup_id, place_name, lat, lng) on public.meetup_locations to meetup_api;
grant insert (meetup_id, user_id) on public.rsvps to meetup_api;
grant delete on public.rsvps to meetup_api;

-- ---------------------------------------------------------------------
-- RLS policies (meetup_api only). Every rule requires current membership.
-- ---------------------------------------------------------------------
create policy "own memberships"
on public.group_memberships for select to meetup_api
using (user_id = (select private.uid()));

create policy "groups i belong to"
on public.groups for select to meetup_api
using (private.is_group_member(id));

create policy "myself and people in my groups"
on public.users for select to meetup_api
using (id = (select private.uid()) or private.shares_group_with(id));

create policy "meetups in my groups"
on public.meetups for select to meetup_api
using (private.is_group_member(group_id));

create policy "members create meetups as themselves"
on public.meetups for insert to meetup_api
with check (
  created_by = (select private.uid())
  and private.is_group_member(group_id)
  and status = 'scheduled'
  and starts_at > now()
);

create policy "creator cancels"
on public.meetups for update to meetup_api
using (
  created_by = (select private.uid())
  and private.is_group_member(group_id)
  and status = 'scheduled'
)
with check (status = 'cancelled');

create policy "exact point for creator and attendees"
on public.meetup_locations for select to meetup_api
using (private.can_see_exact(meetup_id));

create policy "creator sets the meeting point"
on public.meetup_locations for insert to meetup_api
with check (private.is_meetup_creator(meetup_id));

create policy "attendees of meetups in my groups"
on public.rsvps for select to meetup_api
using (private.is_meetup_member(meetup_id));

create policy "rsvp for myself"
on public.rsvps for insert to meetup_api
with check (user_id = (select private.uid()) and private.can_rsvp(meetup_id));

create policy "withdraw my own rsvp"
on public.rsvps for delete to meetup_api
using (user_id = (select private.uid()) and private.is_meetup_member(meetup_id));
