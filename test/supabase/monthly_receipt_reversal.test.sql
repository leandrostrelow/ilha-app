begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('77000000-0000-4000-8000-000000000001','reversal@tests.invalid','{"provider":"email","providers":["email"]}','{"app_context":"public"}');
insert into app_clients(id,full_name,email,phone,cpf,status,client_type)
values ('77000000-0000-4000-8000-000000000001','Synthetic reversal','reversal@tests.invalid','27999990001','11144477735','ATIVO','aluno');
insert into app_payment_invoices(id,client_id,invoice_month,amount,due_date,status,paid_at,provider_status)
values ('77000000-0000-4000-8000-000000000002','77000000-0000-4000-8000-000000000001','2026-11-01',250,'2026-11-03','PAGA','2026-11-06 15:00:00+00','RECEIVED');
insert into app_invoice_provider_payments(invoice_id,provider_environment,provider_customer_id,provider_payment_id,external_reference,expected_amount,status,safe_snapshot)
values ('77000000-0000-4000-8000-000000000002','SANDBOX','cus_fixture','pay_fixture','ilha-monthly-invoice:77000000-0000-4000-8000-000000000002',250,'RECEIVED','{"payment":{"status":"RECEIVED_IN_CASH"}}');
select private.sync_app_invoice_financial_transaction('77000000-0000-4000-8000-000000000002','RECEIVED','2026-11-06 15:00:00+00');
insert into private.monthly_invoice_receipts(invoice_id,requested_by,method,received_on,amount,claim_until)
values ('77000000-0000-4000-8000-000000000002','77000000-0000-4000-8000-000000000001','CLUB_PIX','2026-10-30',250,now()-interval '1 minute');
create function pg_temp.review(v text default null,s jsonb default null,checked timestamptz default null) returns jsonb language sql as $$
 select public.review_reversed_monthly_receipt('77000000-0000-4000-8000-000000000002','77000000-0000-4000-8000-000000000001',250,'2026-11-01','2026-11-03','Confirmação externa equivocada desfeita no provedor.',v,s,checked,'2026-11-03');
$$;
create temporary table proof as select
 jsonb_build_object('payment',jsonb_build_object('id','pay_fixture','customer','cus_fixture','external_reference','ilha-monthly-invoice:77000000-0000-4000-8000-000000000002','value',250,'billing_type','PIX','status','OVERDUE','deleted',false)) as snapshot,
 pg_temp.review()->>'version' as version;
select is(pg_temp.review()->>'state','READY','inspect does not mutate');
select is((select count(*)::int from private.monthly_receipt_reversal_reviews),0,'no audit until confirmed');
select throws_ok($$select pg_temp.review('stale',(select snapshot from proof),clock_timestamp())$$,'P0001','Dados alterados durante a conferência; consulte novamente.','reject stale version');
select throws_ok($$select pg_temp.review((select version from proof),(select snapshot from proof),now()-interval '1 minute')$$,'P0001','Asaas não comprova a reversão atual desta cobrança.','reject old provider evidence');
select throws_ok($$select pg_temp.review((select version from proof),(select jsonb_set(snapshot,'{payment,status}','"RECEIVED"') from proof),clock_timestamp())$$,'P0001','Asaas não comprova a reversão atual desta cobrança.','reject still paid remotely');
select is(pg_temp.review((select version from proof),(select snapshot from proof),clock_timestamp())->>'state','REVIEW_REQUIRED','verified reversal enters review atomically');
select is((select status from app_payment_invoices where id='77000000-0000-4000-8000-000000000002'),'AGUARDANDO','invoice no longer falsely paid');
select ok((select paid_at is null and received_on is null from app_payment_invoices where id='77000000-0000-4000-8000-000000000002'),'no invented payment date');
select ok((select status='REVISAO' and paid_at is null from financial_transactions where app_payment_invoice_id='77000000-0000-4000-8000-000000000002'),'ledger no longer counts fictitious income');
select ok((select reversed_at is not null and completed_at is null and received_on='2026-10-30' from private.monthly_invoice_receipts where invoice_id='77000000-0000-4000-8000-000000000002'),'original attempted date preserved, claim invalidated');
select is((select before_state#>>'{invoice,paid_at}' from private.monthly_receipt_reversal_reviews),'2026-11-06T15:00:00+00:00','original erroneous date preserved in audit');
select is(pg_temp.review()->>'state','REVIEW_REQUIRED','retry idempotent');
select is((select count(*)::int from private.monthly_receipt_reversal_reviews),1,'only one correction audit');
select is(public.apply_app_invoice_payment_reconciliation('pay_fixture','SANDBOX','RECEIVED_IN_CASH','ilha-monthly-invoice:77000000-0000-4000-8000-000000000002',250,now(),'late-cash-event','{"payment":{"billing_type":"RECEIVED_IN_CASH"}}')->>'reason','STATUS_REGRESSION','late payment webhook cannot restore false income');
select throws_ok($$select public.complete_monthly_invoice_receipt('77000000-0000-4000-8000-000000000002',gen_random_uuid(),null)$$,'P0001','Recebimento desfeito em revisão administrativa.','old receipt completion blocked');
select ok(not has_function_privilege('authenticated','public.review_reversed_monthly_receipt(uuid,uuid,numeric,date,date,text,text,jsonb,timestamptz,date)','EXECUTE') and not has_table_privilege('service_role','private.monthly_receipt_reversal_reviews','DELETE'),'no public RPC or editable audit');
select is((select due_date from app_payment_invoices where id='77000000-0000-4000-8000-000000000002'),date '2026-11-03','issued due date remains immutable');
select * from finish();
rollback;
