begin;

-- Preserve the failed issuance and its closure. A separate, already-paid local
-- invoice records the actual club Pix; no provider charge is created or paid.
create table private.monthly_closed_invoice_receipts (
 old_invoice_id uuid primary key references public.app_payment_invoices(id),
 new_invoice_id uuid not null unique references public.app_payment_invoices(id),
 actor_id uuid not null references auth.users(id), reason text not null,
 received_on date not null, before_state jsonb not null, absence_proof jsonb not null,
 created_at timestamptz not null default now()
);
revoke all on private.monthly_closed_invoice_receipts from public,anon,authenticated,service_role;
create index monthly_closed_invoice_receipts_actor_idx on private.monthly_closed_invoice_receipts(actor_id);

create function public.receive_closed_monthly_invoice(
 p_invoice_id uuid,p_actor_id uuid,p_expected_amount numeric,p_invoice_month date,
 p_old_due_date date,p_received_on date,p_reason text,p_version text default null,
 p_snapshot jsonb default null,p_checked_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.app_payment_invoices%rowtype; p public.app_invoice_provider_payments%rowtype;
 f public.financial_transactions%rowtype; a private.monthly_closed_invoice_receipts%rowtype;
 n public.app_payment_invoices%rowtype; r private.monthly_invoice_receipts%rowtype;
 before_state jsonb; revision text; prepared jsonb; result jsonb;
 paid_time timestamptz;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_actor_id is null or not exists(select 1 from auth.users where id=p_actor_id)
 or p_expected_amount is null or p_expected_amount<=0 or p_expected_amount<>round(p_expected_amount,2)
 or p_invoice_month is null or p_invoice_month<>date_trunc('month',p_invoice_month)::date
 or p_old_due_date is null or date_trunc('month',p_old_due_date)::date<>p_invoice_month
 or p_received_on is null or p_received_on<date '2000-01-01'
 or p_received_on>(now() at time zone 'America/Sao_Paulo')::date
 or length(trim(coalesce(p_reason,''))) not between 10 and 400 then
 raise exception 'Confira valor, competência, vencimento, data real do Pix e motivo.'; end if;
 select * into strict i from public.app_payment_invoices where id=p_invoice_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ilha-monthly-billing:'||i.invoice_month::text,0));
 select * into strict p from public.app_invoice_provider_payments where invoice_id=i.id for update;
 select * into strict i from public.app_payment_invoices where id=p_invoice_id for update;
 select * into strict f from public.financial_transactions where app_payment_invoice_id=i.id for update;
 if i.amount is distinct from p_expected_amount or i.invoice_month is distinct from p_invoice_month or i.due_date is distinct from p_old_due_date then
 raise exception 'Fatura alterada; confira os dados atuais.'; end if;
 if i.status<>'CANCELADA' or i.provider_status<>'CANCELLED' or p.status<>'CANCELLED'
 or p.provider_payment_id is not null or p.expected_amount is distinct from i.amount
 or i.paid_at is not null or i.received_on is not null or f.paid_at is not null
 or f.status<>'CANCELADO' or f.type<>'RECEITA' or f.amount is distinct from i.amount or f.due_date is distinct from i.due_date
 or i.family_billing or exists(select 1 from public.app_family_invoice_items where invoice_id=i.id)
 or exists(select 1 from private.monthly_invoice_receipts where invoice_id=i.id)
 or not exists(select 1 from private.monthly_failed_invoice_closures where invoice_id=i.id)
 or p.external_reference is distinct from 'ilha-monthly-invoice:'||i.id::text
 or p.provider_environment not in ('PRODUCTION','SANDBOX') then
 raise exception 'Use somente emissão individual com falha já encerrada, sem cobrança remota nem recebimento.'; end if;
 paid_time:=(p_received_on::text||' 12:00:00 America/Sao_Paulo')::timestamptz;
 select * into a from private.monthly_closed_invoice_receipts where old_invoice_id=i.id;
 if found then
 select * into strict n from public.app_payment_invoices where id=a.new_invoice_id;
 select * into strict r from private.monthly_invoice_receipts where invoice_id=n.id;
 if a.reason<>trim(p_reason) or a.received_on<>p_received_on or i.superseded_at is null
 or n.client_id<>i.client_id or n.invoice_month<>i.invoice_month or n.amount<>i.amount or n.due_date<>i.due_date
 or n.status<>'PAGA' or n.paid_at is distinct from paid_time or n.received_on is distinct from p_received_on
 or n.received_method is distinct from 'CLUB_PIX' or n.superseded_at is not null or n.provider_status is not null
 or r.completed_at is null or r.reversed_at is not null or r.amount<>i.amount or r.received_on<>p_received_on or r.method<>'CLUB_PIX'
 or exists(select 1 from public.app_invoice_provider_payments where invoice_id=n.id)
 or not exists(select 1 from public.financial_transactions where app_payment_invoice_id=n.id
 and status='RECEBIDO' and amount=i.amount and due_date=i.due_date and paid_at=paid_time and payment_method='CLUB_PIX') then
 raise exception 'Recebimento anterior divergente; confira antes de continuar.'; end if;
 return jsonb_build_object('state','COMPLETED','invoiceId',n.id,'method','CLUB_PIX','receivedOn',p_received_on);
 end if;
 if i.superseded_at is not null then raise exception 'Esta emissão já foi substituída.'; end if;
 if exists(select 1 from public.financial_transactions x join public.app_clients c on c.id=i.client_id
 where x.id<>f.id and x.category='Mensalidade' and x.status<>'CANCELADO'
 and lower(trim(x.counterparty))=lower(trim(c.full_name))
 and coalesce(x.competence_month,date_trunc('month',x.due_date)::date)=i.invoice_month) then
 raise exception 'Existe outro lançamento nesta competência; concilie antes de receber.'; end if;
 before_state:=jsonb_build_object('invoice',to_jsonb(i),'provider',to_jsonb(p),'ledger',to_jsonb(f),
 'receivedOn',p_received_on,'reason',trim(p_reason),'actorId',p_actor_id);
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
 update public.app_payment_invoices set superseded_at=now(),superseded_reason=trim(p_reason),updated_at=now() where id=i.id;
 insert into public.app_payment_invoices(client_id,invoice_month,description,plan_code,plan_name,amount,due_date,status,family_billing,payment_method,notes)
 values(i.client_id,i.invoice_month,i.description,i.plan_code,i.plan_name,i.amount,i.due_date,'ABERTA',false,'CLUB_PIX',
 'Pix do clube após emissão falhada encerrada: '||trim(p_reason)) returning * into n;
 prepared:=public.prepare_monthly_invoice_receipt(n.id,p_actor_id,'CLUB_PIX',p_received_on,n.amount,n.notes);
 result:=public.complete_monthly_invoice_receipt(n.id,(prepared->>'claimToken')::uuid,null);
 if result->>'state' is distinct from 'COMPLETED' then raise exception 'Recebimento não concluído.'; end if;
 insert into private.monthly_closed_invoice_receipts(old_invoice_id,new_invoice_id,actor_id,reason,received_on,before_state,absence_proof)
 values(i.id,n.id,p_actor_id,trim(p_reason),p_received_on,before_state,p_snapshot);
 return result;
end;
$$;
revoke all on function public.receive_closed_monthly_invoice(uuid,uuid,numeric,date,date,date,text,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.receive_closed_monthly_invoice(uuid,uuid,numeric,date,date,date,text,text,jsonb,timestamptz) to service_role;
commit;
