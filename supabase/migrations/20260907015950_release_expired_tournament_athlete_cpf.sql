begin;

alter table public.tournaments
  add column if not exists spatial_portal_token_ciphertext text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'tournaments_spatial_portal_token_ciphertext_check'
      and conrelid = 'public.tournaments'::regclass
  ) then
    alter table public.tournaments
      add constraint tournaments_spatial_portal_token_ciphertext_check
      check (
        spatial_portal_token_ciphertext is null
        or spatial_portal_token_ciphertext ~ '^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{60,120}$'
      );
  end if;
end;
$$;

-- The private Classe Espacial window is controlled by its own `enabled`
-- capability. Upgrade the already-deployed claim RPC so closing the main
-- registration does not silently disable the separate add-on portal. The
-- definition check fails closed if the upstream function ever changes shape.
do $$
declare
  function_oid regprocedure := to_regprocedure(
    'public.claim_private_tournament_spatial_addon_checkout(uuid,uuid,uuid,uuid,text,text)'
  );
  function_security_definer boolean;
  function_config text[];
  current_definition text;
  updated_definition text;
begin
  if function_oid is null then
    raise exception 'RPC da Classe Espacial não encontrada.';
  end if;

  select procedure.prosecdef, procedure.proconfig, pg_get_functiondef(procedure.oid)
    into function_security_definer, function_config, current_definition
  from pg_catalog.pg_proc as procedure
  where procedure.oid = function_oid;

  if function_security_definer is distinct from true
     or not coalesce('search_path=""' = any(function_config), false)
     or current_definition not like '%auth.jwt() ->> ''role''%service_role%'
     or current_definition not like '%tournament.is_published = true%'
     or current_definition not like '%spatial_addon_portal,enabled%true%' then
    raise exception 'A proteção da RPC da Classe Espacial está incompleta.';
  end if;

  if current_definition like '%tournament.status in (''REGISTRATION_OPEN'', ''REGISTRATION_CLOSED'', ''IN_PROGRESS'')%' then
    if current_definition like '%tournament.registration_open = true%'
       or current_definition like '%tournament.registration_opens_at is null%'
       or current_definition like '%tournament.registration_closes_at is null%' then
      raise exception 'A RPC da Classe Espacial está parcialmente atualizada.';
    end if;
    return;
  end if;
  if current_definition not like '%tournament.status = ''REGISTRATION_OPEN''%'
     or current_definition not like '%tournament.registration_open = true%'
     or current_definition not like '%tournament.registration_opens_at is null%'
     or current_definition not like '%tournament.registration_closes_at is null%' then
    raise exception 'A proteção atual da Classe Espacial não corresponde à versão esperada.';
  end if;

  updated_definition := replace(
    current_definition,
    'tournament.status = ''REGISTRATION_OPEN''',
    'tournament.status in (''REGISTRATION_OPEN'', ''REGISTRATION_CLOSED'', ''IN_PROGRESS'')'
  );
  updated_definition := replace(updated_definition, E'    and tournament.registration_open = true\n', '');
  updated_definition := replace(
    updated_definition,
    E'    and (tournament.registration_opens_at is null or tournament.registration_opens_at <= now())\n',
    ''
  );
  updated_definition := replace(
    updated_definition,
    E'    and (tournament.registration_closes_at is null or tournament.registration_closes_at >= now())\n',
    ''
  );

  if updated_definition like '%tournament.registration_open = true%'
     or updated_definition like '%tournament.registration_opens_at is null%'
     or updated_definition like '%tournament.registration_closes_at is null%'
     or updated_definition not like '%tournament.status in (''REGISTRATION_OPEN'', ''REGISTRATION_CLOSED'', ''IN_PROGRESS'')%' then
    raise exception 'Não foi possível desacoplar com segurança a Classe Espacial.';
  end if;

  execute updated_definition;
end;
$$;

