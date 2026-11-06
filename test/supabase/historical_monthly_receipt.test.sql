begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('78000000-0000-4000-8000-000000000001','history@tests.invalid','{"provider":"email","providers":["email"]}','{"app_context":"public"}');
insert into app_clients(id,full_name,email,phone,cpf,status,client_type,plan_amount,due_day)
values ('78000000-0000-4000-8000-000000000001','Synthetic history','history@tests.invalid','27999990001','11144477735','ATIVO','aluno',250,5);
create function pg_temp.record_history(amount numeric default 230) returns jsonb language sql as $$
 select public.record_historical_club_monthly_receipt('78000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000001','2020-10-01',amount,'2020-10-05','2020-10-06','Pix histórico confirmado pelo responsável; valor anterior ao reajuste.');
$$;
select is(pg_temp.record_history()->>'state','COMPLETED','historical receipt completes locally');
select ok((select amount=230 and due_date='2020-10-05' and invoice_month='2020-10-01' and received_on='2020-10-06' and received_method='CLUB_PIX' and status='PAGA' from app_payment_invoices where client_id='78000000-0000-4000-8000-000000000001'),'correct historical invoice value and dates');
select ok((select amount=230 and paid_at='2020-10-06 15:00:00+00' and status='RECEBIDO' and payment_method='CLUB_PIX' from financial_transactions where app_payment_invoice_id in(select id from app_payment_invoices where client_id='78000000-0000-4000-8000-000000000001')),'ledger uses actual past receipt date');
select is((select plan_amount from app_clients where id='78000000-0000-4000-8000-000000000001'),250::numeric,'current recurring price unchanged');
select is((select count(*)::int from app_invoice_provider_payments where invoice_id in(select id from app_payment_invoices where client_id='78000000-0000-4000-8000-000000000001')),0,'no provider invoice created');
select is(pg_temp.record_history()->>'state','COMPLETED','exact retry idempotent');
select is((select count(*)::int from app_payment_invoices where client_id='78000000-0000-4000-8000-000000000001'),1,'retry does not duplicate invoices');
select throws_ok($$select pg_temp.record_history(250)$$,'P0001','Já existe fatura nesta competência; concilie o registro existente.','changed value cannot replace history');
select throws_ok($$select public.record_historical_club_monthly_receipt('78000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000001',date_trunc('month',now())::date,230,date_trunc('month',now())::date,current_date,'Não é competência histórica.')$$,'P0001','Confira competência passada, valor, vencimento, data real e motivo.','not available for current collection');
select ok(not has_function_privilege('authenticated','public.record_historical_club_monthly_receipt(uuid,uuid,date,numeric,date,date,text)','EXECUTE'),'only verified administrative service can call');
select * from finish();
rollback;
