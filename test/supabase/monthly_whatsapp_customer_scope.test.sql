begin;
create extension if not exists pgtap with schema extensions;
select plan(26);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select ('96000000-0000-4000-8000-00000000000'||n)::uuid,'scope-'||n||'@tests.invalid',
 '{"provider":"email","providers":["email"]}','{"app_context":"public"}' from generate_series(1,2)n;
insert into public.app_clients(id,full_name,email,phone,cpf,plan_amount,due_day,status,client_type,birth_date,registration_completed_at)
select ('96000000-0000-4000-8000-00000000000'||n)::uuid,'Synthetic scope payer '||n,'scope-'||n||'@tests.invalid',
 '2799999000'||n,(array['11144477735','52998224725'])[n],100,10,'ATIVO','aluno','1980-01-01',now() from generate_series(1,2)n;
insert into public.app_payment_customers(client_id,provider_environment,external_reference,identity_fingerprint,status,provider_customer_id)
select ('96000000-0000-4000-8000-00000000000'||n)::uuid,'SANDBOX','ilha-monthly-customer:96000000-0000-4000-8000-00000000000'||n,
 repeat('a',64),'ACTIVE','cus_scope_'||n from generate_series(1,2)n;
insert into public.app_payment_invoices(id,client_id,invoice_month,amount,due_date,status,provider_status)
values
 ('96000000-0000-4000-8000-000000000021','96000000-0000-4000-8000-000000000001','2030-01-01',100,'2030-01-10','AGUARDANDO','PENDING'),
 ('96000000-0000-4000-8000-000000000022','96000000-0000-4000-8000-000000000002','2030-01-01',100,'2030-01-10','AGUARDANDO','PENDING'),
 ('96000000-0000-4000-8000-000000000023','96000000-0000-4000-8000-000000000001','2029-12-01',100,'2029-12-10','CANCELADA','CANCELLED');
insert into public.app_invoice_provider_payments(invoice_id,provider_environment,provider_customer_id,provider_payment_id,external_reference,expected_amount,status)
select i.id,'SANDBOX',case when i.client_id='96000000-0000-4000-8000-000000000002' then 'cus_scope_2' else 'cus_scope_1' end,
 'pay_scope_'||right(i.id::text,2),'ilha-monthly-invoice:'||i.id,100,case when i.status='CANCELADA' then 'CANCELLED' else 'PENDING' end
from public.app_payment_invoices i where i.id in('96000000-0000-4000-8000-000000000021','96000000-0000-4000-8000-000000000022','96000000-0000-4000-8000-000000000023');
insert into public.tournament_athletes(id,source_key,full_name,cpf,asaas_customer_id,app_client_id)
values
 ('96000000-0000-4000-8000-000000000031','ci:scope-owned','Synthetic prior athlete','11144477735','cus_scope_1','96000000-0000-4000-8000-000000000001'),
 ('96000000-0000-4000-8000-000000000032','ci:scope-foreign','Synthetic unrelated athlete','52998224725','cus_scope_1',null);
insert into public.tournament_registrations(id,tournament_id,category_id,athlete_id,public_name,status,payment_status,total_amount,paid_amount,source)
select '96000000-0000-4000-8000-000000000041',t.id,c.id,'96000000-0000-4000-8000-000000000031','Synthetic prior athlete','CONFIRMED','PAID',100,100,'PUBLIC'
from public.tournaments t join lateral(select id from public.tournament_categories where tournament_id=t.id order by sort_order,id limit 1)c on true
where t.slug='ilha-open-2026-teste';
insert into public.tournament_payments(id,tournament_id,registration_id,provider,provider_environment,provider_customer_id,provider_payment_id,external_reference,billing_type,status,amount,paid_at)
select '96000000-0000-4000-8000-000000000051',r.tournament_id,r.id,'ASAAS','SANDBOX','cus_scope_1','pay_scope_tournament','ci:scope-tournament','PIX','RECEIVED',100,now()
from public.tournament_registrations r where r.id='96000000-0000-4000-8000-000000000041';
insert into public.tournament_registration_groups(id,tournament_id,request_token,payer_name,payer_email,payer_phone,payer_cpf,provider_customer_id,status,total_amount)
select x.id,t.id,x.id,'Synthetic previous payer','scope-group@tests.invalid','27999990001',x.cpf,'cus_scope_1','CONFIRMED',100
from public.tournaments t cross join(values
 ('96000000-0000-4000-8000-000000000061'::uuid,'11144477735'),
 ('96000000-0000-4000-8000-000000000062'::uuid,'52998224725'))x(id,cpf) where t.slug='ilha-open-2026-teste';
