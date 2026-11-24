begin;
create extension if not exists pgtap with schema extensions;
select plan(19);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('91000000-0000-4000-8000-000000000001','provider-safety@tests.invalid','{"provider":"email","providers":["email"]}','{"app_context":"public"}');
insert into public.app_clients(id,full_name,email,plan_amount,due_day,status,client_type)
values('91000000-0000-4000-8000-000000000001','Synthetic provider safety','provider-safety@tests.invalid',100,10,'ATIVO','aluno');

select ok(not has_function_privilege('authenticated','public.release_rejected_app_payment_customer(uuid,text,uuid,integer)','EXECUTE'), 'customer lease release is service-only');
insert into public.app_payment_customers(client_id,provider_environment,external_reference,identity_fingerprint,status,resolution_token,resolution_started_at,provider_create_attempted_at)
values('91000000-0000-4000-8000-000000000001','SANDBOX','ilha-monthly-customer:91000000-0000-4000-8000-000000000001',repeat('a',64),'RESOLVING','91000000-0000-4000-8000-000000000099',now(),now());
select is(public.release_rejected_app_payment_customer('91000000-0000-4000-8000-000000000001','SANDBOX','91000000-0000-4000-8000-000000000098',400),false,'wrong lease cannot be released');
select throws_ok($$select public.release_rejected_app_payment_customer('91000000-0000-4000-8000-000000000001','SANDBOX','91000000-0000-4000-8000-000000000099',500)$$,'22023','Somente uma rejeição definitiva permite liberar a reserva.','ambiguous failure cannot permit a second POST');
select is(public.release_rejected_app_payment_customer('91000000-0000-4000-8000-000000000001','SANDBOX','91000000-0000-4000-8000-000000000099',400),true,'definite rejection releases its lease');
select ok((select provider_create_attempted_at is null and resolution_token is null and provider_customer_id is null from public.app_payment_customers where client_id='91000000-0000-4000-8000-000000000001'),'release does not fabricate a remote customer');
create temporary table customer_claim as select public.claim_app_payment_customer_resolution('91000000-0000-4000-8000-000000000001','SANDBOX','ilha-monthly-customer:91000000-0000-4000-8000-000000000001',repeat('a',64)) as result;
select ok((select (result->>'claimed')::boolean and (result->>'allowProviderCreate')::boolean from customer_claim),'corrected customer can be retried safely');
select is(public.release_rejected_app_payment_customer('91000000-0000-4000-8000-000000000001','SANDBOX','91000000-0000-4000-8000-000000000099',400),false,'stale worker cannot release the new lease');

insert into public.app_payment_invoices(id,client_id,invoice_month,amount,due_date,status,provider_status)
select ('91000000-0000-4000-8000-00000000002'||n)::uuid,'91000000-0000-4000-8000-000000000001',make_date(2030,n,1),100,make_date(2030,n,10),'AGUARDANDO','PENDING' from generate_series(1,5) n;
insert into public.app_invoice_provider_payments(invoice_id,provider_environment,provider_customer_id,provider_payment_id,external_reference,expected_amount,status)
select id,'SANDBOX','cus_synthetic','pay_safety_'||extract(month from invoice_month)::int,'ilha-monthly-invoice:'||id,100,'PENDING'
from public.app_payment_invoices where client_id='91000000-0000-4000-8000-000000000001';
create function pg_temp.reconcile(n integer,status text,event text,remote_due date default null,deleted boolean default false,amount numeric default 100) returns jsonb language sql as $$
select public.apply_app_invoice_payment_reconciliation('pay_safety_'||n,'SANDBOX',status,'ilha-monthly-invoice:91000000-0000-4000-8000-00000000002'||n,amount,'2030-01-05T12:00:00-03:00',event||':'||n,
jsonb_build_object('event',event,'payment',jsonb_build_object('billing_type',case when n=1 then 'RECEIVED_IN_CASH' else 'PIX' end,'due_date',coalesce(remote_due,make_date(2030,n,10))::text,'deleted',deleted)));
$$;
select pg_temp.reconcile(n,'RECEIVED','PAYMENT_RECEIVED') from generate_series(1,3) n;
select set_config('ilha.invoice_receipt_write','1',true);
update public.app_payment_invoices set received_on='2030-01-05',received_method='CLUB_PIX' where id='91000000-0000-4000-8000-000000000021';
insert into private.monthly_invoice_receipts(invoice_id,requested_by,method,received_on,amount,completed_at)
values('91000000-0000-4000-8000-000000000021','91000000-0000-4000-8000-000000000001','CLUB_PIX','2030-01-05',100,now());
create temporary table receipt_before as select to_jsonb(r) as snapshot from private.monthly_invoice_receipts r where invoice_id='91000000-0000-4000-8000-000000000021';
create temporary table ledger_before as select id,to_jsonb(f) as snapshot from public.financial_transactions f where app_payment_invoice_id in(select id from public.app_payment_invoices where client_id='91000000-0000-4000-8000-000000000001');
select is(pg_temp.reconcile(1,'REVIEW_REQUIRED','PAYMENT_RECEIVED_IN_CASH_UNDONE')->>'status','REVIEW_REQUIRED','undo receipt opens review');
select is(pg_temp.reconcile(2,'REVIEW_REQUIRED','PAYMENT_RESTORED')->>'status','REVIEW_REQUIRED','restoration opens review');
select is(pg_temp.reconcile(3,'REVIEW_REQUIRED','PAYMENT_REFUND_DENIED')->>'status','REVIEW_REQUIRED','denied refund opens review');
select ok((select count(*)=3 and bool_and(status='PAGA' and paid_at is not null and provider_status='REVIEW_REQUIRED') from public.app_payment_invoices where client_id='91000000-0000-4000-8000-000000000001' and extract(month from invoice_month)<=3),'review preserves actual local receipts until audited correction');
select ok(not exists(select 1 from ledger_before b join public.financial_transactions f on f.id=b.id where to_jsonb(f)<>b.snapshot),'review does not rewrite the financial ledger');
select ok((select to_jsonb(r)=b.snapshot from private.monthly_invoice_receipts r cross join receipt_before b where invoice_id='91000000-0000-4000-8000-000000000021'),'cash undo review preserves audited receipt');
select ok((select received_on='2030-01-05' and received_method='CLUB_PIX' and paid_at='2030-01-05 12:00:00 America/Sao_Paulo'::timestamptz from public.app_payment_invoices where id='91000000-0000-4000-8000-000000000021'),'cash undo review preserves actual payment date and method');
select is(pg_temp.reconcile(1,'REVIEW_REQUIRED','PAYMENT_RECEIVED_IN_CASH_UNDONE')->>'reason','DUPLICATE_EVENT','duplicate review event is idempotent');
select is(pg_temp.reconcile(4,'PENDING','PAYMENT_UPDATED','2030-04-11')->>'status','REVIEW_REQUIRED','different remote due date opens review');
select is((select due_date::text from public.app_payment_invoices where id='91000000-0000-4000-8000-000000000024'),'2030-04-10','provider date change cannot overwrite the contracted invoice');
select is(pg_temp.reconcile(5,'DELETED','PAYMENT_DELETED',null,true)->>'status','CANCELLED','verified deleted unpaid charge cancels normally');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select public.release_rejected_app_payment_customer('91000000-0000-4000-8000-000000000001','SANDBOX','91000000-0000-4000-8000-000000000099',400)$$,'42501','Esta operação exige a função de serviço.','authenticated callers cannot release a lease');
select * from finish();
rollback;
