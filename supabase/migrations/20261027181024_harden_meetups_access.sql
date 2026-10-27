-- =====================================================================
-- Hardening after code review of 20261027160639_meetups_rsvps.
-- Each section names the problem it fixes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. private.uid() must return NULL, not throw, when no claims are set.
--    After a transaction that used set_config(..., true) ends, the setting
--    reverts to '' (not NULL) on that pooled connection, and ''::jsonb
--    raises. That broke fail-closed: a request without claims got a 500
--    instead of zero rows.
-- ---------------------------------------------------------------------
create or replace function private.uid()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    ''
  )::uuid
$$;

-- ---------------------------------------------------------------------
-- 2. Future objects must not be exposed to user roles by default.
--    Supabase grants new public tables, sequences, and functions to anon
--    and authenticated by default. Access model D needs those roles to have
--    nothing, so a later migration that forgets a per-object revoke must
--    still be safe.
-- ---------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Membership-based helpers reuse one definition of "member of the
--    meetup's group", so the rules can't drift apart.
-- ---------------------------------------------------------------------
create or replace function private.can_see_exact(p_meetup_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_meetup_member(p_meetup_id)
     and exists (
       select 1 from public.meetups mt
       where mt.id = p_meetup_id
         and (
           mt.created_by = private.uid()
           or exists (
             select 1 from public.rsvps r
             where r.meetup_id = mt.id and r.user_id = private.uid()
           )
         )
     )
$$;

create or replace function private.can_rsvp(p_meetup_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_meetup_member(p_meetup_id)
     and exists (
       select 1 from public.meetups mt
       where mt.id = p_meetup_id
         and mt.status = 'scheduled'
         and mt.starts_at > now()
     )
$$;

-- The creator check also requires current membership, like every other rule.
create or replace function private.is_meetup_creator(p_meetup_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_meetup_member(p_meetup_id)
     and exists (
       select 1 from public.meetups mt
       where mt.id = p_meetup_id and mt.created_by = private.uid()
     )
$$;

-- ---------------------------------------------------------------------
-- 4. RSVPs must not race a cancel or a membership removal.
--    The policy check reads a snapshot without locks, so an RSVP could
--    commit on a meetup that was cancelled at the same moment, or survive
--    a concurrent membership delete. Lock both rows and re-check: a
--    row-locking read waits for the other transaction and then sees its
--    committed result.
-- ---------------------------------------------------------------------
create function private.lock_rsvp_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.meetups%rowtype;
begin
  select * into m from public.meetups where id = new.meetup_id for share;
  if not found or m.status <> 'scheduled' or m.starts_at <= now() then
    raise exception 'meetup is not open for RSVPs' using errcode = '23514';
  end if;

  perform 1 from public.group_memberships
   where group_id = m.group_id and user_id = new.user_id
   for share;
  if not found then
    raise exception 'not a member of this group' using errcode = '23514';
  end if;

  return new;
end
$$;

create trigger rsvps_lock_target
before insert on public.rsvps
for each row execute function private.lock_rsvp_target();

-- ---------------------------------------------------------------------
-- 5. The approximate area must stay on the map near the antimeridian and
--    the poles: wrap longitude into [-180, 180), clamp latitude, and
--    enforce valid ranges on the stored columns.
-- ---------------------------------------------------------------------
create or replace function private.approx_area(
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
  lat := least(90, greatest(-90, (floor(p_lat / dlat) + 0.5) * dlat));
  -- Longitude cell width uses the cell-center latitude, so it stays fixed
  -- for every point in the same row of cells. Floor cos() to avoid
  -- division by zero at the poles.
  dlng := least(360, cell_m / (m_per_deg * greatest(cos(radians(lat)), 1e-6)));
  lng := (floor(p_lng / dlng) + 0.5) * dlng;
  lng := lng - 360 * floor((lng + 180) / 360);
  radius_m := 600;
end
$$;

alter table public.meetups
  add constraint meetups_approx_lat_range check (approx_lat between -90 and 90),
  add constraint meetups_approx_lng_range check (approx_lng >= -180 and approx_lng < 180);

-- ---------------------------------------------------------------------
-- 6. The deferred "every meetup has a meeting point" check doesn't need
--    owner privileges: it runs in the creator's own transaction, and the
--    creator can already read the meetup.
-- ---------------------------------------------------------------------
alter function private.assert_meetup_has_area() security invoker;