-- This helper is deliberately private and executable only by its owner. Every
-- caller must supply IDs from an archived registration snapshot; the predicates
-- below are repeated at deletion time so a newly-created dependency fails closed.
create or replace function private.delete_orphaned_public_tournament_athletes(
  p_athlete_ids uuid[]
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  deleted_count integer := 0;
begin
  if coalesce(pg_catalog.cardinality(p_athlete_ids), 0) = 0 then
    return 0;
  end if;

  delete from public.tournament_athletes as athlete
  where athlete.id = any(p_athlete_ids)
    and (
      athlete.source_key ~ '^public:[0-9a-f]{64}$'
      or athlete.source_key ~ '^tournament-family:[0-9a-f]{64}$'
    )
    and athlete.auth_user_id is null
    and athlete.app_client_id is null
    and athlete.created_by is null
    and not exists (
      select 1
      from public.tournament_registrations as registration
      where registration.athlete_id = athlete.id
    )
    and not exists (
      select 1
      from public.tournament_registration_orders as registration_order
      where registration_order.athlete_id = athlete.id
    )
    and not exists (
      select 1
      from public.tournament_matches as tournament_match
      where tournament_match.side1_athlete_id = athlete.id
         or tournament_match.side2_athlete_id = athlete.id
         or tournament_match.winner_athlete_id = athlete.id
    )
    and not exists (
      select 1
      from public.tournament_live_state as live_state
      where live_state.side1_athlete_id = athlete.id
         or live_state.side2_athlete_id = athlete.id
         or live_state.winner_athlete_id = athlete.id
    );

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function private.delete_orphaned_public_tournament_athletes(uuid[])
  from public, anon, authenticated, service_role;

-- Preserve the legacy one-argument entry point used by the atomic family
-- checkout, adding only orphan cleanup after the archived registrations are gone.
create or replace function public.archive_expired_tournament_payment(
  p_payment_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.tournament_payments%rowtype;
  primary_registration_id uuid;
  athlete_id uuid;
  target_group_id uuid;
  registration_snapshot jsonb;
  snapshot_athlete_ids uuid[] := '{}'::uuid[];
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;

  select payment.*
    into payment_row
  from public.tournament_payments as payment
  where payment.id = p_payment_id
  for update;

  if not found
     or payment_row.status in (
       'RECEIVED', 'CONFIRMED', 'REVIEW_REQUIRED', 'PARTIALLY_REFUNDED',
       'REFUNDED', 'CANCELLED', 'CHARGEBACK'
     )
     or payment_row.expires_at is null
     or payment_row.expires_at > now() then
    return false;
  end if;

  select coalesce(registration.parent_registration_id, registration.id),
         registration.athlete_id,
         registration.registration_group_id
    into primary_registration_id, athlete_id, target_group_id
  from public.tournament_registrations as registration
  where registration.id = payment_row.registration_id
  for update;

  if primary_registration_id is null then
    delete from public.tournament_payments where id = payment_row.id;
    return true;
  end if;

  select
    coalesce(
      jsonb_agg(to_jsonb(registration) order by registration.created_at, registration.id),
      '[]'::jsonb
    ),
    coalesce(
      array_agg(distinct registration.athlete_id)
        filter (where registration.athlete_id is not null),
      '{}'::uuid[]
    )
    into registration_snapshot, snapshot_athlete_ids
  from public.tournament_registrations as registration
  where case
    when target_group_id is not null then registration.registration_group_id = target_group_id
    else registration.id = primary_registration_id
      or registration.parent_registration_id = primary_registration_id
  end;

  insert into private.tournament_expired_registration_attempts (
    tournament_id,
    athlete_id,
    primary_registration_id,
    payment_id,
    registration_group_id,
    registration_snapshot,
    payment_snapshot,
    expired_at
  ) values (
    payment_row.tournament_id,
    athlete_id,
    primary_registration_id,
    payment_row.id,
    target_group_id,
    registration_snapshot,
    to_jsonb(payment_row) - 'raw_response' - 'pix_payload' - 'pix_encoded_image',
    now()
  ) on conflict (payment_id) do nothing;

  delete from public.tournament_payments
  where id = payment_row.id;

  if target_group_id is not null then
    delete from public.tournament_registrations
    where tournament_registrations.registration_group_id = target_group_id;
    delete from public.tournament_registration_groups
    where id = target_group_id;
  else
    delete from public.tournament_registrations
    where id = primary_registration_id;
  end if;

  perform private.delete_orphaned_public_tournament_athletes(snapshot_athlete_ids);

  return true;
end;
$$;

revoke all on function public.archive_expired_tournament_payment(uuid)
  from public, anon, authenticated;
grant execute on function public.archive_expired_tournament_payment(uuid)
  to service_role;

-- Compare-and-swap overload used by the expiry worker after provider I/O.
create or replace function public.archive_expired_tournament_payment(
  p_payment_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.tournament_payments%rowtype;
  primary_registration_id uuid;
  athlete_id uuid;
  target_group_id uuid;
  registration_snapshot jsonb;
  snapshot_athlete_ids uuid[] := '{}'::uuid[];
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;

  select payment.*
    into payment_row
  from public.tournament_payments as payment
  where payment.id = p_payment_id
  for update;

  if not found
     or payment_row.status is distinct from p_expected_status
     or payment_row.updated_at is distinct from p_expected_updated_at
     or payment_row.status not in ('CREATED', 'RECONCILING', 'PENDING', 'FAILED', 'OVERDUE')
     or payment_row.expires_at is null
     or payment_row.expires_at > now()
     or (
       payment_row.status in ('CREATED', 'RECONCILING')
       and payment_row.provider_attempted_at is not null
       and payment_row.provider_attempted_at > clock_timestamp() - interval '3 minutes'
     ) then
    return false;
  end if;

  select coalesce(registration.parent_registration_id, registration.id),
         registration.athlete_id,
         registration.registration_group_id
    into primary_registration_id, athlete_id, target_group_id
  from public.tournament_registrations as registration
  where registration.id = payment_row.registration_id
  for update;

  if primary_registration_id is null then
    delete from public.tournament_payments where id = payment_row.id;
    return true;
  end if;

  select
    coalesce(
      jsonb_agg(to_jsonb(registration) order by registration.created_at, registration.id),
      '[]'::jsonb
    ),
    coalesce(
      array_agg(distinct registration.athlete_id)
        filter (where registration.athlete_id is not null),
      '{}'::uuid[]
    )
    into registration_snapshot, snapshot_athlete_ids
  from public.tournament_registrations as registration
  where case
    when target_group_id is not null then registration.registration_group_id = target_group_id
    else registration.id = primary_registration_id
      or registration.parent_registration_id = primary_registration_id
  end;

  insert into private.tournament_expired_registration_attempts (
    tournament_id,
    athlete_id,
    primary_registration_id,
    payment_id,
    registration_group_id,
    registration_snapshot,
    payment_snapshot,
    expired_at
  ) values (
    payment_row.tournament_id,
    athlete_id,
    primary_registration_id,
    payment_row.id,
    target_group_id,
    registration_snapshot,
    to_jsonb(payment_row) - 'raw_response' - 'pix_payload' - 'pix_encoded_image',
    now()
  ) on conflict (payment_id) do nothing;

  delete from public.tournament_payments
  where id = payment_row.id;

  if target_group_id is not null then
    delete from public.tournament_registrations
    where tournament_registrations.registration_group_id = target_group_id;
    delete from public.tournament_registration_groups
    where id = target_group_id;
  else
    delete from public.tournament_registrations
    where id = primary_registration_id;
  end if;

  perform private.delete_orphaned_public_tournament_athletes(snapshot_athlete_ids);

  return true;
end;
$$;

revoke all on function public.archive_expired_tournament_payment(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.archive_expired_tournament_payment(uuid, text, timestamptz)
  to service_role;

-- Returns identifiers only. The archived snapshots are the capability boundary:
-- no athlete is listed merely because it happens to be an orphan.
create or replace function public.list_incomplete_tournament_athlete_ids(
  p_tournament_id uuid
)
returns table (athlete_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;

  if p_tournament_id is null then
    raise exception using errcode = '22023', message = 'Torneio inválido.';
  end if;

  return query
  with snapshot_athlete_ids as (
    select distinct (snapshot_entry.value ->> 'athlete_id')::uuid as athlete_id
    from private.tournament_expired_registration_attempts as attempt
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(attempt.registration_snapshot) = 'array'
          then attempt.registration_snapshot
        else '[]'::jsonb
      end
    ) as snapshot_entry(value)
    where attempt.tournament_id = p_tournament_id
      and coalesce(snapshot_entry.value ->> 'athlete_id', '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  select athlete.id
  from snapshot_athlete_ids as candidate
  join public.tournament_athletes as athlete
    on athlete.id = candidate.athlete_id
  where (
      athlete.source_key ~ '^public:[0-9a-f]{64}$'
      or athlete.source_key ~ '^tournament-family:[0-9a-f]{64}$'
    )
    and athlete.auth_user_id is null
    and athlete.app_client_id is null
    and athlete.created_by is null
    and not exists (
      select 1
      from public.tournament_registrations as registration
      where registration.athlete_id = athlete.id
    )
    and not exists (
      select 1
      from public.tournament_registration_orders as registration_order
      where registration_order.athlete_id = athlete.id
    )
    and not exists (
      select 1
      from public.tournament_matches as tournament_match
      where tournament_match.side1_athlete_id = athlete.id
         or tournament_match.side2_athlete_id = athlete.id
         or tournament_match.winner_athlete_id = athlete.id
    )
    and not exists (
      select 1
      from public.tournament_live_state as live_state
      where live_state.side1_athlete_id = athlete.id
         or live_state.side2_athlete_id = athlete.id
         or live_state.winner_athlete_id = athlete.id
    )
  order by athlete.id;
end;
$$;

revoke all on function public.list_incomplete_tournament_athlete_ids(uuid)
  from public, anon, authenticated;
grant execute on function public.list_incomplete_tournament_athlete_ids(uuid)
  to service_role;

-- Atomically rebinds an abandoned public athlete to the contact fingerprint of
-- a fresh checkout. A CPF match alone is never enough when any durable
-- tournament relationship still exists.
create or replace function public.claim_incomplete_tournament_athlete(
  p_athlete_id uuid,
  p_cpf text,
  p_new_source_key text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_gender text,
  p_city text
)
returns public.tournament_athletes
language plpgsql
security definer
set search_path = ''
as $$
declare
  athlete_row public.tournament_athletes%rowtype;
  normalized_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  normalized_name text := trim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
  normalized_email text := lower(trim(coalesce(p_email, '')));
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  normalized_gender text := upper(trim(coalesce(p_gender, '')));
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;

  if p_athlete_id is null
     or normalized_cpf !~ '^[0-9]{11}$'
     or coalesce(p_new_source_key, '') !~ '^public:[0-9a-f]{64}$'
     or length(normalized_name) < 2
     or normalized_email !~ '^\S+@\S+\.\S+$'
     or length(normalized_phone) not between 10 and 13
     or normalized_gender not in ('MALE', 'FEMALE', 'OTHER', 'NOT_INFORMED') then
    raise exception using errcode = '22023', message = 'Dados do atleta inválidos.';
  end if;

  select athlete.*
    into athlete_row
  from public.tournament_athletes as athlete
  where athlete.id = p_athlete_id
  for update;

  if not found then
    return null;
  end if;

  if not coalesce(athlete_row.source_key ~ '^public:[0-9a-f]{64}$', false)
     or athlete_row.auth_user_id is not null
     or athlete_row.app_client_id is not null
     or athlete_row.created_by is not null
     or regexp_replace(coalesce(athlete_row.cpf, ''), '[^0-9]', '', 'g') <> normalized_cpf
     or exists (
       select 1
       from public.tournament_registrations as registration
       where registration.athlete_id = athlete_row.id
     )
     or exists (
       select 1
       from public.tournament_registration_orders as registration_order
       where registration_order.athlete_id = athlete_row.id
     )
     or exists (
       select 1
       from public.tournament_matches as tournament_match
       where tournament_match.side1_athlete_id = athlete_row.id
          or tournament_match.side2_athlete_id = athlete_row.id
          or tournament_match.winner_athlete_id = athlete_row.id
     )
     or exists (
       select 1
       from public.tournament_live_state as live_state
       where live_state.side1_athlete_id = athlete_row.id
          or live_state.side2_athlete_id = athlete_row.id
          or live_state.winner_athlete_id = athlete_row.id
     ) then
    return null;
  end if;

  update public.tournament_athletes as athlete
  set source_key = p_new_source_key,
      full_name = normalized_name,
      email = normalized_email,
      phone = normalized_phone,
      cpf = normalized_cpf,
      gender = normalized_gender,
      city = nullif(trim(coalesce(p_city, '')), ''),
      active = true,
      status = 'ACTIVE',
      updated_at = now()
  where athlete.id = athlete_row.id
  returning athlete.* into athlete_row;

  return athlete_row;
end;
$$;

revoke all on function public.claim_incomplete_tournament_athlete(
  uuid, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.claim_incomplete_tournament_athlete(
  uuid, text, text, text, text, text, text, text
) to service_role;

create or replace function public.delete_incomplete_tournament_athlete(
  p_tournament_id uuid,
  p_athlete_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;

  if p_tournament_id is null or p_athlete_id is null then
    raise exception using errcode = '22023', message = 'Torneio ou atleta inválido.';
  end if;

  perform 1
  from public.tournament_athletes as athlete
  where athlete.id = p_athlete_id
  for update;

  if not found then
    return false;
  end if;

  if not exists (
    select 1
    from public.list_incomplete_tournament_athlete_ids(p_tournament_id) as candidate
    where candidate.athlete_id = p_athlete_id
  ) then
    return false;
  end if;

  deleted_count := private.delete_orphaned_public_tournament_athletes(array[p_athlete_id]);
  return deleted_count = 1;
end;
$$;

revoke all on function public.delete_incomplete_tournament_athlete(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_incomplete_tournament_athlete(uuid, uuid)
  to service_role;

-- One-time repair for failed/expired checkouts that predate automatic cleanup.
-- Only athlete IDs embedded in an archived registration snapshot are candidates.
do $$
declare
  archived_athlete_ids uuid[] := '{}'::uuid[];
begin
  select coalesce(array_agg(distinct candidate.athlete_id), '{}'::uuid[])
    into archived_athlete_ids
  from (
    select (snapshot_entry.value ->> 'athlete_id')::uuid as athlete_id
    from private.tournament_expired_registration_attempts as attempt
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(attempt.registration_snapshot) = 'array'
          then attempt.registration_snapshot
        else '[]'::jsonb
      end
    ) as snapshot_entry(value)
    where coalesce(snapshot_entry.value ->> 'athlete_id', '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) as candidate;

  perform private.delete_orphaned_public_tournament_athletes(archived_athlete_ids);
end;
$$;

commit;
