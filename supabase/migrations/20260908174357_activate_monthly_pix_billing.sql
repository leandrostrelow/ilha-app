begin;

do $$
begin
  if to_regclass('public.app_payment_invoices') is null
     or to_regclass('public.app_clients') is null
     or to_regclass('public.app_plans') is null
     or to_regclass('public.app_family_members') is null
     or to_regclass('public.app_family_invoice_items') is null
     or to_regclass('public.financial_transactions') is null
     or to_regprocedure('public.is_valid_cpf(text)') is null then
    raise exception 'O financeiro mensal exige o schema do Ilha Play e de contas familiares.'
      using errcode = '55000';
  end if;
end;
$$;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Only operationally safe provider state is exposed with the invoice. Provider
-- identifiers, customer mappings, request snapshots and retries stay in tables
-- that have no anon/authenticated grants or policies.
alter table public.app_payment_invoices
  add column if not exists provider_status text,
  add column if not exists pix_expires_at timestamptz,
  add column if not exists last_payment_error text,
  add column if not exists issued_at timestamptz;

alter table public.financial_transactions
  add column if not exists app_payment_invoice_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'financial_transactions_app_payment_invoice_fkey'
      and conrelid = 'public.financial_transactions'::regclass
  ) then
    alter table public.financial_transactions
      add constraint financial_transactions_app_payment_invoice_fkey
      foreign key (app_payment_invoice_id)
      references public.app_payment_invoices(id)
      on delete restrict;
  end if;
end;
$$;

create unique index if not exists financial_transactions_app_payment_invoice_uidx
  on public.financial_transactions (app_payment_invoice_id)
  where app_payment_invoice_id is not null;

alter table public.app_payment_invoices
  add constraint app_payment_invoices_month_start_check
    check (invoice_month = date_trunc('month', invoice_month::timestamp)::date) not valid,
  add constraint app_payment_invoices_nonnegative_amount_check
    check (amount >= 0) not valid,
  add constraint app_payment_invoices_due_date_check
    check (status = 'CANCELADA' or due_date is not null) not valid,
  add constraint app_payment_invoices_provider_status_check
    check (
      provider_status is null
      or provider_status in (
        'READY', 'RECONCILING', 'PENDING', 'CONFIRMED', 'RECEIVED', 'OVERDUE',
        'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED',
        'CHARGEBACK', 'DISPUTED', 'FAILED', 'REVIEW_REQUIRED'
      )
    );

create unique index if not exists app_payment_invoices_client_competence_uidx
  on public.app_payment_invoices (
    client_id,
    (date_trunc('month', invoice_month::timestamp)::date)
  );

alter table public.app_payment_invoices
  validate constraint app_payment_invoices_month_start_check;
alter table public.app_payment_invoices
  validate constraint app_payment_invoices_nonnegative_amount_check;
alter table public.app_payment_invoices
  validate constraint app_payment_invoices_due_date_check;

create table public.app_payment_customers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.app_clients(id) on delete restrict,
  provider text not null default 'ASAAS',
  provider_environment text not null,
  provider_customer_id text,
  external_reference text not null,
  identity_fingerprint text,
  status text not null default 'ACTIVE',
  resolution_token uuid,
  resolution_started_at timestamptz,
  provider_create_attempted_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_payment_customers_provider_check check (provider = 'ASAAS'),
  constraint app_payment_customers_environment_check
    check (provider_environment in ('SANDBOX', 'PRODUCTION')),
  constraint app_payment_customers_status_check
    check (status in ('ACTIVE', 'RESOLVING', 'REVIEW_REQUIRED')),
  constraint app_payment_customers_external_reference_check
    check (external_reference = 'ilha-monthly-customer:' || client_id::text),
  constraint app_payment_customers_provider_customer_length_check
    check (provider_customer_id is null or char_length(provider_customer_id) between 3 and 120),
  constraint app_payment_customers_last_error_length_check
    check (last_error is null or char_length(last_error) <= 500),
  unique (client_id, provider, provider_environment),
  unique (provider, provider_environment, external_reference)
);

create unique index app_payment_customers_provider_id_uidx
  on public.app_payment_customers (provider, provider_environment, provider_customer_id)
  where provider_customer_id is not null;

create index app_payment_customers_resolution_idx
  on public.app_payment_customers (status, resolution_started_at)
  where status = 'RESOLVING';

create table public.app_invoice_provider_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null unique
    references public.app_payment_invoices(id) on delete restrict,
  provider text not null default 'ASAAS',
  provider_environment text not null,
  provider_customer_id text,
  provider_payment_id text,
  external_reference text not null unique,
  expected_amount numeric(10, 2) not null,
  billing_type text not null default 'PIX',
  status text not null default 'READY',
  invoice_url text,
  pix_payload text,
  pix_expires_at timestamptz,
  provider_attempted_at timestamptz,
  reconciliation_started_at timestamptz,
  reconciliation_attempts integer not null default 0,
  next_reconciliation_at timestamptz,
  last_event_id text,
  last_event_at timestamptz,
  safe_snapshot jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_invoice_provider_payments_provider_check check (provider = 'ASAAS'),
  constraint app_invoice_provider_payments_environment_check
    check (provider_environment in ('SANDBOX', 'PRODUCTION')),
  constraint app_invoice_provider_payments_amount_check check (expected_amount > 0),
  constraint app_invoice_provider_payments_billing_type_check check (billing_type = 'PIX'),
  constraint app_invoice_provider_payments_status_check check (
    status in (
      'READY', 'RECONCILING', 'PENDING', 'CONFIRMED', 'RECEIVED', 'OVERDUE',
      'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED',
      'CHARGEBACK', 'DISPUTED', 'FAILED', 'REVIEW_REQUIRED'
    )
  ),
  constraint app_invoice_provider_payments_external_reference_check
    check (external_reference = 'ilha-monthly-invoice:' || invoice_id::text),
  constraint app_invoice_provider_payments_attempts_check
    check (reconciliation_attempts >= 0),
  constraint app_invoice_provider_payments_last_error_length_check
    check (last_error is null or char_length(last_error) <= 500)
);

create unique index app_invoice_provider_payments_provider_id_uidx
  on public.app_invoice_provider_payments (
    provider,
    provider_environment,
    provider_payment_id
  )
  where provider_payment_id is not null;

create index app_invoice_provider_payments_dispatch_idx
  on public.app_invoice_provider_payments (status, next_reconciliation_at, created_at, id)
  where status in ('READY', 'FAILED', 'RECONCILING', 'PENDING', 'CONFIRMED', 'OVERDUE');

create index app_invoice_provider_payments_customer_idx
  on public.app_invoice_provider_payments (
    provider,
    provider_environment,
    provider_customer_id
  )
  where provider_customer_id is not null;

