begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values ('88000000-0000-4000-8000-000000000001','amount@tests.invalid','{"provider":"email","providers":["email"]}','{"app_context":"public"}');
insert into app_clients(id,full_name,email,plan_amount,due_day,status,client_type) values ('88000000-0000-4000-8000-000000000001','Synthetic amount','amount@tests.invalid',350,10,'ATIVO','aluno');
insert into app_payment_invoices(id,client_id,invoice_month,amount,due_date,status,provider_status) values ('88000000-0000-4000-8000-000000000021','88000000-0000-4000-8000-000000000001','2026-11-01',700,'2026-11-10','VENCIDA','OVERDUE');
insert into app_invoice_provider_payments(invoice_id,provider_environment,provider_customer_id,provider_payment_id,external_reference,expected_amount,status)
values ('88000000-0000-4000-8000-000000000021','SANDBOX','cus_test','pay_test','ilha-monthly-invoice:88000000-0000-4000-8000-000000000021',700,'OVERDUE');
select private.sync_app_invoice_financial_transaction('88000000-0000-4000-8000-000000000021','OVERDUE',null);
create function pg_temp.adjust(v text default null,proof jsonb default null,checked timestamptz default null,amount numeric default 350) returns jsonb language sql as $$
 select public.adjust_unpaid_monthly_invoice_amount('88000000-0000-4000-8000-000000000021','88000000-0000-4000-8000-000000000001',amount,700,'2026-11-01','2026-11-10','Synthetic authorized amount correction.',v,proof,checked);
$$;
create temporary table evidence as select pg_temp.adjust()->>'version' as v,'{"pix_payload":"synthetic-pix","payment":{"id":"pay_test","customer":"cus_test","external_reference":"ilha-monthly-invoice:88000000-0000-4000-8000-000000000021","value":350,"billing_type":"PIX","due_date":"2026-11-10","status":"OVERDUE","deleted":false}}'::jsonb as proof;
select throws_ok($$select pg_temp.adjust(null,null,null,351)$$,'P0001','Valor solicitado deve corresponder à composição cadastrada.','reject amount not matching profile');
select throws_ok($$select pg_temp.adjust('stale',(select proof from evidence),clock_timestamp())$$,'P0001','Dados alterados durante a conferência; consulte novamente.','reject stale version');
select throws_ok($$select pg_temp.adjust((select v from evidence),(select proof from evidence),clock_timestamp()-interval '1 minute')$$,'P0001','Asaas não comprova o ajuste sem recebimento desta cobrança.','reject stale proof');
select throws_ok($$select pg_temp.adjust((select v from evidence),(select jsonb_set(proof,'{payment,value}','700') from evidence),clock_timestamp())$$,'P0001','Asaas não comprova o ajuste sem recebimento desta cobrança.','reject remote old amount');
select throws_ok($$select pg_temp.adjust((select v from evidence),(select jsonb_set(proof,'{payment,payment_date}','"2026-11-06"') from evidence),clock_timestamp())$$,'P0001','Asaas não comprova o ajuste sem recebimento desta cobrança.','reject receipt');
select is(pg_temp.adjust(v,proof,clock_timestamp())->>'state','COMPLETED','apply verified amount') from evidence;
select ok((select i.amount=350 and f.amount=i.amount and p.expected_amount=i.amount and i.due_date='2026-11-10' and f.due_date=i.due_date and i.status='VENCIDA' and p.status='OVERDUE' and i.paid_at is null and f.paid_at is null and i.pix_payload='synthetic-pix' from app_payment_invoices i join app_invoice_provider_payments p on p.invoice_id=i.id join financial_transactions f on f.app_payment_invoice_id=i.id where i.id='88000000-0000-4000-8000-000000000021'),'same invoice provider ledger and Pix coordinated without receipt');
select is(pg_temp.adjust()->>'state','COMPLETED','retry idempotent');
select throws_ok($$update app_payment_invoices set amount=1 where id='88000000-0000-4000-8000-000000000021'$$,'23514','Valor, vencimento e composição ficam congelados após a emissão.','direct changes remain blocked');
select ok((select count(*)=1 and min(old_amount)=700 and min(new_amount)=350 from private.monthly_invoice_amount_adjustments),'audit preserves original amount');

