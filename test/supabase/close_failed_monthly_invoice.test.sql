begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('92000000-0000-4000-8000-000000000001','failed-closure@tests.invalid','{"provider":"email","providers":["email"]}','{"app_context":"public"}');
insert into public.app_clients(id,full_name,email,plan_amount,due_day,status,client_type)
values('92000000-0000-4000-8000-000000000001','Synthetic failed closure','failed-closure@tests.invalid',350,10,'ATIVO','aluno');
insert into public.app_payment_invoices(id,client_id,invoice_month,amount,due_date,status,provider_status)
select ('92000000-0000-4000-8000-00000000002'||n)::uuid,'92000000-0000-4000-8000-000000000001',make_date(2030,n,1),350,make_date(2030,n,10),'ABERTA','FAILED' from generate_series(1,6) n;
insert into public.app_invoice_provider_payments(invoice_id,provider_environment,external_reference,expected_amount,status)
select id,'SANDBOX','ilha-monthly-invoice:'||id,350,'FAILED' from public.app_payment_invoices where client_id='92000000-0000-4000-8000-000000000001';
select private.sync_app_invoice_financial_transaction(id,'FAILED',null) from public.app_payment_invoices where client_id='92000000-0000-4000-8000-000000000001';
create function pg_temp.close_failed(n integer,v text default null,proof jsonb default null,checked timestamptz default null,reason text default 'Synthetic authorized failure closure.') returns jsonb language sql as $$
select public.close_failed_monthly_invoice(('92000000-0000-4000-8000-00000000002'||n)::uuid,'92000000-0000-4000-8000-000000000001',350,make_date(2030,n,1),make_date(2030,n,10),reason,v,proof,checked);
$$;
create temporary table prepared as select n,pg_temp.close_failed(n)->>'version' as v,jsonb_build_object('externalReference','ilha-monthly-invoice:92000000-0000-4000-8000-00000000002'||n,'environment','SANDBOX','totalCount',0,'hasMore',false,'data','[]'::jsonb) as proof from generate_series(1,6) n;
select is(pg_temp.close_failed(1)->>'state','CHECK_ABSENCE','preflight does not close before provider absence');
select ok((select i.status='ABERTA' and p.status='FAILED' and f.status='FALHA' from public.app_payment_invoices i join public.app_invoice_provider_payments p on p.invoice_id=i.id join public.financial_transactions f on f.app_payment_invoice_id=i.id where i.id='92000000-0000-4000-8000-000000000021'),'preflight is read-only');
select throws_ok($$select pg_temp.close_failed(1,(select v from prepared where n=1),null,clock_timestamp())$$,'P0001','Ausência de cobrança remota não comprovada.','missing absence proof rejected');
select throws_ok($$select pg_temp.close_failed(1,(select v from prepared where n=1),(select proof from prepared where n=1),clock_timestamp()-interval '1 minute')$$,'P0001','Ausência de cobrança remota não comprovada.','stale absence rejected');
select throws_ok($$select pg_temp.close_failed(1,(select v from prepared where n=1),(select jsonb_set(proof,'{totalCount}','1') from prepared where n=1),clock_timestamp())$$,'P0001','Ausência de cobrança remota não comprovada.','remote payment presence rejected');
select throws_ok($$select pg_temp.close_failed(1,(select v from prepared where n=1),(select jsonb_set(proof,'{environment}','"PRODUCTION"') from prepared where n=1),clock_timestamp())$$,'P0001','Ausência de cobrança remota não comprovada.','wrong provider environment rejected');
select throws_ok($$select pg_temp.close_failed(1,(select v from prepared where n=1),(select jsonb_set(proof,'{hasMore}','true') from prepared where n=1),clock_timestamp())$$,'P0001','Ausência de cobrança remota não comprovada.','incomplete provider pagination rejected');
update public.app_invoice_provider_payments set last_error='Concurrent dispatch result' where invoice_id='92000000-0000-4000-8000-000000000022';
select throws_ok($$select pg_temp.close_failed(2,(select v from prepared where n=2),(select proof from prepared where n=2),clock_timestamp())$$,'P0001','Dados alterados durante a conferência; consulte novamente.','CAS rejects changed local state');
update public.app_invoice_provider_payments set provider_payment_id='pay_already_created' where invoice_id='92000000-0000-4000-8000-000000000023';
select throws_ok($$select pg_temp.close_failed(3)$$,'P0001','Somente emissão com falha, sem cobrança remota nem recebimento, pode ser encerrada.','existing remote id blocks closure');
select set_config('ilha.monthly_billing_write','1',true);
update public.app_payment_invoices set status='PAGA',paid_at=now() where id='92000000-0000-4000-8000-000000000024';
select throws_ok($$select pg_temp.close_failed(4)$$,'P0001','Somente emissão com falha, sem cobrança remota nem recebimento, pode ser encerrada.','paid invoice cannot be closed');
update public.financial_transactions set amount=351 where app_payment_invoice_id='92000000-0000-4000-8000-000000000025';
select throws_ok($$select pg_temp.close_failed(5)$$,'P0001','Somente emissão com falha, sem cobrança remota nem recebimento, pode ser encerrada.','ledger amount mismatch blocks closure');
select throws_ok($$update public.financial_transactions set type='DESPESA' where app_payment_invoice_id='92000000-0000-4000-8000-000000000026'$$,'23514',null,'database rejects a non-revenue monthly ledger before closure');
select is(pg_temp.close_failed(1,v,proof,clock_timestamp())->>'state','COMPLETED','strict absence proof closes the failed invoice') from prepared where n=1;
select ok((select i.status='CANCELADA' and i.provider_status='CANCELLED' and i.paid_at is null and p.status='CANCELLED' and p.provider_payment_id is null and f.status='CANCELADO' and f.paid_at is null from public.app_payment_invoices i join public.app_invoice_provider_payments p on p.invoice_id=i.id join public.financial_transactions f on f.app_payment_invoice_id=i.id where i.id='92000000-0000-4000-8000-000000000021'),'closure coordinates invoice/provider/ledger without receipt');
select is((select count(*)::int from private.monthly_failed_invoice_closures where invoice_id='92000000-0000-4000-8000-000000000021'),1,'one immutable closure audit');
select is(pg_temp.close_failed(1)->>'state','COMPLETED','same request retry is idempotent');
select throws_ok($$select pg_temp.close_failed(1,null,null,null,'A different synthetic closure reason.')$$,'P0001','Encerramento anterior divergente.','idempotence does not hide a changed request');
update public.financial_transactions set status='FALHA' where app_payment_invoice_id='92000000-0000-4000-8000-000000000021';
select throws_ok($$select pg_temp.close_failed(1)$$,'P0001','Encerramento anterior divergente.','idempotence does not hide inconsistent ledger');
select ok(not has_function_privilege('authenticated','public.close_failed_monthly_invoice(uuid,uuid,numeric,date,date,text,text,jsonb,timestamptz)','EXECUTE') and not has_function_privilege('anon','public.close_failed_monthly_invoice(uuid,uuid,numeric,date,date,text,text,jsonb,timestamptz)','EXECUTE'),'closure RPC restricted to service');
select ok(not has_table_privilege('service_role','private.monthly_failed_invoice_closures','UPDATE') and not has_table_privilege('authenticated','private.monthly_failed_invoice_closures','SELECT'),'audit inaccessible to client and immutable for service');
select ok((select before_state#>>'{invoice,status}'='ABERTA' and before_state#>>'{provider,status}'='FAILED' and absence_proof->>'totalCount'='0' from private.monthly_failed_invoice_closures where invoice_id='92000000-0000-4000-8000-000000000021'),'audit preserves original state and remote proof');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select pg_temp.close_failed(2)$$,'42501','Acesso negado.','authenticated JWT cannot invoke service operation');
select * from finish();
rollback;
