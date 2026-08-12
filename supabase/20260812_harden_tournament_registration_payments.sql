-- Serialize public registration capacity checks and make webhook processing reclaimable.

alter table public.asaas_webhook_events
  add column if not exists processing_token uuid,
  add column if not exists processing_started_at timestamptz;

create or replace function public.tournament_claim_public_registration(
  p_tournament_id uuid,
  p_category_id uuid,
  p_athlete_id uuid,
  p_public_name text,
  p_public_city text default null,
  p_public_club text default null,
  p_partner_name text default null,
  p_shirt_size text default null,
  p_total_amount numeric default 0,
  p_notes text default null
)
returns public.tournament_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_row public.tournament_categories%rowtype;
  registration_row public.tournament_registrations%rowtype;
  occupied_count integer;
  next_status text := 'PENDING';
  next_payment_status text := 'PENDING';
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if p_tournament_id is null or p_category_id is null or p_athlete_id is null then
    raise exception using errcode = '22023', message = 'Inscrição inválida.';
  end if;
  if length(trim(coalesce(p_public_name, ''))) < 2 then
    raise exception using errcode = '22023', message = 'Nome inválido.';
  end if;
  if coalesce(p_total_amount, 0) < 0 then
    raise exception using errcode = '22023', message = 'Valor inválido.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_category_id::text, 0));

  select * into category_row
  from public.tournament_categories
  where id = p_category_id
    and tournament_id = p_tournament_id
    and active = true
    and registration_open = true
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Categoria indisponível para inscrição.';
  end if;

  if not exists (
    select 1
    from public.tournaments t
    where t.id = p_tournament_id
      and t.is_published = true
      and t.status = 'REGISTRATION_OPEN'
      and t.registration_open = true
      and (t.registration_opens_at is null or t.registration_opens_at <= now())
      and (t.registration_closes_at is null or t.registration_closes_at >= now())
  ) then
    raise exception using errcode = 'P0002', message = 'Torneio indisponível para inscrição.';
  end if;

  if not exists (
    select 1
    from public.tournament_athletes a
    where a.id = p_athlete_id and a.active = true
  ) then
    raise exception using errcode = 'P0002', message = 'Atleta inválido.';
  end if;

  select * into registration_row
  from public.tournament_registrations
  where tournament_id = p_tournament_id
    and category_id = p_category_id
    and athlete_id = p_athlete_id;

  if found then
    return registration_row;
  end if;

  if category_row.max_entries is not null then
    select count(*)::integer into occupied_count
    from public.tournament_registrations
    where category_id = p_category_id
      and status in ('PENDING', 'CONFIRMED');

    if occupied_count >= category_row.max_entries then
      next_status := 'WAITLIST';
      next_payment_status := 'NOT_REQUIRED';
    end if;
  end if;

  if greatest(coalesce(p_total_amount, 0), 0) = 0 and next_status <> 'WAITLIST' then
    next_status := 'CONFIRMED';
    next_payment_status := 'NOT_REQUIRED';
  end if;

  insert into public.tournament_registrations (
    tournament_id, category_id, athlete_id, public_name, public_city, public_club,
    partner_name, shirt_size, status, payment_status, total_amount, source,
    published, notes, terms_accepted_at, confirmed_at
  ) values (
    p_tournament_id, p_category_id, p_athlete_id, trim(p_public_name), nullif(trim(p_public_city), ''),
    nullif(trim(p_public_club), ''), nullif(trim(p_partner_name), ''), nullif(trim(p_shirt_size), ''),
    next_status, next_payment_status, greatest(coalesce(p_total_amount, 0), 0), 'PUBLIC', true,
    nullif(trim(p_notes), ''), now(), case when next_status = 'CONFIRMED' then now() else null end
  )
  returning * into registration_row;

  return registration_row;
end;
$$;

revoke all on function public.tournament_claim_public_registration(uuid, uuid, uuid, text, text, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.tournament_claim_public_registration(uuid, uuid, uuid, text, text, text, text, text, numeric, text) to service_role;

create or replace function public.claim_asaas_webhook_event(
  p_event_id text,
  p_event_type text,
  p_provider_payment_id text,
  p_payload jsonb,
  p_processing_token uuid,
  p_stale_after interval default interval '60 seconds'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.asaas_webhook_events%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if nullif(trim(p_event_id), '') is null or p_processing_token is null then
    raise exception using errcode = '22023', message = 'Evento inválido.';
  end if;
  if nullif(trim(p_event_type), '') is null or nullif(trim(p_provider_payment_id), '') is null then
    raise exception using errcode = '22023', message = 'Evento incompleto.';
  end if;

  insert into public.asaas_webhook_events (
    event_id, event_type, provider_payment_id, payload, status,
    processing_token, processing_started_at
  ) values (
    trim(p_event_id), trim(p_event_type), nullif(trim(p_provider_payment_id), ''),
    coalesce(p_payload, '{}'::jsonb), 'PENDING', p_processing_token, now()
  )
  on conflict (event_id) do nothing
  returning * into event_row;

  if found then
    return 'CLAIMED';
  end if;

  select * into event_row
  from public.asaas_webhook_events
  where event_id = trim(p_event_id)
  for update;

  if event_row.status in ('PROCESSED', 'IGNORED') then
    return 'DONE';
  end if;

  if event_row.status = 'PENDING'
     and event_row.processing_started_at is not null
     and event_row.processing_started_at >= now() - greatest(p_stale_after, interval '10 seconds') then
    return 'BUSY';
  end if;

  if event_row.status not in ('PENDING', 'FAILED') then
    return 'BUSY';
  end if;

  update public.asaas_webhook_events
  set status = 'PENDING',
      event_type = trim(p_event_type),
      provider_payment_id = nullif(trim(p_provider_payment_id), ''),
      payload = coalesce(p_payload, '{}'::jsonb),
      processing_token = p_processing_token,
      processing_started_at = now(),
      processed_at = null,
      error = null
  where id = event_row.id;

  return 'CLAIMED';
end;
$$;

revoke all on function public.claim_asaas_webhook_event(text, text, text, jsonb, uuid, interval) from public, anon, authenticated;
grant execute on function public.claim_asaas_webhook_event(text, text, text, jsonb, uuid, interval) to service_role;