update public.tournament_registration_groups set primary_registration_id='96000000-0000-4000-8000-000000000041' where id='96000000-0000-4000-8000-000000000061';
update public.tournament_payments set registration_group_id='96000000-0000-4000-8000-000000000061' where id='96000000-0000-4000-8000-000000000051';
create function pg_temp.scope() returns jsonb language sql as $$
select public.get_monthly_whatsapp_customer_scope('96000000-0000-4000-8000-000000000001','SANDBOX');
$$;
create temporary table scope_before as select pg_temp.scope() result;
create temporary table financial_before as select jsonb_agg(to_jsonb(p) order by p.id) result from public.app_invoice_provider_payments p where p.provider_customer_id in('cus_scope_1','cus_scope_2');

select ok(not has_function_privilege('anon','public.get_monthly_whatsapp_customer_scope(uuid,text)','EXECUTE')
 and not has_function_privilege('authenticated','public.get_monthly_whatsapp_customer_scope(uuid,text)','EXECUTE')
 and has_function_privilege('service_role','public.get_monthly_whatsapp_customer_scope(uuid,text)','EXECUTE'),'scope proof is service-only');
select is(pg_temp.scope()->>'state','READY','terminal tournament history permits scope inspection');
select ok((pg_temp.scope()->'allowedExternalReferences') ? 'tournament-athlete:96000000-0000-4000-8000-000000000031','athlete reference needs matching record, customer and fiscal identity');
select ok((pg_temp.scope()->'allowedExternalReferences') ? 'tournament-family:96000000-0000-4000-8000-000000000061','family tournament reference is proved by its exact payer record');
select is(jsonb_array_length(pg_temp.scope()->'allowedExternalReferences'),2,'arbitrary or mismatched-person references are not admitted');
select ok(not((pg_temp.scope()->'allowedExternalReferences') ? 'tournament-athlete:96000000-0000-4000-8000-000000000032')
 and not((pg_temp.scope()->'allowedExternalReferences') ? 'tournament-family:96000000-0000-4000-8000-000000000062'),'matching customer alone cannot borrow another person reference');
select is(pg_temp.scope()->'monthlyPayments','[{"providerPaymentId":"pay_scope_21","externalReference":"ilha-monthly-invoice:96000000-0000-4000-8000-000000000021"}]'::jsonb,'only own open monthly payment id and reference enter remote allowlist');
select ok(not(pg_temp.scope() ? 'cpf') and not(pg_temp.scope() ? 'phone') and not(pg_temp.scope() ? 'name'),'scope proof contains no payer contact fields');
select ok((select result=pg_temp.scope() from scope_before),'repeated scope inspection is stable and does not adopt remote data');
select ok((select result=(select jsonb_agg(to_jsonb(p) order by p.id) from public.app_invoice_provider_payments p where p.provider_customer_id in('cus_scope_1','cus_scope_2')) from financial_before),'scope inspection preserves money, status and payment identity');
update public.tournament_payments set provider_environment='PRODUCTION' where id='96000000-0000-4000-8000-000000000051';
select is(jsonb_array_length(pg_temp.scope()->'allowedExternalReferences'),0,'customer id caches cannot borrow origin proof from another provider environment');
update public.tournament_payments set provider_environment='SANDBOX' where id='96000000-0000-4000-8000-000000000051';
update public.tournament_athletes set asaas_customer_id='cus_unrelated' where id='96000000-0000-4000-8000-000000000031';
select ok(not((pg_temp.scope()->'allowedExternalReferences') ? 'tournament-athlete:96000000-0000-4000-8000-000000000031'),'matching CPF alone cannot borrow a different remote customer');
update public.tournament_athletes set asaas_customer_id='cus_scope_1',app_client_id='96000000-0000-4000-8000-000000000002' where id='96000000-0000-4000-8000-000000000031';
select ok(not((pg_temp.scope()->'allowedExternalReferences') ? 'tournament-athlete:96000000-0000-4000-8000-000000000031'),'conflicting linked app identity is not accepted');
update public.tournament_athletes set app_client_id='96000000-0000-4000-8000-000000000001' where id='96000000-0000-4000-8000-000000000031';
update public.tournament_payments set status='PENDING' where id='96000000-0000-4000-8000-000000000051';
select ok(pg_temp.scope()->>'reason'='OTHER_ACTIVE_PRODUCT' and (pg_temp.scope()->>'hasOtherActiveProduct')::boolean,'reopened foreign payment blocks reused customer');
select ok((select result->>'scopeVersion' is distinct from pg_temp.scope()->>'scopeVersion' from scope_before),'financial scope changes invalidate readback proof');
update public.tournament_payments set status='RECEIVED' where id='96000000-0000-4000-8000-000000000051';
update public.tournament_registration_groups set status='PENDING' where id='96000000-0000-4000-8000-000000000061';
select is(pg_temp.scope()->>'reason','OTHER_ACTIVE_PRODUCT','a group awaiting a charge also blocks activation');
update public.tournament_registration_groups set status='CONFIRMED' where id='96000000-0000-4000-8000-000000000061';
update public.tournament_registrations set payment_status='PENDING' where id='96000000-0000-4000-8000-000000000041';
select is(pg_temp.scope()->>'reason','OTHER_ACTIVE_PRODUCT','unpaid registration awaiting provider creation blocks activation');
update public.tournament_registrations set payment_status='NOT_REQUIRED' where id='96000000-0000-4000-8000-000000000041';
select is(pg_temp.scope()->>'state','READY','courtesy registration cannot generate a foreign payment notice');
update public.tournament_registrations set payment_status='PAID' where id='96000000-0000-4000-8000-000000000041';
insert into public.app_store_products(id,code,name,sale_price,stock_quantity) values('96000000-0000-4000-8000-000000000071','ci-scope-item','Synthetic scope item',30,10);
insert into public.app_store_orders(id,request_id,created_by,client_id,customer_name,source,product_id,product_name,quantity,unit_price,total,status,provider_environment,payment_flow)
values('96000000-0000-4000-8000-000000000072','96000000-0000-4000-8000-000000000073','96000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001',
 'Synthetic scope payer','APP','96000000-0000-4000-8000-000000000071','Synthetic scope item',1,30,30,'PENDING','SANDBOX','CHARGE');