create table public.app_monthly_billing_runs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  invoice_month date,
  requested_invoice_id uuid references public.app_payment_invoices(id) on delete restrict,
  requested_by uuid references auth.users(id) on delete set null,
  authorization_kind text not null,
  status text not null default 'STARTED',
  summary jsonb not null default '{}'::jsonb,
  last_error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint app_monthly_billing_runs_action_check
    check (action in ('GENERATE', 'RETRY', 'SCHEDULED', 'RECONCILE')),
  constraint app_monthly_billing_runs_authorization_check
    check (authorization_kind in ('USER', 'INTERNAL')),
  constraint app_monthly_billing_runs_status_check
    check (status in ('STARTED', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  constraint app_monthly_billing_runs_month_start_check
    check (
      invoice_month is null
      or invoice_month = date_trunc('month', invoice_month::timestamp)::date
    ),
  constraint app_monthly_billing_runs_last_error_length_check
    check (last_error is null or char_length(last_error) <= 1000)
);

create index app_monthly_billing_runs_month_created_idx
  on public.app_monthly_billing_runs (invoice_month, created_at desc);

create index app_monthly_billing_runs_requested_by_idx
  on public.app_monthly_billing_runs (requested_by, created_at desc)
  where requested_by is not null;

create table public.app_monthly_billing_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  generation_day integer not null default 1 check (generation_day between 1 and 28),
  max_batch_size integer not null default 10 check (max_batch_size between 1 and 25),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.app_monthly_billing_settings (singleton, enabled)
values (true, false)
on conflict (singleton) do nothing;

create table public.app_monthly_billing_settings_audit (
  id uuid primary key default gen_random_uuid(),
  previous_settings jsonb not null,
  new_settings jsonb not null,
  changed_by uuid references auth.users(id) on delete set null,
  authorization_kind text not null,
  created_at timestamptz not null default now(),
  constraint app_monthly_billing_settings_audit_authorization_check
    check (authorization_kind in ('USER', 'INTERNAL'))
);

create index app_monthly_billing_settings_audit_changed_by_idx
  on public.app_monthly_billing_settings_audit (changed_by, created_at desc)
  where changed_by is not null;

alter table public.app_payment_customers enable row level security;
alter table public.app_payment_customers force row level security;
alter table public.app_invoice_provider_payments enable row level security;
alter table public.app_invoice_provider_payments force row level security;
alter table public.app_monthly_billing_runs enable row level security;
alter table public.app_monthly_billing_runs force row level security;
alter table public.app_monthly_billing_settings enable row level security;
alter table public.app_monthly_billing_settings force row level security;
alter table public.app_monthly_billing_settings_audit enable row level security;
alter table public.app_monthly_billing_settings_audit force row level security;

revoke all on table public.app_payment_customers
  from public, anon, authenticated, service_role;
revoke all on table public.app_invoice_provider_payments
  from public, anon, authenticated, service_role;
revoke all on table public.app_monthly_billing_runs
  from public, anon, authenticated, service_role;
revoke all on table public.app_monthly_billing_settings
  from public, anon, authenticated, service_role;
revoke all on table public.app_monthly_billing_settings_audit
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.app_payment_customers to service_role;
grant select, insert, update, delete on table public.app_invoice_provider_payments to service_role;
grant select, insert, update, delete on table public.app_monthly_billing_runs to service_role;
grant select, insert, update on table public.app_monthly_billing_settings to service_role;
grant select, insert on table public.app_monthly_billing_settings_audit to service_role;

create or replace function public.admin_get_app_monthly_billing_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings_row public.app_monthly_billing_settings%rowtype;
  is_service boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
begin
  if not is_service and (
    (select auth.uid()) is null
    or not (
      coalesce(public.has_club_permission('finance.read'), false)
      or coalesce(public.has_club_permission('finance.write'), false)
    )
  ) then
    raise exception 'Seu acesso não permite consultar a configuração financeira.'
      using errcode = '42501';
  end if;

  select * into strict settings_row
    from public.app_monthly_billing_settings
   where singleton;

  return jsonb_build_object(
    'enabled', settings_row.enabled,
    'generationDay', settings_row.generation_day,
    'generationTime', '09:05',
    'timezone', 'America/Sao_Paulo',
    'maxBatchSize', settings_row.max_batch_size,
    'reconciliationIntervalMinutes', 15,
    'paymentPollingIntervalMinutes', 60,
    'updatedAt', settings_row.updated_at,
    'updatedBy', settings_row.updated_by
  );
end;
$$;

revoke all on function public.admin_get_app_monthly_billing_settings()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_app_monthly_billing_settings()
  to authenticated, service_role;

create or replace function public.admin_set_app_monthly_billing_settings(
  p_enabled boolean,
  p_generation_day integer default null,
  p_max_batch_size integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings_row public.app_monthly_billing_settings%rowtype;
  previous_payload jsonb;
  is_service boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
  actor_id uuid := case when is_service then null else (select auth.uid()) end;
begin
  if not is_service and (
    (select auth.uid()) is null
    or not coalesce(public.has_club_permission('finance.write'), false)
  ) then
    raise exception 'Seu acesso não permite alterar a configuração financeira.'
      using errcode = '42501';
  end if;
  if p_enabled is null
     or (p_generation_day is not null and p_generation_day not between 1 and 28)
     or (p_max_batch_size is not null and p_max_batch_size not between 1 and 25) then
    raise exception 'A configuração mensal informada é inválida.' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'enabled', settings.enabled,
    'generationDay', settings.generation_day,
    'maxBatchSize', settings.max_batch_size
  ) into strict previous_payload
  from public.app_monthly_billing_settings as settings
  where settings.singleton
  for update;

  update public.app_monthly_billing_settings
     set enabled = p_enabled,
         generation_day = coalesce(p_generation_day, generation_day),
         max_batch_size = coalesce(p_max_batch_size, max_batch_size),
         updated_by = actor_id,
         updated_at = now()
   where singleton
  returning * into strict settings_row;

  insert into public.app_monthly_billing_settings_audit (
    previous_settings,
    new_settings,
    changed_by,
    authorization_kind
  ) values (
    previous_payload,
    jsonb_build_object(
      'enabled', settings_row.enabled,
      'generationDay', settings_row.generation_day,
      'maxBatchSize', settings_row.max_batch_size
    ),
    actor_id,
    case when is_service then 'INTERNAL' else 'USER' end
  );

  return jsonb_build_object(
    'enabled', settings_row.enabled,
    'generationDay', settings_row.generation_day,
    'generationTime', '09:05',
    'timezone', 'America/Sao_Paulo',
    'maxBatchSize', settings_row.max_batch_size,
    'reconciliationIntervalMinutes', 15,
    'paymentPollingIntervalMinutes', 60,
    'updatedAt', settings_row.updated_at,
    'updatedBy', settings_row.updated_by
  );
end;
$$;

revoke all on function public.admin_set_app_monthly_billing_settings(boolean, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_app_monthly_billing_settings(boolean, integer, integer)
  to authenticated, service_role;

create or replace function private.monthly_billing_due_date(
  p_invoice_month date,
  p_due_day integer
)
returns date
language sql
immutable
security invoker
set search_path = ''
as $$
  select pg_catalog.make_date(
    extract(year from date_trunc('month', p_invoice_month::timestamp))::integer,
    extract(month from date_trunc('month', p_invoice_month::timestamp))::integer,
    least(
      greatest(coalesce(p_due_day, 10), 1),
      extract(
        day from (
          date_trunc('month', p_invoice_month::timestamp)
          + interval '1 month - 1 day'
        )
      )::integer
    )
  )
$$;

revoke all on function private.monthly_billing_due_date(date, integer)
  from public, anon, authenticated, service_role;

create or replace function private.ensure_app_invoice_financial_transaction(
  p_invoice_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.app_payment_invoices%rowtype;
  client_name text;
  transaction_row public.financial_transactions%rowtype;
  legacy_ids uuid[];
begin
  select invoice.* into strict invoice_row
  from public.app_payment_invoices as invoice
  where invoice.id = p_invoice_id
  for update of invoice;

  select client.full_name into strict client_name
  from public.app_clients as client
  where client.id = invoice_row.client_id;

  select ledger.* into transaction_row
  from public.financial_transactions as ledger
  where ledger.app_payment_invoice_id = p_invoice_id
  for update;

  if found then
    if transaction_row.type <> 'RECEITA'
       or transaction_row.amount is distinct from invoice_row.amount
       or transaction_row.due_date is distinct from invoice_row.due_date then
      raise exception 'O lançamento financeiro vinculado diverge do snapshot da fatura.'
        using errcode = '23514';
    end if;
    return transaction_row.id;
  end if;

  select coalesce(array_agg(ledger.id order by ledger.id), '{}'::uuid[])
    into legacy_ids
  from public.financial_transactions as ledger
  where ledger.app_payment_invoice_id is null
    and ledger.type = 'RECEITA'
    and ledger.amount = invoice_row.amount
    and ledger.due_date is not distinct from invoice_row.due_date
    and lower(trim(coalesce(ledger.counterparty, ''))) = lower(trim(client_name))
    and lower(coalesce(ledger.category, '')) in ('mensalidade', 'aulas')
    and lower(ledger.description) like '%mensalidade%';

  if cardinality(legacy_ids) > 1 then
    raise exception 'Mais de um lançamento legado corresponde à fatura mensal.'
      using errcode = '23514';
  end if;

  if cardinality(legacy_ids) = 1 then
    select ledger.* into strict transaction_row
    from public.financial_transactions as ledger
    where ledger.id = legacy_ids[1]
    for update;
    if upper(coalesce(transaction_row.status, '')) not in ('ABERTO', 'VENCIDO') then
      raise exception 'O lançamento legado correspondente já foi baixado ou encerrado.'
        using errcode = '23514';
    end if;
  end if;

  perform pg_catalog.set_config('ilha.monthly_billing_write', '1', true);
  if cardinality(legacy_ids) = 1 then
    update public.financial_transactions
       set app_payment_invoice_id = p_invoice_id,
           updated_at = now()
     where id = legacy_ids[1]
    returning * into strict transaction_row;
  else
    insert into public.financial_transactions (
      app_payment_invoice_id,
      counterparty,
      description,
      category,
      type,
      amount,
      due_date,
      paid_at,
      status,
      payment_method,
      notes
    ) values (
      p_invoice_id,
      client_name,
      invoice_row.description,
      'Mensalidade',
      'RECEITA',
      invoice_row.amount,
      invoice_row.due_date,
      invoice_row.paid_at,
      case
        when invoice_row.status = 'PAGA' then 'RECEBIDO'
        when invoice_row.status = 'VENCIDA' then 'VENCIDO'
        when invoice_row.status = 'CANCELADA' then 'CANCELADO'
        else 'ABERTO'
      end,
      invoice_row.payment_method,
      'Gerado automaticamente pelo financeiro mensal do Ilha Play.'
    )
    returning * into strict transaction_row;
  end if;

  return transaction_row.id;
end;
$$;

revoke all on function private.ensure_app_invoice_financial_transaction(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.sync_app_invoice_financial_transaction(
  p_invoice_id uuid,
  p_provider_status text,
  p_paid_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_status text := upper(trim(coalesce(p_provider_status, '')));
begin
  perform private.ensure_app_invoice_financial_transaction(p_invoice_id);
  perform pg_catalog.set_config('ilha.monthly_billing_write', '1', true);

  update public.financial_transactions
     set status = case
           when normalized_status = 'RECEIVED' then 'RECEBIDO'
           when normalized_status = 'OVERDUE' then 'VENCIDO'
           when normalized_status in ('CANCELLED', 'REFUNDED') then 'CANCELADO'
           when normalized_status in (
             'REVIEW_REQUIRED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED',
             'CHARGEBACK', 'DISPUTED'
           ) then 'REVISAO'
           when normalized_status = 'FAILED' then 'FALHA'
           when normalized_status = 'RECONCILING' then 'EM_RECONCILIACAO'
           else 'ABERTO'
         end,
         paid_at = case
           when normalized_status = 'RECEIVED' then coalesce(p_paid_at, paid_at, now())
           else paid_at
         end,
         payment_method = case
           when normalized_status = 'RECEIVED' then 'PIX'
           else payment_method
         end,
         updated_at = now()
   where app_payment_invoice_id = p_invoice_id;
end;
$$;

revoke all on function private.sync_app_invoice_financial_transaction(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.monthly_billing_candidates(
  p_invoice_month date,
  p_client_id uuid default null
)
returns table (
  client_id uuid,
  client_name text,
  invoice_id uuid,
  amount numeric,
  due_date date,
  family_billing boolean,
  state text,
  reason text,
  provider_status text,
  last_error text
)
language sql
stable
security definer
set search_path = ''
as $$
  with client_base as (
    select
      client.*,
      plan.type as catalog_plan_type,
      plan.default_due_day,
      exists (
        select 1
          from public.app_family_members as dependent
         where dependent.member_client_id = client.id
           and dependent.billing_responsible_id <> client.id
           and dependent.status in ('PENDENTE', 'ATIVO')
      ) as is_family_dependent,
      coalesce((
        select count(*)
          from public.app_family_members as member
         where member.billing_responsible_id = client.id
           and member.status = 'ATIVO'
      ), 0)::integer as active_family_count,
      coalesce((
        select sum(coalesce(member.monthly_amount, 0))
          from public.app_family_members as member
         where member.billing_responsible_id = client.id
           and member.status = 'ATIVO'
           and (
             not coalesce(member.responsible_confirmation_required, false)
             or member.responsible_confirmed_at is not null
           )
      ), 0)::numeric(10, 2) as included_family_amount,
      coalesce((
        select count(*)
          from public.app_family_members as member
         where member.billing_responsible_id = client.id
           and member.status = 'ATIVO'
           and coalesce(member.responsible_confirmation_required, false)
           and member.responsible_confirmed_at is null
      ), 0)::integer as unconfirmed_family_count
    from public.app_clients as client
    left join public.app_plans as plan on plan.id = client.official_plan_id
    where p_client_id is null or client.id = p_client_id
  ), resolved as (
    select
      base.*,
      case
        when date_trunc('month', p_invoice_month::timestamp)::date =
          date_trunc(
            'month',
            now() at time zone 'America/Sao_Paulo'
          )::date then greatest(
            private.monthly_billing_due_date(
              p_invoice_month,
              coalesce(base.due_day, base.default_due_day, 10)
            ),
            (now() at time zone 'America/Sao_Paulo')::date + 1
          )
        else private.monthly_billing_due_date(
          p_invoice_month,
          coalesce(base.due_day, base.default_due_day, 10)
        )
      end as calculated_due_date,
      invoice.id as existing_invoice_id,
      invoice.amount as existing_amount,
      invoice.due_date as existing_due_date,
      invoice.status as invoice_status,
      invoice.family_billing as existing_family_billing,
      invoice.pix_payload as existing_pix_payload,
      coalesce(payment.status, invoice.provider_status) as payment_status,
      coalesce(payment.last_error, invoice.last_payment_error) as payment_last_error,
      payment.id as provider_row_id,
      coalesce((
        select jsonb_object_agg(
          item.item_type || ':' || coalesce(
            item.family_member_id::text,
            item.beneficiary_client_id::text,
            'INVALID:' || item.id::text
          ),
          to_jsonb(item.amount)
        )
        from public.app_family_invoice_items as item
        where item.invoice_id = invoice.id
      ), '{}'::jsonb) = case
        when base.active_family_count > 0 then
          jsonb_build_object(
            'RESPONSAVEL:' || base.id::text,
            to_jsonb(coalesce(base.plan_amount, 0))
          ) || coalesce((
            select jsonb_object_agg(
              'MEMBRO:' || member.id::text,
              to_jsonb(coalesce(member.monthly_amount, 0))
            )
            from public.app_family_members as member
            where member.billing_responsible_id = base.id
              and member.status = 'ATIVO'
              and (
                not coalesce(member.responsible_confirmation_required, false)
                or member.responsible_confirmed_at is not null
              )
          ), '{}'::jsonb)
        else '{}'::jsonb
      end as draft_composition_matches,
      (
        select count(*)
        from public.app_family_invoice_items as item
        where item.invoice_id = invoice.id
      ) = case
        when base.active_family_count > 0 then 1 + (
          select count(*)
          from public.app_family_members as member
          where member.billing_responsible_id = base.id
            and member.status = 'ATIVO'
            and (
              not coalesce(member.responsible_confirmation_required, false)
              or member.responsible_confirmed_at is not null
            )
        )
        else 0
      end as draft_item_count_matches
    from client_base as base
    left join lateral (
      select candidate_invoice.*
        from public.app_payment_invoices as candidate_invoice
       where candidate_invoice.client_id = base.id
         and candidate_invoice.invoice_month >= date_trunc('month', p_invoice_month::timestamp)::date
         and candidate_invoice.invoice_month < (date_trunc('month', p_invoice_month::timestamp) + interval '1 month')::date
       order by candidate_invoice.invoice_month, candidate_invoice.created_at
       limit 1
    ) as invoice on true
    left join public.app_invoice_provider_payments as payment
      on payment.invoice_id = invoice.id
  ), classified as (
    select
      resolved.*,
      round(coalesce(resolved.plan_amount, 0) + resolved.included_family_amount, 2) as calculated_amount,
      case
        when resolved.existing_invoice_id is not null and resolved.existing_due_date is null
          then 'INVOICE_DUE_DATE_MISSING'
        when resolved.existing_invoice_id is not null and coalesce(resolved.existing_amount, 0) <= 0
          then 'INVOICE_AMOUNT_INVALID'
        -- Once dispatched (or carrying a legacy Pix), the immutable financial
        -- snapshot is authoritative. A merely local draft still revalidates the
        -- current enrollment before any provider row can be attached.
        when resolved.existing_invoice_id is not null
          and (
            resolved.provider_row_id is not null
            or nullif(resolved.existing_pix_payload, '') is not null
          ) then null
        when resolved.is_family_dependent then 'FAMILY_DEPENDENT'
        when upper(coalesce(resolved.status, '')) <> 'ATIVO' then 'CLIENT_NOT_ACTIVE'
        when resolved.registration_completed_at is null then 'REGISTRATION_INCOMPLETE'
        when resolved.unconfirmed_family_count > 0 then 'FAMILY_MEMBER_CONFIRMATION_PENDING'
        when date_trunc('month', p_invoice_month::timestamp)::date <
          date_trunc(
            'month',
            now() at time zone 'America/Sao_Paulo'
          )::date then 'DUE_DATE_IN_PAST'
        when lower(coalesce(resolved.official_plan_code, '')) = 'isento'
          and resolved.included_family_amount <= 0 then 'EXEMPT_PLAN'
        when lower(coalesce(resolved.catalog_plan_type, '')) = 'avulso'
          and resolved.included_family_amount <= 0 then 'ONE_OFF_PLAN'
        when round(coalesce(resolved.plan_amount, 0) + resolved.included_family_amount, 2) <= 0 then 'NO_BILLABLE_AMOUNT'
        when not coalesce(public.is_valid_cpf(resolved.cpf), false)
          then 'MISSING_VALID_CPF'
        when resolved.plan_cancel_at is not null
          and resolved.plan_cancel_at <= resolved.calculated_due_date then 'PLAN_CANCELLED_FOR_CYCLE'
        when resolved.existing_invoice_id is not null
          and (
            resolved.existing_amount is distinct from round(
              coalesce(resolved.plan_amount, 0) + resolved.included_family_amount,
              2
            )
            or resolved.existing_due_date is distinct from resolved.calculated_due_date
            or coalesce(resolved.existing_family_billing, false)
              is distinct from (resolved.active_family_count > 0)
            or not resolved.draft_composition_matches
            or not resolved.draft_item_count_matches
          ) then 'DRAFT_SNAPSHOT_MISMATCH'
        else null
      end as ineligible_reason,
      null::text as warning_reason
    from resolved
  )
  select
    classified.id,
    classified.full_name,
    classified.existing_invoice_id,
    coalesce(classified.existing_amount, classified.calculated_amount),
    coalesce(classified.existing_due_date, classified.calculated_due_date),
    coalesce(classified.existing_family_billing, classified.active_family_count > 0),
    case
      when classified.payment_status in (
        'FAILED', 'REVIEW_REQUIRED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED',
        'CHARGEBACK', 'DISPUTED'
      ) then 'FAILED'
      when classified.invoice_status = 'CANCELADA'
        or classified.payment_status in ('CANCELLED', 'REFUNDED') then 'SKIPPED'
      when classified.invoice_status = 'PAGA' or classified.payment_status = 'RECEIVED' then 'PAID'
      when classified.ineligible_reason is not null then 'SKIPPED'
      when classified.payment_status = 'RECONCILING' then 'RECONCILING'
      when classified.existing_due_date < (now() at time zone 'America/Sao_Paulo')::date
        and classified.invoice_status not in ('PAGA', 'CANCELADA') then 'OVERDUE'
      when classified.provider_row_id is null
        and classified.existing_invoice_id is not null
        and nullif(classified.existing_pix_payload, '') is not null then 'FAILED'
      when classified.payment_status = 'READY' then 'READY'
      when classified.existing_invoice_id is not null then 'EXISTING'
      when classified.warning_reason is not null then 'ELIGIBLE_WITH_WARNING'
      else 'ELIGIBLE'
    end,
    case
      when classified.payment_status in (
        'FAILED', 'REVIEW_REQUIRED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED',
        'CHARGEBACK', 'DISPUTED'
      ) then coalesce(
        classified.payment_last_error,
        'PAYMENT_REQUIRES_REVIEW:' || classified.payment_status
      )
      when classified.invoice_status = 'CANCELADA'
        or classified.payment_status in ('CANCELLED', 'REFUNDED') then 'INVOICE_CANCELLED'
      when classified.ineligible_reason is not null then classified.ineligible_reason
      when classified.provider_row_id is null
        and classified.existing_invoice_id is not null
        and nullif(classified.existing_pix_payload, '') is not null then 'LEGACY_PIX_REQUIRES_REVIEW'
      when classified.payment_last_error is not null then classified.payment_last_error
      else classified.warning_reason
    end,
    classified.payment_status,
    classified.payment_last_error
  from classified
  order by classified.full_name, classified.id
$$;

revoke all on function private.monthly_billing_candidates(date, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.monthly_billing_preview_payload(
  p_invoice_month date,
  p_client_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as materialized (
    select * from private.monthly_billing_candidates(p_invoice_month, p_client_id)
  )
  select jsonb_build_object(
    'month', date_trunc('month', p_invoice_month::timestamp)::date,
    'summary', jsonb_build_object(
      'eligible', count(*) filter (where state in ('ELIGIBLE', 'ELIGIBLE_WITH_WARNING')),
      'existing', count(*) filter (where state = 'EXISTING'),
      'ready', count(*) filter (where state = 'READY'),
      'reconciling', count(*) filter (where state = 'RECONCILING'),
      'paid', count(*) filter (where state = 'PAID'),
      'overdue', count(*) filter (where state = 'OVERDUE'),
      'failed', count(*) filter (where state = 'FAILED'),
      'skipped', count(*) filter (where state = 'SKIPPED'),
      'total', coalesce(round(sum(amount) filter (where state <> 'SKIPPED'), 2), 0)
    ),
    'candidates', coalesce(jsonb_agg(jsonb_build_object(
      'clientId', client_id,
      'clientName', client_name,
      'invoiceId', invoice_id,
      'amount', amount,
      'dueDate', due_date,
      'familyBilling', family_billing,
      'state', state,
      'reason', reason,
      'providerStatus', provider_status,
      'lastError', last_error
    ) order by client_name, client_id), '[]'::jsonb),
    'results', '[]'::jsonb
  )
  from candidates
$$;

revoke all on function private.monthly_billing_preview_payload(date, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.preview_app_monthly_pix_billing(
  p_invoice_month date,
  p_client_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  month_start date;
  is_service boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
begin
  if not is_service and (
    (select auth.uid()) is null
    or not (
      coalesce(public.has_club_permission('finance.read'), false)
      or coalesce(public.has_club_permission('finance.write'), false)
    )
  ) then
    raise exception 'Seu acesso não permite visualizar a geração financeira.' using errcode = '42501';
  end if;
  if p_invoice_month is null then
    raise exception 'Informe a competência da cobrança.' using errcode = '22023';
  end if;
  month_start := date_trunc('month', p_invoice_month::timestamp)::date;
  if p_invoice_month <> month_start then
    raise exception 'A competência precisa usar o primeiro dia do mês.' using errcode = '22023';
  end if;
  return private.monthly_billing_preview_payload(month_start, p_client_id);
end;
$$;

revoke all on function public.preview_app_monthly_pix_billing(date, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.preview_app_monthly_pix_billing(date, uuid)
  to authenticated, service_role;

create or replace function public.generate_app_monthly_pix_billing(
  p_invoice_month date,
  p_client_id uuid default null,
  p_provider_environment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_start date;
  normalized_environment text := upper(trim(coalesce(p_provider_environment, '')));
  is_service boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
  candidate record;
  refreshed record;
  invoice_row public.app_payment_invoices%rowtype;
  result_rows jsonb := '[]'::jsonb;
begin
  if not is_service then
    raise exception 'Esta operação exige a função de serviço.' using errcode = '42501';
  end if;
  if p_invoice_month is null then
    raise exception 'Informe a competência da cobrança.' using errcode = '22023';
  end if;
  month_start := date_trunc('month', p_invoice_month::timestamp)::date;
  if p_invoice_month <> month_start then
    raise exception 'A competência precisa usar o primeiro dia do mês.' using errcode = '22023';
  end if;
  if normalized_environment not in ('SANDBOX', 'PRODUCTION') then
    raise exception 'O ambiente do provedor é inválido.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ilha-monthly-billing:' || month_start::text, 0)
  );
  perform pg_catalog.set_config('ilha.monthly_billing_write', '1', true);

  for candidate in
    select *
      from private.monthly_billing_candidates(month_start, p_client_id)
     where state in ('ELIGIBLE', 'ELIGIBLE_WITH_WARNING', 'EXISTING')
     order by client_id
  loop
    perform 1 from public.app_clients where id = candidate.client_id for update;
    perform 1
      from public.app_family_members
     where billing_responsible_id = candidate.client_id
       and status in ('PENDENTE', 'ATIVO')
     order by id
     for update;

    select * into refreshed
      from private.monthly_billing_candidates(month_start, candidate.client_id)
     limit 1;

    if refreshed.state not in ('ELIGIBLE', 'ELIGIBLE_WITH_WARNING', 'EXISTING') then
      result_rows := result_rows || jsonb_build_array(jsonb_build_object(
        'invoiceId', refreshed.invoice_id,
        'clientId', refreshed.client_id,
        'state', 'SKIPPED',
        'providerStatus', refreshed.provider_status,
        'error', refreshed.reason
      ));
      continue;
    end if;

    if refreshed.invoice_id is null then
      insert into public.app_payment_invoices (
        client_id,
        invoice_month,
        description,
        plan_code,
        plan_name,
        amount,
        due_date,
        status,
        family_billing,
        provider_status,
        last_payment_error,
        notes
      )
      select
        client.id,
        month_start,
        case when refreshed.family_billing
          then 'Mensalidade familiar Ilha Tênis'
          else 'Mensalidade Ilha Tênis'
        end,
        case when refreshed.family_billing then 'familia' else client.official_plan_code end,
        case when refreshed.family_billing then 'Conta familiar' else client.official_plan_name end,
        refreshed.amount,
        refreshed.due_date,
        'ABERTA',
        refreshed.family_billing,
        'READY',
        null,
        case when refreshed.reason is null then null
          else 'Aviso da geração: ' || refreshed.reason
        end
      from public.app_clients as client
      where client.id = refreshed.client_id
      returning * into invoice_row;

      if refreshed.family_billing then
        insert into public.app_family_invoice_items (
          invoice_id,
          beneficiary_client_id,
          item_type,
          description,
          amount
        )
        select invoice_row.id, client.id, 'RESPONSAVEL', client.full_name, coalesce(client.plan_amount, 0)
          from public.app_clients as client
         where client.id = refreshed.client_id;

        insert into public.app_family_invoice_items (
          invoice_id,
          family_member_id,
          beneficiary_client_id,
          item_type,
          description,
          amount
        )
        select
          invoice_row.id,
          member.id,
          member.member_client_id,
          'MEMBRO',
          member.full_name,
          coalesce(member.monthly_amount, 0)
        from public.app_family_members as member
        where member.billing_responsible_id = refreshed.client_id
          and member.status = 'ATIVO'
          and (
            not coalesce(member.responsible_confirmation_required, false)
            or member.responsible_confirmed_at is not null
          )
        order by member.full_name, member.id;
      end if;
    else
      select * into invoice_row
        from public.app_payment_invoices
       where id = refreshed.invoice_id
       for update;
    end if;

    begin
      perform private.ensure_app_invoice_financial_transaction(invoice_row.id);
    exception
      when check_violation or unique_violation then
        -- A legacy ledger mismatch belongs to this responsible only. Keep the
        -- invoice auditable, block provider dispatch and continue the batch.
        update public.app_invoice_provider_payments
           set status = 'REVIEW_REQUIRED',
               last_error = 'Conflito com lançamento financeiro preexistente.',
               next_reconciliation_at = null,
               updated_at = now()
         where invoice_id = invoice_row.id;
        update public.app_payment_invoices
           set provider_status = 'REVIEW_REQUIRED',
               last_payment_error = 'Conflito com lançamento financeiro preexistente.',
               updated_at = now()
         where id = invoice_row.id;
        perform private.notify_monthly_billing_finance_review(
          invoice_row.id,
          'REVIEW_REQUIRED'
        );
        result_rows := result_rows || jsonb_build_array(jsonb_build_object(
          'invoiceId', invoice_row.id,
          'clientId', invoice_row.client_id,
          'state', 'FAILED',
          'providerStatus', 'REVIEW_REQUIRED',
          'error', 'LEDGER_CONFLICT_REQUIRES_REVIEW'
        ));
        continue;
    end;

    insert into public.app_invoice_provider_payments (
      invoice_id,
      provider_environment,
      external_reference,
      expected_amount,
      status
    ) values (
      invoice_row.id,
      normalized_environment,
      'ilha-monthly-invoice:' || invoice_row.id::text,
      invoice_row.amount,
      'READY'
    )
    on conflict (invoice_id) do nothing;

    update public.app_payment_invoices
       set provider_status = coalesce(provider_status, 'READY'),
           last_payment_error = null,
           updated_at = now()
     where id = invoice_row.id;

    result_rows := result_rows || jsonb_build_array(jsonb_build_object(
      'invoiceId', invoice_row.id,
      'clientId', invoice_row.client_id,
      'state', 'READY',
      'providerStatus', 'READY',
      'error', refreshed.reason
    ));
  end loop;

  return private.monthly_billing_preview_payload(month_start, p_client_id)
    || jsonb_build_object('results', result_rows);
end;
$$;

revoke all on function public.generate_app_monthly_pix_billing(date, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.generate_app_monthly_pix_billing(date, uuid, text)
  to service_role;

create or replace function public.claim_app_invoice_provider_dispatch(
  p_invoice_id uuid default null,
  p_invoice_month date default null,
  p_batch_limit integer default 10,
  p_include_ready boolean default true
)
returns table (
  provider_attempt_id uuid,
  invoice_id uuid,
  client_id uuid,
  provider_environment text,
  provider_payment_id text,
  external_reference text,
  expected_amount numeric,
  attempt_number integer,
  stored_pix_payload text,
  stored_pix_expires_at timestamptz,
  allow_provider_create boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Esta operação exige a função de serviço.' using errcode = '42501';
  end if;
  if p_batch_limit is null or p_batch_limit not between 1 and 25 then
    raise exception 'O lote precisa conter entre 1 e 25 cobranças.' using errcode = '22023';
  end if;

  return query
  with claimed as (
    select payment.id, payment.status as claimed_status
      from public.app_invoice_provider_payments as payment
      join public.app_payment_invoices as invoice on invoice.id = payment.invoice_id
     where (p_invoice_id is null or payment.invoice_id = p_invoice_id)
       and (
         p_invoice_month is null
         or invoice.invoice_month >= date_trunc('month', p_invoice_month::timestamp)::date
           and invoice.invoice_month < (
             date_trunc('month', p_invoice_month::timestamp) + interval '1 month'
           )::date
       )
       and invoice.status not in ('PAGA', 'CANCELADA')
       and (
         (payment.status = 'READY' and coalesce(p_include_ready, false))
         or (
           payment.status = 'FAILED'
           and p_invoice_id is not null
         )
         or (
           payment.status = 'RECONCILING'
           and coalesce(
             payment.next_reconciliation_at,
             payment.updated_at + interval '3 minutes'
           ) <= now()
         )
         or (
           payment.status in ('PENDING', 'CONFIRMED', 'OVERDUE')
           and (
             p_invoice_id is not null
             or coalesce(payment.next_reconciliation_at, now()) <= now()
           )
         )
       )
     order by payment.created_at, payment.id
     limit p_batch_limit
     for update of payment skip locked
  ), updated as (
    update public.app_invoice_provider_payments as payment
       set status = 'RECONCILING',
           provider_attempted_at = now(),
           reconciliation_started_at = coalesce(payment.reconciliation_started_at, now()),
           reconciliation_attempts = payment.reconciliation_attempts + 1,
           next_reconciliation_at = now() + interval '3 minutes',
           last_error = null,
           updated_at = now()
      from claimed
     where payment.id = claimed.id
    returning payment.*
  )
  select
    updated.id,
    updated.invoice_id,
    invoice.client_id,
    updated.provider_environment,
    updated.provider_payment_id,
    updated.external_reference,
    updated.expected_amount,
    updated.reconciliation_attempts,
    updated.pix_payload,
    updated.pix_expires_at,
    claimed.claimed_status in ('READY', 'FAILED')
  from updated
  join claimed on claimed.id = updated.id
  join public.app_payment_invoices as invoice on invoice.id = updated.invoice_id;
end;
$$;

revoke all on function public.claim_app_invoice_provider_dispatch(uuid, date, integer, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_app_invoice_provider_dispatch(uuid, date, integer, boolean)
  to service_role;

create or replace function public.claim_app_payment_customer_resolution(
  p_client_id uuid,
  p_provider_environment text,
  p_external_reference text,
  p_identity_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  customer_row public.app_payment_customers%rowtype;
  claim_token uuid := gen_random_uuid();
  normalized_environment text := upper(trim(coalesce(p_provider_environment, '')));
  normalized_fingerprint text := lower(trim(coalesce(p_identity_fingerprint, '')));
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Esta operação exige a função de serviço.' using errcode = '42501';
  end if;
  if normalized_environment not in ('SANDBOX', 'PRODUCTION')
     or p_external_reference <> 'ilha-monthly-customer:' || p_client_id::text
     or normalized_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'A reserva do cliente no provedor é inválida.' using errcode = '22023';
  end if;

  insert into public.app_payment_customers (
    client_id,
    provider_environment,
    external_reference,
    identity_fingerprint,
    status,
    resolution_token,
    resolution_started_at
  ) values (
    p_client_id,
    normalized_environment,
    p_external_reference,
    normalized_fingerprint,
    'RESOLVING',
    claim_token,
    now()
  )
  on conflict (client_id, provider, provider_environment) do nothing;

  select * into strict customer_row
    from public.app_payment_customers
   where client_id = p_client_id
     and provider = 'ASAAS'
     and provider_environment = normalized_environment
   for update;

  if customer_row.provider_customer_id is not null
     and customer_row.identity_fingerprint is distinct from normalized_fingerprint then
    update public.app_payment_customers
       set status = 'REVIEW_REQUIRED',
           resolution_token = null,
           resolution_started_at = null,
           last_error = 'A identidade do responsável mudou e exige revisão.',
           updated_at = now()
     where id = customer_row.id;
    return jsonb_build_object(
      'claimed', false,
      'status', 'REVIEW_REQUIRED',
      'providerCustomerId', null,
      'resolutionToken', null,
      'allowProviderCreate', false
    );
  end if;

  if customer_row.provider_customer_id is not null
     and customer_row.status = 'ACTIVE'
     and customer_row.external_reference = p_external_reference
     and customer_row.identity_fingerprint = normalized_fingerprint then
    return jsonb_build_object(
      'claimed', false,
      'status', 'ACTIVE',
      'providerCustomerId', customer_row.provider_customer_id,
      'resolutionToken', null,
      'allowProviderCreate', false
    );
  end if;

  if customer_row.status = 'REVIEW_REQUIRED' then
    return jsonb_build_object(
      'claimed', false,
      'status', 'REVIEW_REQUIRED',
      'providerCustomerId', null,
      'resolutionToken', null,
      'allowProviderCreate', false
    );
  end if;

  if customer_row.status = 'RESOLVING'
     and customer_row.resolution_token <> claim_token then
    if coalesce(customer_row.resolution_started_at, '-infinity'::timestamptz)
       > now() - interval '3 minutes' then
      return jsonb_build_object(
        'claimed', false,
        'status', 'RESOLVING',
        'providerCustomerId', null,
        'resolutionToken', null,
        'allowProviderCreate', false
      );
    end if;

    -- A worker may have reached Asaas and lost the response. Once a POST was
    -- attempted, a later lease is lookup-only and requires manual review when
    -- neither the reference nor the exact CPF can recover the customer.
    if customer_row.provider_create_attempted_at is not null then
      update public.app_payment_customers
         set status = 'REVIEW_REQUIRED',
             resolution_token = null,
             resolution_started_at = null,
             last_error = 'A criação remota teve resultado ambíguo e exige revisão.',
             updated_at = now()
       where id = customer_row.id;
      return jsonb_build_object(
        'claimed', false,
        'status', 'REVIEW_REQUIRED',
        'providerCustomerId', null,
        'resolutionToken', null,
        'allowProviderCreate', false
      );
    end if;
  end if;

  if customer_row.resolution_token is distinct from claim_token then
    update public.app_payment_customers
       set external_reference = p_external_reference,
           identity_fingerprint = normalized_fingerprint,
           status = 'RESOLVING',
           resolution_token = claim_token,
           resolution_started_at = now(),
           last_error = null,
           updated_at = now()
     where id = customer_row.id;
  end if;

  return jsonb_build_object(
    'claimed', true,
    'status', 'RESOLVING',
    'providerCustomerId', null,
    'resolutionToken', claim_token,
    'allowProviderCreate', customer_row.provider_create_attempted_at is null
  );
end;
$$;

revoke all on function public.claim_app_payment_customer_resolution(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_app_payment_customer_resolution(uuid, text, text, text)
  to service_role;

create or replace function public.mark_app_payment_customer_create_attempt(
  p_client_id uuid,
  p_provider_environment text,
  p_resolution_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  marked boolean;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Esta operação exige a função de serviço.' using errcode = '42501';
  end if;

  update public.app_payment_customers
     set provider_create_attempted_at = now(),
         updated_at = now()
   where client_id = p_client_id
     and provider = 'ASAAS'
     and provider_environment = upper(trim(coalesce(p_provider_environment, '')))
     and status = 'RESOLVING'
     and resolution_token = p_resolution_token
     and provider_create_attempted_at is null
  returning true into marked;

  if not coalesce(marked, false) then
    raise exception 'A criação do cliente já foi tentada ou a reserva expirou.'
      using errcode = '40001';
  end if;
  return true;
end;
$$;

revoke all on function public.mark_app_payment_customer_create_attempt(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_app_payment_customer_create_attempt(uuid, text, uuid)
  to service_role;

create or replace function public.save_app_payment_customer(
  p_client_id uuid,
  p_provider_environment text,
  p_provider_customer_id text,
  p_external_reference text,
  p_identity_fingerprint text,
  p_resolution_token uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  normalized_environment text := upper(trim(coalesce(p_provider_environment, '')));
  normalized_fingerprint text := lower(trim(coalesce(p_identity_fingerprint, '')));
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Esta operação exige a função de serviço.' using errcode = '42501';
  end if;
  if normalized_environment not in ('SANDBOX', 'PRODUCTION')
     or nullif(trim(p_provider_customer_id), '') is null
     or p_external_reference <> 'ilha-monthly-customer:' || p_client_id::text
     or normalized_fingerprint !~ '^[0-9a-f]{64}$'
     or p_resolution_token is null then
    raise exception 'O vínculo do cliente no provedor é inválido.' using errcode = '22023';
  end if;

  update public.app_payment_customers
     set provider_customer_id = trim(p_provider_customer_id),
        external_reference = p_external_reference,
        identity_fingerprint = normalized_fingerprint,
        status = 'ACTIVE',
        resolution_token = null,
        resolution_started_at = null,
        last_error = null,
        updated_at = now()
   where client_id = p_client_id
     and provider = 'ASAAS'
     and provider_environment = normalized_environment
     and status = 'RESOLVING'
     and resolution_token = p_resolution_token
  returning id into saved_id;

  if saved_id is null then
    raise exception 'A reserva do cliente no provedor expirou ou pertence a outra execução.'
      using errcode = '40001';
  end if;

  return saved_id;
end;
$$;

revoke all on function public.save_app_payment_customer(uuid, text, text, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_app_payment_customer(uuid, text, text, text, text, uuid)
  to service_role;

create or replace function private.notify_monthly_billing_finance_review(
  p_invoice_id uuid,
  p_provider_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_status text := upper(trim(coalesce(p_provider_status, 'REVIEW_REQUIRED')));
begin
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
    case
      when normalized_status = 'RECONCILING' then 'Cobrança mensal em reconciliação'
      when normalized_status = 'FAILED' then 'Falha ao emitir mensalidade'
      when normalized_status in ('REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED')
        then 'Estorno de mensalidade requer atenção'
      when normalized_status in ('CHARGEBACK', 'DISPUTED')
        then 'Contestação de mensalidade requer atenção'
      else 'Cobrança mensal requer revisão'
    end,
    case
      when normalized_status = 'RECONCILING' then
        'A resposta do Asaas para ' || left(client.full_name, 120) ||
        ' ficou indeterminada. O sistema fará nova consulta sem duplicar a cobrança.'
      when normalized_status = 'FAILED' then
        'A mensalidade de ' || left(client.full_name, 120) ||
        ' não foi emitida e precisa de revisão no Financeiro.'
      when normalized_status in ('REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED') then
        'A mensalidade de ' || left(client.full_name, 120) ||
        ' recebeu uma atualização de estorno e precisa de revisão no Financeiro.'
      when normalized_status in ('CHARGEBACK', 'DISPUTED') then
        'A mensalidade de ' || left(client.full_name, 120) ||
        ' recebeu uma contestação e precisa de revisão no Financeiro.'
      else
        'A mensalidade de ' || left(client.full_name, 120) ||
        ' apresentou divergência e precisa de revisão no Financeiro.'
    end,
    '/adm?module=finance',
    'FATURA_MENSAL_FALHA',
    'monthly-billing-alert:' || invoice.id::text || ':' || lower(normalized_status) ||
      ':adm:' || profile.id::text
  from public.app_payment_invoices as invoice
  join public.app_clients as client on client.id = invoice.client_id
  cross join public.profiles as profile
  join auth.users as auth_user on auth_user.id = profile.id
  join public.protected_access_accounts as protected_account
    on protected_account.email = lower(trim(auth_user.email))
   and protected_account.role = profile.role
   and protected_account.active is true
  where invoice.id = p_invoice_id
    and profile.active is true
    and (
      profile.role = 'admin'
      or (
        coalesce(profile.permissions, '[]'::jsonb) ? 'finance.write'
        and coalesce(protected_account.permissions, '[]'::jsonb) ? 'finance.write'
        and coalesce(profile.permissions, '[]'::jsonb) ? 'communication'
        and coalesce(protected_account.permissions, '[]'::jsonb) ? 'communication'
      )
    )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

revoke all on function private.notify_monthly_billing_finance_review(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.complete_app_invoice_provider_dispatch(
  p_invoice_id uuid,
  p_provider_environment text,
  p_provider_customer_id text,
  p_provider_payment_id text,
  p_provider_status text,
  p_external_reference text,
  p_remote_amount numeric,
  p_billing_type text,
  p_invoice_url text,
  p_pix_payload text,
  p_pix_expires_at timestamptz,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.app_invoice_provider_payments%rowtype;
  invoice_row public.app_payment_invoices%rowtype;
  normalized_status text := upper(trim(coalesce(p_provider_status, 'PENDING')));
  authoritative_status text;
  effective_status text;
  has_authoritative_status boolean;
  snapshot_safe jsonb := case
    when pg_catalog.octet_length(coalesce(p_snapshot, '{}'::jsonb)::text) <= 12000
      then coalesce(p_snapshot, '{}'::jsonb)
    else jsonb_build_object('truncated', true)
  end;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Esta operação exige a função de serviço.' using errcode = '42501';
  end if;

  select * into payment_row
    from public.app_invoice_provider_payments
   where invoice_id = p_invoice_id
   for update;
  if not found then
    raise exception 'Tentativa mensal não encontrada.' using errcode = 'P0002';
  end if;

  select * into invoice_row
    from public.app_payment_invoices
   where id = p_invoice_id
   for update;
  if not found then
    raise exception 'Fatura mensal não encontrada.' using errcode = 'P0002';
  end if;

  if payment_row.provider_environment <> upper(trim(coalesce(p_provider_environment, '')))
     or payment_row.external_reference <> p_external_reference
     or round(payment_row.expected_amount * 100) <> round(coalesce(p_remote_amount, -1) * 100)
     or upper(trim(coalesce(p_billing_type, ''))) <> 'PIX'
     or nullif(trim(p_provider_customer_id), '') is null
     or nullif(trim(p_provider_payment_id), '') is null then
    update public.app_invoice_provider_payments
       set status = 'REVIEW_REQUIRED',
           last_error = 'Cobrança remota divergente do snapshot local.',
           safe_snapshot = snapshot_safe,
           next_reconciliation_at = null,
           updated_at = now()
     where id = payment_row.id;
    update public.app_payment_invoices
       set provider_status = 'REVIEW_REQUIRED',
           last_payment_error = 'Cobrança remota divergente do snapshot local.',
           updated_at = now()
     where id = p_invoice_id;
    perform private.sync_app_invoice_financial_transaction(
      p_invoice_id,
      'REVIEW_REQUIRED'
    );
    perform private.notify_monthly_billing_finance_review(
      p_invoice_id,
      'REVIEW_REQUIRED'
    );
    return jsonb_build_object(
      'applied', false,
      'status', 'REVIEW_REQUIRED',
      'reason', 'REMOTE_MISMATCH',
      'invoice_id', p_invoice_id
    );
  end if;

  authoritative_status := case
    when payment_row.status in (
      'PENDING', 'CONFIRMED', 'RECEIVED', 'OVERDUE', 'CANCELLED',
      'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK',
      'DISPUTED', 'REVIEW_REQUIRED'
    ) then payment_row.status
    when upper(coalesce(invoice_row.provider_status, '')) in (
      'PENDING', 'CONFIRMED', 'RECEIVED', 'OVERDUE', 'CANCELLED',
      'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK',
      'DISPUTED', 'REVIEW_REQUIRED'
    ) then upper(invoice_row.provider_status)
    when invoice_row.status = 'PAGA' then 'RECEIVED'
    else null
  end;
  has_authoritative_status := authoritative_status is not null;
  effective_status := case
    when has_authoritative_status then authoritative_status
    when normalized_status in (
      'PENDING', 'CONFIRMED', 'RECEIVED', 'OVERDUE', 'FAILED', 'CANCELLED',
      'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK', 'DISPUTED'
    ) then normalized_status
    else 'REVIEW_REQUIRED'
  end;

  update public.app_invoice_provider_payments
     set provider_customer_id = trim(p_provider_customer_id),
         provider_payment_id = trim(p_provider_payment_id),
         -- A retry only refreshes the provider binding/QR. The reconciliation
         -- RPC below owns financial transitions and their regression matrix.
         status = effective_status,
         invoice_url = coalesce(nullif(trim(p_invoice_url), ''), payment_row.invoice_url),
         pix_payload = coalesce(nullif(trim(p_pix_payload), ''), payment_row.pix_payload),
         pix_expires_at = coalesce(p_pix_expires_at, payment_row.pix_expires_at),
         safe_snapshot = snapshot_safe,
         last_error = null,
         next_reconciliation_at = case
           when effective_status in ('PENDING', 'CONFIRMED', 'OVERDUE')
             then now() + interval '1 hour'
           else null
         end,
         updated_at = now()
   where id = payment_row.id;

  perform pg_catalog.set_config('ilha.monthly_billing_write', '1', true);
  update public.app_payment_invoices
     set status = case
           when has_authoritative_status then status
           when effective_status = 'OVERDUE' then 'VENCIDA'
           when effective_status in ('PENDING', 'CONFIRMED') then 'AGUARDANDO'
           else status
         end,
         provider_status = effective_status,
         pix_payload = coalesce(nullif(trim(p_pix_payload), ''), invoice_row.pix_payload),
         pix_expires_at = coalesce(p_pix_expires_at, invoice_row.pix_expires_at),
         last_payment_error = null,
         issued_at = case
           when nullif(trim(p_pix_payload), '') is not null then coalesce(issued_at, now())
           else issued_at
         end,
         updated_at = now()
   where id = p_invoice_id;

  perform private.sync_app_invoice_financial_transaction(
    p_invoice_id,
    effective_status,
    case when effective_status = 'RECEIVED' then invoice_row.paid_at else null end
  );

  insert into public.app_client_notifications (
    user_id,
    title,
    body,
    link_url,
    event_type,
    dedupe_key
  )
  select
    invoice.client_id,
    'Sua fatura mensal está disponível',
    'A cobrança Pix da mensalidade já pode ser consultada e paga no Ilha Play.',
    '/?view=payments&invoice=' || invoice.id::text,
    'FATURA_MENSAL_DISPONIVEL',
    'monthly-invoice-issued:' || invoice.id::text
  from public.app_payment_invoices as invoice
  where invoice.id = p_invoice_id
    and nullif(trim(p_pix_payload), '') is not null
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return jsonb_build_object(
    'applied', true,
    'status', effective_status,
    'reason', 'DISPATCHED',
    'invoice_id', p_invoice_id,
    'provider_payment_id', trim(p_provider_payment_id)
  );
end;
$$;

revoke all on function public.complete_app_invoice_provider_dispatch(
  uuid, text, text, text, text, text, numeric, text, text, text, timestamptz, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.complete_app_invoice_provider_dispatch(
  uuid, text, text, text, text, text, numeric, text, text, text, timestamptz, jsonb
) to service_role;

create or replace function public.fail_app_invoice_provider_dispatch(
  p_invoice_id uuid,
  p_error text,
  p_ambiguous boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_status text := case when p_ambiguous then 'RECONCILING' else 'FAILED' end;
  safe_error text := left(coalesce(nullif(trim(p_error), ''), 'Falha não identificada.'), 500);
  payment_row public.app_invoice_provider_payments%rowtype;
  invoice_row public.app_payment_invoices%rowtype;
  preserved_status text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Esta operação exige a função de serviço.' using errcode = '42501';
  end if;

  select * into payment_row
    from public.app_invoice_provider_payments
   where invoice_id = p_invoice_id
   for update;
  if not found then
    raise exception 'Tentativa mensal não encontrada.' using errcode = 'P0002';
  end if;

  select * into invoice_row
    from public.app_payment_invoices
   where id = p_invoice_id
   for update;
  if not found then
    raise exception 'Fatura mensal não encontrada.' using errcode = 'P0002';
  end if;

  -- The provider operation/reconciliation can commit even when the Edge
  -- Function loses the HTTP response. Never overwrite a financial state that
  -- has already been bound or reconciled with a transport-level failure.
  preserved_status := case
    when payment_row.status in (
      'PENDING', 'CONFIRMED', 'RECEIVED', 'OVERDUE', 'CANCELLED',
      'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK',
      'DISPUTED', 'REVIEW_REQUIRED'
    ) then payment_row.status
    when invoice_row.status = 'PAGA'
      and invoice_row.provider_status in (
        'PENDING', 'CONFIRMED', 'RECEIVED', 'OVERDUE', 'CANCELLED',
        'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK',
        'DISPUTED', 'REVIEW_REQUIRED'
      ) then invoice_row.provider_status
    when invoice_row.status = 'PAGA' then 'RECEIVED'
    else null
  end;

  if preserved_status is not null then
    return jsonb_build_object(
      'applied', false,
      'status', preserved_status,
      'reason', 'FINANCIAL_STATE_PRESERVED',
      'invoice_id', p_invoice_id
    );
  end if;

  update public.app_invoice_provider_payments
     set status = next_status,
         last_error = safe_error,
         next_reconciliation_at = case
           when p_ambiguous then now() + interval '3 minutes'
           else null
         end,
         updated_at = now()
   where invoice_id = p_invoice_id;

  perform pg_catalog.set_config('ilha.monthly_billing_write', '1', true);
  update public.app_payment_invoices
     set provider_status = next_status,
         last_payment_error = safe_error,
         updated_at = now()
   where id = p_invoice_id;

  perform private.sync_app_invoice_financial_transaction(
    p_invoice_id,
    next_status
  );

  perform private.notify_monthly_billing_finance_review(p_invoice_id, next_status);

  return jsonb_build_object(
    'applied', true,
    'status', next_status,
    'reason', case when p_ambiguous then 'AMBIGUOUS_PROVIDER_RESULT' else 'PROVIDER_FAILURE' end,
    'invoice_id', p_invoice_id
  );
end;
$$;

revoke all on function public.fail_app_invoice_provider_dispatch(uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_app_invoice_provider_dispatch(uuid, text, boolean)
  to service_role;

create or replace function public.apply_app_invoice_payment_reconciliation(
  p_provider_payment_id text,
  p_provider_environment text,
  p_provider_status text,
  p_external_reference text,
  p_expected_amount numeric,
  p_paid_at timestamptz,
  p_event_id text,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.app_invoice_provider_payments%rowtype;
  invoice_row public.app_payment_invoices%rowtype;
  matched_payment_ids uuid[];
  normalized_environment text := upper(trim(coalesce(p_provider_environment, '')));
  normalized_status text := upper(trim(coalesce(p_provider_status, '')));
  normalized_payment_id text := trim(coalesce(p_provider_payment_id, ''));
  normalized_event_id text := left(trim(coalesce(p_event_id, '')), 160);
  supported_statuses constant text[] := array[
    'PENDING', 'CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH', 'OVERDUE',
    'FAILED', 'CANCELLED', 'DELETED', 'REFUND_PENDING', 'REFUNDED',
    'PARTIALLY_REFUNDED', 'CHARGEBACK', 'DISPUTED'
  ];
  snapshot_safe jsonb := case
    when pg_catalog.octet_length(coalesce(p_snapshot, '{}'::jsonb)::text) <= 12000
      then coalesce(p_snapshot, '{}'::jsonb)
    else jsonb_build_object('truncated', true)
  end;
  next_invoice_status text;
  next_provider_status text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Esta operação exige a função de serviço.' using errcode = '42501';
  end if;
  if normalized_status <> all(supported_statuses) then
    return jsonb_build_object(
      'applied', false,
      'status', normalized_status,
      'reason', 'UNSUPPORTED_STATUS',
      'invoice_id', null,
      'provider_payment_id', null
    );
  end if;

  select coalesce(array_agg(payment.id order by payment.id), '{}'::uuid[])
    into matched_payment_ids
    from public.app_invoice_provider_payments as payment
   where payment.external_reference = p_external_reference
      or (
        normalized_payment_id <> ''
        and payment.provider_payment_id = normalized_payment_id
        and payment.provider_environment = normalized_environment
      );

  if cardinality(matched_payment_ids) = 0 then
    return jsonb_build_object(
      'applied', false,
      'status', normalized_status,
      'reason', 'PAYMENT_NOT_FOUND',
      'invoice_id', null,
      'provider_payment_id', normalized_payment_id
    );
  end if;

  if cardinality(matched_payment_ids) > 1 then
    update public.app_invoice_provider_payments
       set status = 'REVIEW_REQUIRED',
           safe_snapshot = snapshot_safe,
           last_error = 'Webhook mensal corresponde a mais de um snapshot local.',
           next_reconciliation_at = null,
           updated_at = now()
     where id = any(matched_payment_ids);
    perform pg_catalog.set_config('ilha.monthly_billing_write', '1', true);
    update public.app_payment_invoices
       set status = case when status = 'PAGA' then status else 'AGUARDANDO' end,
           provider_status = 'REVIEW_REQUIRED',
           last_payment_error = 'Webhook mensal corresponde a mais de um snapshot local.',
           updated_at = now()
     where id in (
       select candidate.invoice_id
         from public.app_invoice_provider_payments as candidate
        where candidate.id = any(matched_payment_ids)
     );
    perform private.sync_app_invoice_financial_transaction(
      candidate.invoice_id,
      'REVIEW_REQUIRED'
    )
      from public.app_invoice_provider_payments as candidate
     where candidate.id = any(matched_payment_ids);
    perform private.notify_monthly_billing_finance_review(
      candidate.invoice_id,
      'REVIEW_REQUIRED'
    )
      from public.app_invoice_provider_payments as candidate
     where candidate.id = any(matched_payment_ids);
    return jsonb_build_object(
      'applied', false,
      'status', 'REVIEW_REQUIRED',
      'reason', 'AMBIGUOUS_LOCAL_MATCH',
      'invoice_id', null,
      'provider_payment_id', normalized_payment_id
    );
  end if;

  select * into payment_row
    from public.app_invoice_provider_payments
   where id = matched_payment_ids[1]
   for update;

  select * into invoice_row
    from public.app_payment_invoices
   where id = payment_row.invoice_id
   for update;

  if normalized_environment not in ('SANDBOX', 'PRODUCTION')
     or normalized_environment <> payment_row.provider_environment
     or p_external_reference <> payment_row.external_reference
     or normalized_payment_id = ''
     or upper(coalesce(p_snapshot #>> '{payment,billing_type}', '')) <> 'PIX'
     or (
       payment_row.provider_payment_id is not null
       and payment_row.provider_payment_id <> normalized_payment_id
     )
     or round(payment_row.expected_amount * 100) <> round(coalesce(p_expected_amount, -1) * 100) then
    update public.app_invoice_provider_payments
       set status = 'REVIEW_REQUIRED',
           last_event_id = nullif(normalized_event_id, ''),
           last_event_at = now(),
           safe_snapshot = snapshot_safe,
           last_error = 'Webhook mensal divergente do snapshot local.',
           next_reconciliation_at = null,
           updated_at = now()
     where id = payment_row.id;
    perform pg_catalog.set_config('ilha.monthly_billing_write', '1', true);
    update public.app_payment_invoices
       set status = case when status = 'PAGA' then status else 'AGUARDANDO' end,
           provider_status = 'REVIEW_REQUIRED',
           last_payment_error = 'Webhook mensal divergente do snapshot local.',
           updated_at = now()
     where id = payment_row.invoice_id;
    perform private.sync_app_invoice_financial_transaction(
      payment_row.invoice_id,
      'REVIEW_REQUIRED'
    );
    perform private.notify_monthly_billing_finance_review(
      payment_row.invoice_id,
      'REVIEW_REQUIRED'
    );
    return jsonb_build_object(
      'applied', false,
      'status', 'REVIEW_REQUIRED',
      'reason', 'PAYMENT_MISMATCH',
      'invoice_id', payment_row.invoice_id,
      'provider_payment_id', normalized_payment_id
    );
  end if;

  if normalized_event_id <> '' and payment_row.last_event_id = normalized_event_id then
    return jsonb_build_object(
      'applied', false,
      'status', payment_row.status,
      'reason', 'DUPLICATE_EVENT',
      'invoice_id', payment_row.invoice_id,
      'provider_payment_id', payment_row.provider_payment_id
    );
  end if;

  next_provider_status := case
    when normalized_status = 'RECEIVED_IN_CASH' then 'RECEIVED'
    when normalized_status in ('CANCELLED', 'DELETED') then 'CANCELLED'
    else normalized_status
  end;

  if (
    payment_row.status = 'CONFIRMED' and next_provider_status in ('PENDING', 'FAILED')
  ) or (
    payment_row.status = 'OVERDUE' and next_provider_status in ('PENDING', 'CONFIRMED', 'FAILED')
  ) or (
    payment_row.status = 'RECEIVED'
    and next_provider_status in ('PENDING', 'CONFIRMED', 'OVERDUE', 'FAILED', 'CANCELLED')
  ) or (
    payment_row.status = 'CANCELLED' and next_provider_status <> 'CANCELLED'
  ) or (
    payment_row.status = 'REFUNDED' and next_provider_status <> 'REFUNDED'
  ) or (
    payment_row.status in (
      'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'CHARGEBACK', 'DISPUTED', 'REVIEW_REQUIRED'
    )
    and next_provider_status in (
      'PENDING', 'CONFIRMED', 'RECEIVED', 'OVERDUE', 'FAILED', 'CANCELLED'
    )
  ) then
    return jsonb_build_object(
      'applied', false,
      'status', payment_row.status,
      'reason', 'STATUS_REGRESSION',
      'invoice_id', payment_row.invoice_id,
      'provider_payment_id', normalized_payment_id
    );
  end if;
  next_invoice_status := case
    when next_provider_status = 'RECEIVED' then 'PAGA'
    when next_provider_status = 'OVERDUE' then 'VENCIDA'
    when next_provider_status in ('CANCELLED', 'REFUNDED') then 'CANCELADA'
    when next_provider_status in (
      'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'CHARGEBACK', 'DISPUTED'
    ) then 'AGUARDANDO'
    else 'AGUARDANDO'
  end;

  update public.app_invoice_provider_payments
     set provider_payment_id = normalized_payment_id,
         status = next_provider_status,
         last_event_id = nullif(normalized_event_id, ''),
         last_event_at = now(),
         safe_snapshot = snapshot_safe,
         last_error = case
           when next_provider_status in (
             'FAILED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'CHARGEBACK', 'DISPUTED'
           ) then 'Pagamento exige revisão financeira: ' || next_provider_status || '.'
           else null
         end,
         next_reconciliation_at = case
           when next_provider_status in ('PENDING', 'CONFIRMED', 'OVERDUE')
             then now() + interval '1 hour'
           else null
         end,
         updated_at = now()
   where id = payment_row.id;

  perform pg_catalog.set_config('ilha.monthly_billing_write', '1', true);
  update public.app_payment_invoices
     set status = next_invoice_status,
         provider_status = next_provider_status,
         payment_method = case when next_provider_status = 'RECEIVED' then 'PIX' else payment_method end,
         paid_at = case
           when next_provider_status = 'RECEIVED' then coalesce(p_paid_at, now())
           else paid_at
         end,
         last_payment_error = case
           when next_provider_status in (
             'FAILED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'CHARGEBACK', 'DISPUTED'
           ) then 'Pagamento exige revisão financeira: ' || next_provider_status || '.'
           else null
         end,
         updated_at = now()
   where id = payment_row.invoice_id;

  perform private.sync_app_invoice_financial_transaction(
    payment_row.invoice_id,
    next_provider_status,
    case when next_provider_status = 'RECEIVED' then coalesce(p_paid_at, now()) else null end
  );

  if next_provider_status in (
    'FAILED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED',
    'CHARGEBACK', 'DISPUTED', 'REVIEW_REQUIRED'
  ) then
    perform private.notify_monthly_billing_finance_review(
      payment_row.invoice_id,
      next_provider_status
    );
  end if;

  if next_provider_status = 'FAILED' then
    perform public.fail_app_invoice_provider_dispatch(
      payment_row.invoice_id,
      'O Asaas recusou esta cobrança Pix; revise os dados antes de tentar novamente.',
      false
    );
  end if;

  if next_provider_status = 'RECEIVED' then
    insert into public.app_client_notifications (
      user_id,
      title,
      body,
      link_url,
      event_type,
      dedupe_key
    )
    select
      invoice.client_id,
      'Pagamento mensal recebido',
      'Recebemos o pagamento Pix da sua mensalidade. Obrigado!',
      '/?view=payments&invoice=' || invoice.id::text,
      'FATURA_MENSAL_PAGA',
      'monthly-invoice-paid:' || invoice.id::text
    from public.app_payment_invoices as invoice
    where invoice.id = payment_row.invoice_id
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;

  return jsonb_build_object(
    'applied', true,
    'status', next_provider_status,
    'reason', 'APPLIED',
    'invoice_id', payment_row.invoice_id,
    'provider_payment_id', normalized_payment_id
  );
end;
$$;

revoke all on function public.apply_app_invoice_payment_reconciliation(
  text, text, text, text, numeric, timestamptz, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.apply_app_invoice_payment_reconciliation(
  text, text, text, text, numeric, timestamptz, text, jsonb
) to service_role;

create or replace function private.guard_app_payment_invoice_billing_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_write boolean :=
    coalesce(current_setting('ilha.monthly_billing_write', true), '') = '1';
  has_provider_snapshot boolean;
begin
  if tg_op = 'INSERT' then
    if coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
       and not trusted_write
       and (
         new.provider_status is not null
         or new.pix_expires_at is not null
         or new.last_payment_error is not null
         or new.issued_at is not null
       ) then
      raise exception 'Campos do provedor só podem ser preenchidos pelo fluxo financeiro.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  select exists (
    select 1
      from public.app_invoice_provider_payments as payment
     where payment.invoice_id = old.id
  ) into has_provider_snapshot;

  if tg_op = 'DELETE' then
    if has_provider_snapshot then
      raise exception 'Fatura emitida não pode ser excluída; use cancelamento auditado.'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if has_provider_snapshot and (
    new.client_id is distinct from old.client_id
    or new.invoice_month is distinct from old.invoice_month
    or new.description is distinct from old.description
    or new.plan_code is distinct from old.plan_code
    or new.plan_name is distinct from old.plan_name
    or new.amount is distinct from old.amount
    or new.due_date is distinct from old.due_date
    or new.family_billing is distinct from old.family_billing
  ) then
    raise exception 'Valor, vencimento e composição ficam congelados após a emissão.'
      using errcode = '23514';
  end if;

  if coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
     and not trusted_write
     and (
       (has_provider_snapshot and (
         new.status is distinct from old.status
         or new.payment_method is distinct from old.payment_method
         or new.paid_at is distinct from old.paid_at
       ))
       or
       new.provider_status is distinct from old.provider_status
       or new.pix_payload is distinct from old.pix_payload
       or new.pix_expires_at is distinct from old.pix_expires_at
       or new.last_payment_error is distinct from old.last_payment_error
       or new.issued_at is distinct from old.issued_at
     ) then
    raise exception 'Campos do provedor só podem ser alterados pelo fluxo financeiro.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_app_payment_invoice_billing_snapshot()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_app_payment_invoice_billing_snapshot
  on public.app_payment_invoices;
create trigger guard_app_payment_invoice_billing_snapshot
before insert or update or delete on public.app_payment_invoices
for each row execute function private.guard_app_payment_invoice_billing_snapshot();

create or replace function private.guard_app_family_invoice_item_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_write boolean :=
    coalesce(current_setting('ilha.monthly_billing_write', true), '') = '1'
    or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
begin
  if not trusted_write and exists (
    select 1
      from public.app_invoice_provider_payments as payment
     where payment.invoice_id = case when tg_op = 'INSERT' then new.invoice_id else old.invoice_id end
        or (
          tg_op = 'UPDATE'
          and payment.invoice_id = new.invoice_id
        )
  ) then
    raise exception 'A composição familiar fica congelada após a emissão.'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_app_family_invoice_item_snapshot()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_app_family_invoice_item_snapshot
  on public.app_family_invoice_items;
create trigger guard_app_family_invoice_item_snapshot
before insert or update or delete on public.app_family_invoice_items
for each row execute function private.guard_app_family_invoice_item_snapshot();

create or replace function private.guard_monthly_financial_transaction_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_write boolean :=
    coalesce(current_setting('ilha.monthly_billing_write', true), '') = '1';
  linked_invoice_id uuid := case
    when tg_op = 'INSERT' then new.app_payment_invoice_id
    else old.app_payment_invoice_id
  end;
begin
  if tg_op = 'DELETE' then
    if linked_invoice_id is not null then
      raise exception 'Lançamento de mensalidade emitida não pode ser excluído.'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if not trusted_write and (
    (tg_op = 'INSERT' and new.app_payment_invoice_id is not null)
    or (
      tg_op = 'UPDATE'
      and (
        old.app_payment_invoice_id is not null
        or new.app_payment_invoice_id is not null
      )
      and (
        new.app_payment_invoice_id is distinct from old.app_payment_invoice_id
        or new.student_id is distinct from old.student_id
        or new.counterparty is distinct from old.counterparty
        or new.description is distinct from old.description
        or new.category is distinct from old.category
        or new.type is distinct from old.type
        or new.amount is distinct from old.amount
        or new.due_date is distinct from old.due_date
        or new.paid_at is distinct from old.paid_at
        or new.status is distinct from old.status
        or new.payment_method is distinct from old.payment_method
      )
    )
  ) then
    raise exception 'Lançamento mensal vinculado só pode ser conciliado pelo fluxo financeiro.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_monthly_financial_transaction_snapshot()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_monthly_financial_transaction_snapshot
  on public.financial_transactions;
create trigger guard_monthly_financial_transaction_snapshot
before insert or update or delete on public.financial_transactions
for each row execute function private.guard_monthly_financial_transaction_snapshot();

comment on table public.app_invoice_provider_payments is
  'Snapshot privado 1:1 da cobrança PIX avulsa mensal. Nunca é exposto ao aluno.';
comment on table public.app_payment_customers is
  'Mapeamento privado e isolado por ambiente entre responsável e customer Asaas.';
comment on table public.app_monthly_billing_runs is
  'Auditoria privada de geração, retry e reconciliação manual/agendada; o cron fica em migration separada.';
comment on table public.app_monthly_billing_settings is
  'Feature flag de emissão. O cron varre a cada 15 minutos, mas cada pagamento normal é consultado no máximo uma vez por hora.';
comment on table public.app_monthly_billing_settings_audit is
  'Histórico privado e append-only das alterações administrativas do financeiro mensal.';
comment on column public.financial_transactions.app_payment_invoice_id is
  'Vínculo idempotente entre a receita exibida no ADM e a fatura mensal do Ilha Play.';
comment on function public.apply_app_invoice_payment_reconciliation(
  text, text, text, text, numeric, timestamptz, text, jsonb
) is 'Aplica webhook mensal de forma idempotente e fail-closed; execução exclusiva do service_role.';

commit;
