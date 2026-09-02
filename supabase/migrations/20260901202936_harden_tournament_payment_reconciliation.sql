begin;

alter table public.tournament_payments
  add column if not exists provider_environment text not null default 'UNKNOWN',
  add column if not exists provider_attempted_at timestamptz,
  add column if not exists reconciliation_started_at timestamptz,
  add column if not exists next_reconciliation_at timestamptz,
  add column if not exists reconciliation_attempts integer not null default 0;

alter table public.asaas_webhook_events
  add column if not exists processing_token uuid,
  add column if not exists processing_started_at timestamptz;

alter table public.tournament_registrations
  add column if not exists request_token uuid;

-- Provider IDs are unique only inside one Asaas environment. Replace the
-- legacy cross-environment constraint before any production identifier can be
-- persisted, while preserving the stronger uniqueness inside each account.
alter table public.tournament_payments
  drop constraint if exists tournament_payments_provider_provider_payment_id_key;
drop index if exists public.tournament_payments_provider_provider_payment_id_key;
create unique index if not exists tournament_payments_provider_environment_payment_id_uq
  on public.tournament_payments(provider, provider_environment, provider_payment_id)
  where provider_payment_id is not null;

create unique index if not exists tournament_registrations_request_token_uq
  on public.tournament_registrations(request_token)
  where request_token is not null and parent_registration_id is null;

alter table public.tournament_payments
  drop constraint if exists tournament_payments_status_check,
  drop constraint if exists tournament_payments_provider_environment_check,
  drop constraint if exists tournament_payments_reconciliation_attempts_check;

alter table public.tournament_registrations
  drop constraint if exists tournament_registrations_payment_status_check;

-- Provider identifiers are scoped to exactly one Asaas account/environment.
-- Historical rows predate that invariant and must never be queried with the
-- newly configured key until an operator reconciles them explicitly.
update public.tournament_registrations as registration
set status = 'PENDING',
    payment_status = 'PENDING',
    paid_amount = 0,
    confirmed_at = null,
    cancelled_at = null,
    updated_at = now()
where exists (
  select 1
  from public.tournament_payments as payment
  where payment.provider = 'ASAAS'
    and payment.provider_environment = 'UNKNOWN'
    and (
      payment.provider_payment_id is not null
      or payment.provider_attempted_at is not null
      or payment.status not in ('CREATED', 'FAILED')
    )
    and (
      registration.id = payment.registration_id
      or registration.parent_registration_id = payment.registration_id
      or (payment.registration_group_id is not null and registration.registration_group_id = payment.registration_group_id)
    )
);

update public.tournament_registration_groups as registration_group
set status = 'PENDING',
    updated_at = now()
where registration_group.id in (
  select payment.registration_group_id
  from public.tournament_payments as payment
  where payment.provider = 'ASAAS'
    and payment.provider_environment = 'UNKNOWN'
    and (
      payment.provider_payment_id is not null
      or payment.provider_attempted_at is not null
      or payment.status not in ('CREATED', 'FAILED')
    )
    and payment.registration_group_id is not null
);

update public.tournament_payments
set status = 'REVIEW_REQUIRED',
    invoice_url = null,
    pix_payload = null,
    pix_encoded_image = null,
    pix_expires_at = null,
    paid_at = null,
    reconciliation_started_at = coalesce(reconciliation_started_at, now()),
    next_reconciliation_at = null,
    raw_response = jsonb_build_object(
      'error_code', 'provider_environment_unknown',
      'requires_manual_review', true
    ),
    updated_at = now()
where provider = 'ASAAS'
  and provider_environment = 'UNKNOWN'
  and (
    provider_payment_id is not null
    or provider_attempted_at is not null
    or status not in ('CREATED', 'FAILED')
  );

update public.tournament_payments
set status = 'CANCELLED',
    next_reconciliation_at = coalesce(next_reconciliation_at, now()),
    updated_at = now()
where status = 'CHARGEBACK'
  and provider = 'ASAAS'
  and provider_environment <> 'UNKNOWN';

