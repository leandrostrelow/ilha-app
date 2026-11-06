begin;
create table private.monthly_reissue_reschedules (
 old_invoice_id uuid primary key references public.app_payment_invoices(id),
 new_invoice_id uuid not null unique references public.app_payment_invoices(id),
 actor_id uuid not null references auth.users(id), reason text not null,
 before_state jsonb not null, absence_proof jsonb not null, created_at timestamptz not null default now()
);
revoke all on private.monthly_reissue_reschedules from public,anon,authenticated,service_role;
create function public.prepare_failed_reissue_reschedule(
 p_invoice_id uuid,p_actor_id uuid,p_expected_amount numeric,p_invoice_month date,
 p_old_due_date date,p_new_due_date date,p_reason text,p_version text default null,
 p_snapshot jsonb default null,p_checked_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.app_payment_invoices%rowtype; p public.app_invoice_provider_payments%rowtype;
 f public.financial_transactions%rowtype; a private.monthly_reissue_reschedules%rowtype;
 n public.app_payment_invoices%rowtype; candidate record; before_state jsonb; revision text;
 today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_actor_id is null or not exists(select 1 from auth.users where id=p_actor_id)
 or p_expected_amount is null or p_expected_amount<=0 or p_invoice_month is null
 or p_old_due_date is null or p_new_due_date is null or length(trim(coalesce(p_reason,''))) not between 10 and 400 then
 raise exception 'Confira os dados e o motivo do reagendamento.'; end if;
 select * into strict i from public.app_payment_invoices where id=p_invoice_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ilha-monthly-billing:'||i.invoice_month::text,0));
 select * into strict p from public.app_invoice_provider_payments where invoice_id=i.id for update;
 select * into strict i from public.app_payment_invoices where id=p_invoice_id for update;
 select * into strict f from public.financial_transactions where app_payment_invoice_id=i.id for update;
 if i.amount is distinct from p_expected_amount or i.invoice_month is distinct from p_invoice_month or i.due_date is distinct from p_old_due_date then
 raise exception 'Fatura alterada; confira os dados atuais.'; end if;
 select * into a from private.monthly_reissue_reschedules where old_invoice_id=i.id;
 if found then
 select * into strict n from public.app_payment_invoices where id=a.new_invoice_id;
 if n.amount is distinct from p_expected_amount or n.due_date is distinct from p_new_due_date or a.reason<>trim(p_reason) or n.superseded_at is not null then
 raise exception 'Já existe reagendamento com outros dados.'; end if;
 return jsonb_build_object('state','READY_DISPATCH','invoiceId',n.id,'clientId',n.client_id);
 end if;
 if p_new_due_date<today or p_new_due_date<=i.due_date or p_new_due_date>= (i.invoice_month+interval '1 month')::date
 or i.invoice_month<>date_trunc('month',today)::date then raise exception 'Use nova data não vencida dentro da competência atual.'; end if;
 if i.superseded_at is not null or i.status<>'ABERTA' or i.provider_status<>'FAILED' or p.status<>'FAILED'
 or p.provider_payment_id is not null or p.expected_amount is distinct from i.amount
 or i.paid_at is not null or i.received_on is not null or f.paid_at is not null or f.status<>'FALHA'
 or i.family_billing or exists(select 1 from public.app_family_invoice_items where invoice_id=i.id)
 or exists(select 1 from private.monthly_invoice_receipts where invoice_id=i.id)
 or not exists(select 1 from private.monthly_invoice_reissues where new_invoice_id=i.id) then
 raise exception 'Somente substituta recusada, sem cobrança remota nem recebimento, pode ser reagendada.'; end if;
 select * into strict candidate from private.monthly_billing_candidates_ignoring(i.invoice_month,i.client_id,i.id);
 if candidate.state not in ('ELIGIBLE','ELIGIBLE_WITH_WARNING') or candidate.amount is distinct from i.amount or candidate.family_billing then
 raise exception 'Cadastro atual divergente; revise antes de reagendar.'; end if;
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
 perform pg_catalog.set_config('ilha.monthly_billing_write','1',true);
 perform pg_catalog.set_config('ilha.monthly_reissue_write','1',true);
 update public.app_invoice_provider_payments set status='CANCELLED',next_reconciliation_at=null,updated_at=now() where id=p.id;
 update public.app_payment_invoices set status='CANCELADA',provider_status='CANCELLED',superseded_at=now(),superseded_reason=trim(p_reason),updated_at=now() where id=i.id;
 perform private.sync_app_invoice_financial_transaction(i.id,'CANCELLED',null);
 insert into public.app_payment_invoices(client_id,invoice_month,description,plan_code,plan_name,amount,due_date,status,family_billing,provider_status,notes)
 values(i.client_id,i.invoice_month,i.description,i.plan_code,i.plan_name,i.amount,p_new_due_date,'ABERTA',false,'READY',
 'Reagendamento autorizado. Vencimento anterior: '||i.due_date||'. Motivo: '||trim(p_reason)) returning * into n;
 perform private.ensure_app_invoice_financial_transaction(n.id);
 insert into public.app_invoice_provider_payments(invoice_id,provider_environment,external_reference,expected_amount,status)
 values(n.id,p.provider_environment,'ilha-monthly-invoice:'||n.id,n.amount,'READY');
 insert into private.monthly_reissue_reschedules(old_invoice_id,new_invoice_id,actor_id,reason,before_state,absence_proof)
 values(i.id,n.id,p_actor_id,trim(p_reason),before_state,p_snapshot);
 return jsonb_build_object('state','READY_DISPATCH','invoiceId',n.id,'clientId',n.client_id);
end;
$$;
revoke all on function public.prepare_failed_reissue_reschedule(uuid,uuid,numeric,date,date,date,text,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.prepare_failed_reissue_reschedule(uuid,uuid,numeric,date,date,date,text,text,jsonb,timestamptz) to service_role;
commit;
