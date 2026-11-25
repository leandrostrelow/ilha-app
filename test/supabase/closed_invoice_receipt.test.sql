begin;
create extension if not exists pgtap with schema extensions;
select plan(27);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('93000000-0000-4000-8000-000000000001','closed-receipt@tests.invalid','{"provider":"email","providers":["email"]}','{"app_context":"public"}');
insert into public.app_clients(id,full_name,email,plan_amount,due_day,status,client_type)
values('93000000-0000-4000-8000-000000000001','Synthetic closed receipt','closed-receipt@tests.invalid',350,10,'ATIVO','aluno');
insert into public.app_payment_invoices(id,client_id,invoice_month,amount,due_date,status,provider_status)
select ('93000000-0000-4000-8000-00000000002'||n)::uuid,'93000000-0000-4000-8000-000000000001',make_date(2030,n,1),350,make_date(2030,n,10),'ABERTA','FAILED' from generate_series(1,7) n;
insert into public.app_invoice_provider_payments(invoice_id,provider_environment,external_reference,expected_amount,status)
select id,'SANDBOX','ilha-monthly-invoice:'||id,350,'FAILED' from public.app_payment_invoices where client_id='93000000-0000-4000-8000-000000000001';
select private.sync_app_invoice_financial_transaction(id,'FAILED',null) from public.app_payment_invoices where client_id='93000000-0000-4000-8000-000000000001';
create temporary table fixtures as select n,('93000000-0000-4000-8000-00000000002'||n)::uuid id,
 jsonb_build_object('externalReference','ilha-monthly-invoice:93000000-0000-4000-8000-00000000002'||n,'environment','SANDBOX','totalCount',0,'hasMore',false,'data','[]'::jsonb) proof from generate_series(1,7) n;
select public.close_failed_monthly_invoice(id,'93000000-0000-4000-8000-000000000001',350,make_date(2030,n,1),make_date(2030,n,10),'Synthetic closed failure.',
 public.close_failed_monthly_invoice(id,'93000000-0000-4000-8000-000000000001',350,make_date(2030,n,1),make_date(2030,n,10),'Synthetic closed failure.')->>'version',proof,clock_timestamp()) from fixtures;
create function pg_temp.receive_closed(n integer,v text default null,proof jsonb default null,checked timestamptz default null,
 received date default current_date-2,reason text default 'Synthetic confirmed club Pix.') returns jsonb language sql as $$
 select public.receive_closed_monthly_invoice(('93000000-0000-4000-8000-00000000002'||n)::uuid,'93000000-0000-4000-8000-000000000001',350,make_date(2030,n,1),make_date(2030,n,10),received,reason,v,proof,checked);
$$;
create temporary table prepared as select *,pg_temp.receive_closed(n)->>'version' v from fixtures;
select is(pg_temp.receive_closed(1)->>'state','CHECK_ABSENCE','preflight requires fresh remote absence');
select is((select count(*)::int from private.monthly_invoice_receipts where invoice_id in(select id from fixtures)),0,'preflight registers no receipt');
select throws_ok($$select pg_temp.receive_closed(1,(select v from prepared where n=1),null,clock_timestamp())$$,'P0001','Ausência de cobrança remota não comprovada.','no proof rejected');
select throws_ok($$select pg_temp.receive_closed(1,v,proof,clock_timestamp()-interval '1 minute') from prepared where n=1$$,'P0001','Ausência de cobrança remota não comprovada.','stale proof rejected');
select throws_ok($$select pg_temp.receive_closed(1,v,jsonb_set(proof,'{totalCount}','1'),clock_timestamp()) from prepared where n=1$$,'P0001','Ausência de cobrança remota não comprovada.','remote charge blocks receipt');
select throws_ok($$select pg_temp.receive_closed(1,v,jsonb_set(proof,'{environment}','"PRODUCTION"'),clock_timestamp()) from prepared where n=1$$,'P0001','Ausência de cobrança remota não comprovada.','wrong environment rejected');
select throws_ok($$select pg_temp.receive_closed(1,v,jsonb_set(proof,'{hasMore}','true'),clock_timestamp()) from prepared where n=1$$,'P0001','Ausência de cobrança remota não comprovada.','incomplete pagination rejected');
select throws_ok($$select pg_temp.receive_closed(1,v,proof,clock_timestamp(),current_date+1) from prepared where n=1$$,'P0001','Confira valor, competência, vencimento, data real do Pix e motivo.','future date rejected');
select throws_ok($$select pg_temp.receive_closed(1,v,proof,clock_timestamp(),current_date-3) from prepared where n=1$$,'P0001','Dados alterados durante a conferência; consulte novamente.','receipt date bound to preflight');
update public.app_invoice_provider_payments set last_error='Concurrent result' where invoice_id=(select id from fixtures where n=2);
select throws_ok($$select pg_temp.receive_closed(2,v,proof,clock_timestamp()) from prepared where n=2$$,'P0001','Dados alterados durante a conferência; consulte novamente.','CAS blocks changed source');
update public.app_invoice_provider_payments set provider_payment_id='pay_other' where invoice_id=(select id from fixtures where n=3);
select throws_ok($$select pg_temp.receive_closed(3)$$,'P0001','Use somente emissão individual com falha já encerrada, sem cobrança remota nem recebimento.','remote id blocks local receipt');
select set_config('ilha.monthly_billing_write','1',true);
update public.app_payment_invoices set family_billing=true where id=(select id from fixtures where n=4);
select throws_ok($$select pg_temp.receive_closed(4)$$,'P0001','Use somente emissão individual com falha já encerrada, sem cobrança remota nem recebimento.','family requires specific reconciliation');
delete from private.monthly_failed_invoice_closures where invoice_id=(select id from fixtures where n=5);
select throws_ok($$select pg_temp.receive_closed(5)$$,'P0001','Use somente emissão individual com falha já encerrada, sem cobrança remota nem recebimento.','ordinary cancellation cannot use receipt flow');
update public.financial_transactions set amount=351 where app_payment_invoice_id=(select id from fixtures where n=6);
select throws_ok($$select pg_temp.receive_closed(6)$$,'P0001','Use somente emissão individual com falha já encerrada, sem cobrança remota nem recebimento.','ledger mismatch rejected');
select is(pg_temp.receive_closed(1,v,proof,clock_timestamp())->>'state','COMPLETED','confirmed absence records exact club receipt') from prepared where n=1;
select ok((select i.status='CANCELADA' and i.superseded_at is not null and i.paid_at is null and p.status='CANCELLED' and p.provider_payment_id is null and f.status='CANCELADO' and f.paid_at is null
 from public.app_payment_invoices i join public.app_invoice_provider_payments p on p.invoice_id=i.id join public.financial_transactions f on f.app_payment_invoice_id=i.id where i.id=(select id from fixtures where n=1)),'original cancellation and ledger preserved');
