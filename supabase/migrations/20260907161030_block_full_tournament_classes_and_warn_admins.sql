begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Capacity is an invariant, not a UI hint. Serialize every transition that
-- starts occupying a place on the category row, then count the other active
-- reservations while the lock is held. PENDING reserves the place during the
-- two-hour Pix window; CONFIRMED keeps it after payment.
create or replace function private.enforce_tournament_registration_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_max_entries integer;
  occupied_entries integer;
begin
  -- WAITLIST is no longer a valid overflow path. Existing historical rows can
  -- still receive harmless edits and can be cancelled or promoted.
  if new.status = 'WAITLIST'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception using
      errcode = 'P0001',
      message = 'Esta classe atingiu o limite de vagas. Escolha outra classe ou aguarde a organização abrir novas vagas.';
  end if;

  if coalesce(new.status, '') not in ('PENDING', 'CONFIRMED') then
    return new;
  end if;

  -- PENDING -> CONFIRMED keeps occupying the same place and must not acquire
  -- a category lock after a payment worker has already locked the registration.
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

drop trigger if exists enforce_tournament_registration_capacity_on_insert
  on public.tournament_registrations;
create trigger enforce_tournament_registration_capacity_on_insert
before insert on public.tournament_registrations
for each row execute function private.enforce_tournament_registration_capacity();

drop trigger if exists enforce_tournament_registration_capacity_on_update
  on public.tournament_registrations;
create trigger enforce_tournament_registration_capacity_on_update
before update
on public.tournament_registrations
for each row execute function private.enforce_tournament_registration_capacity();

-- The active checkout bundle used to turn a full primary class into WAITLIST.
-- Patch only the reviewed branch in place so all other payment, add-on and
-- idempotency protections remain byte-for-byte aligned with the deployed RPC.
do $$
declare
  function_oid regprocedure := to_regprocedure(
    'public.claim_public_tournament_registration_bundle(uuid,uuid,uuid,uuid,text,text,text,text,text,numeric,text)'
  );
  function_security_definer boolean;
  function_config text[];
  current_definition text;
  updated_definition text;
  waitlist_assignment text := E'        primary_status := ''WAITLIST'';\n        primary_payment_status := ''NOT_REQUIRED'';';
  full_class_rejection text := E'        raise exception using\n          errcode = ''P0001'',\n          message = ''Esta classe atingiu o limite de vagas. Escolha outra classe ou aguarde a organização abrir novas vagas.'';';
begin
  if function_oid is null then
    raise exception 'RPC de reserva de inscrição não encontrada.' using errcode = '55000';
  end if;

  select
    procedure.prosecdef,
    procedure.proconfig,
    pg_catalog.pg_get_functiondef(procedure.oid)
    into function_security_definer, function_config, current_definition
  from pg_catalog.pg_proc as procedure
  where procedure.oid = function_oid;

  if function_security_definer is distinct from true
     or not coalesce('search_path=""' = any(function_config), false)
     or current_definition not like '%auth.jwt() ->> ''role''%service_role%'
     or current_definition not like '%status in (''PENDING'', ''CONFIRMED'')%'
     or current_definition not like '%for update%' then
    raise exception 'A proteção atual da RPC de reserva não corresponde à versão esperada.'
      using errcode = '55000';
  end if;

  if current_definition like '%Esta classe atingiu o limite de vagas. Escolha outra classe ou aguarde a organização abrir novas vagas.%'
     and current_definition not like '%primary_status := ''WAITLIST''%' then
    return;
  end if;

  if pg_catalog.strpos(current_definition, waitlist_assignment) = 0 then
    raise exception 'O branch de lista de espera esperado não foi encontrado.'
      using errcode = '55000';
  end if;

  updated_definition := replace(
    current_definition,
    waitlist_assignment,
    full_class_rejection
  );

  if updated_definition = current_definition
     or updated_definition like '%primary_status := ''WAITLIST''%'
     or updated_definition not like '%Esta classe atingiu o limite de vagas. Escolha outra classe ou aguarde a organização abrir novas vagas.%' then
    raise exception 'Não foi possível bloquear a lista de espera com segurança.'
      using errcode = '55000';
  end if;

  execute updated_definition;
end;
$$;

