begin;

do $$
begin
  if to_regclass('public.financial_transactions') is null
     or to_regclass('public.app_payment_invoices') is null
     or to_regclass('public.app_invoice_provider_payments') is null
     or to_regclass('public.app_clients') is null
     or to_regprocedure('public.has_club_permission(text)') is null
     or not exists (
       select 1
       from pg_catalog.pg_attribute
       where attrelid = to_regclass('public.financial_transactions')
         and attname = 'app_payment_invoice_id'
         and not attisdropped
     )
     or not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'O financeiro profissional exige a base administrativa protegida.'
      using errcode = '55000';
  end if;
end;
$$;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table public.financial_recurring_rules (
  id uuid primary key default gen_random_uuid(),
  counterparty text not null,
  description text not null,
  category text not null default 'Operação',
  type text not null,
  classification text not null default 'FIXO',
  amount numeric(10, 2) not null,
  due_day smallint not null default 10,
  payment_method text,
  processing_method text not null default 'MANUAL',
  starts_on date not null default date_trunc('month', timezone('America/Sao_Paulo', now()))::date,
  ends_on date,
  active boolean not null default true,
  paused_at timestamptz,
  archived_at timestamptz,
  notes text,
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_recurring_rules_type_check
    check (type in ('RECEITA', 'DESPESA')),
  constraint financial_recurring_rules_classification_check
    check (classification = 'FIXO'),
  constraint financial_recurring_rules_amount_check
    check (amount > 0),
  constraint financial_recurring_rules_due_day_check
    check (due_day between 1 and 28),
  constraint financial_recurring_rules_payment_method_check
    check (
      payment_method is null
      or payment_method in ('CLUB_PIX', 'CASH', 'TRANSFERENCIA', 'CARTAO', 'PIX')
    ),
  constraint financial_recurring_rules_processing_method_check
    check (processing_method in ('MANUAL', 'ASAAS_PREPARED')),
  constraint financial_recurring_rules_provider_shape_check
    check (
      processing_method = 'MANUAL'
      or (
        processing_method = 'ASAAS_PREPARED'
        and type = 'RECEITA'
        and payment_method = 'PIX'
      )
    ),
  constraint financial_recurring_rules_period_check
    check (
      starts_on = date_trunc('month', starts_on::timestamp)::date
      and (
        ends_on is null
        or (
          ends_on = date_trunc('month', ends_on::timestamp)::date
          and ends_on >= starts_on
        )
      )
    ),
  constraint financial_recurring_rules_copy_length_check
    check (
      char_length(trim(counterparty)) between 2 and 160
      and char_length(trim(description)) between 2 and 240
      and char_length(trim(category)) between 2 and 80
      and (notes is null or char_length(notes) <= 2000)
    ),
  constraint financial_recurring_rules_version_check
    check (version > 0),
  constraint financial_recurring_rules_state_check
    check (
      (active and paused_at is null and archived_at is null)
      or (not active and paused_at is not null)
    )
);

alter table public.financial_recurring_rules enable row level security;

create index financial_recurring_rules_active_period_idx
  on public.financial_recurring_rules (active, starts_on, ends_on, due_day)
  where archived_at is null;

create index financial_recurring_rules_updated_by_idx
  on public.financial_recurring_rules (updated_by)
  where updated_by is not null;

alter table public.financial_transactions
  add column if not exists recurring_rule_id uuid,
  add column if not exists recurring_rule_version integer,
  add column if not exists competence_month date,
  add column if not exists classification text not null default 'VARIAVEL',
  add column if not exists processing_method text not null default 'MANUAL',
  add column if not exists ledger_origin text,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'financial_transactions_recurring_rule_fkey'
      and conrelid = 'public.financial_transactions'::regclass
  ) then
    alter table public.financial_transactions
      add constraint financial_transactions_recurring_rule_fkey
      foreign key (recurring_rule_id)
      references public.financial_recurring_rules(id)
      on delete restrict;
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'financial_transactions_created_by_fkey'
      and conrelid = 'public.financial_transactions'::regclass
  ) then
    alter table public.financial_transactions
      add constraint financial_transactions_created_by_fkey
      foreign key (created_by)
      references auth.users(id)
      on delete set null;
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'financial_transactions_updated_by_fkey'
      and conrelid = 'public.financial_transactions'::regclass
  ) then
    alter table public.financial_transactions
      add constraint financial_transactions_updated_by_fkey
      foreign key (updated_by)
      references auth.users(id)
      on delete set null;
  end if;
end;
$$;

