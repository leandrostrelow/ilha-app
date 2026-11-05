begin;

-- Reuse the single eligibility calculation; ignore an old invoice only while
-- previewing an explicitly proven remote cancellation. No historical edits.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('private.monthly_billing_candidates(date,uuid)'::regprocedure);
  if position('where candidate_invoice.superseded_at is null and candidate_invoice.client_id = base.id' in definition)=0 then
    raise exception 'Unexpected monthly candidates definition';
  end if;
  definition := regexp_replace(definition,
    'FUNCTION private.monthly_billing_candidates\([^\n]+\)',
    'FUNCTION private.monthly_billing_candidates_ignoring(p_invoice_month date, p_client_id uuid, p_ignored_invoice_id uuid)');
  definition := replace(definition,
    'where candidate_invoice.superseded_at is null and candidate_invoice.client_id = base.id',
    'where candidate_invoice.superseded_at is null and candidate_invoice.id is distinct from p_ignored_invoice_id and candidate_invoice.client_id = base.id');
  execute definition;
end;
$$;
revoke all on function private.monthly_billing_candidates_ignoring(date,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function private.monthly_billing_candidates(p_invoice_month date,p_client_id uuid default null)
returns table(client_id uuid,client_name text,invoice_id uuid,amount numeric,due_date date,
  family_billing boolean,state text,reason text,provider_status text,last_error text)
language sql stable security definer set search_path='' as $$
  select * from private.monthly_billing_candidates_ignoring(p_invoice_month,p_client_id,null);
$$;

create or replace function private.client_monthly_payment_options(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare today date:=(now() at time zone 'America/Sao_Paulo')::date;
  cycle record; candidate record; fresh record; invoice public.app_payment_invoices%rowtype;
  payment public.app_invoice_provider_payments%rowtype;
  result jsonb:='[]'::jsonb; state text; due date; amount numeric; reason text;
begin
  if not exists(select 1 from public.app_monthly_billing_enrollments where client_id=p_client_id and enabled and billing_method='ASAAS_PIX')
    or exists(select 1 from public.app_family_members where member_client_id=p_client_id
      and billing_responsible_id<>p_client_id and status in ('ATIVO','PENDENTE')) then return result; end if;
  for cycle in
    select m::date as month,private.monthly_billing_due_date(m::date,coalesce(c.due_day,p.default_due_day,10)) as due
    from public.app_clients c left join public.app_plans p on p.id=c.official_plan_id
    cross join generate_series(date_trunc('month',today::timestamp),date_trunc('month',today::timestamp)+interval '1 month',interval '1 month') m
    where c.id=p_client_id and c.status='ATIVO'
  loop
    select * into candidate from private.monthly_billing_candidates(cycle.month,p_client_id);
    select * into invoice from public.app_payment_invoices where id=candidate.invoice_id;
    due:=coalesce(invoice.due_date,cycle.due); amount:=candidate.amount; reason:=candidate.reason;
    state:=case
      when candidate.state='PAID' then 'PAID'
      when candidate.provider_status='CONFIRMED' then 'CONFIRMED'
      when candidate.state='SKIPPED' or candidate.provider_status in ('REVIEW_REQUIRED','REFUND_PENDING','REFUNDED','PARTIALLY_REFUNDED','DISPUTED','CHARGEBACK','CANCELLED') then 'BLOCKED'
      when candidate.provider_status in ('PENDING','OVERDUE') and nullif(trim(invoice.pix_payload),'') is not null
        and (invoice.pix_expires_at is null or invoice.pix_expires_at>now()) then 'PAYABLE'
      when candidate.state in ('ELIGIBLE','ELIGIBLE_WITH_WARNING','READY','EXISTING','RECONCILING','OVERDUE','FAILED') then 'AVAILABLE'
      else 'BLOCKED' end;
    if reason='INVOICE_CANCELLED' and invoice.status='CANCELADA' and invoice.paid_at is null and invoice.provider_status='CANCELLED' then
      select * into payment from public.app_invoice_provider_payments where invoice_id=invoice.id;
      if payment.status='CANCELLED' and (coalesce(payment.safe_snapshot#>>'{payment,deleted}','false')='true'
        or coalesce(payment.safe_snapshot#>>'{payment,status}','') in ('DELETED','CANCELLED')) then
        select * into fresh from private.monthly_billing_candidates_ignoring(cycle.month,p_client_id,invoice.id);
        amount:=fresh.amount; due:=fresh.due_date;
        if fresh.state in ('ELIGIBLE','ELIGIBLE_WITH_WARNING') then state:='REISSUABLE'; reason:=null;
        else reason:=fresh.reason; end if;
      end if;
    end if;
    -- Current-month self service is on demand. The automatic job still uses
    -- monthly_billing_advance_targets and future cycles still respect D-15.
    if state in ('AVAILABLE','REISSUABLE') and cycle.month>date_trunc('month',today)::date and due>today+15 then state:='TOO_EARLY'; end if;
    result:=result||jsonb_build_array(jsonb_build_object('invoice_month',cycle.month,'invoice_id',candidate.invoice_id,
      'amount',amount,'due_date',due,'scheduled_due_date',case when state='REISSUABLE' then due else coalesce(invoice.due_date,cycle.due) end,
      'available_on',case when cycle.month=date_trunc('month',today)::date then cycle.month else due-15 end,
      'state',state,'reason',reason));
  end loop;
  return result;
end;
$$;

-- The safe reissue transaction also accepts the current month on demand.
do $$
declare definition text; needle text;
begin
  definition:=pg_get_functiondef('public.prepare_cancelled_monthly_invoice_reissue(uuid,numeric,text)'::regprocedure);
  needle:='if not exists(select 1 from private.monthly_billing_advance_targets';
  if position(needle in definition)=0 then raise exception 'Unexpected reissue definition'; end if;
  definition:=replace(definition,needle,
    'if not (old_invoice.invoice_month=date_trunc(''month'',now() at time zone ''America/Sao_Paulo'')::date and exists(select 1 from public.app_monthly_billing_enrollments where client_id=old_invoice.client_id and enabled and billing_method=''ASAAS_PIX'')) and not exists(select 1 from private.monthly_billing_advance_targets');
  execute definition;
end;
$$;

create or replace function public.prepare_client_monthly_pix(p_client_id uuid,p_invoice_month date,p_provider_environment text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare option jsonb; generated jsonb; invoice_id uuid;
begin
  if coalesce((select auth.jwt()->>'role'),'') <> 'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if p_provider_environment not in ('PRODUCTION','SANDBOX') then raise exception 'Ambiente inválido.'; end if;
  perform 1 from public.app_monthly_billing_enrollments where client_id=p_client_id and enabled and billing_method='ASAAS_PIX' for share;
  if not found then return jsonb_build_object('state','BLOCKED','error','Cobrança Pix não ativada. Fale com o clube.'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ilha-monthly-billing:'||p_invoice_month::text,0));
  select value into option from jsonb_array_elements(private.client_monthly_payment_options(p_client_id)) where value->>'invoice_month'=p_invoice_month::text;
  if option is null or option->>'state' not in ('AVAILABLE','PAYABLE','REISSUABLE') then
    return jsonb_build_object('state',coalesce(option->>'state','BLOCKED'),'error',case
      when option->>'state'='TOO_EARLY' then 'O próximo mês fica disponível 15 dias antes do vencimento.'
      when option->>'state' in ('PAID','CONFIRMED') then 'Este pagamento já foi identificado.'
      else 'Esta mensalidade precisa de revisão do clube antes da emissão.' end);
  end if;
  invoice_id:=(option->>'invoice_id')::uuid;
  if exists(select 1 from public.app_invoice_provider_payments where app_invoice_provider_payments.invoice_id=prepare_client_monthly_pix.invoice_id
    and provider_environment<>p_provider_environment) then raise exception 'Ambiente da cobrança divergente.'; end if;
  if option->>'state'='REISSUABLE' then
    generated:=public.prepare_cancelled_monthly_invoice_reissue(invoice_id,(option->>'amount')::numeric,
      'Nova via solicitada pelo titular autenticado; cancelamento remoto comprovado e valor atual validado no servidor.');
    invoice_id:=(generated#>>'{results,0,invoiceId}')::uuid;
  elsif invoice_id is null then
    generated:=public.generate_enrolled_app_monthly_pix_billing(p_invoice_month,p_client_id,p_provider_environment);
    invoice_id:=(generated#>>'{results,0,invoiceId}')::uuid;
  end if;
  if invoice_id is null then return jsonb_build_object('state','BLOCKED','error','Não foi possível preparar a mensalidade. Fale com o clube.'); end if;
  return jsonb_build_object('state',case when option->>'state'='PAYABLE' then 'PAYABLE' else 'AVAILABLE' end,'invoiceId',invoice_id);
end;
$$;

-- A receipt belongs to ONE invoice, never to the recurring enrollment.
create table private.monthly_invoice_receipts (
  invoice_id uuid primary key references public.app_payment_invoices(id),
  requested_by uuid not null references auth.users(id),
  method text not null check(method in ('CASH','CLUB_PIX')),
  received_on date not null,
  amount numeric(12,2) not null check(amount>0),
  notes text,
  claim_token uuid not null default gen_random_uuid(),
  claim_until timestamptz not null default now()+interval '2 minutes',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
revoke all on private.monthly_invoice_receipts from public,anon,authenticated,service_role;
alter table public.app_payment_invoices add column received_method text check(received_method in ('CASH','CLUB_PIX')),
  add column received_on date;

create function private.guard_invoice_receipt_fields() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (tg_op='INSERT' and (new.received_method is not null or new.received_on is not null)) or
    (tg_op='UPDATE' and (new.received_method is distinct from old.received_method or new.received_on is distinct from old.received_on)) then
    if coalesce(current_setting('ilha.invoice_receipt_write',true),'')<>'1' or coalesce(auth.jwt()->>'role','')<>'service_role' then
      raise exception 'Recebimento exige confirmação financeira auditada.' using errcode='42501';
    end if;
  end if;
  if new.status='PAGA' and new.received_on is not null then new.paid_at:=(new.received_on::text||' 12:00:00 America/Sao_Paulo')::timestamptz; end if;
  return new;
end;
$$;
revoke all on function private.guard_invoice_receipt_fields() from public,anon,authenticated,service_role;
create trigger guard_invoice_receipt_fields before insert or update on public.app_payment_invoices
  for each row execute function private.guard_invoice_receipt_fields();

create function public.prepare_monthly_invoice_receipt(p_invoice_id uuid,p_actor_id uuid,p_method text,p_received_on date,p_expected_amount numeric,p_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.app_payment_invoices%rowtype; p public.app_invoice_provider_payments%rowtype;
  r private.monthly_invoice_receipts%rowtype;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if p_actor_id is null or p_method not in ('CASH','CLUB_PIX') or p_received_on is null
    or p_received_on>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Confira a forma e a data do recebimento.'; end if;
  select * into p from public.app_invoice_provider_payments where invoice_id=p_invoice_id for update;
  select * into strict i from public.app_payment_invoices where id=p_invoice_id for update;
  select * into r from private.monthly_invoice_receipts where invoice_id=p_invoice_id for update;
  if r.completed_at is not null then return jsonb_build_object('state','COMPLETED','invoiceId',i.id); end if;
  if i.superseded_at is not null or i.status='CANCELADA' or i.amount<=0 or i.amount is distinct from p_expected_amount then
    raise exception 'Fatura cancelada ou valor alterado. Atualize a página e confira.'; end if;
  if r.invoice_id is null and (i.status='PAGA' or i.paid_at is not null) then raise exception 'Esta fatura já foi paga.'; end if;
  if p.id is not null and (p.provider_payment_id is null or p.status not in ('PENDING','OVERDUE','RECEIVED')
    or (p.status='RECEIVED' and r.invoice_id is null)) then
    raise exception 'Cobrança em processamento ou revisão. Consulte o Asaas antes da baixa.';
  end if;
  if p.id is null and (i.provider_status is not null or i.issued_at is not null or nullif(i.pix_payload,'') is not null) then
    raise exception 'Vínculo de cobrança inconsistente. Revise antes de receber.';
  end if;
  if r.invoice_id is not null then
    if r.method<>p_method or r.received_on<>p_received_on or r.amount<>p_expected_amount then
      raise exception 'Há uma confirmação pendente. Tente novamente com a mesma forma, valor e data.';
    end if;
    if r.claim_until>now() then raise exception 'Recebimento em confirmação. Aguarde dois minutos e atualize antes de tentar novamente.'; end if;
    update private.monthly_invoice_receipts set claim_token=gen_random_uuid(),claim_until=now()+interval '2 minutes'
      where invoice_id=p_invoice_id returning * into r;
  else
    insert into private.monthly_invoice_receipts(invoice_id,requested_by,method,received_on,amount,notes)
      values(i.id,p_actor_id,p_method,p_received_on,i.amount,left(nullif(trim(p_notes),''),500)) returning * into r;
  end if;
  return jsonb_build_object('state','READY','invoiceId',i.id,'claimToken',r.claim_token,'amount',r.amount,
    'receivedOn',r.received_on,'method',r.method,'payment',case when p.id is null then null else to_jsonb(p) end);
end;
$$;
revoke all on function public.prepare_monthly_invoice_receipt(uuid,uuid,text,date,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.prepare_monthly_invoice_receipt(uuid,uuid,text,date,numeric,text) to service_role;

create function public.complete_monthly_invoice_receipt(p_invoice_id uuid,p_claim_token uuid,p_provider_snapshot jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.app_payment_invoices%rowtype; p public.app_invoice_provider_payments%rowtype;
  r private.monthly_invoice_receipts%rowtype; outcome jsonb; paid_time timestamptz;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
  select * into p from public.app_invoice_provider_payments where invoice_id=p_invoice_id for update;
  select * into strict i from public.app_payment_invoices where id=p_invoice_id for update;
  select * into strict r from private.monthly_invoice_receipts where invoice_id=p_invoice_id for update;
  if r.completed_at is not null then return jsonb_build_object('state','COMPLETED','invoiceId',i.id); end if;
  if r.claim_token is distinct from p_claim_token or i.status='CANCELADA' or i.superseded_at is not null or i.amount<>r.amount then raise exception 'Confirmação divergente; atualize a fatura.'; end if;
  paid_time:=(r.received_on::text||' 12:00:00 America/Sao_Paulo')::timestamptz;
  if p.id is not null then
    if coalesce(p_provider_snapshot#>>'{payment,id}','')<>p.provider_payment_id
      or coalesce(p_provider_snapshot#>>'{payment,external_reference}','')<>p.external_reference
      or coalesce(p_provider_snapshot#>>'{payment,customer}','')<>p.provider_customer_id
      or coalesce((p_provider_snapshot#>>'{payment,value}')::numeric,-1)<>r.amount
      or not (coalesce(p_provider_snapshot#>>'{payment,billing_type}','')='RECEIVED_IN_CASH'
        or coalesce(p_provider_snapshot#>>'{payment,status}','')='RECEIVED_IN_CASH')
      or coalesce(p_provider_snapshot#>>'{payment,status}','') not in ('RECEIVED','RECEIVED_IN_CASH') then
      raise exception 'O Asaas ainda não confirmou o recebimento fora da plataforma.';
    end if;
    outcome:=public.apply_app_invoice_payment_reconciliation(p.provider_payment_id,p.provider_environment,'RECEIVED_IN_CASH',
      p.external_reference,r.amount,paid_time,'manual-receipt:'||i.id::text,p_provider_snapshot);
    if coalesce((outcome->>'applied')::boolean,false)=false and not (outcome->>'reason'='DUPLICATE_EVENT' and outcome->>'status'='RECEIVED') then
      raise exception 'Não foi possível reconciliar o recebimento: %',outcome->>'reason';
    end if;
  else
    if i.paid_at is not null or i.status='PAGA' then raise exception 'A fatura já foi recebida por outra operação.'; end if;
    perform pg_catalog.set_config('ilha.monthly_billing_write','1',true);
    perform private.ensure_app_invoice_financial_transaction(i.id);
  end if;
  perform pg_catalog.set_config('ilha.monthly_billing_write','1',true);
  perform pg_catalog.set_config('ilha.invoice_receipt_write','1',true);
  update public.app_payment_invoices set status='PAGA',paid_at=paid_time,received_method=r.method,received_on=r.received_on,
    notes=coalesce(r.notes,notes),updated_at=now() where id=i.id;
  update public.financial_transactions set status='RECEBIDO',paid_at=paid_time,payment_method=r.method,
    notes=coalesce(r.notes,notes),updated_at=now() where app_payment_invoice_id=i.id;
  update private.monthly_invoice_receipts set completed_at=now(),claim_until=now() where invoice_id=i.id;
  return jsonb_build_object('state','COMPLETED','invoiceId',i.id,'method',r.method,'receivedOn',r.received_on);
end;
$$;
revoke all on function public.complete_monthly_invoice_receipt(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.complete_monthly_invoice_receipt(uuid,uuid,jsonb) to service_role;

-- Asaas uses billingType RECEIVED_IN_CASH for an off-platform receipt. Keep
-- identity/amount/environment validation and prevent late webhooks from
-- overwriting the actual receipt method in the accounting ledger.
do $$
declare definition text; needle text;
begin
  definition:=pg_get_functiondef('public.apply_app_invoice_payment_reconciliation(text,text,text,text,numeric,timestamptz,text,jsonb)'::regprocedure);
  needle:='upper(coalesce(p_snapshot #>> ''{payment,billing_type}'', '''')) <> ''PIX''';
  if position(needle in definition)=0 then raise exception 'Unexpected reconciliation definition'; end if;
  definition:=replace(definition,needle,'not (upper(coalesce(p_snapshot #>> ''{payment,billing_type}'', '''')) = ''PIX'' or (upper(coalesce(p_snapshot #>> ''{payment,billing_type}'', '''')) = ''RECEIVED_IN_CASH'' and normalized_status in (''RECEIVED'',''RECEIVED_IN_CASH'')))');
  definition:=replace(definition,'Recebemos o pagamento Pix da sua mensalidade. Obrigado!','Recebemos o pagamento da sua mensalidade. Obrigado!');
  execute definition;
  select pg_get_functiondef(p.oid) into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='complete_app_invoice_provider_dispatch';
  needle:='upper(trim(coalesce(p_billing_type, ''''))) <> ''PIX''';
  if definition is null or position(needle in definition)=0 then raise exception 'Unexpected dispatch definition'; end if;
  definition:=replace(definition,needle,'not (upper(trim(coalesce(p_billing_type, ''''))) = ''PIX'' or (upper(trim(coalesce(p_billing_type, ''''))) = ''RECEIVED_IN_CASH'' and normalized_status = ''RECEIVED''))');
  execute definition;
  definition:=pg_get_functiondef('private.sync_app_invoice_financial_transaction(uuid,text,timestamptz)'::regprocedure);
  definition:=replace(definition,'coalesce(p_paid_at, paid_at, now())',
    'coalesce((select paid_at from public.app_payment_invoices where id=p_invoice_id and received_on is not null), p_paid_at, paid_at, now())');
  definition:=replace(definition,'when normalized_status = ''RECEIVED'' then ''PIX''',
    'when normalized_status = ''RECEIVED'' then coalesce((select received_method from public.app_payment_invoices where id=p_invoice_id),''PIX'')');
  execute definition;
end;
$$;

commit;