alter function public.claim_public_tournament_registration_bundle(
  uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, text
) owner to postgres;
revoke all on function public.claim_public_tournament_registration_bundle(
  uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, text
) from public, anon, authenticated, service_role;
grant execute on function public.claim_public_tournament_registration_bundle(
  uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, text
) to service_role;

-- The public snapshot is a security-definer allow-list wrapper around this
-- private implementation. Replace only the private implementation so newly
-- added tournament settings remain private by default.
do $$
declare
  wrapper_oid regprocedure := to_regprocedure('public.tournament_public_snapshot(text)');
  legacy_oid regprocedure := to_regprocedure('private.tournament_public_snapshot_legacy_unsafe(text)');
  wrapper_security_definer boolean;
  wrapper_config text[];
  wrapper_definition text;
begin
  if wrapper_oid is null or legacy_oid is null then
    raise exception 'A projeção pública protegida do torneio não foi encontrada.'
      using errcode = '55000';
  end if;

  select
    procedure.prosecdef,
    procedure.proconfig,
    pg_catalog.pg_get_functiondef(procedure.oid)
    into wrapper_security_definer, wrapper_config, wrapper_definition
  from pg_catalog.pg_proc as procedure
  where procedure.oid = wrapper_oid;

  if wrapper_security_definer is distinct from true
     or not coalesce('search_path=""' = any(wrapper_config), false)
     or lower(wrapper_definition) not like '%private.tournament_public_snapshot_legacy_unsafe(p_slug)%'
     or lower(wrapper_definition) not like '%public_settings := jsonb_strip_nulls%'
  then
    raise exception 'A allow-list da projeção pública do torneio está incompleta.'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function private.tournament_public_snapshot_legacy_unsafe(
  p_slug text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.tournaments%rowtype;
  result jsonb;
begin
  if nullif(trim(p_slug), '') is null then
    select jsonb_build_object(
      'tournaments', coalesce(jsonb_agg(jsonb_build_object(
        'id', tournament.id,
        'name', tournament.name,
        'slug', tournament.slug,
        'short_description', tournament.short_description,
        'city', tournament.city,
        'club_name', tournament.club_name,
        'venue', tournament.venue,
        'status', tournament.status,
        'starts_on', tournament.starts_on,
        'ends_on', tournament.ends_on,
        'registration_open', tournament.registration_open,
        'registration_closes_at', tournament.registration_closes_at,
        'cover_url', tournament.cover_url,
        'logo_url', tournament.logo_url
      ) order by tournament.starts_on desc nulls last, tournament.name), '[]'::jsonb)
    )
      into result
    from public.tournaments as tournament
    where tournament.is_published = true
      and tournament.status <> 'ARCHIVED';

    return coalesce(result, jsonb_build_object('tournaments', '[]'::jsonb));
  end if;

  select tournament.*
    into target
  from public.tournaments as tournament
  where lower(tournament.slug) = lower(trim(p_slug))
    and tournament.is_published = true
    and tournament.status <> 'ARCHIVED'
  limit 1;

  if target.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'tournament', jsonb_build_object(
      'id', target.id,
      'name', target.name,
      'slug', target.slug,
      'year', target.year,
      'short_description', target.short_description,
      'description', target.description,
      'city', target.city,
      'club_name', target.club_name,
      'venue', target.venue,
      'timezone', target.timezone,
      'logo_url', target.logo_url,
      'cover_url', target.cover_url,
      'regulations_url', target.regulations_url,
      'status', target.status,
      'registration_open', target.registration_open,
      'registration_opens_at', target.registration_opens_at,
      'registration_closes_at', target.registration_closes_at,
      'starts_on', target.starts_on,
      'ends_on', target.ends_on,
      'default_fee', target.default_fee,
      'allowed_payment_methods', target.allowed_payment_methods,
      'instagram', target.instagram,
      'whatsapp', target.whatsapp,
      'settings', target.settings,
      'theme', target.theme
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', category.id,
        'tournament_id', category.tournament_id,
        'code', category.code,
        'name', category.name,
        'description', category.description,
        'event_type', category.event_type,
        'gender', category.gender,
        'class_level', category.class_level,
        'draw_format', category.draw_format,
        'draw_size', category.draw_size,
        'registration_fee', category.registration_fee,
        'registration_open', category.registration_open,
        'max_entries', category.max_entries,
        -- Keep the visible "inscritos" count aligned with the confirmed names.
        -- Pending Pix reservations still occupy capacity through occupied_count.
        'registration_count', capacity.confirmed_count,
        'occupied_count', capacity.occupied_count,
        'remaining_entries', case
          when category.max_entries is null then null
          else greatest(category.max_entries - capacity.occupied_count, 0)
        end,
        'is_full', category.max_entries is not null
          and capacity.occupied_count >= category.max_entries,
        'sort_order', category.sort_order
      ) order by category.sort_order, category.name)
      from public.tournament_categories as category
      cross join lateral (
        select
          count(*) filter (where registration.status = 'CONFIRMED')::integer as confirmed_count,
          count(*) filter (where registration.status in ('PENDING', 'CONFIRMED'))::integer as occupied_count
        from public.tournament_registrations as registration
        where registration.tournament_id = target.id
          and registration.category_id = category.id
      ) as capacity
      where category.tournament_id = target.id
        and category.active = true
        and category.is_published = true
    ), '[]'::jsonb),
    'registrations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', registration.id,
        'category_id', registration.category_id,
        'public_name', registration.public_name,
        'public_city', registration.public_city,
        'public_club', registration.public_club,
        'partner_name', registration.partner_name,
        'seed_number', registration.seed_number,
        'status', registration.status
      ) order by registration.seed_number nulls last, registration.public_name)
      from public.tournament_registrations as registration
      where registration.tournament_id = target.id
        and registration.published = true
        and registration.status = 'CONFIRMED'
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tournament_match.id,
        'category_id', tournament_match.category_id,
        'round_no', tournament_match.round_no,
        'round_code', tournament_match.round_code,
        'phase', tournament_match.phase,
        'match_no', tournament_match.match_no,
        'side1_athlete_id', tournament_match.side1_athlete_id,
        'side2_athlete_id', tournament_match.side2_athlete_id,
        'winner_athlete_id', tournament_match.winner_athlete_id,
        'side1_name', coalesce(side1_registration.public_name, side1_athlete.full_name),
        'side2_name', coalesce(side2_registration.public_name, side2_athlete.full_name),
        'winner_name', coalesce(winner_registration.public_name, winner_athlete.full_name),
        'source1_match_id', tournament_match.source1_match_id,
        'source2_match_id', tournament_match.source2_match_id,
        'score', tournament_match.score,
        'court_name', tournament_match.court_name,
        'match_date', tournament_match.match_date,
        'match_time', tournament_match.match_time,
        'scheduled_at', tournament_match.scheduled_at,
        'status', tournament_match.status,
        'sort_order', tournament_match.sort_order,
        'public_notes', tournament_match.public_notes
      ) order by tournament_match.category_id, tournament_match.round_no, tournament_match.match_no)
      from public.tournament_matches as tournament_match
      left join public.tournament_athletes as side1_athlete
        on side1_athlete.id = tournament_match.side1_athlete_id
      left join public.tournament_athletes as side2_athlete
        on side2_athlete.id = tournament_match.side2_athlete_id
      left join public.tournament_athletes as winner_athlete
        on winner_athlete.id = tournament_match.winner_athlete_id
      left join public.tournament_registrations as side1_registration
        on side1_registration.tournament_id = tournament_match.tournament_id
       and side1_registration.category_id = tournament_match.category_id
       and side1_registration.athlete_id = tournament_match.side1_athlete_id
       and side1_registration.status = 'CONFIRMED'
      left join public.tournament_registrations as side2_registration
        on side2_registration.tournament_id = tournament_match.tournament_id
       and side2_registration.category_id = tournament_match.category_id
       and side2_registration.athlete_id = tournament_match.side2_athlete_id
       and side2_registration.status = 'CONFIRMED'
      left join public.tournament_registrations as winner_registration
        on winner_registration.tournament_id = tournament_match.tournament_id
       and winner_registration.category_id = tournament_match.category_id
       and winner_registration.athlete_id = tournament_match.winner_athlete_id
       and winner_registration.status = 'CONFIRMED'
      where tournament_match.tournament_id = target.id
        and tournament_match.published = true
    ), '[]'::jsonb),
    'courts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', court.id,
        'name', court.name,
        'surface', court.surface,
        'sort_order', court.sort_order
      ) order by court.sort_order, court.name)
      from public.tournament_courts as court
      where court.tournament_id = target.id
        and court.active = true
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event.id,
        'title', event.title,
        'description', event.description,
        'event_date', event.event_date,
        'event_time', event.event_time,
        'court_name', event.court_name,
        'status', event.status,
        'sort_order', event.sort_order
      ) order by event.event_date, event.event_time nulls last, event.sort_order)
      from public.tournament_schedule_events as event
      where event.tournament_id = target.id
        and event.published = true
    ), '[]'::jsonb),
    'sponsors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sponsor.id,
        'name', sponsor.name,
        'logo_url', sponsor.logo_url,
        'link_url', sponsor.link_url,
        'tier', sponsor.tier
      ) order by sponsor.sort_order, sponsor.name)
      from public.tournament_sponsors as sponsor
      where sponsor.tournament_id = target.id
        and sponsor.is_published = true
    ), '[]'::jsonb)
  );