update public.financial_transactions as ledger
   set processing_method = case
         when ledger.app_payment_invoice_id is not null
              and exists (
                select 1
                from public.app_invoice_provider_payments as provider
                where provider.invoice_id = ledger.app_payment_invoice_id
              ) then 'ASAAS'
         else 'MANUAL'
       end,
       classification = case when ledger.app_payment_invoice_id is not null then 'FIXO' else classification end,
       ledger_origin = case when ledger.app_payment_invoice_id is not null then 'APP_MONTHLY_INVOICE' else 'LEGACY' end
 where ledger.ledger_origin is null;

alter table public.financial_transactions
  alter column ledger_origin set default 'MANUAL',
  alter column ledger_origin set not null;

alter table public.financial_transactions
  add constraint financial_transactions_classification_check
    check (classification in ('FIXO', 'VARIAVEL')) not valid,
  add constraint financial_transactions_processing_method_check
    check (processing_method in ('MANUAL', 'ASAAS', 'ASAAS_PREPARED')) not valid,
  add constraint financial_transactions_ledger_origin_check
    check (ledger_origin in ('LEGACY', 'MANUAL', 'RECURRENCE', 'APP_MONTHLY_INVOICE')) not valid,
  add constraint financial_transactions_competence_month_check
    check (
      competence_month is null
      or competence_month = date_trunc('month', competence_month::timestamp)::date
    ) not valid,
  add constraint financial_transactions_recurring_shape_check
    check (
      (recurring_rule_id is null and recurring_rule_version is null)
      or (
        recurring_rule_id is not null
        and recurring_rule_version is not null
        and competence_month is not null
      )
    ) not valid,
  add constraint financial_transactions_provider_shape_check
    check (
      (
        ledger_origin in ('LEGACY', 'MANUAL')
        and processing_method = 'MANUAL'
        and app_payment_invoice_id is null
        and recurring_rule_id is null
      )
      or (
        ledger_origin = 'RECURRENCE'
        and recurring_rule_id is not null
        and app_payment_invoice_id is null
        and (
          processing_method = 'MANUAL'
          or (
            processing_method = 'ASAAS_PREPARED'
            and type = 'RECEITA'
            and payment_method = 'PIX'
          )
        )
      )
      or (
        ledger_origin = 'APP_MONTHLY_INVOICE'
        and app_payment_invoice_id is not null
        and recurring_rule_id is null
        and type = 'RECEITA'
        and processing_method in ('MANUAL', 'ASAAS')
      )
    ) not valid;

alter table public.financial_transactions
  validate constraint financial_transactions_classification_check;
alter table public.financial_transactions
  validate constraint financial_transactions_processing_method_check;
alter table public.financial_transactions
  validate constraint financial_transactions_ledger_origin_check;
alter table public.financial_transactions
  validate constraint financial_transactions_competence_month_check;
alter table public.financial_transactions
  validate constraint financial_transactions_recurring_shape_check;
alter table public.financial_transactions
  validate constraint financial_transactions_provider_shape_check;

create unique index financial_transactions_recurring_competence_uidx
  on public.financial_transactions (recurring_rule_id, competence_month)
  where recurring_rule_id is not null;

create index financial_transactions_competence_type_idx
  on public.financial_transactions (competence_month, type, status);

create index financial_transactions_recurring_rule_idx
  on public.financial_transactions (recurring_rule_id, due_date desc)
  where recurring_rule_id is not null;

create table private.financial_activity_audit (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  origin text not null default 'USER',
  reason text,
  before_data jsonb,
  after_data jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint financial_activity_audit_entity_type_check
    check (entity_type in ('TRANSACTION', 'RECURRING_RULE')),
  constraint financial_activity_audit_action_check
    check (action in ('CREATED', 'UPDATED', 'PAUSED', 'RESUMED', 'ARCHIVED', 'STATUS_CHANGED', 'GENERATED')),
  constraint financial_activity_audit_origin_check
    check (origin in ('USER', 'CRON', 'WEBHOOK')),
  constraint financial_activity_audit_reason_length_check
    check (reason is null or char_length(reason) <= 500)
);

revoke all on table private.financial_activity_audit
  from public, anon, authenticated, service_role;
grant insert, select on table private.financial_activity_audit to service_role;

create index financial_activity_audit_entity_created_idx
  on private.financial_activity_audit (entity_type, entity_id, created_at desc);

create index financial_activity_audit_actor_idx
  on private.financial_activity_audit (actor_user_id)
  where actor_user_id is not null;

drop policy if exists "finance staff read recurring rules"
  on public.financial_recurring_rules;
create policy "finance staff read recurring rules"
on public.financial_recurring_rules for select to authenticated
using (
  (select public.has_club_permission('finance.read'))
  or (select public.has_club_permission('finance.write'))
);

