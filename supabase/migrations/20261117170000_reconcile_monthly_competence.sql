begin;
create table private.monthly_competence_reconciliations (
 id uuid primary key default gen_random_uuid(),source_invoice_id uuid not null unique references public.app_payment_invoices(id),
 target_invoice_id uuid not null unique references public.app_payment_invoices(id),historical_invoice_id uuid not null,
 actor_id uuid not null references auth.users(id),reason text not null,
 source_month date not null,target_month date not null,before_state jsonb not null,
 remote_proof jsonb not null,created_at timestamptz not null default now()
);
revoke all on private.monthly_competence_reconciliations from public,anon,authenticated,service_role;
create function private.is_audited_invoice_month_change(p_id uuid,p_old date,p_new date)
returns boolean language sql security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'role','')='service_role' and exists(
 select 1 from private.monthly_competence_reconciliations a where a.id::text=current_setting('ilha.invoice_month_adjustment',true)
 and a.source_invoice_id=p_id and a.source_month=p_old and a.target_month=p_new and a.created_at=now()
 and a.remote_proof#>>'{source,payment,status}'='RECEIVED' and a.remote_proof#>>'{target,payment,deleted}'='true');
$$;
revoke all on function private.is_audited_invoice_month_change(uuid,date,date) from public,anon,authenticated,service_role;
do $$ declare definition text;needle text:='or new.invoice_month is distinct from old.invoice_month';begin
 definition:=pg_get_functiondef('private.guard_app_payment_invoice_billing_snapshot()'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Review changed invoice snapshot guard';end if;
 execute replace(definition,needle,'or (new.invoice_month is distinct from old.invoice_month and not private.is_audited_invoice_month_change(old.id,old.invoice_month,new.invoice_month))');
end;$$;
create function public.reconcile_monthly_competence(
 p_source_id uuid,p_target_id uuid,p_actor_id uuid,p_amount numeric,p_source_month date,p_target_month date,
 p_source_paid_on date,p_club_paid_on date,p_club_due_date date,p_reason text,
 p_version text default null,p_proof jsonb default null,p_checked_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.app_payment_invoices%rowtype;t public.app_payment_invoices%rowtype;
 sp public.app_invoice_provider_payments%rowtype;tp public.app_invoice_provider_payments%rowtype;
 sf public.financial_transactions%rowtype;tf public.financial_transactions%rowtype;r private.monthly_invoice_receipts%rowtype;
 a private.monthly_competence_reconciliations%rowtype;h uuid:=gen_random_uuid();revision text;before_state jsonb;prepared jsonb;proof jsonb;b jsonb;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Acesso negado.' using errcode='42501';end if;
 if p_actor_id is null or not exists(select 1 from auth.users where id=p_actor_id) or p_source_id=p_target_id
 or p_source_month is null or p_source_month<>date_trunc('month',p_source_month)::date
 or p_target_month is distinct from (p_source_month+interval '1 month')::date
 or p_source_paid_on is null or p_club_paid_on is null or p_club_due_date is null
 or p_source_paid_on>(now() at time zone 'America/Sao_Paulo')::date or p_club_paid_on>p_source_paid_on
 or date_trunc('month',p_club_due_date)::date<>p_source_month or date_trunc('month',p_club_paid_on)::date<>p_source_month
 or p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2)
 or p_reason is null or length(trim(p_reason)) not between 10 and 400 then raise exception 'Confira as competências, os dois recebimentos e o motivo.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ilha-monthly-billing:'||p_source_month::text,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ilha-monthly-billing:'||p_target_month::text,0));
 select * into a from private.monthly_competence_reconciliations where source_invoice_id=p_source_id or target_invoice_id=p_target_id;
 if a.id is not null then
   if a.source_invoice_id=p_source_id and a.target_invoice_id=p_target_id and a.source_month=p_source_month and a.target_month=p_target_month
   and a.before_state#>>'{confirmed,club_paid_on}'=p_club_paid_on::text and a.before_state#>>'{confirmed,club_due_date}'=p_club_due_date::text
   and a.before_state#>>'{confirmed,source_paid_on}'=p_source_paid_on::text and (a.before_state#>>'{confirmed,amount}')::numeric=p_amount
   then return jsonb_build_object('state','COMPLETED','paidInvoiceId',p_source_id,'historicalInvoiceId',a.historical_invoice_id);end if;
   raise exception 'Já existe uma conciliação diferente para estas faturas.';
 end if;
 perform 1 from public.app_invoice_provider_payments where invoice_id in(p_source_id,p_target_id) order by invoice_id for update;
 select * into strict sp from public.app_invoice_provider_payments where invoice_id=p_source_id;
 select * into strict tp from public.app_invoice_provider_payments where invoice_id=p_target_id;
 perform 1 from public.app_payment_invoices where id in(p_source_id,p_target_id) order by id for update;
 select * into strict s from public.app_payment_invoices where id=p_source_id;
 select * into strict t from public.app_payment_invoices where id=p_target_id;
 select * into strict sf from public.financial_transactions where app_payment_invoice_id=s.id for update;
 select * into strict tf from public.financial_transactions where app_payment_invoice_id=t.id for update;
 select * into r from private.monthly_invoice_receipts where invoice_id=t.id for update;
 if coalesce((s.client_id<>t.client_id or s.invoice_month<>p_source_month or t.invoice_month<>p_target_month
 or s.amount<>p_amount or t.amount<>p_amount or sp.expected_amount<>p_amount or tp.expected_amount<>p_amount
 or s.status<>'PAGA' or s.provider_status<>'RECEIVED' or sp.status<>'RECEIVED' or sf.status<>'RECEBIDO'
 or s.paid_at is null or (s.paid_at at time zone 'America/Sao_Paulo')::date<>p_source_paid_on
 or sf.paid_at is distinct from s.paid_at or sf.amount<>p_amount or tf.amount<>p_amount
 or s.received_on is not null or t.paid_at is not null or t.received_on is not null or tf.paid_at is not null
 or s.superseded_at is not null or t.superseded_at is not null or s.family_billing or t.family_billing
 or sp.provider_environment<>tp.provider_environment or sp.provider_customer_id is distinct from tp.provider_customer_id
 or sp.provider_payment_id is null or tp.provider_payment_id is null or sp.provider_payment_id=tp.provider_payment_id
 or not ((t.status in ('ABERTA','AGUARDANDO','VENCIDA') and t.provider_status in ('PENDING','OVERDUE') and tp.status in ('PENDING','OVERDUE') and tf.status in ('ABERTO','VENCIDO'))
   or (t.status='CANCELADA' and t.provider_status='CANCELLED' and tp.status='CANCELLED' and tf.status='CANCELADO'))
 or (r.invoice_id is not null and (r.completed_at is not null or r.claim_until>now() or r.amount<>p_amount or r.received_on<>p_source_paid_on))
 or exists(select 1 from private.monthly_invoice_receipts where invoice_id=s.id)
 or exists(select 1 from public.app_family_members where member_client_id=s.client_id or billing_responsible_id=s.client_id)
 or exists(select 1 from public.app_family_invoice_items where invoice_id in(s.id,t.id))
 or exists(select 1 from public.financial_transactions f where lower(trim(f.counterparty))=(select lower(trim(full_name)) from public.app_clients where id=s.client_id)
   and f.category='Mensalidade' and f.app_payment_invoice_id is null and coalesce(f.competence_month,date_trunc('month',f.due_date)::date) in(p_source_month,p_target_month))
),true) then raise exception 'Faturas ou recebimentos divergentes; conciliação bloqueada.';end if;
 before_state:=jsonb_build_object('source',to_jsonb(s),'target',to_jsonb(t),'source_provider',to_jsonb(sp),'target_provider',to_jsonb(tp),
 'source_ledger',to_jsonb(sf),'target_ledger',to_jsonb(tf),'pending_receipt',to_jsonb(r),
 'confirmed',jsonb_build_object('amount',p_amount,'source_paid_on',p_source_paid_on,'club_paid_on',p_club_paid_on,'club_due_date',p_club_due_date));
 -- Stable across the expected cancellation webhook; all financial-state checks still run at commit.
 revision:=md5(jsonb_build_array(s.id,t.id,s.client_id,s.invoice_month,t.invoice_month,s.amount,t.amount,s.due_date,t.due_date,s.paid_at,
 sp.provider_payment_id,tp.provider_payment_id,sp.provider_customer_id,tp.provider_customer_id,sp.external_reference,tp.external_reference,
 sp.provider_environment,tp.provider_environment,sf.id,tf.id,r.claim_token,p_club_paid_on,p_club_due_date)::text);
 if p_version is null then return jsonb_build_object('state','READY','version',revision,'source',jsonb_build_object('id',sp.provider_payment_id,'customer',sp.provider_customer_id,'reference',sp.external_reference,'environment',sp.provider_environment,'dueDate',s.due_date),
 'target',jsonb_build_object('id',tp.provider_payment_id,'customer',tp.provider_customer_id,'reference',tp.external_reference,'environment',tp.provider_environment,'dueDate',t.due_date));end if;
 if p_version<>revision then raise exception 'Dados alterados durante a conciliação.';end if;
 if p_checked_at is null or p_checked_at<clock_timestamp()-interval '30 seconds' or p_checked_at>clock_timestamp() then raise exception 'Prova remota expirada.';end if;
 for proof,b in select p_proof->'source',jsonb_build_object('id',sp.provider_payment_id,'customer',sp.provider_customer_id,'ref',sp.external_reference,'due',s.due_date)
 union all select p_proof->'target',jsonb_build_object('id',tp.provider_payment_id,'customer',tp.provider_customer_id,'ref',tp.external_reference,'due',t.due_date) loop
 if coalesce(proof#>>'{payment,id}','')<>b->>'id' or coalesce(proof#>>'{payment,customer}','')<>b->>'customer'
 or coalesce(proof#>>'{payment,external_reference}','')<>b->>'ref' or coalesce(proof#>>'{payment,due_date}','')<>b->>'due'
 or coalesce((proof#>>'{payment,value}')::numeric,-1)<>p_amount or coalesce(proof#>>'{payment,billing_type}','')<>'PIX'
 then raise exception 'Identidade remota divergente.';end if;end loop;
 if coalesce(p_proof#>>'{source,payment,status}','')<>'RECEIVED' or coalesce(p_proof#>>'{source,payment,deleted}','')<>'false'
 or coalesce(nullif(p_proof#>>'{source,payment,client_payment_date}',''),p_proof#>>'{source,payment,payment_date}','')<>p_source_paid_on::text
 or coalesce(p_proof#>>'{target,payment,deleted}','')<>'true' or coalesce(p_proof#>>'{target,payment,status}','') not in ('PENDING','OVERDUE','DELETED','CANCELLED')
 or coalesce(p_proof#>>'{target,payment,payment_date}','')<>'' or coalesce(p_proof#>>'{target,payment,client_payment_date}','')<>''
 then raise exception 'Asaas não comprova o recebimento e o cancelamento sem duplicidade.';end if;
 insert into private.monthly_competence_reconciliations(source_invoice_id,target_invoice_id,historical_invoice_id,actor_id,reason,source_month,target_month,before_state,remote_proof)
 values(s.id,t.id,h,p_actor_id,trim(p_reason),p_source_month,p_target_month,before_state,p_proof) returning * into a;
 perform pg_catalog.set_config('ilha.monthly_billing_write','1',true);
 perform pg_catalog.set_config('ilha.monthly_reissue_write','1',true);
 perform pg_catalog.set_config('ilha.invoice_month_adjustment',a.id::text,true);
 update private.monthly_invoice_receipts set reversed_at=now(),claim_token=gen_random_uuid(),claim_until=now() where invoice_id=t.id;
 update public.app_invoice_provider_payments set status='CANCELLED',safe_snapshot=p_proof->'target',next_reconciliation_at=null,updated_at=now() where invoice_id=t.id;
 update public.app_payment_invoices set status='CANCELADA',provider_status='CANCELLED',superseded_at=now(),superseded_reason=trim(p_reason),notes=concat_ws(E'\n',notes,'Conciliação de competência: '||trim(p_reason)),updated_at=now() where id=t.id;
 perform private.sync_app_invoice_financial_transaction(t.id,'CANCELLED',null);
 update public.app_payment_invoices set invoice_month=p_target_month,notes=concat_ws(E'\n',notes,'Competência corrigida; vencimento original do Asaas preservado. '||trim(p_reason)),updated_at=now() where id=s.id;
 update public.financial_transactions set competence_month=p_target_month,notes=concat_ws(E'\n',notes,'Conciliação de competência: '||trim(p_reason)),updated_at=now() where id=sf.id;
 insert into public.app_payment_invoices(id,client_id,invoice_month,amount,due_date,status,description,notes)
 values(h,s.client_id,p_source_month,p_amount,p_club_due_date,'ABERTA','Mensalidade histórica recebida por Pix do clube','Conciliação de competência: '||trim(p_reason));
 prepared:=public.prepare_monthly_invoice_receipt(h,p_actor_id,'CLUB_PIX',p_club_paid_on,p_amount,'Conciliação de competência: '||trim(p_reason));
 prepared:=public.complete_monthly_invoice_receipt(h,(prepared->>'claimToken')::uuid,null);
 if prepared->>'state' is distinct from 'COMPLETED' then raise exception 'Registro histórico não concluído.';end if;
 update public.financial_transactions set competence_month=p_source_month where app_payment_invoice_id=h;
 perform pg_catalog.set_config('ilha.invoice_month_adjustment','',true);
 return jsonb_build_object('state','COMPLETED','paidInvoiceId',s.id,'historicalInvoiceId',h);
end;$$;
revoke all on function public.reconcile_monthly_competence(uuid,uuid,uuid,numeric,date,date,date,date,date,text,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.reconcile_monthly_competence(uuid,uuid,uuid,numeric,date,date,date,date,date,text,text,jsonb,timestamptz) to service_role;
commit;
