begin;
create table private.monthly_failed_invoice_closures (
 invoice_id uuid primary key references public.app_payment_invoices(id),
 actor_id uuid not null references auth.users(id), reason text not null,
 before_state jsonb not null, absence_proof jsonb not null, created_at timestamptz not null default now()
);
revoke all on private.monthly_failed_invoice_closures from public,anon,authenticated,service_role;
create index monthly_failed_invoice_closures_actor_idx on private.monthly_failed_invoice_closures(actor_id);
create function public.close_failed_monthly_invoice(
 p_invoice_id uuid,p_actor_id uuid,p_expected_amount numeric,p_invoice_month date,
 p_old_due_date date,p_reason text,p_version text default null,
 p_snapshot jsonb default null,p_checked_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.app_payment_invoices%rowtype; p public.app_invoice_provider_payments%rowtype;
 f public.financial_transactions%rowtype; a private.monthly_failed_invoice_closures%rowtype;
 before_state jsonb; revision text;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_actor_id is null or not exists(select 1 from auth.users where id=p_actor_id)
 or p_expected_amount is null or p_expected_amount<=0 or p_invoice_month is null
 or p_old_due_date is null or length(trim(coalesce(p_reason,''))) not between 10 and 400 then
 raise exception 'Confira os dados e o motivo do encerramento.'; end if;
 select * into strict i from public.app_payment_invoices where id=p_invoice_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ilha-monthly-billing:'||i.invoice_month::text,0));
 select * into strict p from public.app_invoice_provider_payments where invoice_id=i.id for update;
 select * into strict i from public.app_payment_invoices where id=p_invoice_id for update;
 select * into strict f from public.financial_transactions where app_payment_invoice_id=i.id for update;
 if i.amount is distinct from p_expected_amount or i.invoice_month is distinct from p_invoice_month or i.due_date is distinct from p_old_due_date then
 raise exception 'Fatura alterada; confira os dados atuais.'; end if;
 select * into a from private.monthly_failed_invoice_closures where invoice_id=i.id;
 if found then
 if a.reason<>trim(p_reason) or i.status<>'CANCELADA' or p.status<>'CANCELLED'
 or f.status<>'CANCELADO' or f.type<>'RECEITA' or f.paid_at is not null
 or i.paid_at is not null or i.received_on is not null or p.provider_payment_id is not null
 or f.amount is distinct from i.amount or f.due_date is distinct from i.due_date then raise exception 'Encerramento anterior divergente.'; end if;
 return jsonb_build_object('state','COMPLETED','invoiceId',i.id);
 end if;
 if i.superseded_at is not null or i.status<>'ABERTA' or i.provider_status<>'FAILED' or p.status<>'FAILED'
 or p.provider_payment_id is not null or p.expected_amount is distinct from i.amount
 or i.paid_at is not null or i.received_on is not null or f.paid_at is not null or f.status<>'FALHA' or f.type<>'RECEITA'
 or f.amount is distinct from i.amount or f.due_date is distinct from i.due_date
 or exists(select 1 from private.monthly_invoice_receipts where invoice_id=i.id)
 or p.external_reference is distinct from 'ilha-monthly-invoice:'||i.id::text
 or p.provider_environment not in ('PRODUCTION','SANDBOX') then
 raise exception 'Somente emissão com falha, sem cobrança remota nem recebimento, pode ser encerrada.'; end if;
 before_state:=jsonb_build_object('invoice',to_jsonb(i),'provider',to_jsonb(p),'ledger',to_jsonb(f));
 revision:=md5(before_state::text);
 if p_version is null then return jsonb_build_object('state','CHECK_ABSENCE','version',revision,
 'externalReference',p.external_reference,'environment',p.provider_environment); end if;
 if p_version<>revision then raise exception 'Dados alterados durante a conferência; consulte novamente.'; end if;
 if p_checked_at is null or p_checked_at<clock_timestamp()-interval '30 seconds' or p_checked_at>clock_timestamp()
 or p_snapshot->>'externalReference' is distinct from p.external_reference
 or p_snapshot->>'environment' is distinct from p.provider_environment
 or p_snapshot->>'totalCount' is distinct from '0' or p_snapshot->'data' is distinct from '[]'::jsonb
 or p_snapshot->>'hasMore' is distinct from 'false' then raise exception 'Ausência de cobrança remota não comprovada.'; end if;
 insert into private.monthly_failed_invoice_closures(invoice_id,actor_id,reason,before_state,absence_proof)
 values(i.id,p_actor_id,trim(p_reason),before_state,p_snapshot);
 perform pg_catalog.set_config('ilha.monthly_billing_write','1',true);
 update public.app_invoice_provider_payments set status='CANCELLED',next_reconciliation_at=null,last_error=null,updated_at=now() where id=p.id;
 update public.app_payment_invoices set status='CANCELADA',provider_status='CANCELLED',last_payment_error=null,
 notes=concat_ws(E'\n',nullif(notes,''),'Emissão com falha encerrada: '||trim(p_reason)),updated_at=now() where id=i.id;
 perform private.sync_app_invoice_financial_transaction(i.id,'CANCELLED',null);
 return jsonb_build_object('state','COMPLETED','invoiceId',i.id);
end;
$$;
revoke all on function public.close_failed_monthly_invoice(uuid,uuid,numeric,date,date,text,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.close_failed_monthly_invoice(uuid,uuid,numeric,date,date,text,text,jsonb,timestamptz) to service_role;
commit;
