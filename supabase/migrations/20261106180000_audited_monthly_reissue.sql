begin;
create table private.monthly_invoice_reissues (
  old_invoice_id uuid primary key references public.app_payment_invoices(id),
  new_invoice_id uuid not null unique references public.app_payment_invoices(id),
  actor_id uuid not null references auth.users(id),
  reason text not null,
  before_state jsonb not null,
  cancellation_proof jsonb not null,
  created_at timestamptz not null default now()
);
revoke all on private.monthly_invoice_reissues from public,anon,authenticated,service_role;

-- Two-phase administrative coordinator. The Edge supplies a fresh GET from
-- Asaas; no emitted snapshot is edited, and no payment date is invented.
create function public.prepare_audited_monthly_reissue(
  p_invoice_id uuid,p_actor_id uuid,p_expected_amount numeric,p_invoice_month date,
  p_old_due_date date,p_new_due_date date,p_reason text,
  p_version text default null,p_snapshot jsonb default null,p_checked_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.app_payment_invoices%rowtype; p public.app_invoice_provider_payments%rowtype;
  f public.financial_transactions%rowtype; r private.monthly_invoice_receipts%rowtype;
  a private.monthly_invoice_reissues%rowtype; candidate record; before_state jsonb; revision text;
  generated jsonb; replacement public.app_payment_invoices%rowtype;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if p_actor_id is null or not exists(select 1 from auth.users where id=p_actor_id)
    or p_expected_amount is null or p_expected_amount<=0 or p_invoice_month is null
    or p_old_due_date is null or p_new_due_date is null or p_reason is null
    or length(trim(p_reason)) not between 10 and 400 then raise exception 'Confira ator, valor, competência, vencimentos e motivo.'; end if;
  select * into strict i from public.app_payment_invoices where id=p_invoice_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ilha-monthly-billing:'||i.invoice_month::text,0));
  select * into strict p from public.app_invoice_provider_payments where invoice_id=i.id for update;
  select * into strict i from public.app_payment_invoices where id=p_invoice_id for update;
  select * into strict f from public.financial_transactions where app_payment_invoice_id=i.id for update;
  select * into r from private.monthly_invoice_receipts where invoice_id=i.id for update;
  if i.amount is distinct from p_expected_amount or i.invoice_month is distinct from p_invoice_month
    or i.due_date is distinct from p_old_due_date then raise exception 'Fatura alterada; confira os dados atuais.'; end if;
  select * into a from private.monthly_invoice_reissues where old_invoice_id=i.id;
  if a.old_invoice_id is not null then
    select * into strict replacement from public.app_payment_invoices where id=a.new_invoice_id;
    if replacement.amount is distinct from p_expected_amount or replacement.due_date is distinct from p_new_due_date
      or a.reason<>trim(p_reason) then raise exception 'Já existe uma reemissão com outros dados; confira o histórico.'; end if;
    return jsonb_build_object('state','READY_DISPATCH','invoiceId',replacement.id,'clientId',replacement.client_id);
  end if;
  if i.superseded_at is not null or i.paid_at is not null or i.received_on is not null or f.paid_at is not null
    or r.completed_at is not null or (r.invoice_id is not null and r.reversed_at is null)
    or p.expected_amount is distinct from i.amount or p.provider_payment_id is null
    or not ((i.status='CANCELADA' and i.provider_status='CANCELLED' and p.status='CANCELLED' and f.status='CANCELADO')
      or (i.status='AGUARDANDO' and i.provider_status='REVIEW_REQUIRED' and p.status='REVIEW_REQUIRED' and f.status='REVISAO'
        and r.reversed_at is not null and exists(select 1 from private.monthly_receipt_reversal_reviews where invoice_id=i.id))) then
    raise exception 'Somente cobrança cancelada ou baixa desfeita auditada sem recebimento pode ser reemitida.';
  end if;
  select * into strict candidate from private.monthly_billing_candidates_ignoring(i.invoice_month,i.client_id,i.id);
  if candidate.state not in ('ELIGIBLE','ELIGIBLE_WITH_WARNING') or candidate.amount is distinct from p_expected_amount
    or candidate.due_date is distinct from p_new_due_date then raise exception 'Valor ou vencimento não corresponde ao cadastro atual.'; end if;
  before_state:=jsonb_build_object('invoice',to_jsonb(i),'provider',to_jsonb(p),'ledger',to_jsonb(f),'receipt',to_jsonb(r));
  revision:=md5(before_state::text);
  if p_version is null then
    return jsonb_build_object('state','READY_REMOTE','version',revision,'payment',jsonb_build_object(
      'provider_payment_id',p.provider_payment_id,'provider_customer_id',p.provider_customer_id,
      'provider_environment',p.provider_environment,'external_reference',p.external_reference),
      'allowCancellation',p.status='REVIEW_REQUIRED');
  end if;
  if p_version<>revision then raise exception 'Dados alterados durante a conferência; consulte novamente.'; end if;
  if p_checked_at is null or p_checked_at<clock_timestamp()-interval '30 seconds' or p_checked_at>clock_timestamp()
    or coalesce(p_snapshot#>>'{payment,id}','')<>p.provider_payment_id
    or coalesce(p_snapshot#>>'{payment,customer}','')<>p.provider_customer_id
    or coalesce(p_snapshot#>>'{payment,external_reference}','')<>p.external_reference
    or coalesce((p_snapshot#>>'{payment,value}')::numeric,-1)<>i.amount
    or coalesce(p_snapshot#>>'{payment,due_date}','')<>i.due_date::text
    or coalesce(p_snapshot#>>'{payment,billing_type}','')<>'PIX'
    or coalesce(p_snapshot#>>'{payment,deleted}','')<>'true'
    or coalesce(p_snapshot#>>'{payment,status}','') not in ('PENDING','OVERDUE','DELETED','CANCELLED')
    or coalesce(p_snapshot#>>'{payment,payment_date}','')<>''
    or coalesce(p_snapshot#>>'{payment,client_payment_date}','')<>'' then
    raise exception 'Asaas não comprova o cancelamento sem recebimento desta cobrança.';
  end if;
  perform pg_catalog.set_config('ilha.monthly_billing_write','1',true);
  update public.app_invoice_provider_payments set status='CANCELLED',safe_snapshot=p_snapshot,
    next_reconciliation_at=null,last_event_at=now(),updated_at=now() where id=p.id;
  update public.app_payment_invoices set status='CANCELADA',provider_status='CANCELLED',updated_at=now() where id=i.id;
  update public.financial_transactions set status='CANCELADO',updated_at=now() where id=f.id;
  generated:=public.prepare_cancelled_monthly_invoice_reissue(i.id,p_expected_amount,trim(p_reason));
  select * into strict replacement from public.app_payment_invoices
    where client_id=i.client_id and invoice_month=i.invoice_month and superseded_at is null;
  if replacement.id=i.id or replacement.amount is distinct from p_expected_amount
    or replacement.due_date is distinct from p_new_due_date or replacement.paid_at is not null then
    raise exception 'A substituta não corresponde aos dados conferidos; transação revertida.';
  end if;
  insert into private.monthly_invoice_reissues(old_invoice_id,new_invoice_id,actor_id,reason,before_state,cancellation_proof)
    values(i.id,replacement.id,p_actor_id,trim(p_reason),before_state,p_snapshot);
  return jsonb_build_object('state','READY_DISPATCH','invoiceId',replacement.id,'clientId',replacement.client_id);
end;
$$;
revoke all on function public.prepare_audited_monthly_reissue(uuid,uuid,numeric,date,date,date,text,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.prepare_audited_monthly_reissue(uuid,uuid,numeric,date,date,date,text,text,jsonb,timestamptz) to service_role;
commit;
