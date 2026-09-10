-- Keep the denormalized public registration name aligned with the athlete
-- edited by tournament administrators. Public snapshots expose only this
-- already-public value and never receive additional athlete fields.
create or replace function private.sync_tournament_registration_public_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.full_name is distinct from old.full_name then
    update public.tournament_registrations as registration
       set public_name = new.full_name
     where registration.athlete_id = new.id
       and registration.public_name is distinct from new.full_name;
  end if;

  return new;
end;
$$;

alter function private.sync_tournament_registration_public_name()
  owner to postgres;
revoke all on function private.sync_tournament_registration_public_name()
  from public, anon, authenticated, service_role;

drop trigger if exists tournament_athlete_sync_public_name
  on public.tournament_athletes;
create trigger tournament_athlete_sync_public_name
after update of full_name on public.tournament_athletes
for each row
when (new.full_name is distinct from old.full_name)
execute function private.sync_tournament_registration_public_name();

-- Repair names edited before this trigger existed.
update public.tournament_registrations as registration
   set public_name = athlete.full_name
  from public.tournament_athletes as athlete
 where athlete.id = registration.athlete_id
   and registration.public_name is distinct from athlete.full_name;

comment on function private.sync_tournament_registration_public_name() is
  'Synchronizes the already-public tournament registration name after an administrator renames an athlete.';
