-- Bonus: the creator can edit a meetup (title, start time, meeting point).
-- Allowed only for the creator, still a member, while the meetup is scheduled and hasn't started.
-- Cancelled meetups stay frozen. A moved meeting point recomputes the approximate area.

-- Editable means: caller created it, is still in the group, and it's scheduled and upcoming.
create function private.can_edit_meetup(p_meetup_id uuid)
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
         and mt.created_by = private.uid()
         and mt.status = 'scheduled'
         and mt.starts_at > now()
     )
$$;

grant execute on function private.can_edit_meetup(uuid) to meetup_api;

-- Column grants: only these fields are editable; group, creator and status edits stay impossible.
grant update (title, starts_at) on public.meetups to meetup_api;
grant update (place_name, lat, lng) on public.meetup_locations to meetup_api;

-- One UPDATE policy for both creator actions (the advisor flags two permissive ones):
-- cancel (scheduled → cancelled) or edit (stays scheduled, new start still in the future).
drop policy "creator cancels" on public.meetups;

create policy "creator cancels or edits"
on public.meetups for update to meetup_api
using (
  (created_by = (select private.uid()) and private.is_group_member(group_id) and status = 'scheduled')
  or private.can_edit_meetup(id)
)
with check (status = 'cancelled' or (status = 'scheduled' and starts_at > now()));

create policy "creator moves the meeting point"
on public.meetup_locations for update to meetup_api
using (private.can_edit_meetup(meetup_id))
with check (private.can_edit_meetup(meetup_id));

-- The guard now allows title/start edits; cancelling stays a status-only change.
create or replace function private.guard_meetup_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'cancelled' then
    raise exception 'cancelled meetups cannot be changed' using errcode = '23514';
  end if;

  if (new.id, new.group_id, new.created_by, new.created_at) is distinct from
     (old.id, old.group_id, old.created_by, old.created_at) then
    raise exception 'group and creator of a meetup cannot change' using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    if (new.title, new.starts_at) is distinct from (old.title, old.starts_at) then
      raise exception 'cancel and edit are separate changes' using errcode = '23514';
    end if;
    new.cancelled_at := now();
  else
    new.cancelled_at := old.cancelled_at;
  end if;

  -- The approximate area is written only by the location trigger (meetup_api has no grant on it).
  return new;
end
$$;

-- Moving the exact point recomputes the approximate area (same function as on insert).
create trigger meetup_locations_reset_approx_area
after update of lat, lng on public.meetup_locations
for each row execute function private.set_meetup_approx_area();