end;
$$;

alter function private.tournament_public_snapshot_legacy_unsafe(text)
  owner to postgres;
revoke all on function private.tournament_public_snapshot_legacy_unsafe(text)
  from public, anon, authenticated, service_role;

-- Capacity alerts contain only tournament/class metadata. The regular
-- registration notification remains separate and may identify the athlete to
-- staff; this alert is deduplicated by category, configured limit and each
-- remaining threshold (2, 1, 0) for every protected tournament administrator.
create or replace function private.notify_tournament_capacity_warning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_name text;
  category_name text;
  category_max_entries integer;
  occupied_entries integer;
  remaining_entries integer;
  notification_title text;
  notification_body text;
begin
  if new.status not in ('PENDING', 'CONFIRMED') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.tournament_id is not distinct from new.tournament_id
     and old.category_id is not distinct from new.category_id
     and old.status in ('PENDING', 'CONFIRMED') then
    return new;
  end if;

  select tournament.name, category.name, category.max_entries
    into tournament_name, category_name, category_max_entries
  from public.tournament_categories as category
  join public.tournaments as tournament
    on tournament.id = category.tournament_id
  where category.id = new.category_id
    and category.tournament_id = new.tournament_id;

  if category_max_entries is null then
    return new;
  end if;

  select count(*)::integer
    into occupied_entries
  from public.tournament_registrations as registration
  where registration.tournament_id = new.tournament_id
    and registration.category_id = new.category_id
    and registration.status in ('PENDING', 'CONFIRMED');

  remaining_entries := greatest(category_max_entries - occupied_entries, 0);
  if remaining_entries > 2 then
    return new;
  end if;

  notification_title := case
    when remaining_entries = 0 then 'Classe lotada · ' || left(category_name, 100)
    when remaining_entries = 1 then 'Última vaga · ' || left(category_name, 100)
    else 'Poucas vagas · ' || left(category_name, 100)
  end;
  notification_body := case
    when remaining_entries = 0 then
      left(category_name, 100) || ' do ' || left(tournament_name, 120) ||
      ' ficou lotada. Abra mais vagas no ADM se desejar.'
    when remaining_entries = 1 then
      'Resta somente 1 vaga em ' || left(category_name, 100) || ' do ' ||
      left(tournament_name, 120) || '.'
    else
      'Restam somente 2 vagas em ' || left(category_name, 100) || ' do ' ||
      left(tournament_name, 120) || '.'
  end;

  insert into public.app_client_notifications (
    user_id,
    title,
    body,
    link_url,
    event_type,
    dedupe_key
  )
  select
    profile.id,
    left(notification_title, 90),
    left(notification_body, 280),
    '/adm?module=tournaments',
    'TORNEIO_INSCRICAO',
    'tournament-capacity:' || new.category_id::text ||
      ':max:' || category_max_entries::text ||
      ':remaining:' || remaining_entries::text ||
      ':adm:' || profile.id::text
  from public.profiles as profile
  join auth.users as auth_user
    on auth_user.id = profile.id
  join public.protected_access_accounts as protected_account
    on protected_account.email = lower(trim(auth_user.email))
   and protected_account.role = profile.role
   and protected_account.active is true
  where profile.active is true
    and (
      profile.role = 'admin'
      or (
        coalesce(profile.permissions, '[]'::jsonb) ? 'tournaments'
        and coalesce(protected_account.permissions, '[]'::jsonb) ? 'tournaments'
        and coalesce(profile.permissions, '[]'::jsonb) ? 'communication'
        and coalesce(protected_account.permissions, '[]'::jsonb) ? 'communication'
      )
    )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return new;
