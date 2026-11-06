begin;

-- Preserve the pending attempt, and invalidate its claim instead of deleting it.
alter table private.monthly_invoice_receipts add column reversed_at timestamptz;
create table private.monthly_receipt_reversal_reviews (
  invoice_id uuid primary key references public.app_payment_invoices(id),
  actor_id uuid not null references auth.users(id),
  reason text not null check(length(trim(reason)) between 10 and 500),
  reviewed_at timestamptz not null default now(),
  before_state jsonb not null,
  remote_snapshot jsonb not null
);
revoke all on private.monthly_receipt_reversal_reviews from public,anon,authenticated,service_role;

-- A narrowly scoped administrative operation for a cash webhook whose pending
-- local receipt never completed. Normal reconciliation guards stay unchanged.
create function public.review_reversed_monthly_receipt(
  p_invoice_id uuid,p_actor_id uuid,p_expected_amount numeric,p_invoice_month date,p_due_date date,p_reason text,
  p_expected_version text default null,p_snapshot jsonb default null,p_checked_at timestamptz default null,
  p_remote_due_date date default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.app_payment_invoices%rowtype; p public.app_invoice_provider_payments%rowtype;
  r private.monthly_invoice_receipts%rowtype; f public.financial_transactions%rowtype;
  state_before jsonb; revision text;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
  -- The Edge authenticates the actor and checks finance.write before this RPC.
  if p_actor_id is null or not exists(select 1 from auth.users where id=p_actor_id)
    or p_reason is null or length(trim(p_reason)) not between 10 and 500
    or p_expected_amount is null or p_invoice_month is null or p_due_date is null then
    raise exception 'Confira ator, competência, valor, vencimento e motivo.';
  end if;
  select * into strict p from public.app_invoice_provider_payments where invoice_id=p_invoice_id for update;
  select * into strict i from public.app_payment_invoices where id=p_invoice_id for update;
  select * into strict r from private.monthly_invoice_receipts where invoice_id=p_invoice_id for update;
  select * into strict f from public.financial_transactions where app_payment_invoice_id=p_invoice_id for update;
  if i.amount is distinct from p_expected_amount or i.invoice_month is distinct from p_invoice_month
    or i.due_date is distinct from p_due_date then raise exception 'Fatura alterada; confira os dados atuais.'; end if;
  if r.reversed_at is not null and p.status='REVIEW_REQUIRED' and i.provider_status='REVIEW_REQUIRED'
    and i.status='AGUARDANDO' and i.paid_at is null and f.status='REVISAO' and f.paid_at is null
    and exists(select 1 from private.monthly_receipt_reversal_reviews where invoice_id=i.id) then
    return jsonb_build_object('state','REVIEW_REQUIRED','invoiceId',i.id);
  end if;
  if p.status<>'RECEIVED' or i.status<>'PAGA' or i.paid_at is null or i.superseded_at is not null
    or i.received_on is not null or i.received_method is not null or r.completed_at is not null
    or r.reversed_at is not null or r.claim_until>now() or r.amount<>i.amount
    or f.status<>'RECEBIDO' or f.paid_at is distinct from i.paid_at
    or p.expected_amount<>i.amount
    or coalesce(p.safe_snapshot#>>'{payment,status}','')<>'RECEIVED_IN_CASH' then
    raise exception 'Caso fora do fluxo de baixa pendente desfeita. Revisão específica necessária.';
  end if;
  state_before:=jsonb_build_object('invoice',to_jsonb(i),'provider',to_jsonb(p),'receipt',to_jsonb(r),'ledger',to_jsonb(f));
  revision:=md5(state_before::text);
  if p_expected_version is null then
    return jsonb_build_object('state','READY','invoiceId',i.id,'version',revision,'payment',
      jsonb_build_object('provider_payment_id',p.provider_payment_id,'provider_customer_id',p.provider_customer_id,
        'provider_environment',p.provider_environment,'external_reference',p.external_reference));
  end if;
  if p_expected_version<>revision then raise exception 'Dados alterados durante a conferência; consulte novamente.'; end if;
  if p_checked_at is null or p_checked_at<clock_timestamp()-interval '30 seconds' or p_checked_at>clock_timestamp()
    or p_remote_due_date is distinct from i.due_date
    or coalesce(p_snapshot#>>'{payment,id}','')<>p.provider_payment_id
    or coalesce(p_snapshot#>>'{payment,customer}','')<>p.provider_customer_id
    or coalesce(p_snapshot#>>'{payment,external_reference}','')<>p.external_reference
    or coalesce((p_snapshot#>>'{payment,value}')::numeric,-1)<>i.amount
    or coalesce(p_snapshot#>>'{payment,billing_type}','')<>'PIX'
    or coalesce(p_snapshot#>>'{payment,status}','') not in ('PENDING','OVERDUE')
    or coalesce(p_snapshot#>>'{payment,deleted}','')<>'false'
    or coalesce(p_snapshot#>>'{payment,payment_date}','')<>''
    or coalesce(p_snapshot#>>'{payment,client_payment_date}','')<>'' then
    raise exception 'Asaas não comprova a reversão atual desta cobrança.';
  end if;
  insert into private.monthly_receipt_reversal_reviews(invoice_id,actor_id,reason,before_state,remote_snapshot)
    values(i.id,p_actor_id,trim(p_reason),state_before,p_snapshot);
  perform pg_catalog.set_config('ilha.monthly_billing_write','1',true);
  update public.app_invoice_provider_payments set status='REVIEW_REQUIRED',safe_snapshot=p_snapshot,
    last_error='Baixa externa desfeita; aguardando conciliação administrativa.',next_reconciliation_at=null,
    last_event_at=now(),updated_at=now() where id=p.id;
  update public.app_payment_invoices set status='AGUARDANDO',provider_status='REVIEW_REQUIRED',paid_at=null,
    last_payment_error='Baixa externa desfeita; aguardando conciliação administrativa.',updated_at=now() where id=i.id;
  update public.financial_transactions set status='REVISAO',paid_at=null,updated_at=now() where id=f.id;
  update private.monthly_invoice_receipts set reversed_at=now(),claim_token=gen_random_uuid(),claim_until=now()
    where invoice_id=i.id;
  -- REVIEW_REQUIRED deliberately quarantines stale webhooks. It is NOT a new
  -- receipt and does not reopen collection while the actual payment is unknown.
  return jsonb_build_object('state','REVIEW_REQUIRED','invoiceId',i.id);
end;
$$;
revoke all on function public.review_reversed_monthly_receipt(uuid,uuid,numeric,date,date,text,text,jsonb,timestamptz,date) from public,anon,authenticated,service_role;
grant execute on function public.review_reversed_monthly_receipt(uuid,uuid,numeric,date,date,text,text,jsonb,timestamptz,date) to service_role;

-- Old claim tokens and late completion must not reapply a reversed attempt.
do $$
declare signature text; definition text; needle text;
begin
  foreach signature in array array[
    'public.prepare_monthly_invoice_receipt(uuid,uuid,text,date,numeric,text)',
    'public.complete_monthly_invoice_receipt(uuid,uuid,jsonb)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    needle:='if r.completed_at is not null then';
    if position(needle in definition)=0 then raise exception 'Unexpected receipt definition: %',signature; end if;
    execute replace(definition,needle,'if r.reversed_at is not null then raise exception ''Recebimento desfeito em revisão administrativa.''; end if; '||needle);
  end loop;
end;
$$;
commit;
