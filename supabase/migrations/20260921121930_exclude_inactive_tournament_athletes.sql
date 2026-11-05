begin;

create or replace function private.guard_active_tournament_match_athletes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.tournament_athletes as athlete
    where athlete.id in (new.side1_athlete_id, new.side2_athlete_id)
      and (
        athlete.active is false
        or upper(coalesce(athlete.status, 'ACTIVE')) = 'INACTIVE'
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'Jogadores desativados não podem entrar em chaves ou grupos.';
  end if;

  return new;
end;
$$;

alter function private.guard_active_tournament_match_athletes() owner to postgres;
revoke all on function private.guard_active_tournament_match_athletes()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_active_tournament_match_athletes
  on public.tournament_matches;
create trigger guard_active_tournament_match_athletes
before insert on public.tournament_matches
for each row execute function private.guard_active_tournament_match_athletes();

comment on function private.guard_active_tournament_match_athletes() is
  'Prevents inactive athletes from being inserted into newly generated tournament matches.';

commit;
