begin;
create table private.monthly_invoice_amount_adjustments (
 id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.app_payment_invoices(id),
 actor_id uuid not null references auth.users(id), reason text not null, old_amount numeric not null,new_amount numeric not null,
 before_state jsonb not null,remote_proof jsonb not null,created_at timestamptz not null default now()
);
revoke all on private.monthly_invoice_amount_adjustments from public,anon,authenticated,service_role;
create function private.is_audited_invoice_amount_change(p_id uuid,p_old numeric,p_new numeric)
returns boolean language sql security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'role','')='service_role' and exists(
 select 1 from private.monthly_invoice_amount_adjustments a where a.id::text=current_setting('ilha.invoice_amount_adjustment',true)
 and a.invoice_id=p_id and a.old_amount=p_old and a.new_amount=p_new and a.created_at=now()
 and (a.remote_proof#>>'{payment,value}')::numeric=p_new and a.remote_proof#>>'{payment,deleted}'='false');
$$;
revoke all on function private.is_audited_invoice_amount_change(uuid,numeric,numeric) from public,anon,authenticated,service_role;
do $$ declare definition text;needle text:='or new.amount is distinct from old.amount';begin
 definition:=pg_get_functiondef('private.guard_app_payment_invoice_billing_snapshot()'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Review changed snapshot guard';end if;
 execute replace(definition,needle,'or (new.amount is distinct from old.amount and not private.is_audited_invoice_amount_change(old.id,old.amount,new.amount))');
end;$$;
create function public.adjust_unpaid_monthly_invoice_amount(
 p_invoice_id uuid,p_actor_id uuid,p_new_amount numeric,p_expected_amount numeric,p_invoice_month date,
 p_old_due_date date,p_reason text,
 p_version text default null,p_snapshot jsonb default null,p_checked_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.app_payment_invoices%rowtype;p public.app_invoice_provider_payments%rowtype;
 f public.financial_transactions%rowtype;c public.app_clients%rowtype;
 items_before jsonb;items_after jsonb;item_total numeric; adjustment_id uuid;before_state jsonb;revision text;remote_status text;next_status text;target_date date;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Acesso negado.' using errcode='42501';end if;
 if p_actor_id is null or not exists(select 1 from auth.users where id=p_actor_id)
 or p_new_amount is null or p_new_amount<=0 or p_new_amount<>round(p_new_amount,2) or p_expected_amount is null or p_expected_amount<=0
 or p_invoice_month is null or p_old_due_date is null or p_reason is null or length(trim(p_reason)) not between 10 and 400
 then raise exception 'Confira operação, ator, valor, competência, vencimentos e motivo.';end if;
 select * into strict i from public.app_payment_invoices where id=p_invoice_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ilha-monthly-billing:'||i.invoice_month::text,0));
 select * into strict p from public.app_invoice_provider_payments where invoice_id=i.id for update;
 select * into strict i from public.app_payment_invoices where id=p_invoice_id for update;
 select * into strict f from public.financial_transactions where app_payment_invoice_id=i.id for update;
 select * into strict c from public.app_clients where id=i.client_id for share;
 if i.amount=p_new_amount and p.expected_amount=p_new_amount and f.amount=p_new_amount and i.invoice_month=p_invoice_month and i.due_date=p_old_due_date
 and exists(select 1 from private.monthly_invoice_amount_adjustments a where a.invoice_id=i.id and a.old_amount=p_expected_amount and a.new_amount=p_new_amount and a.reason=trim(p_reason)) then
 return jsonb_build_object('state','COMPLETED','invoiceId',i.id,'amount',i.amount,'providerPaymentId',p.provider_payment_id);end if;
 if i.amount is distinct from p_expected_amount or i.invoice_month is distinct from p_invoice_month
 or p.expected_amount is distinct from i.amount or f.amount is distinct from i.amount or f.due_date is distinct from i.due_date
 or f.type<>'RECEITA' or i.superseded_at is not null or i.paid_at is not null or i.received_on is not null or f.paid_at is not null
 or exists(select 1 from private.monthly_invoice_receipts r where r.invoice_id=i.id and (r.completed_at is not null or r.reversed_at is null))
 or p.provider_payment_id is null or p.provider_customer_id is null
 then raise exception 'Fatura divergente ou com recebimento; ajuste bloqueado.';end if;
 if i.due_date is distinct from p_old_due_date or i.status not in ('ABERTA','AGUARDANDO','VENCIDA')
 or not coalesce(((i.provider_status in ('PENDING','OVERDUE') and p.status in ('PENDING','OVERDUE') and f.status in ('ABERTO','VENCIDO')) or (
 i.provider_status='REVIEW_REQUIRED' and p.status='REVIEW_REQUIRED' and f.status='REVISAO' and p.last_error='Webhook mensal divergente do snapshot local.'
 and p.safe_snapshot#>>'{payment,id}'=p.provider_payment_id and p.safe_snapshot#>>'{payment,customer}'=p.provider_customer_id
 and p.safe_snapshot#>>'{payment,external_reference}'=p.external_reference
 and (p.safe_snapshot#>>'{payment,value}')::numeric=p_new_amount and p.safe_snapshot#>>'{payment,due_date}'=i.due_date::text
 and p.safe_snapshot#>>'{payment,billing_type}'='PIX' and p.safe_snapshot#>>'{payment,status}' in ('PENDING','OVERDUE')
 and coalesce(p.safe_snapshot#>>'{payment,payment_date}','')='' and coalesce(p.safe_snapshot#>>'{payment,client_payment_date}','')='')),false)
 then raise exception 'Estado atual não permite o ajuste solicitado.';end if;
 -- Preserve membership and descriptions; only correct the amounts from the current registered composition.
 perform 1 from public.app_family_invoice_items where invoice_id=i.id for update;
 perform 1 from public.app_family_members where billing_responsible_id=c.id for share;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb),coalesce(sum(x.amount),0)
 into items_before,item_total from public.app_family_invoice_items x where x.invoice_id=i.id;
 if i.family_billing then
   if item_total<>i.amount or not exists(select 1 from public.app_family_invoice_items x where x.invoice_id=i.id and x.item_type='RESPONSAVEL' and x.beneficiary_client_id=c.id)
   or exists(select 1 from public.app_family_invoice_items x left join public.app_family_members m on m.id=x.family_member_id
     where x.invoice_id=i.id and x.item_type='MEMBRO' and (m.id is null or m.billing_responsible_id<>c.id or m.status<>'ATIVO' or m.billing_paused or m.monthly_amount is null))
   or exists(select 1 from public.app_family_members m where m.billing_responsible_id=c.id and m.status='ATIVO' and not m.billing_paused
     and not exists(select 1 from public.app_family_invoice_items x where x.invoice_id=i.id and x.family_member_id=m.id))
   then raise exception 'Composição mudou; exige revisão específica.';end if;
   select jsonb_agg(jsonb_build_object('id',x.id,'amount',case when x.item_type='RESPONSAVEL' then c.plan_amount else m.monthly_amount end) order by x.id),
   sum(case when x.item_type='RESPONSAVEL' then c.plan_amount else m.monthly_amount end)
   into items_after,item_total from public.app_family_invoice_items x left join public.app_family_members m on m.id=x.family_member_id where x.invoice_id=i.id;
 else
   if items_before<>'[]'::jsonb then raise exception 'Composição divergente.';end if;
   items_after:='[]'::jsonb;item_total:=c.plan_amount;
 end if;
 if c.plan_amount is null or item_total is distinct from p_new_amount then raise exception 'Valor solicitado deve corresponder à composição cadastrada.';end if;
 before_state:=jsonb_build_object('invoice',to_jsonb(i),'provider',to_jsonb(p),'ledger',to_jsonb(f),'items',items_before,'corrected_items',items_after);
 -- Stable financial identity tolerates a concurrent webhook of the same unpaid
 -- charge. Receipt, refund and cancellation guards above remain authoritative.
 revision:=md5(jsonb_build_array(i.id,i.amount,i.invoice_month,i.due_date,p.provider_payment_id,p.provider_customer_id,p.external_reference,p.provider_environment,f.id,items_before,items_after,p_new_amount)::text);
 if p_version is null then return jsonb_build_object('state','READY_REMOTE','version',revision,'payment',jsonb_build_object(
 'provider_payment_id',p.provider_payment_id,'provider_customer_id',p.provider_customer_id,'external_reference',p.external_reference,'provider_environment',p.provider_environment));end if;
 if p_version<>revision then raise exception 'Dados alterados durante a conferência; consulte novamente.';end if;
 target_date:=p_old_due_date;
 remote_status:=p_snapshot#>>'{payment,status}';
 if p_checked_at is null or p_checked_at<clock_timestamp()-interval '30 seconds' or p_checked_at>clock_timestamp()
 or coalesce(p_snapshot#>>'{payment,id}','')<>p.provider_payment_id
 or coalesce(p_snapshot#>>'{payment,customer}','')<>p.provider_customer_id
 or coalesce(p_snapshot#>>'{payment,external_reference}','')<>p.external_reference
 or coalesce((p_snapshot#>>'{payment,value}')::numeric,-1)<>p_new_amount
 or coalesce(p_snapshot#>>'{payment,due_date}','')<>target_date::text
 or coalesce(p_snapshot#>>'{payment,billing_type}','')<>'PIX'
 or nullif(p_snapshot->>'pix_payload','') is null
 or coalesce(remote_status,'') not in ('PENDING','OVERDUE')
 or coalesce(p_snapshot#>>'{payment,deleted}','')<>'false'
 or coalesce(p_snapshot#>>'{payment,payment_date}','')<>'' or coalesce(p_snapshot#>>'{payment,client_payment_date}','')<>''
 then raise exception 'Asaas não comprova o ajuste sem recebimento desta cobrança.';end if;
 next_status:=remote_status;
 insert into private.monthly_invoice_amount_adjustments(invoice_id,actor_id,reason,old_amount,new_amount,before_state,remote_proof)
 values(i.id,p_actor_id,trim(p_reason),i.amount,p_new_amount,before_state,p_snapshot) returning id into adjustment_id;
 perform pg_catalog.set_config('ilha.invoice_amount_adjustment',adjustment_id::text,true);
 perform pg_catalog.set_config('ilha.monthly_billing_write','1',true);
 update public.app_invoice_provider_payments set expected_amount=p_new_amount,status=next_status,last_error=null,safe_snapshot=p_snapshot,last_event_at=now(),updated_at=now(),
 next_reconciliation_at=case when next_status='CANCELLED' then null else now()+interval '1 hour' end where id=p.id;
 update public.app_payment_invoices set amount=p_new_amount,provider_status=next_status,last_payment_error=null,
 pix_payload=p_snapshot->>'pix_payload',pix_expires_at=(p_snapshot->>'pix_expires_at')::timestamptz,
 status=case when next_status='CANCELLED' then 'CANCELADA' when next_status='OVERDUE' then 'VENCIDA' else 'AGUARDANDO' end,
 notes=concat_ws(E'\n',nullif(notes,''),'Ajuste administrativo auditado: '||trim(p_reason)),updated_at=now() where id=i.id;
 update public.app_family_invoice_items x set amount=(v->>'amount')::numeric from jsonb_array_elements(items_after) v where x.id=(v->>'id')::uuid and x.invoice_id=i.id;
 update public.financial_transactions set amount=p_new_amount,updated_at=now() where id=f.id;
 perform private.sync_app_invoice_financial_transaction(i.id,next_status,null);
 perform pg_catalog.set_config('ilha.invoice_amount_adjustment','',true);
 return jsonb_build_object('state','COMPLETED','invoiceId',i.id,'amount',p_new_amount,'dueDate',target_date,'providerStatus',next_status,'providerPaymentId',p.provider_payment_id);
end;$$;
revoke all on function public.adjust_unpaid_monthly_invoice_amount(uuid,uuid,numeric,numeric,date,date,text,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.adjust_unpaid_monthly_invoice_amount(uuid,uuid,numeric,numeric,date,date,text,text,jsonb,timestamptz) to service_role;
commit;