select ok((select i.status='PAGA' and i.received_method='CLUB_PIX' and i.received_on=current_date-2 and i.amount=350 and i.due_date=date '2030-01-10' and i.provider_status is null
 and r.completed_at is not null and r.reversed_at is null and r.received_on=i.received_on and r.amount=i.amount
 and f.status='RECEBIDO' and f.payment_method='CLUB_PIX' and f.paid_at=i.paid_at and f.amount=i.amount
 from private.monthly_closed_invoice_receipts a join public.app_payment_invoices i on i.id=a.new_invoice_id join private.monthly_invoice_receipts r on r.invoice_id=i.id
 join public.financial_transactions f on f.app_payment_invoice_id=i.id where a.old_invoice_id=(select id from fixtures where n=1)),'paid invoice, receipt and ledger agree on actual Pix');
select is((select count(*)::int from public.app_invoice_provider_payments where invoice_id in(select new_invoice_id from private.monthly_closed_invoice_receipts)),0,'no provider charge for paid replacement');
select is((select count(*)::int from public.app_payment_invoices where client_id='93000000-0000-4000-8000-000000000001' and invoice_month='2030-01-01' and superseded_at is null),1,'only one current invoice');
select is(pg_temp.receive_closed(1)->>'state','COMPLETED','identical retry is idempotent');
select throws_ok($$select pg_temp.receive_closed(1,null,null,null,current_date-3)$$,'P0001','Recebimento anterior divergente; confira antes de continuar.','changed retry rejected');
select is((select count(*)::int from private.monthly_closed_invoice_receipts where old_invoice_id=(select id from fixtures where n=1)),1,'one immutable audit');
select ok((select before_state#>>'{invoice,status}'='CANCELADA' and absence_proof->>'totalCount'='0' from private.monthly_closed_invoice_receipts where old_invoice_id=(select id from fixtures where n=1)),'audit keeps source and absence proof');
select ok(not has_function_privilege('authenticated','public.receive_closed_monthly_invoice(uuid,uuid,numeric,date,date,date,text,text,jsonb,timestamptz)','EXECUTE') and not has_function_privilege('anon','public.receive_closed_monthly_invoice(uuid,uuid,numeric,date,date,date,text,text,jsonb,timestamptz)','EXECUTE'),'service-only operation');
select ok(not has_table_privilege('service_role','private.monthly_closed_invoice_receipts','UPDATE') and not has_table_privilege('authenticated','private.monthly_closed_invoice_receipts','SELECT'),'audit protected');
update public.financial_transactions set paid_at=now() where app_payment_invoice_id=(select new_invoice_id from private.monthly_closed_invoice_receipts where old_invoice_id=(select id from fixtures where n=1));
select throws_ok($$select pg_temp.receive_closed(1)$$,'P0001','Recebimento anterior divergente; confira antes de continuar.','retry detects inconsistent ledger');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select pg_temp.receive_closed(7)$$,'42501','Acesso negado.','authenticated direct call rejected');
select * from finish();
rollback;