alter table public.tournament_payments
  add constraint tournament_payments_status_check
    check (status in (
      'CREATED', 'RECONCILING', 'PENDING', 'RECEIVED', 'CONFIRMED',
      'REVIEW_REQUIRED', 'PARTIALLY_REFUNDED', 'OVERDUE', 'REFUNDED', 'CANCELLED',
      'CHARGEBACK', 'FAILED'
    )),
  add constraint tournament_payments_provider_environment_check
    check (provider_environment in ('SANDBOX', 'PRODUCTION', 'UNKNOWN')),
  add constraint tournament_payments_reconciliation_attempts_check
    check (reconciliation_attempts >= 0);

alter table public.tournament_registrations
  add constraint tournament_registrations_payment_status_check
    check (payment_status in (
      'NOT_REQUIRED', 'PENDING', 'PAID', 'PARTIALLY_REFUNDED',
      'OVERDUE', 'REFUNDED', 'CANCELLED'
    ));

update public.tournament_payments
set next_reconciliation_at = coalesce(next_reconciliation_at, now()),
    reconciliation_started_at = case
      when status = 'CONFIRMED'
        then coalesce(reconciliation_started_at, updated_at, created_at, now())
      else reconciliation_started_at
    end
where status in ('RECONCILING', 'PENDING', 'CONFIRMED', 'REVIEW_REQUIRED', 'PARTIALLY_REFUNDED', 'RECEIVED', 'CANCELLED', 'OVERDUE')
  and provider = 'ASAAS'
  and provider_environment <> 'UNKNOWN'
  and provider_payment_id is not null;

drop index if exists public.tournament_payments_expiry_due_idx;
drop index if exists public.tournament_payments_expiry_idx;
create index tournament_payments_expiry_idx
  on public.tournament_payments(expires_at, id)
  where provider = 'ASAAS'
    and status in ('CREATED', 'RECONCILING', 'PENDING', 'FAILED', 'OVERDUE');

drop index if exists public.tournament_payments_reconciliation_due_idx;
create index tournament_payments_reconciliation_due_idx
  on public.tournament_payments(next_reconciliation_at, id)
  where provider = 'ASAAS'
    and status in ('RECONCILING', 'PENDING', 'CONFIRMED', 'REVIEW_REQUIRED', 'PARTIALLY_REFUNDED', 'RECEIVED', 'CANCELLED', 'OVERDUE')
    and next_reconciliation_at is not null;

-- The environment parameter changes the function identity. Remove the legacy
-- overload so no service-role caller can create an environment-less payment.
drop function if exists public.claim_public_tournament_registration_checkout(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, text, text
);

