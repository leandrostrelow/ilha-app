begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Public registration remains closed after a draw is generated. Private/admin
-- registrations may only use a real vacant slot left in the first round (for
-- example after an inactive athlete is removed), and still respect max_entries.
create or replace function private.enforce_tournament_registration_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_max_entries integer;
  category_has_draw boolean;
  draw_has_vacancy boolean;
  occupied_entries integer;
begin
  if new.status = 'WAITLIST'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception using
      errcode = 'P0001',
      message = 'Esta classe atingiu o limite de vagas. Escolha outra classe ou aguarde a organização abrir novas vagas.';
  end if;

  if coalesce(new.status, '') not in ('PENDING', 'CONFIRMED') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.tournament_id is not distinct from new.tournament_id
     and old.category_id is not distinct from new.category_id
     and old.status in ('PENDING', 'CONFIRMED') then
    return new;
  end if;

  select category.max_entries
    into category_max_entries
  from public.tournament_categories as category
  where category.id = new.category_id
    and category.tournament_id = new.tournament_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'A classe informada não pertence a este torneio.';
  end if;

  select exists (
    select 1
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = new.tournament_id
      and tournament_match.category_id = new.category_id
  ) into category_has_draw;

  select exists (
    select 1
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = new.tournament_id
      and tournament_match.category_id = new.category_id
      and tournament_match.round_no = (
        select min(first_round.round_no)
        from public.tournament_matches as first_round
        where first_round.tournament_id = new.tournament_id
          and first_round.category_id = new.category_id
      )
      and tournament_match.status = 'PENDING'
      and (tournament_match.side1_athlete_id is null or tournament_match.side2_athlete_id is null)
  ) into draw_has_vacancy;

  if category_has_draw and not draw_has_vacancy then
    raise exception using
      errcode = 'P0001',
      message = 'A chave desta classe já está completa. Remova ou desative um atleta antes de adicionar outro.';
  end if;

  if category_max_entries is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select count(*)::integer
      into occupied_entries
    from public.tournament_registrations as registration
    join public.tournament_athletes as athlete on athlete.id = registration.athlete_id
    where registration.tournament_id = new.tournament_id
      and registration.category_id = new.category_id
      and registration.status in ('PENDING', 'CONFIRMED')
      and athlete.active is true
      and athlete.status = 'ACTIVE'
      and registration.id <> old.id;
  else
    select count(*)::integer
      into occupied_entries
    from public.tournament_registrations as registration
    join public.tournament_athletes as athlete on athlete.id = registration.athlete_id
    where registration.tournament_id = new.tournament_id
      and registration.category_id = new.category_id
      and registration.status in ('PENDING', 'CONFIRMED')
      and athlete.active is true
      and athlete.status = 'ACTIVE';
  end if;

  if occupied_entries >= category_max_entries then
    raise exception using
      errcode = 'P0001',
      message = 'Esta classe atingiu o limite de vagas. Escolha outra classe ou aguarde a organização abrir novas vagas.';
  end if;

  return new;
end;
$$;

alter function private.enforce_tournament_registration_capacity() owner to postgres;
revoke all on function private.enforce_tournament_registration_capacity()
  from public, anon, authenticated, service_role;

create or replace function private.fill_tournament_draw_vacancy_from_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  vacant_match_id uuid;
  vacant_side text;
begin
  if new.status <> 'CONFIRMED' then
    return new;
  end if;

  if exists (
    select 1
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = new.tournament_id
      and tournament_match.category_id = new.category_id
      and (tournament_match.side1_athlete_id = new.athlete_id
        or tournament_match.side2_athlete_id = new.athlete_id)
  ) then
    return new;
  end if;

  select tournament_match.id,
         case when tournament_match.side1_athlete_id is null then 'side1' else 'side2' end
    into vacant_match_id, vacant_side
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = new.tournament_id
    and tournament_match.category_id = new.category_id
    and tournament_match.round_no = (
      select min(first_round.round_no)
      from public.tournament_matches as first_round
      where first_round.tournament_id = new.tournament_id
        and first_round.category_id = new.category_id
    )
    and tournament_match.status = 'PENDING'
    and (tournament_match.side1_athlete_id is null or tournament_match.side2_athlete_id is null)
  order by tournament_match.match_no, tournament_match.id
  for update skip locked
  limit 1;

  if vacant_match_id is null then
    return new;
  end if;

  if vacant_side = 'side1' then
    update public.tournament_matches
    set side1_athlete_id = new.athlete_id,
        updated_at = now()
    where id = vacant_match_id;
  else
    update public.tournament_matches
    set side2_athlete_id = new.athlete_id,
        updated_at = now()
    where id = vacant_match_id;
  end if;

  return new;
end;
$$;

alter function private.fill_tournament_draw_vacancy_from_registration() owner to postgres;
revoke all on function private.fill_tournament_draw_vacancy_from_registration()
  from public, anon, authenticated, service_role;

drop trigger if exists fill_tournament_draw_vacancy_from_registration
  on public.tournament_registrations;
create trigger fill_tournament_draw_vacancy_from_registration
after insert or update of status, category_id, athlete_id
on public.tournament_registrations
for each row execute function private.fill_tournament_draw_vacancy_from_registration();

commit;
