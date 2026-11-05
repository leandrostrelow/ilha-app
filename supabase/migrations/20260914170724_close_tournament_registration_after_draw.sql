begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Registration capacity remains the final database guard. In addition to the
-- numeric limit, a category with generated matches is closed permanently until
-- those matches are removed. This protects stale browser tabs and every entry
-- path (public, family, internal and private add-ons).
create or replace function private.enforce_tournament_registration_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_max_entries integer;
  category_has_draw boolean;
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

  -- Confirming an already-reserved place is not a new registration. Future draw
  -- generation refuses pending rows, so this transition cannot add someone who
  -- was absent from a newly generated draw.
  if tg_op = 'UPDATE'
     and old.tournament_id is not distinct from new.tournament_id
     and old.category_id is not distinct from new.category_id
     and old.status in ('PENDING', 'CONFIRMED') then
    return new;
  end if;

  select
    category.max_entries,
    exists (
      select 1
      from public.tournament_matches as tournament_match
      where tournament_match.tournament_id = new.tournament_id
        and tournament_match.category_id = new.category_id
    )
    into category_max_entries, category_has_draw
  from public.tournament_categories as category
  where category.id = new.category_id
    and category.tournament_id = new.tournament_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'A classe informada não pertence a este torneio.';
  end if;

  if category_has_draw then
    raise exception using
      errcode = 'P0001',
      message = 'As inscrições desta classe foram encerradas porque a chave já foi gerada.';
  end if;

  if category_max_entries is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select count(*)::integer
      into occupied_entries
    from public.tournament_registrations as registration
    where registration.tournament_id = new.tournament_id
      and registration.category_id = new.category_id
      and registration.status in ('PENDING', 'CONFIRMED')
      and registration.id <> old.id;
  else
    select count(*)::integer
      into occupied_entries
    from public.tournament_registrations as registration
    where registration.tournament_id = new.tournament_id
      and registration.category_id = new.category_id
      and registration.status in ('PENDING', 'CONFIRMED');
  end if;

  if occupied_entries >= category_max_entries then
    raise exception using
      errcode = 'P0001',
      message = 'Esta classe atingiu o limite de vagas. Escolha outra classe ou aguarde a organização abrir novas vagas.';
  end if;

  return new;
end;
$$;

alter function private.enforce_tournament_registration_capacity()
  owner to postgres;
revoke all on function private.enforce_tournament_registration_capacity()
  from public, anon, authenticated, service_role;