create or replace function public.claim_public_tournament_registration_checkout(
  p_tournament_id uuid,
  p_request_token uuid,
  p_primary_category_id uuid,
  p_additional_category_id uuid,
  p_athlete_id uuid,
  p_public_name text,
  p_public_city text default null,
  p_public_club text default null,
  p_partner_name text default null,
  p_shirt_size text default null,
  p_primary_amount numeric default 0,
  p_billing_type text default 'PIX',
  p_provider_environment text default 'UNKNOWN',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  bundle jsonb;
  primary_registration public.tournament_registrations%rowtype;
  additional_registration public.tournament_registrations%rowtype;
  payment_row public.tournament_payments%rowtype;
  total_amount numeric := 0;
  payment_created boolean := false;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if p_tournament_id is null
     or p_request_token is null
     or p_primary_category_id is null
     or p_athlete_id is null then
    raise exception using errcode = '22023', message = 'Tentativa de inscrição inválida.';
  end if;
  if p_provider_environment not in ('SANDBOX', 'PRODUCTION') then
    raise exception using errcode = '22023', message = 'Ambiente do provedor inválido.';
  end if;
  if upper(coalesce(p_billing_type, '')) <> 'PIX' then
    raise exception using errcode = '22023', message = 'Forma de pagamento do provedor inválida.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_token::text, 20260901184500)
  );

  select registration.*
    into primary_registration
  from public.tournament_registrations as registration
  where registration.request_token = p_request_token
    and registration.parent_registration_id is null
  for update;

  if found then
    if primary_registration.tournament_id <> p_tournament_id
       or primary_registration.category_id <> p_primary_category_id
       or primary_registration.athlete_id <> p_athlete_id then
      raise exception using errcode = '42501', message = 'Esta tentativa não corresponde à inscrição informada.';
    end if;

    select registration.*
      into additional_registration
    from public.tournament_registrations as registration
    where registration.parent_registration_id = primary_registration.id
    order by registration.created_at, registration.id
    limit 1;

    if p_additional_category_id is distinct from additional_registration.category_id then
      raise exception using errcode = '42501', message = 'Esta tentativa não corresponde às classes informadas.';
    end if;

    select payment.*
      into payment_row
    from public.tournament_payments as payment
    where payment.registration_id = primary_registration.id
    for update;

    if payment_row.id is not null
       and (payment_row.billing_type <> p_billing_type
         or payment_row.provider_environment <> p_provider_environment) then
      raise exception using errcode = '42501', message = 'Esta tentativa não corresponde ao pagamento informado.';
    end if;

    return jsonb_build_object(
      'registration', to_jsonb(primary_registration),
      'additional_registration', case
        when additional_registration.id is null then null
        else to_jsonb(additional_registration)
      end,
      'payment', case when payment_row.id is null then null else to_jsonb(payment_row) end,
      'payment_created', false,
      'total_amount', primary_registration.total_amount + coalesce(additional_registration.total_amount, 0)
    );
  end if;

  bundle := public.claim_public_tournament_registration_bundle(
    p_tournament_id,
    p_primary_category_id,
    p_additional_category_id,
    p_athlete_id,
    p_public_name,
    p_public_city,
    p_public_club,
    p_partner_name,
    p_shirt_size,
    p_primary_amount,
    p_notes
  );

  select registration.*
    into primary_registration
  from public.tournament_registrations as registration
  where registration.id = (bundle -> 'registration' ->> 'id')::uuid
  for update;

  if primary_registration.id is null then
    raise exception using errcode = 'P0002', message = 'Inscrição principal não encontrada.';
  end if;
  if primary_registration.request_token is not null
     and primary_registration.request_token <> p_request_token then
    raise exception using errcode = '23505', message = 'Esta inscrição já pertence a outra tentativa.';
  end if;

  update public.tournament_registrations
  set request_token = p_request_token,
      updated_at = now()
  where id = primary_registration.id
  returning * into primary_registration;

  select registration.*
    into additional_registration
  from public.tournament_registrations as registration
  where registration.parent_registration_id = primary_registration.id
  order by registration.created_at, registration.id
  limit 1;

  total_amount := primary_registration.total_amount + coalesce(additional_registration.total_amount, 0);
  if primary_registration.status <> 'WAITLIST' and total_amount > 0 then
    insert into public.tournament_payments (
      tournament_id,
      registration_id,
      provider,
      provider_environment,
      external_reference,
      billing_type,
      status,
      amount
    ) values (
      p_tournament_id,
      primary_registration.id,
      'ASAAS',
      p_provider_environment,
      'tournament-registration:' || primary_registration.id::text,
      p_billing_type,
      'CREATED',
      total_amount
    )
    on conflict (registration_id) do nothing
    returning * into payment_row;

    if payment_row.id is null then
      select payment.*
        into payment_row
      from public.tournament_payments as payment
      where payment.registration_id = primary_registration.id
      for update;
    else
      payment_created := true;
    end if;

    if payment_row.id is null
       or payment_row.tournament_id <> p_tournament_id
       or payment_row.amount <> total_amount
       or payment_row.billing_type <> p_billing_type
       or payment_row.provider_environment <> p_provider_environment then
      raise exception using errcode = '55000', message = 'A cobrança local da inscrição é divergente.';
    end if;
  end if;

  return jsonb_build_object(
    'registration', to_jsonb(primary_registration),
    'additional_registration', case
      when additional_registration.id is null then null
      else to_jsonb(additional_registration)
    end,
    'payment', case when payment_row.id is null then null else to_jsonb(payment_row) end,
    'payment_created', payment_created,
    'total_amount', total_amount
  );
end;
$$;

revoke all on function public.claim_public_tournament_registration_checkout(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, text, text, text
) from public, anon, authenticated;
grant execute on function public.claim_public_tournament_registration_checkout(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, text, text, text
) to service_role;

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
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
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

revoke all on function public.claim_asaas_webhook_event(text, text, text, jsonb, uuid, interval)
  from public, anon, authenticated;
grant execute on function public.claim_asaas_webhook_event(text, text, text, jsonb, uuid, interval)
  to service_role;