end;
$$;

alter function private.notify_tournament_capacity_warning()
  owner to postgres;
revoke all on function private.notify_tournament_capacity_warning()
  from public, anon, authenticated, service_role;

drop trigger if exists notify_tournament_capacity_warning_on_insert
  on public.tournament_registrations;
create trigger notify_tournament_capacity_warning_on_insert
after insert on public.tournament_registrations
for each row execute function private.notify_tournament_capacity_warning();

drop trigger if exists notify_tournament_capacity_warning_on_update
  on public.tournament_registrations;
create trigger notify_tournament_capacity_warning_on_update
after update of tournament_id, category_id, status
on public.tournament_registrations
for each row execute function private.notify_tournament_capacity_warning();

-- Seed at most one alert per current threshold/admin. The same partial unique
-- key used by the trigger makes this safe if an alert already exists.
with category_capacity as (
  select
    tournament.id as tournament_id,
    tournament.name as tournament_name,
    category.id as category_id,
    category.name as category_name,
    category.max_entries,
    greatest(category.max_entries - count(registration.id)::integer, 0) as remaining_entries
  from public.tournaments as tournament
  join public.tournament_categories as category
    on category.tournament_id = tournament.id
  left join public.tournament_registrations as registration
   on registration.tournament_id = tournament.id
   and registration.category_id = category.id
   and registration.status in ('PENDING', 'CONFIRMED')
  where tournament.status = 'REGISTRATION_OPEN'
    and tournament.registration_open is true
    and tournament.is_published is true
    and category.active is true
    and category.is_published is true
    and category.registration_open is true
    and category.max_entries is not null
  group by
    tournament.id,
    tournament.name,
    category.id,
    category.name,
    category.max_entries
), capacity_warning as (
  select capacity.*
  from category_capacity as capacity
  where capacity.remaining_entries between 0 and 2
), recipient as (
  select profile.id
  from public.profiles as profile
  join auth.users as auth_user
    on auth_user.id = profile.id
  join public.protected_access_accounts as protected_account
    on protected_account.email = lower(trim(auth_user.email))
   and protected_account.role = profile.role
   and protected_account.active is true
  where profile.active is true
    and (
      profile.role = 'admin'
      or (
        coalesce(profile.permissions, '[]'::jsonb) ? 'tournaments'
        and coalesce(protected_account.permissions, '[]'::jsonb) ? 'tournaments'
        and coalesce(profile.permissions, '[]'::jsonb) ? 'communication'
        and coalesce(protected_account.permissions, '[]'::jsonb) ? 'communication'
      )
    )
)
insert into public.app_client_notifications (
  user_id,
  title,
  body,
  link_url,
  event_type,
  dedupe_key
)
select
  recipient.id,
  left(case
    when capacity_warning.remaining_entries = 0 then
      'Classe lotada · ' || left(capacity_warning.category_name, 100)
    when capacity_warning.remaining_entries = 1 then
      'Última vaga · ' || left(capacity_warning.category_name, 100)
    else
      'Poucas vagas · ' || left(capacity_warning.category_name, 100)
  end, 90),
  left(case
    when capacity_warning.remaining_entries = 0 then
      left(capacity_warning.category_name, 100) || ' do ' ||
      left(capacity_warning.tournament_name, 120) ||
      ' ficou lotada. Abra mais vagas no ADM se desejar.'
    when capacity_warning.remaining_entries = 1 then
      'Resta somente 1 vaga em ' || left(capacity_warning.category_name, 100) ||
      ' do ' || left(capacity_warning.tournament_name, 120) || '.'
    else
      'Restam somente 2 vagas em ' || left(capacity_warning.category_name, 100) ||
      ' do ' || left(capacity_warning.tournament_name, 120) || '.'
  end, 280),
  '/adm?module=tournaments',
  'TORNEIO_INSCRICAO',
  'tournament-capacity:' || capacity_warning.category_id::text ||
    ':max:' || capacity_warning.max_entries::text ||
    ':remaining:' || capacity_warning.remaining_entries::text ||
    ':adm:' || recipient.id::text
from capacity_warning
cross join recipient
on conflict (dedupe_key) where dedupe_key is not null do nothing;

commit;