update app_clients set plan_amount=0 where id='88000000-0000-4000-8000-000000000001';
insert into app_family_members(id,billing_responsible_id,full_name,relationship,monthly_amount,status,birth_date,contact_responsible_name,contact_responsible_phone,reviewed_at)
values('88000000-0000-4000-8000-000000000002','88000000-0000-4000-8000-000000000001','Synthetic dependent','Filho(a)',350,'ATIVO','2015-01-01','Synthetic payer','27999990001',now());
insert into app_payment_invoices(id,client_id,invoice_month,amount,due_date,status,provider_status,family_billing) values ('88000000-0000-4000-8000-000000000022','88000000-0000-4000-8000-000000000001','2026-12-01',700,'2026-12-10','VENCIDA','OVERDUE',true);
insert into app_family_invoice_items(invoice_id,item_type,beneficiary_client_id,description,amount) values('88000000-0000-4000-8000-000000000022','RESPONSAVEL','88000000-0000-4000-8000-000000000001','Synthetic payer',350);
insert into app_family_invoice_items(invoice_id,item_type,family_member_id,description,amount) values('88000000-0000-4000-8000-000000000022','MEMBRO','88000000-0000-4000-8000-000000000002','Synthetic dependent',350);
insert into app_invoice_provider_payments(invoice_id,provider_environment,provider_customer_id,provider_payment_id,external_reference,expected_amount,status)
values ('88000000-0000-4000-8000-000000000022','SANDBOX','cus_test','pay_family','ilha-monthly-invoice:88000000-0000-4000-8000-000000000022',700,'OVERDUE');
select private.sync_app_invoice_financial_transaction('88000000-0000-4000-8000-000000000022','OVERDUE',null);
create function pg_temp.family_adjust(v text default null,proof jsonb default null) returns jsonb language sql as $$
 select public.adjust_unpaid_monthly_invoice_amount('88000000-0000-4000-8000-000000000022','88000000-0000-4000-8000-000000000001',350,700,'2026-12-01','2026-12-10','Synthetic family amount correction.',v,proof,clock_timestamp());
$$;
create temporary table family_evidence as select pg_temp.family_adjust()->>'version' as v,'{"pix_payload":"synthetic-family-pix","payment":{"id":"pay_family","customer":"cus_test","external_reference":"ilha-monthly-invoice:88000000-0000-4000-8000-000000000022","value":350,"billing_type":"PIX","due_date":"2026-12-10","status":"OVERDUE","deleted":false}}'::jsonb as proof;
-- A provider webhook may arrive between the remote PUT and the final local commit.
update app_invoice_provider_payments set status='REVIEW_REQUIRED',last_error='Webhook mensal divergente do snapshot local.',safe_snapshot=(select proof from family_evidence) where provider_payment_id='pay_family';
update app_payment_invoices set status='AGUARDANDO',provider_status='REVIEW_REQUIRED' where id='88000000-0000-4000-8000-000000000022';
select private.sync_app_invoice_financial_transaction('88000000-0000-4000-8000-000000000022','REVIEW_REQUIRED',null);
select is(pg_temp.family_adjust(v,proof)->>'state','COMPLETED','family correction reconciles precisely matching concurrent webhook') from family_evidence;
select ok((select count(*)=2 and sum(amount)=350 and min(amount)=0 from app_family_invoice_items where invoice_id='88000000-0000-4000-8000-000000000022'),'family items retain identity and corrected amounts');
select is((select before_state#>>'{invoice,amount}' from private.monthly_invoice_amount_adjustments where invoice_id='88000000-0000-4000-8000-000000000022'),'700.00','audit retains original family invoice');
select ok((select amount=350 from app_payment_invoices where id='88000000-0000-4000-8000-000000000021'),'other invoice untouched');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select pg_temp.adjust()$$,'42501','Acesso negado.','authenticated direct call denied');
select * from finish();rollback;