revoke all on table public.financial_recurring_rules from public, anon, authenticated;
grant select on table public.financial_recurring_rules to authenticated;
grant select on table public.financial_recurring_rules to service_role;

drop policy if exists "office manage financial_transactions" on public.financial_transactions;
drop policy if exists "permitted office manage financial transactions" on public.financial_transactions;
revoke insert, update, delete on table public.financial_transactions from authenticated;
grant select on table public.financial_transactions to authenticated;

create or replace function private.assert_finance_write()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or not public.has_club_permission('finance.write') then
    raise exception 'Sem permissão para alterar o financeiro.' using errcode = '42501';
  end if;
  return actor;
end;
$$;

revoke all on function private.assert_finance_write()
  from public, anon, authenticated, service_role;

create or replace function private.audit_financial_activity(
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_origin text,
  p_reason text,
  p_before jsonb,
  p_after jsonb,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.financial_activity_audit (
    entity_type, entity_id, action, origin, reason,
    before_data, after_data, actor_user_id
  ) values (
    p_entity_type, p_entity_id, p_action, p_origin, nullif(trim(p_reason), ''),
    p_before, p_after, p_actor
  );
end;
$$;

revoke all on function private.audit_financial_activity(text, uuid, text, text, text, jsonb, jsonb, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.generate_financial_recurring_transactions_internal(
  p_month date,
  p_rule_id uuid default null,
  p_actor uuid default null,
  p_origin text default 'USER'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_month date := date_trunc('month', p_month::timestamp)::date;
  rule_row public.financial_recurring_rules%rowtype;
  transaction_row public.financial_transactions%rowtype;
  generated integer := 0;
  generated_due_date date;
begin
  if p_month is null then
    raise exception 'Informe o mês de competência.' using errcode = '22023';
  end if;
  if p_origin not in ('USER', 'CRON') then
    raise exception 'Origem de geração inválida.' using errcode = '22023';
  end if;

  for rule_row in
    select rule.*
    from public.financial_recurring_rules as rule
    where rule.archived_at is null
      and rule.active
      and rule.starts_on <= normalized_month
      and (rule.ends_on is null or rule.ends_on >= normalized_month)
      and (p_rule_id is null or rule.id = p_rule_id)
    order by rule.id
    for update of rule
  loop
    generated_due_date := normalized_month + (rule_row.due_day - 1);
    perform pg_catalog.set_config('ilha.club_finance_write', '1', true);
    insert into public.financial_transactions (
      recurring_rule_id,
      recurring_rule_version,
      competence_month,
      counterparty,
      description,
      category,
      type,
      classification,
      amount,
      due_date,
      paid_at,
      status,
      payment_method,
      processing_method,
      ledger_origin,
      notes,
      created_by,
      updated_by
    ) values (
      rule_row.id,
      rule_row.version,
      normalized_month,
      rule_row.counterparty,
      rule_row.description,
      rule_row.category,
      rule_row.type,
      rule_row.classification,
      rule_row.amount,
      generated_due_date,
      null,
      'ABERTO',
      rule_row.payment_method,
      rule_row.processing_method,
      'RECURRENCE',
      concat_ws(E'\n', nullif(trim(rule_row.notes), ''), 'Gerado pela recorrência mensal do financeiro do clube.'),
      p_actor,
      p_actor
    )
    on conflict (recurring_rule_id, competence_month)
      where recurring_rule_id is not null
    do nothing
    returning * into transaction_row;

    if found then
      generated := generated + 1;
      perform private.audit_financial_activity(
        'TRANSACTION', transaction_row.id, 'GENERATED', p_origin,
        'Competência ' || normalized_month::text,
        null, to_jsonb(transaction_row), p_actor
      );
    end if;
  end loop;

  return generated;
end;
$$;

revoke all on function private.generate_financial_recurring_transactions_internal(date, uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.admin_save_financial_transaction(
  p_transaction_id uuid,
  p_type text,
  p_classification text,
  p_counterparty text,
  p_description text,
  p_category text,
  p_amount numeric,
  p_due_date date,
  p_status text,
  p_payment_method text,
  p_notes text
)
returns public.financial_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.assert_finance_write();
  old_row public.financial_transactions%rowtype;
  saved_row public.financial_transactions%rowtype;
  normalized_type text := upper(trim(coalesce(p_type, '')));
  normalized_classification text := upper(trim(coalesce(p_classification, '')));
  normalized_status text := upper(trim(coalesce(p_status, '')));
  normalized_method text := upper(trim(coalesce(p_payment_method, '')));
  paid_timestamp timestamptz;
begin
  if normalized_type not in ('RECEITA', 'DESPESA') then
    raise exception 'Tipo financeiro inválido.' using errcode = '22023';
  end if;
  if normalized_classification not in ('FIXO', 'VARIAVEL') then
    raise exception 'Classificação financeira inválida.' using errcode = '22023';
  end if;
  if (normalized_type = 'RECEITA' and normalized_status not in ('ABERTO', 'RECEBIDO', 'VENCIDO', 'CANCELADO'))
     or (normalized_type = 'DESPESA' and normalized_status not in ('ABERTO', 'PAGO', 'VENCIDO', 'CANCELADO')) then
    raise exception 'Status incompatível com o tipo financeiro.' using errcode = '22023';
  end if;
  if normalized_method in ('', 'A_DEFINIR') then normalized_method := null; end if;
  if normalized_method = 'PIX_CLUBE' then normalized_method := 'CLUB_PIX'; end if;
  if normalized_method = 'DINHEIRO' then normalized_method := 'CASH'; end if;
  if normalized_method is not null
     and normalized_method not in ('CLUB_PIX', 'CASH', 'TRANSFERENCIA', 'CARTAO') then
    raise exception 'Forma de pagamento manual inválida.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'O valor precisa ser maior que zero.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_counterparty, ''))) not between 2 and 160
     or char_length(trim(coalesce(p_description, ''))) not between 2 and 240
     or char_length(trim(coalesce(p_category, ''))) not between 2 and 80
     or char_length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Revise os textos do lançamento.' using errcode = '22023';
  end if;

  paid_timestamp := case when normalized_status in ('RECEBIDO', 'PAGO') then now() else null end;
  perform pg_catalog.set_config('ilha.club_finance_write', '1', true);

  if p_transaction_id is null then
    insert into public.financial_transactions (
      counterparty, description, category, type, classification, amount,
      due_date, paid_at, status, payment_method, processing_method,
      ledger_origin, notes, created_by, updated_by
    ) values (
      trim(p_counterparty), trim(p_description), trim(p_category), normalized_type,
      normalized_classification, p_amount, p_due_date, paid_timestamp,
      normalized_status, normalized_method, 'MANUAL', 'MANUAL', nullif(trim(p_notes), ''), actor, actor
    ) returning * into saved_row;
    perform private.audit_financial_activity(
      'TRANSACTION', saved_row.id, 'CREATED', 'USER', 'Lançamento avulso',
      null, to_jsonb(saved_row), actor
    );
  else
    select ledger.* into strict old_row
    from public.financial_transactions as ledger
    where ledger.id = p_transaction_id
    for update of ledger;
    if old_row.app_payment_invoice_id is not null
       or old_row.recurring_rule_id is not null
       or old_row.processing_method <> 'MANUAL' then
      raise exception 'Este lançamento é controlado por outro fluxo e não pode ser editado diretamente.'
        using errcode = '42501';
    end if;
    update public.financial_transactions
       set counterparty = trim(p_counterparty),
           description = trim(p_description),
           category = trim(p_category),
           type = normalized_type,
           classification = normalized_classification,
           amount = p_amount,
           due_date = p_due_date,
           paid_at = case
             when normalized_status in ('RECEBIDO', 'PAGO') then coalesce(old_row.paid_at, now())
             else null
           end,
           status = normalized_status,
           payment_method = normalized_method,
           notes = nullif(trim(p_notes), ''),
           ledger_origin = 'MANUAL',
           updated_by = actor,
           updated_at = now()
     where id = old_row.id
     returning * into saved_row;
    perform private.audit_financial_activity(
      'TRANSACTION', saved_row.id, 'UPDATED', 'USER', 'Edição de lançamento avulso',
      to_jsonb(old_row), to_jsonb(saved_row), actor
    );
  end if;

  return saved_row;
end;
$$;

create or replace function public.admin_set_financial_transaction_status(
  p_transaction_id uuid,
  p_status text,
  p_payment_method text default null
)
returns public.financial_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.assert_finance_write();
  old_row public.financial_transactions%rowtype;
  saved_row public.financial_transactions%rowtype;
  normalized_status text := upper(trim(coalesce(p_status, '')));
  normalized_method text := upper(trim(coalesce(p_payment_method, '')));
begin
  select ledger.* into strict old_row
  from public.financial_transactions as ledger
  where ledger.id = p_transaction_id
  for update of ledger;

  if old_row.app_payment_invoice_id is not null or old_row.processing_method = 'ASAAS' then
    raise exception 'A baixa desta cobrança pertence ao fluxo mensal do aluno.' using errcode = '42501';
  end if;
  if old_row.processing_method = 'ASAAS_PREPARED' and normalized_status <> 'CANCELADO' then
    raise exception 'A receita preparada para o Asaas precisa ser integrada ou cancelada.' using errcode = '42501';
  end if;
  if (old_row.type = 'RECEITA' and normalized_status not in ('ABERTO', 'RECEBIDO', 'VENCIDO', 'CANCELADO'))
     or (old_row.type = 'DESPESA' and normalized_status not in ('ABERTO', 'PAGO', 'VENCIDO', 'CANCELADO')) then
    raise exception 'Status incompatível com o tipo financeiro.' using errcode = '22023';
  end if;
  if normalized_method in ('', 'A_DEFINIR') then normalized_method := null; end if;
  if normalized_method = 'PIX_CLUBE' then normalized_method := 'CLUB_PIX'; end if;
  if normalized_method = 'DINHEIRO' then normalized_method := 'CASH'; end if;
  if normalized_method is not null
     and normalized_method not in ('CLUB_PIX', 'CASH', 'TRANSFERENCIA', 'CARTAO') then
    raise exception 'Forma de pagamento manual inválida.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('ilha.club_finance_write', '1', true);
  update public.financial_transactions
     set status = normalized_status,
         paid_at = case
           when normalized_status in ('RECEBIDO', 'PAGO') then coalesce(old_row.paid_at, now())
           else null
         end,
         payment_method = coalesce(normalized_method, payment_method),
         ledger_origin = case when old_row.ledger_origin = 'LEGACY' then 'MANUAL' else old_row.ledger_origin end,
         updated_by = actor,
         updated_at = now()
   where id = old_row.id
   returning * into saved_row;

  perform private.audit_financial_activity(
    'TRANSACTION', saved_row.id, 'STATUS_CHANGED', 'USER',
    'Status alterado para ' || normalized_status,
    to_jsonb(old_row), to_jsonb(saved_row), actor
  );
  return saved_row;
end;
$$;

create or replace function public.admin_save_financial_recurring_rule(
  p_rule_id uuid,
  p_type text,
  p_classification text,
  p_counterparty text,
  p_description text,
  p_category text,
  p_amount numeric,
  p_due_day integer,
  p_payment_method text,
  p_processing_method text,
  p_starts_on date,
  p_ends_on date,
  p_notes text,
  p_expected_version integer default null,
  p_generate_current boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.assert_finance_write();
  old_row public.financial_recurring_rules%rowtype;
  saved_row public.financial_recurring_rules%rowtype;
  normalized_type text := upper(trim(coalesce(p_type, '')));
  normalized_classification text := upper(trim(coalesce(p_classification, '')));
  normalized_method text := upper(trim(coalesce(p_payment_method, '')));
  normalized_processing text := upper(trim(coalesce(p_processing_method, 'MANUAL')));
  normalized_start date := date_trunc(
    'month',
    coalesce(p_starts_on, timezone('America/Sao_Paulo', now())::date)::timestamp
  )::date;
  normalized_end date := case when p_ends_on is null then null else date_trunc('month', p_ends_on::timestamp)::date end;
  generated integer := 0;
begin
  if normalized_type not in ('RECEITA', 'DESPESA') then
    raise exception 'Tipo financeiro inválido.' using errcode = '22023';
  end if;
  if normalized_classification not in ('FIXO', 'VARIAVEL') then
    raise exception 'Classificação financeira inválida.' using errcode = '22023';
  end if;
  if normalized_classification <> 'FIXO' then
    raise exception 'Custos e receitas variáveis devem ser lançados individualmente para preservar o valor real de cada mês.'
      using errcode = '22023';
  end if;
  if normalized_processing not in ('MANUAL', 'ASAAS_PREPARED') then
    raise exception 'Processamento financeiro inválido.' using errcode = '22023';
  end if;
  if normalized_processing = 'ASAAS_PREPARED' then
    raise exception 'O Asaas automático de terceiros está preparado, mas permanece bloqueado até existir um pagador validado.'
      using errcode = '55000';
  end if;
  if normalized_method in ('', 'A_DEFINIR') then normalized_method := null; end if;
  if normalized_method = 'PIX_CLUBE' then normalized_method := 'CLUB_PIX'; end if;
  if normalized_method = 'DINHEIRO' then normalized_method := 'CASH'; end if;
  if normalized_method is not null
     and normalized_method not in ('CLUB_PIX', 'CASH', 'TRANSFERENCIA', 'CARTAO') then
    raise exception 'Forma de pagamento manual inválida.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_due_day not between 1 and 28 then
    raise exception 'Revise o valor e o dia de vencimento.' using errcode = '22023';
  end if;
  if normalized_end is not null and normalized_end < normalized_start then
    raise exception 'O mês final não pode ser anterior ao início.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_counterparty, ''))) not between 2 and 160
     or char_length(trim(coalesce(p_description, ''))) not between 2 and 240
     or char_length(trim(coalesce(p_category, ''))) not between 2 and 80
     or char_length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Revise os textos da recorrência.' using errcode = '22023';
  end if;

  if p_rule_id is null then
    insert into public.financial_recurring_rules (
      counterparty, description, category, type, classification, amount,
      due_day, payment_method, processing_method, starts_on, ends_on,
      notes, created_by, updated_by
    ) values (
      trim(p_counterparty), trim(p_description), trim(p_category), normalized_type,
      normalized_classification, p_amount, p_due_day, normalized_method,
      normalized_processing, normalized_start, normalized_end,
      nullif(trim(p_notes), ''), actor, actor
    ) returning * into saved_row;
    perform private.audit_financial_activity(
      'RECURRING_RULE', saved_row.id, 'CREATED', 'USER', 'Nova recorrência mensal',
      null, to_jsonb(saved_row), actor
    );
  else
    select rule.* into strict old_row
    from public.financial_recurring_rules as rule
    where rule.id = p_rule_id and rule.archived_at is null
    for update of rule;
    if p_expected_version is null or old_row.version <> p_expected_version then
      raise exception 'Esta recorrência foi atualizada em outra tela. Recarregue antes de salvar novamente.'
        using errcode = '40001';
    end if;
    update public.financial_recurring_rules
       set counterparty = trim(p_counterparty),
           description = trim(p_description),
           category = trim(p_category),
           type = normalized_type,
           classification = normalized_classification,
           amount = p_amount,
           due_day = p_due_day,
           payment_method = normalized_method,
           processing_method = normalized_processing,
           starts_on = normalized_start,
           ends_on = normalized_end,
           notes = nullif(trim(p_notes), ''),
           version = version + 1,
           updated_by = actor,
           updated_at = now()
     where id = old_row.id
     returning * into saved_row;
    perform private.audit_financial_activity(
      'RECURRING_RULE', saved_row.id, 'UPDATED', 'USER',
      'A alteração vale somente para competências ainda não geradas.',
      to_jsonb(old_row), to_jsonb(saved_row), actor
    );
  end if;

  if p_generate_current and saved_row.active
     and saved_row.starts_on <= date_trunc('month', timezone('America/Sao_Paulo', now()))::date
     and (saved_row.ends_on is null or saved_row.ends_on >= date_trunc('month', timezone('America/Sao_Paulo', now()))::date) then
    generated := private.generate_financial_recurring_transactions_internal(
      date_trunc('month', timezone('America/Sao_Paulo', now()))::date,
      saved_row.id,
      actor,
      'USER'
    );
  end if;

  return jsonb_build_object('rule', to_jsonb(saved_row), 'generated', generated);
end;
$$;

create or replace function public.admin_set_financial_recurring_rule_active(
  p_rule_id uuid,
  p_active boolean,
  p_expected_version integer default null
)
returns public.financial_recurring_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.assert_finance_write();
  old_row public.financial_recurring_rules%rowtype;
  saved_row public.financial_recurring_rules%rowtype;
begin
  select rule.* into strict old_row
  from public.financial_recurring_rules as rule
  where rule.id = p_rule_id and rule.archived_at is null
  for update of rule;
  if p_expected_version is null or old_row.version <> p_expected_version then
    raise exception 'Esta recorrência foi atualizada em outra tela. Recarregue antes de continuar.'
      using errcode = '40001';
  end if;

  update public.financial_recurring_rules
     set active = p_active,
         paused_at = case when p_active then null else now() end,
         version = version + 1,
         updated_by = actor,
         updated_at = now()
   where id = old_row.id
   returning * into saved_row;

  perform private.audit_financial_activity(
    'RECURRING_RULE', saved_row.id,
    case when p_active then 'RESUMED' else 'PAUSED' end,
    'USER',
    case when p_active then 'Recorrência retomada; lançamentos anteriores preservados.' else 'Recorrência pausada; lançamentos anteriores preservados.' end,
    to_jsonb(old_row), to_jsonb(saved_row), actor
  );
  return saved_row;
end;
$$;

create or replace function public.admin_archive_financial_recurring_rule(
  p_rule_id uuid,
  p_expected_version integer default null
)
returns public.financial_recurring_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.assert_finance_write();
  old_row public.financial_recurring_rules%rowtype;
  saved_row public.financial_recurring_rules%rowtype;
begin
  select rule.* into strict old_row
  from public.financial_recurring_rules as rule
  where rule.id = p_rule_id and rule.archived_at is null
  for update of rule;
  if p_expected_version is null or old_row.version <> p_expected_version then
    raise exception 'Esta recorrência foi atualizada em outra tela. Recarregue antes de arquivar.'
      using errcode = '40001';
  end if;

  update public.financial_recurring_rules
     set active = false,
         paused_at = coalesce(paused_at, now()),
         archived_at = now(),
         version = version + 1,
         updated_by = actor,
         updated_at = now()
   where id = old_row.id
   returning * into saved_row;

  perform private.audit_financial_activity(
    'RECURRING_RULE', saved_row.id, 'ARCHIVED', 'USER',
    'Recorrência arquivada; lançamentos anteriores preservados.',
    to_jsonb(old_row), to_jsonb(saved_row), actor
  );
  return saved_row;
end;
$$;

create or replace function public.admin_generate_financial_recurring_transactions(
  p_month date,
  p_rule_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.assert_finance_write();
  normalized_month date := date_trunc('month', p_month::timestamp)::date;
  generated integer;
begin
  if p_month is null then
    raise exception 'Informe o mês de competência.' using errcode = '22023';
  end if;
  generated := private.generate_financial_recurring_transactions_internal(
    normalized_month, p_rule_id, actor, 'USER'
  );
  return jsonb_build_object('month', normalized_month, 'generated', generated);
end;
$$;

create or replace function private.run_financial_recurring_generation()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.generate_financial_recurring_transactions_internal(
    date_trunc('month', timezone('America/Sao_Paulo', now()))::date,
    null,
    null,
    'CRON'
  );
end;
$$;

revoke all on function private.run_financial_recurring_generation()
  from public, anon, authenticated, service_role;

-- Recurring occurrences can only be created or changed by the audited RPCs.
-- Existing Asaas-linked entries keep their stricter monthly billing capability.
create or replace function private.guard_monthly_financial_transaction_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  monthly_write boolean :=
    coalesce(current_setting('ilha.monthly_billing_write', true), '') = '1';
  club_finance_write boolean :=
    coalesce(current_setting('ilha.club_finance_write', true), '') = '1';
  old_invoice_id uuid := case when tg_op = 'INSERT' then null else old.app_payment_invoice_id end;
  new_invoice_id uuid := case when tg_op = 'DELETE' then null else new.app_payment_invoice_id end;
  old_rule_id uuid := case when tg_op = 'INSERT' then null else old.recurring_rule_id end;
  new_rule_id uuid := case when tg_op = 'DELETE' then null else new.recurring_rule_id end;
begin
  if tg_op = 'DELETE' then
    if old_invoice_id is not null then
      raise exception 'Lançamento de mensalidade emitida não pode ser excluído.' using errcode = '23514';
    end if;
    if old_rule_id is not null then
      raise exception 'Lançamento recorrente não pode ser excluído; cancele-o para preservar o histórico.' using errcode = '23514';
    end if;
    return old;
  end if;

  if not monthly_write and (
    (tg_op = 'INSERT' and new_invoice_id is not null)
    or (
      tg_op = 'UPDATE'
      and (old_invoice_id is not null or new_invoice_id is not null)
      and to_jsonb(new) is distinct from to_jsonb(old)
    )
  ) then
    raise exception 'Lançamento mensal vinculado só pode ser conciliado pelo fluxo financeiro.'
      using errcode = '42501';
  end if;

  if not club_finance_write and (
    (tg_op = 'INSERT' and new_rule_id is not null)
    or (
      tg_op = 'UPDATE'
      and (old_rule_id is not null or new_rule_id is not null)
      and to_jsonb(new) is distinct from to_jsonb(old)
    )
  ) then
    raise exception 'Lançamento recorrente só pode ser alterado pelo fluxo financeiro auditado.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_monthly_financial_transaction_snapshot()
  from public, anon, authenticated, service_role;

-- Keep student monthly matching isolated from generic recurring revenues.
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
  invoice_processing_method text;
begin
  select invoice.* into strict invoice_row
  from public.app_payment_invoices as invoice
  where invoice.id = p_invoice_id
  for update of invoice;

  invoice_processing_method := case
    when upper(coalesce(invoice_row.payment_method, '')) in ('CLUB_PIX', 'CASH', 'PIX_CLUBE', 'DINHEIRO') then 'MANUAL'
    else 'ASAAS'
  end;

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
       or transaction_row.due_date is distinct from invoice_row.due_date
       or transaction_row.ledger_origin <> 'APP_MONTHLY_INVOICE'
       or transaction_row.processing_method <> invoice_processing_method then
      raise exception 'O lançamento financeiro vinculado diverge do snapshot da fatura.'
        using errcode = '23514';
    end if;
    return transaction_row.id;
  end if;

  select coalesce(array_agg(ledger.id order by ledger.id), '{}'::uuid[])
    into legacy_ids
  from public.financial_transactions as ledger
  where ledger.app_payment_invoice_id is null
    and ledger.recurring_rule_id is null
    and ledger.ledger_origin = 'LEGACY'
    and ledger.type = 'RECEITA'
    and ledger.amount = invoice_row.amount
    and ledger.due_date is not distinct from invoice_row.due_date
    and lower(trim(coalesce(ledger.counterparty, ''))) = lower(trim(client_name))
    and lower(coalesce(ledger.category, '')) in ('mensalidade', 'aulas')
    and lower(ledger.description) like '%mensalidade%';

  if cardinality(legacy_ids) > 1 then
    raise exception 'Mais de um lançamento legado corresponde à fatura mensal.' using errcode = '23514';
  end if;

  perform pg_catalog.set_config('ilha.monthly_billing_write', '1', true);
  if cardinality(legacy_ids) = 1 then
    update public.financial_transactions
       set app_payment_invoice_id = p_invoice_id,
           processing_method = invoice_processing_method,
           ledger_origin = 'APP_MONTHLY_INVOICE',
           classification = 'FIXO',
           updated_at = now()
     where id = legacy_ids[1]
       and app_payment_invoice_id is null
       and recurring_rule_id is null
       and ledger_origin = 'LEGACY'
       and upper(coalesce(status, '')) in ('ABERTO', 'VENCIDO')
    returning * into transaction_row;
    if found then
      return transaction_row.id;
    end if;
  end if;

  insert into public.financial_transactions (
    app_payment_invoice_id, counterparty, description, category, type,
    classification, amount, due_date, paid_at, status, payment_method,
    processing_method, ledger_origin, notes
  ) values (
    p_invoice_id, client_name, invoice_row.description, 'Mensalidade', 'RECEITA',
    'FIXO', invoice_row.amount, invoice_row.due_date, invoice_row.paid_at,
    case
      when invoice_row.status = 'PAGA' then 'RECEBIDO'
      when invoice_row.status = 'VENCIDA' then 'VENCIDO'
      when invoice_row.status = 'CANCELADA' then 'CANCELADO'
      else 'ABERTO'
    end,
    invoice_row.payment_method, invoice_processing_method, 'APP_MONTHLY_INVOICE',
    'Gerado pelo financeiro mensal do Ilha Play.'
  ) returning * into strict transaction_row;

  return transaction_row.id;
end;
$$;

revoke all on function private.ensure_app_invoice_financial_transaction(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.admin_save_financial_transaction(uuid, text, text, text, text, text, numeric, date, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_set_financial_transaction_status(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_save_financial_recurring_rule(uuid, text, text, text, text, text, numeric, integer, text, text, date, date, text, integer, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_set_financial_recurring_rule_active(uuid, boolean, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_archive_financial_recurring_rule(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_generate_financial_recurring_transactions(date, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_save_financial_transaction(uuid, text, text, text, text, text, numeric, date, text, text, text)
  to authenticated;
grant execute on function public.admin_set_financial_transaction_status(uuid, text, text)
  to authenticated;
grant execute on function public.admin_save_financial_recurring_rule(uuid, text, text, text, text, text, numeric, integer, text, text, date, date, text, integer, boolean)
  to authenticated;
grant execute on function public.admin_set_financial_recurring_rule_active(uuid, boolean, integer)
  to authenticated;
grant execute on function public.admin_archive_financial_recurring_rule(uuid, integer)
  to authenticated;
grant execute on function public.admin_generate_financial_recurring_transactions(date, uuid)
  to authenticated;

do $$
declare
  existing_job record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for existing_job in
      select jobid from cron.job where jobname = 'club-finance-recurring-daily'
    loop
      perform cron.unschedule(existing_job.jobid);
    end loop;
    perform cron.schedule(
      'club-finance-recurring-daily',
      '15 9 * * *',
      'select private.run_financial_recurring_generation();'
    );
  end if;
end;
$$;

comment on table public.financial_recurring_rules is
  'Regras mensais editáveis e pausáveis. Alterações nunca reescrevem competências já geradas.';
comment on column public.financial_recurring_rules.processing_method is
  'MANUAL está ativo; ASAAS_PREPARED reserva o contrato futuro e é bloqueado até existir pagador validado.';
comment on column public.financial_transactions.recurring_rule_id is
  'Vínculo imutável da ocorrência com sua regra recorrente; evita colisão com mensalidades do aluno.';
comment on function public.admin_generate_financial_recurring_transactions(date, uuid) is
  'Materializa receitas e despesas recorrentes de forma idempotente, auditada e sem chamar o Asaas.';

commit;
