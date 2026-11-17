begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values('89000000-0000-4000-8000-000000000001','competence@tests.invalid','{"provider":"email","providers":["email"]}','{"app_context":"public"}');
insert into app_clients(id,full_name,email,plan_amount,due_day,status,client_type) values('89000000-0000-4000-8000-000000000001','Synthetic competence','competence@tests.invalid',350,15,'ATIVO','aluno');
insert into app_payment_invoices(id,client_id,invoice_month,amount,due_date,status,provider_status,paid_at) values
('89000000-0000-4000-8000-000000000021','89000000-0000-4000-8000-000000000001','2026-10-01',350,'2026-10-29','PAGA','RECEIVED','2026-10-28 15:00:00+00'),
('89000000-0000-4000-8000-000000000022','89000000-0000-4000-8000-000000000001','2026-11-01',350,'2026-11-15','VENCIDA','OVERDUE',null);
insert into app_invoice_provider_payments(invoice_id,provider_environment,provider_customer_id,provider_payment_id,external_reference,expected_amount,status) values
('89000000-0000-4000-8000-000000000021','SANDBOX','cus_test','pay_paid','source',350,'RECEIVED'),
('89000000-0000-4000-8000-000000000022','SANDBOX','cus_test','pay_duplicate','target',350,'OVERDUE');
select private.sync_app_invoice_financial_transaction('89000000-0000-4000-8000-000000000021','RECEIVED','2026-10-28 15:00:00+00');
select private.sync_app_invoice_financial_transaction('89000000-0000-4000-8000-000000000022','OVERDUE',null);
insert into private.monthly_invoice_receipts(invoice_id,requested_by,method,received_on,amount,claim_until) values('89000000-0000-4000-8000-000000000022','89000000-0000-4000-8000-000000000001','CLUB_PIX','2026-10-28',350,now()-interval '1 minute');
create function pg_temp.reconcile(v text default null,proof jsonb default null,checked timestamptz default null) returns jsonb language sql as $$
select public.reconcile_monthly_competence('89000000-0000-4000-8000-000000000021','89000000-0000-4000-8000-000000000022','89000000-0000-4000-8000-000000000001',350,'2026-10-01','2026-11-01','2026-10-28','2026-10-06','2026-10-15','Two distinct synthetic receipts confirmed.',v,proof,checked);
$$;
create temporary table evidence as select pg_temp.reconcile()->>'version' as v,'{"source":{"payment":{"id":"pay_paid","customer":"cus_test","external_reference":"source","value":350,"due_date":"2026-10-29","billing_type":"PIX","status":"RECEIVED","deleted":false,"payment_date":"2026-10-28"}},"target":{"payment":{"id":"pay_duplicate","customer":"cus_test","external_reference":"target","value":350,"due_date":"2026-11-15","billing_type":"PIX","status":"OVERDUE","deleted":true}}}'::jsonb as proof;
select throws_ok($$select pg_temp.reconcile('stale',(select proof from evidence),clock_timestamp())$$,'P0001','Dados alterados durante a conciliação.','reject stale version');
select throws_ok($$select pg_temp.reconcile((select v from evidence),(select proof from evidence),clock_timestamp()-interval '1 minute')$$,'P0001','Prova remota expirada.','reject stale proof');
select throws_ok($$select pg_temp.reconcile((select v from evidence),(select jsonb_set(proof,'{source,payment,value}','700') from evidence),clock_timestamp())$$,'P0001','Identidade remota divergente.','reject altered amount');
select throws_ok($$select pg_temp.reconcile((select v from evidence),(select jsonb_set(proof,'{target,payment,payment_date}','"2026-11-17"') from evidence),clock_timestamp())$$,'P0001','Asaas não comprova o recebimento e o cancelamento sem duplicidade.','reject paid target');
select is(pg_temp.reconcile(v,proof,clock_timestamp())->>'state','COMPLETED','coordinated reconciliation') from evidence;
select ok((select invoice_month='2026-11-01' and due_date='2026-10-29' and paid_at='2026-10-28 15:00:00+00' and status='PAGA' from app_payment_invoices where id='89000000-0000-4000-8000-000000000021'),'source date identity and receipt preserved with corrected competence');
select ok((select status='CANCELADA' and superseded_at is not null and paid_at is null from app_payment_invoices where id='89000000-0000-4000-8000-000000000022'),'duplicate preserved cancelled');
select ok((select i.status='PAGA' and i.received_method='CLUB_PIX' and i.received_on='2026-10-06' and i.invoice_month='2026-10-01' and i.due_date='2026-10-15' and i.amount=350 from app_payment_invoices i join private.monthly_competence_reconciliations a on a.historical_invoice_id=i.id),'historical receipt uses actual club date and amount');
select ok((select count(*)=2 and sum(amount)=700 from financial_transactions where counterparty='Synthetic competence' and status='RECEBIDO'),'two receipts only, never three');
select ok((select reversed_at is not null and completed_at is null from private.monthly_invoice_receipts where invoice_id='89000000-0000-4000-8000-000000000022'),'pending erroneous receipt preserved and invalidated');
select is(pg_temp.reconcile()->>'state','COMPLETED','idempotent retry');
select throws_ok($$update app_payment_invoices set invoice_month='2026-12-01' where id='89000000-0000-4000-8000-000000000021'$$,'23514','Valor, vencimento e composição ficam congelados após a emissão.','direct month edits still blocked');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select pg_temp.reconcile()$$,'42501','Acesso negado.','service coordinator only');
select * from finish();rollback;