select is(pg_temp.scope()->>'reason','OTHER_ACTIVE_PRODUCT','open store charge is conservatively excluded by linked identity');
update public.app_store_orders set status='PAID' where id='96000000-0000-4000-8000-000000000072';
insert into public.bar_ticket_events(id,slug,event_date) values('96000000-0000-4000-8000-000000000081','ci-scope-event','2030-01-01');
insert into public.bar_event_orders(id,event_id,request_id,access_token_hash,request_hash,buyer_name,buyer_email,buyer_phone,buyer_cpf,status,total_cents,quantity,provider_environment)
values('96000000-0000-4000-8000-000000000082','96000000-0000-4000-8000-000000000081','96000000-0000-4000-8000-000000000083',repeat('a',64),'ci-scope',
 'Synthetic scope payer','scope-event@tests.invalid','27999990001','11144477735','PENDING',1000,1,'SANDBOX');
select is(pg_temp.scope()->>'reason','OTHER_ACTIVE_PRODUCT','open ticket purchase is conservatively excluded by fiscal identity');
update public.bar_event_orders set status='PAID' where id='96000000-0000-4000-8000-000000000082';
select is(pg_temp.scope()->>'state','READY','settled foreign products do not remain permanently blocked');
select is(public.get_monthly_whatsapp_customer_scope('96000000-0000-4000-8000-000000000001','PRODUCTION')->>'reason','CUSTOMER_MAPPING_NOT_ACTIVE','sandbox proof cannot authorize production');
update public.app_payment_customers set status='REVIEW_REQUIRED' where client_id='96000000-0000-4000-8000-000000000001';
select is(pg_temp.scope()->>'reason','CUSTOMER_MAPPING_NOT_ACTIVE','mapping in review cannot provide legacy ownership evidence');
select is(public.get_monthly_whatsapp_customer_scope('96000000-0000-4000-8000-000000000099','SANDBOX')->>'reason','CLIENT_NOT_FOUND','unknown customer does not create scope');
select throws_ok($$select public.get_monthly_whatsapp_customer_scope('96000000-0000-4000-8000-000000000001','OTHER')$$,'22023','Ambiente inválido.','unknown environment rejected');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select pg_temp.scope()$$,'42501','Acesso negado.','authenticated callers cannot inspect financial cross-product scope');
select * from finish();
rollback;