-- Close the category inside the same transaction that creates the first match.
-- Pending reservations are rejected before any draw row is stored, so a late
-- Pix confirmation can never create an athlete outside the draw.
create or replace function private.close_tournament_category_on_draw()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.tournament_registrations as registration
  where registration.tournament_id = new.tournament_id
    and registration.category_id = new.category_id
  order by registration.id
  for update;

  if exists (
    select 1
    from public.tournament_registrations as registration
    where registration.tournament_id = new.tournament_id
      and registration.category_id = new.category_id
      and registration.status = 'PENDING'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Conclua ou cancele as inscrições pendentes antes de gerar a chave.';
  end if;

  update public.tournament_categories as category
  set registration_open = false,
      updated_at = now()
  where category.id = new.category_id
    and category.tournament_id = new.tournament_id
    and category.registration_open is distinct from false;

  if not exists (
    select 1
    from public.tournament_categories as category
    where category.id = new.category_id
      and category.tournament_id = new.tournament_id
  ) then
    raise exception using
      errcode = 'P0002',
      message = 'A classe informada não pertence a este torneio.';
  end if;

  return new;
end;
$$;

alter function private.close_tournament_category_on_draw()
  owner to postgres;
revoke all on function private.close_tournament_category_on_draw()
  from public, anon, authenticated, service_role;

drop trigger if exists close_tournament_category_on_draw
  on public.tournament_matches;
create trigger close_tournament_category_on_draw
before insert on public.tournament_matches
for each row execute function private.close_tournament_category_on_draw();

-- Even if an old admin page sends registration_open=true, a category cannot be
-- reopened while its draw exists. Removing all matches makes reopening possible.
create or replace function private.guard_tournament_category_registration_reopen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.registration_open is true
     and old.registration_open is distinct from true
     and exists (
       select 1
       from public.tournament_matches as tournament_match
       where tournament_match.tournament_id = new.tournament_id
         and tournament_match.category_id = new.id
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'Não é possível reabrir inscrições enquanto a chave desta classe existir.';
  end if;

  return new;
end;
$$;

alter function private.guard_tournament_category_registration_reopen()
  owner to postgres;
revoke all on function private.guard_tournament_category_registration_reopen()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_tournament_category_registration_reopen
  on public.tournament_categories;
create trigger guard_tournament_category_registration_reopen
before update of registration_open on public.tournament_categories
for each row execute function private.guard_tournament_category_registration_reopen();

-- Keep the single-elimination wrapper aligned with group generation: lock the
-- registration roster first, reject pending reservations and close registration
-- atomically with the draw replacement.
create or replace function public.tournament_replace_single_elimination_atomic(
  p_tournament_id uuid,
  p_category_id uuid,
  p_draw_size integer,
  p_matches jsonb,
  p_overwrite boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  replacement jsonb;
  pending_count integer;
begin
  if (select auth.uid()) is null
     or not public.has_tournament_permission('tournaments.write') then
    raise exception 'Você não tem permissão para gerar chaves.' using errcode = '42501';
  end if;

  perform 1
  from public.tournament_registrations as registration
  where registration.tournament_id = p_tournament_id
    and registration.category_id = p_category_id
  order by registration.id
  for update;

  perform 1
  from public.tournament_categories as category
  where category.id = p_category_id
    and category.tournament_id = p_tournament_id
  for update;

  if not found then
    raise exception 'Classe não encontrada neste torneio.' using errcode = '22023';
  end if;

  select count(*)::integer
    into pending_count
  from public.tournament_registrations as registration
  where registration.tournament_id = p_tournament_id
    and registration.category_id = p_category_id
    and registration.status = 'PENDING';

  if pending_count > 0 then
    raise exception 'Conclua ou cancele as inscrições pendentes antes de gerar a chave.' using errcode = 'P0001';
  end if;

  replacement := public.tournament_replace_bracket_atomic(
    p_tournament_id,
    p_category_id,
    p_draw_size,
    p_matches,
    p_overwrite
  );

  update public.tournament_categories
  set draw_format = 'SINGLE_ELIMINATION',
      registration_open = false,
      max_entries = case
        when jsonb_typeof(settings -> 'group_stage_previous_max_entries') = 'number'
        then (settings ->> 'group_stage_previous_max_entries')::integer
        when settings ? 'group_stage_previous_max_entries'
          and jsonb_typeof(settings -> 'group_stage_previous_max_entries') = 'null'
        then null
        else max_entries
      end,
      settings = case
        when jsonb_typeof(settings) = 'object'
        then settings - 'group_stage_previous_max_entries'
        else '{}'::jsonb
      end,
      updated_at = now()
  where id = p_category_id
    and tournament_id = p_tournament_id;

  if not found then
    raise exception 'Classe não encontrada neste torneio.' using errcode = '22023';
  end if;

  return replacement || jsonb_build_object(
    'draw_format', 'SINGLE_ELIMINATION',
    'registration_open', false
  );
end;
$$;

alter function public.tournament_replace_single_elimination_atomic(uuid, uuid, integer, jsonb, boolean)
  owner to postgres;
comment on function public.tournament_replace_single_elimination_atomic(uuid, uuid, integer, jsonb, boolean) is
  'Atomically replaces a single-elimination draw, closes registration and resets the category format.';
revoke all on function public.tournament_replace_single_elimination_atomic(uuid, uuid, integer, jsonb, boolean)
  from public, anon, service_role;
grant execute on function public.tournament_replace_single_elimination_atomic(uuid, uuid, integer, jsonb, boolean)
  to authenticated;

-- Retrofit the rule for draws generated before this migration.
update public.tournament_categories as category
set registration_open = false,
    updated_at = now()
where category.registration_open is distinct from false
  and exists (
    select 1
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = category.tournament_id
      and tournament_match.category_id = category.id
  );

commit;