create or replace function public.sync_tournament_registration_payment_group(
  p_primary_registration_id uuid,
  p_registration_status text default null,
  p_payment_status text default null,
  p_paid_amount numeric default null,
  p_confirmed_at timestamptz default null,
  p_cancelled_at timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_group_id uuid;
  group_total numeric;
  updated_count integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if p_registration_status is not null
     and p_registration_status not in ('PENDING', 'CONFIRMED', 'WAITLIST', 'CANCELLED', 'REFUNDED') then
    raise exception using errcode = '22023', message = 'Status de inscrição inválido.';
  end if;
  if p_payment_status is not null
     and p_payment_status not in ('NOT_REQUIRED', 'PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'OVERDUE', 'REFUNDED', 'CANCELLED') then
    raise exception using errcode = '22023', message = 'Status de pagamento inválido.';
  end if;
  if p_paid_amount is not null and p_paid_amount < 0 then
    raise exception using errcode = '22023', message = 'Valor pago inválido.';
  end if;

  select registration.registration_group_id
    into target_group_id
  from public.tournament_registrations as registration
  where registration.id = p_primary_registration_id
    and registration.parent_registration_id is null;

  if not found then
    raise exception using errcode = 'P0002', message = 'Inscrição principal não encontrada.';
  end if;

  select coalesce(sum(registration.total_amount), 0)
    into group_total
  from public.tournament_registrations as registration
  where case
    when target_group_id is not null then registration.registration_group_id = target_group_id
    else registration.id = p_primary_registration_id
      or registration.parent_registration_id = p_primary_registration_id
  end;

  update public.tournament_registrations as registration
  set status = coalesce(p_registration_status, registration.status),
      payment_status = coalesce(p_payment_status, registration.payment_status),
      paid_amount = case
        when p_paid_amount is null then registration.paid_amount
        when group_total <= 0 then 0
        else round(least(registration.total_amount, p_paid_amount * registration.total_amount / group_total), 2)
      end,
      confirmed_at = case
        when p_registration_status = 'CONFIRMED' then coalesce(registration.confirmed_at, p_confirmed_at, now())
        when p_registration_status in ('PENDING', 'CANCELLED', 'REFUNDED') then null
        else registration.confirmed_at
      end,
      cancelled_at = case
        when p_registration_status = 'CANCELLED' then coalesce(p_cancelled_at, now())
        when p_registration_status in ('PENDING', 'CONFIRMED') then null
        else registration.cancelled_at
      end,
      updated_at = now()
  where case
    when target_group_id is not null then registration.registration_group_id = target_group_id
    else registration.id = p_primary_registration_id
      or registration.parent_registration_id = p_primary_registration_id
  end;

  get diagnostics updated_count = row_count;

  if target_group_id is not null then
    update public.tournament_registration_groups
    set status = case
          when p_registration_status = 'PENDING' then 'PENDING'
          when p_registration_status = 'CONFIRMED' then 'CONFIRMED'
          when p_registration_status = 'REFUNDED' then 'REFUNDED'
          when p_registration_status = 'CANCELLED' then 'CANCELLED'
          when p_payment_status = 'OVERDUE' then 'OVERDUE'
          else status
        end,
        updated_at = now()
    where id = target_group_id;
  end if;

  return updated_count;
end;
$$;

revoke all on function public.sync_tournament_registration_payment_group(
  uuid, text, text, numeric, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.sync_tournament_registration_payment_group(
  uuid, text, text, numeric, timestamptz, timestamptz
) to service_role;

create or replace function public.quarantine_tournament_payment_environment(
  p_payment_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.tournament_payments%rowtype;
  updated_row public.tournament_payments%rowtype;
  synced_count integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;

  select payment.*
    into payment_row
  from public.tournament_payments as payment
  where payment.id = p_payment_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Cobrança não encontrada.';
  end if;
  if payment_row.status is distinct from p_expected_status
     or payment_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('applied', false, 'payment', to_jsonb(payment_row));
  end if;
  if payment_row.provider <> 'ASAAS' then
    raise exception using errcode = '22023', message = 'Provedor da cobrança inválido.';
  end if;

  update public.tournament_payments
  set status = 'REVIEW_REQUIRED',
      invoice_url = null,
      pix_payload = null,
      pix_encoded_image = null,
      pix_expires_at = null,
      paid_at = null,
      reconciliation_started_at = coalesce(reconciliation_started_at, now()),
      reconciliation_attempts = reconciliation_attempts + 1,
      next_reconciliation_at = null,
      raw_response = jsonb_build_object(
        'error_code', 'provider_environment_mismatch',
        'reason', left(coalesce(p_reason, 'unknown'), 80),
        'requires_manual_review', true
      ),
      updated_at = now()
  where id = payment_row.id
  returning * into updated_row;

  synced_count := public.sync_tournament_registration_payment_group(
    payment_row.registration_id,
    'PENDING',
    'PENDING',
    0,
    null,
    null
  );
  if synced_count < 1 then
    raise exception using errcode = 'P0002', message = 'Nenhuma inscrição foi colocada em revisão.';
  end if;

  return jsonb_build_object('applied', true, 'payment', to_jsonb(updated_row));
end;
$$;

revoke all on function public.quarantine_tournament_payment_environment(uuid, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.quarantine_tournament_payment_environment(uuid, text, timestamptz, text)
  to service_role;

-- Do not leave the pre-environment overload callable: it cannot enforce that a
-- provider ID belongs to the currently configured Asaas account.
drop function if exists public.apply_tournament_payment_reconciliation(
  uuid, text, timestamptz, text, text, text, text, text, text, text,
  timestamptz, jsonb, timestamptz, timestamptz, integer, timestamptz,
  text, text, numeric, timestamptz, timestamptz
);

create or replace function public.apply_tournament_payment_reconciliation(
  p_payment_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz,
  p_status text,
  p_provider_environment text,
  p_provider_payment_id text,
  p_provider_customer_id text,
  p_billing_type text,
  p_invoice_url text,
  p_pix_payload text,
  p_pix_encoded_image text,
  p_pix_expires_at timestamptz,
  p_raw_response jsonb,
  p_paid_at timestamptz,
  p_reconciliation_started_at timestamptz,
  p_reconciliation_attempts integer,
  p_next_reconciliation_at timestamptz,
  p_registration_status text,
  p_registration_payment_status text,
  p_registration_paid_amount numeric,
  p_confirmed_at timestamptz,
  p_cancelled_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.tournament_payments%rowtype;
  updated_row public.tournament_payments%rowtype;
  synced_count integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Acesso negado.';
  end if;
  if p_status not in (
    'CREATED', 'RECONCILING', 'PENDING', 'RECEIVED', 'CONFIRMED',
    'REVIEW_REQUIRED', 'PARTIALLY_REFUNDED', 'OVERDUE', 'REFUNDED', 'CANCELLED',
    'CHARGEBACK', 'FAILED'
  ) then
    raise exception using errcode = '22023', message = 'Status de cobrança inválido.';
  end if;
  if coalesce(p_reconciliation_attempts, 0) < 0 then
    raise exception using errcode = '22023', message = 'Tentativas de reconciliação inválidas.';
  end if;
  if p_provider_environment not in ('SANDBOX', 'PRODUCTION') then
    raise exception using errcode = '22023', message = 'Ambiente do provedor inválido.';
  end if;
  if upper(coalesce(p_billing_type, '')) <> 'PIX' then
    raise exception using errcode = '22023', message = 'Forma de pagamento do provedor inválida.';
  end if;

  select payment.*
    into payment_row
  from public.tournament_payments as payment
  where payment.id = p_payment_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Cobrança não encontrada.';
  end if;
  if payment_row.status is distinct from p_expected_status
     or payment_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('applied', false, 'payment', to_jsonb(payment_row));
  end if;
  if payment_row.provider <> 'ASAAS' then
    raise exception using errcode = '22023', message = 'Provedor da cobrança inválido.';
  end if;
  if payment_row.provider_environment <> p_provider_environment then
    raise exception using errcode = '22023', message = 'Ambiente da cobrança divergente.';
  end if;
  if payment_row.provider_payment_id is not null
     and nullif(trim(coalesce(p_provider_payment_id, '')), '') is not null
     and payment_row.provider_payment_id <> trim(p_provider_payment_id) then
    raise exception using errcode = '22023', message = 'Identificador da cobrança divergente.';
  end if;

  update public.tournament_payments
  set provider_payment_id = coalesce(nullif(trim(coalesce(p_provider_payment_id, '')), ''), provider_payment_id),
      provider_customer_id = coalesce(nullif(trim(coalesce(p_provider_customer_id, '')), ''), provider_customer_id),
      billing_type = coalesce(nullif(trim(coalesce(p_billing_type, '')), ''), billing_type),
      status = p_status,
      invoice_url = case
        when p_status = 'REVIEW_REQUIRED'
          and coalesce(p_raw_response ->> 'error_code', '') = 'provider_payment_mismatch' then null
        else coalesce(nullif(trim(coalesce(p_invoice_url, '')), ''), invoice_url)
      end,
      pix_payload = case
        when p_status = 'REVIEW_REQUIRED'
          and coalesce(p_raw_response ->> 'error_code', '') = 'provider_payment_mismatch' then null
        else coalesce(nullif(p_pix_payload, ''), pix_payload)
      end,
      pix_encoded_image = case
        when p_status = 'REVIEW_REQUIRED'
          and coalesce(p_raw_response ->> 'error_code', '') = 'provider_payment_mismatch' then null
        else coalesce(nullif(p_pix_encoded_image, ''), pix_encoded_image)
      end,
      pix_expires_at = case
        when p_status = 'REVIEW_REQUIRED'
          and coalesce(p_raw_response ->> 'error_code', '') = 'provider_payment_mismatch' then null
        else coalesce(p_pix_expires_at, pix_expires_at)
      end,
      raw_response = coalesce(p_raw_response, raw_response),
      paid_at = p_paid_at,
      reconciliation_started_at = p_reconciliation_started_at,
      reconciliation_attempts = coalesce(p_reconciliation_attempts, 0),
      next_reconciliation_at = p_next_reconciliation_at,
      updated_at = now()
  where id = payment_row.id
  returning * into updated_row;

  if p_registration_status is not null
     or p_registration_payment_status is not null
     or p_registration_paid_amount is not null then
    synced_count := public.sync_tournament_registration_payment_group(
      payment_row.registration_id,
      p_registration_status,
      p_registration_payment_status,
      p_registration_paid_amount,
      p_confirmed_at,
      p_cancelled_at
    );
    if synced_count < 1 then
      raise exception using errcode = 'P0002', message = 'Nenhuma inscrição foi reconciliada.';
    end if;
  end if;

  return jsonb_build_object('applied', true, 'payment', to_jsonb(updated_row));
end;
$$;

revoke all on function public.apply_tournament_payment_reconciliation(
  uuid, text, timestamptz, text, text, text, text, text, text, text, text,
  timestamptz, jsonb, timestamptz, timestamptz, integer, timestamptz,
  text, text, numeric, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_tournament_payment_reconciliation(
  uuid, text, timestamptz, text, text, text, text, text, text, text, text,
  timestamptz, jsonb, timestamptz, timestamptz, integer, timestamptz,
  text, text, numeric, timestamptz, timestamptz
) to service_role;

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

  select coalesce(jsonb_agg(to_jsonb(registration) order by registration.created_at, registration.id), '[]'::jsonb)
    into registration_snapshot
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

  return true;
end;
$$;

revoke all on function public.archive_expired_tournament_payment(uuid)
  from public, anon, authenticated;
grant execute on function public.archive_expired_tournament_payment(uuid)
  to service_role;

create or replace function public.invoke_tournament_payment_expiry()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  expiry_url text;
  publishable_key text;
  expiry_token text;
begin
  select secret.decrypted_secret
    into expiry_url
  from vault.decrypted_secrets as secret
  where secret.name = 'tournament_payment_expiry_url'
  limit 1;

  select secret.decrypted_secret
    into publishable_key
  from vault.decrypted_secrets as secret
  where secret.name = 'tournament_payment_expiry_publishable_key'
  limit 1;

  select secret.decrypted_secret
    into expiry_token
  from vault.decrypted_secrets as secret
  where secret.name = 'tournament_payment_expiry_token'
  limit 1;

  if expiry_url is null
     or expiry_url !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*/functions/v1/tournament-payment-expiry$'
     or publishable_key is null
     or publishable_key !~ '^sb_publishable_[A-Za-z0-9_-]{20,}$'
     or expiry_token is null
     or length(expiry_token) < 32 then
    return null;
  end if;

  return net.http_post(
    url := expiry_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', publishable_key,
      'x-tournament-expiry-token', expiry_token
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;

revoke all on function public.invoke_tournament_payment_expiry()
  from public, anon, authenticated;
grant execute on function public.invoke_tournament_payment_expiry()
  to service_role;

commit;
