begin;
create table private.monthly_invoice_adjustments (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.app_payment_invoices(id),
 actor_id uuid not null references auth.users(id),
 operation text not null check(operation in ('due_date','cancel')),
 old_due_date date not null,new_due_date date,
 reason text not null,before_state jsonb not null,remote_proof jsonb not null,
 created_at timestamptz not null default now()
);
revoke all on private.monthly_invoice_adjustments from public,anon,authenticated,service_role;
-- The existing immutable snapshot guard remains in place. Only the due-date
-- clause accepts a service-side correction backed by this transaction's audit.
create function private.is_audited_invoice_due_change(p_id uuid,p_old date,p_new date)
returns boolean language sql security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'role','')='service_role' and exists(
 select 1 from private.monthly_invoice_adjustments a
 where a.id::text=current_setting('ilha.invoice_due_adjustment',true) and a.invoice_id=p_id
 and a.operation='due_date' and a.old_due_date=p_old and a.new_due_date=p_new
 and a.created_at=now() and a.remote_proof#>>'{payment,due_date}'=p_new::text
 and a.remote_proof#>>'{payment,deleted}'='false');
$$;
revoke all on function private.is_audited_invoice_due_change(uuid,date,date) from public,anon,authenticated,service_role;
do $$ declare definition text;needle text:='or new.due_date is distinct from old.due_date';begin
 definition:=pg_get_functiondef('private.guard_app_payment_invoice_billing_snapshot()'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
 raise exception 'Snapshot guard changed; review migration before deployment.';end if;
 execute replace(definition,needle,'or (new.due_date is distinct from old.due_date and not private.is_audited_invoice_due_change(old.id,old.due_date,new.due_date))');
end;$$;
create function public.adjust_unpaid_monthly_invoice(
 p_invoice_id uuid,p_actor_id uuid,p_operation text,p_expected_amount numeric,p_invoice_month date,
 p_old_due_date date,p_new_due_date date,p_reason text,
 p_version text default null,p_snapshot jsonb default null,p_checked_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.app_payment_invoices%rowtype;p public.app_invoice_provider_payments%rowtype;
 f public.financial_transactions%rowtype;c public.app_clients%rowtype;
 adjustment_id uuid;before_state jsonb;revision text;remote_status text;next_status text;target_date date;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Acesso negado.' using errcode='42501';end if;
 if p_actor_id is null or not exists(select 1 from auth.users where id=p_actor_id)
 or p_operation is null or p_operation not in ('due_date','cancel') or p_expected_amount is null or p_expected_amount<=0
 or p_invoice_month is null or p_old_due_date is null or p_reason is null or length(trim(p_reason)) not between 10 and 400
 or (p_operation='due_date' and p_new_due_date is null) or (p_operation='cancel' and p_new_due_date is not null)
 then raise exception 'Confira operação, ator, valor, competência, vencimentos e motivo.';end if;
 select * into strict i from public.app_payment_invoices where id=p_invoice_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ilha-monthly-billing:'||i.invoice_month::text,0));
 select * into strict p from public.app_invoice_provider_payments where invoice_id=i.id for update;
 select * into strict i from public.app_payment_invoices where id=p_invoice_id for update;
 select * into strict f from public.financial_transactions where app_payment_invoice_id=i.id for update;
 select * into strict c from public.app_clients where id=i.client_id for share;
 if i.amount is distinct from p_expected_amount or i.invoice_month is distinct from p_invoice_month
 or p.expected_amount is distinct from i.amount or f.amount is distinct from i.amount or f.due_date is distinct from i.due_date
 or f.type<>'RECEITA' or i.superseded_at is not null or i.paid_at is not null or i.received_on is not null or f.paid_at is not null
 or exists(select 1 from private.monthly_invoice_receipts r where r.invoice_id=i.id and (r.completed_at is not null or r.reversed_at is null))
 or p.provider_payment_id is null or p.provider_customer_id is null
 then raise exception 'Fatura divergente ou com recebimento; ajuste bloqueado.';end if;
 if exists(select 1 from private.monthly_invoice_adjustments a where a.invoice_id=i.id and a.operation=p_operation
   and a.old_due_date=p_old_due_date and a.new_due_date is not distinct from p_new_due_date and a.reason=trim(p_reason))
 and ((p_operation='cancel' and i.status='CANCELADA' and p.status='CANCELLED' and f.status='CANCELADO')
 or (p_operation='due_date' and i.due_date=p_new_due_date and p.status in ('PENDING','OVERDUE'))) then
 return jsonb_build_object('state','COMPLETED','invoiceId',i.id,'dueDate',i.due_date,'status',i.status,'providerPaymentId',p.provider_payment_id);end if;
 if i.due_date is distinct from p_old_due_date or not (
 (i.status in ('ABERTA','AGUARDANDO','VENCIDA') and i.provider_status in ('PENDING','OVERDUE') and p.status in ('PENDING','OVERDUE') and f.status in ('ABERTO','VENCIDO'))
 or (p_operation='cancel' and i.status='CANCELADA' and i.provider_status='CANCELLED' and p.status='CANCELLED' and f.status='CANCELADO'))
 then raise exception 'Estado atual não permite o ajuste solicitado.';end if;
 if p_operation='due_date' and (c.due_day is null or p_new_due_date is distinct from private.monthly_billing_due_date(i.invoice_month,c.due_day))
 then raise exception 'Novo vencimento deve corresponder à competência e ao dia cadastrado.';end if;
 before_state:=jsonb_build_object('invoice',to_jsonb(i),'provider',to_jsonb(p),'ledger',to_jsonb(f));
 -- Stable financial identity tolerates a concurrent webhook of the same unpaid
 -- charge. Receipt, refund and cancellation guards above remain authoritative.
 revision:=md5(jsonb_build_array(i.id,i.amount,i.invoice_month,i.due_date,p.provider_payment_id,p.provider_customer_id,p.external_reference,p.provider_environment,f.id)::text);
 if p_version is null then return jsonb_build_object('state','READY_REMOTE','version',revision,'payment',jsonb_build_object(
 'provider_payment_id',p.provider_payment_id,'provider_customer_id',p.provider_customer_id,'external_reference',p.external_reference,'provider_environment',p.provider_environment));end if;
 if p_version<>revision then raise exception 'Dados alterados durante a conferência; consulte novamente.';end if;
 target_date:=case when p_operation='due_date' then p_new_due_date else p_old_due_date end;
 remote_status:=p_snapshot#>>'{payment,status}';
 if p_checked_at is null or p_checked_at<clock_timestamp()-interval '30 seconds' or p_checked_at>clock_timestamp()
 or coalesce(p_snapshot#>>'{payment,id}','')<>p.provider_payment_id
 or coalesce(p_snapshot#>>'{payment,customer}','')<>p.provider_customer_id
 or coalesce(p_snapshot#>>'{payment,external_reference}','')<>p.external_reference
 or coalesce((p_snapshot#>>'{payment,value}')::numeric,-1)<>i.amount
 or coalesce(p_snapshot#>>'{payment,due_date}','')<>target_date::text
 or coalesce(p_snapshot#>>'{payment,billing_type}','')<>'PIX'
 or not (coalesce(remote_status,'') in ('PENDING','OVERDUE') or (p_operation='cancel' and remote_status in ('DELETED','CANCELLED')))
 or coalesce(p_snapshot#>>'{payment,deleted}','')<>(case when p_operation='cancel' then 'true' else 'false' end)
 or coalesce(p_snapshot#>>'{payment,payment_date}','')<>'' or coalesce(p_snapshot#>>'{payment,client_payment_date}','')<>''
 then raise exception 'Asaas não comprova o ajuste sem recebimento desta cobrança.';end if;
 next_status:=case when p_operation='cancel' then 'CANCELLED' else remote_status end;
 insert into private.monthly_invoice_adjustments(invoice_id,actor_id,operation,old_due_date,new_due_date,reason,before_state,remote_proof)
 values(i.id,p_actor_id,p_operation,p_old_due_date,p_new_due_date,trim(p_reason),before_state,p_snapshot) returning id into adjustment_id;
 perform pg_catalog.set_config('ilha.invoice_due_adjustment',adjustment_id::text,true);
 perform pg_catalog.set_config('ilha.monthly_billing_write','1',true);
 update public.app_invoice_provider_payments set status=next_status,safe_snapshot=p_snapshot,last_event_at=now(),updated_at=now(),
 next_reconciliation_at=case when next_status='CANCELLED' then null else now()+interval '1 hour' end where id=p.id;
 update public.app_payment_invoices set due_date=target_date,provider_status=next_status,
 status=case when next_status='CANCELLED' then 'CANCELADA' when next_status='OVERDUE' then 'VENCIDA' else 'AGUARDANDO' end,
 notes=concat_ws(E'\n',nullif(notes,''),'Ajuste administrativo auditado: '||trim(p_reason)),updated_at=now() where id=i.id;
 update public.financial_transactions set due_date=target_date,updated_at=now() where id=f.id;
 perform private.sync_app_invoice_financial_transaction(i.id,next_status,null);
 perform pg_catalog.set_config('ilha.invoice_due_adjustment','',true);
 return jsonb_build_object('state','COMPLETED','invoiceId',i.id,'dueDate',target_date,'providerStatus',next_status,'providerPaymentId',p.provider_payment_id);
end;$$;
revoke all on function public.adjust_unpaid_monthly_invoice(uuid,uuid,text,numeric,date,date,date,text,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.adjust_unpaid_monthly_invoice(uuid,uuid,text,numeric,date,date,date,text,text,jsonb,timestamptz) to service_role;
commit;
