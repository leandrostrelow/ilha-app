begin;
create extension if not exists pgtap with schema extensions;
select plan(35);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select ('95000000-0000-4000-8000-00000000000'||n)::uuid,'whatsapp-'||n||'@tests.invalid',
  '{"provider":"email","providers":["email"]}','{"app_context":"public"}' from generate_series(1,6)n;
insert into public.app_clients(id,full_name,email,phone,cpf,plan_amount,due_day,status,client_type,birth_date,guardian_name,guardian_phone,registration_completed_at)
select ('95000000-0000-4000-8000-00000000000'||n)::uuid,'Synthetic WhatsApp person '||n,'whatsapp-'||n||'@tests.invalid',
  case when n=4 then '2733333333' else '2799999000'||n end,
  (array['11144477735','52998224725','95000000323','95000000404','95000000595','95000000676'])[n],100,10,'ATIVO','aluno',
  case when n in(2,3) then current_date-interval '12 years' else date '1980-01-01' end,
  case when n=3 then 'Synthetic guardian' else null end,case when n=3 then '+55 (27) 98888-7777' else null end,now()
from generate_series(1,6)n;
insert into public.app_payment_customers(client_id,provider_environment,external_reference,identity_fingerprint,status,provider_customer_id)
select ('95000000-0000-4000-8000-00000000000'||n)::uuid,'SANDBOX','ilha-monthly-customer:95000000-0000-4000-8000-00000000000'||n,
repeat('a',64),'ACTIVE','cus_whatsapp_'||n from generate_series(1,5)n;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"ci-protected-admin@tests.invalid"}',true);
insert into public.app_family_members(id,billing_responsible_id,member_client_id,full_name,relationship,monthly_amount,status,birth_date,contact_responsible_name,contact_responsible_phone,reviewed_at)
values('95000000-0000-4000-8000-000000000011','95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002',
 'Synthetic linked child','Filho(a)',100,'ATIVO',current_date-interval '12 years','Synthetic payer','27999990001',now());
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into public.app_payment_invoices(id,client_id,invoice_month,amount,due_date,status,provider_status,family_billing)
values('95000000-0000-4000-8000-000000000021','95000000-0000-4000-8000-000000000001','2030-01-01',200,'2030-01-10','AGUARDANDO','PENDING',true);
insert into public.app_invoice_provider_payments(invoice_id,provider_environment,provider_customer_id,provider_payment_id,external_reference,expected_amount,status)
values('95000000-0000-4000-8000-000000000021','SANDBOX','cus_whatsapp_1','pay_whatsapp_1','ilha-monthly-invoice:95000000-0000-4000-8000-000000000021',200,'PENDING');
select private.sync_app_invoice_financial_transaction('95000000-0000-4000-8000-000000000021','PENDING',null);
create temporary table financial_before as select jsonb_build_object('invoice',to_jsonb(i),'provider',to_jsonb(p),'ledger',to_jsonb(f)) as snapshot
from public.app_payment_invoices i join public.app_invoice_provider_payments p on p.invoice_id=i.id join public.financial_transactions f on f.app_payment_invoice_id=i.id where i.id='95000000-0000-4000-8000-000000000021';
create function pg_temp.target(n integer) returns jsonb language sql as $$
select public.get_monthly_whatsapp_target(('95000000-0000-4000-8000-00000000000'||n)::uuid,'SANDBOX');
$$;
create function pg_temp.policy(enabled boolean) returns jsonb language sql as $$
select public.set_monthly_whatsapp_policy('10000000-0000-4000-8000-000000000001',enabled,'Synthetic authorized WhatsApp policy change.');
$$;
create function pg_temp.audit(v text,status text default 'APPLIED',customer text default 'cus_whatsapp_1',config jsonb default '{"notificationDisabled":false,"notifications":[]}',actor uuid default '10000000-0000-4000-8000-000000000001') returns jsonb language sql as $$
select public.record_monthly_whatsapp_result('95000000-0000-4000-8000-000000000001',actor,'SANDBOX',customer,v,status,'{"notificationDisabled":true,"access_token":"DO_NOT_SAVE","cpf":"DO_NOT_SAVE"}',config,null);
$$;

select is((public.get_monthly_whatsapp_policy()->>'enabled')::boolean,false,'policy starts disabled');
select ok(not has_function_privilege('anon','public.get_monthly_whatsapp_target(uuid,text)','EXECUTE') and not has_function_privilege('authenticated','public.list_monthly_whatsapp_targets(uuid,integer,text)','EXECUTE'),'payer contacts are service-only');
select ok(not has_table_privilege('authenticated','private.monthly_whatsapp_customer_audit','SELECT') and not has_table_privilege('service_role','private.monthly_whatsapp_customer_audit','UPDATE'),'audit inaccessible and not client-editable');
select throws_ok($$select public.set_monthly_whatsapp_policy('95000000-0000-4000-8000-000000000001',true,'Synthetic unauthorized policy attempt.')$$,'42501','Seu acesso não permite configurar avisos financeiros.','customer cannot authorize policy through a spoofed actor');
select is((pg_temp.policy(true)->>'enabled')::boolean,true,'protected finance actor can enable policy');
select pg_temp.policy(true);
select is((select count(*)::integer from private.monthly_whatsapp_policy_audit),1,'repeated policy setting does not duplicate its audit');
select is(pg_temp.target(1)->>'state','READY','payer with own plan and child remains one target');
select ok(pg_temp.target(1)->>'phone'='27999990001' and pg_temp.target(1)->>'cpf'='11144477735' and (pg_temp.target(1)->>'isFamily')::boolean,'family contact and legal identity belong to its payer');
select is(pg_temp.target(2)->>'reason','FAMILY_DEPENDENT','dependent is never configured as another family recipient');
select ok(pg_temp.target(2)->>'phone' is null and pg_temp.target(2)->>'payerClientId'='95000000-0000-4000-8000-000000000001','blocked dependent cannot leak a deliverable contact');
select ok(pg_temp.target(3)->>'state'='READY' and pg_temp.target(3)->>'phone'='27988887777' and pg_temp.target(3)->>'recipientKind'='GUARDIAN' and pg_temp.target(3)->>'cpf'='95000000323','standalone minor routes WhatsApp to guardian without replacing charge identity');
select is(pg_temp.target(4)->>'reason','MOBILE_PHONE_REQUIRED','landline cannot enable WhatsApp');
select ok(pg_temp.target(6)->>'state'='READY' and pg_temp.target(6)->>'providerCustomerId' is null,'new eligible payer can be inspected without creating provider data');
select is((select count(*)::integer from public.app_payment_customers where client_id='95000000-0000-4000-8000-000000000006'),0,'target lookup has no provider side effects');
select throws_ok($$select public.list_monthly_whatsapp_targets(null,11,'SANDBOX')$$,'22023','Confira o ambiente e o tamanho do lote.','batch capped at ten');
create temporary table first_page as select public.list_monthly_whatsapp_targets('94ffffff-ffff-4fff-8fff-ffffffffffff',2,'SANDBOX') as result;
select ok((select jsonb_array_length(result->'targets')=2 and (result->>'hasMore')::boolean and result->>'nextCursor'='95000000-0000-4000-8000-000000000002' from first_page),'pagination advances by payer id including blocked entries');
select ok((select (public.list_monthly_whatsapp_targets((result->>'nextCursor')::uuid,2,'SANDBOX')->'targets'->0->>'clientId')='95000000-0000-4000-8000-000000000003' from first_page),'next batch does not repeat prior payers');

create temporary table evidence as select pg_temp.target(1)->>'targetVersion' as version;
select is(pg_temp.audit(version)->>'status','APPLIED','current mapping and policy permit audited provider result') from evidence;
select ok((select before_config='{"notificationDisabled":true}'::jsonb and after_config='{"notificationDisabled":false,"notifications":[]}'::jsonb from private.monthly_whatsapp_customer_audit where client_id='95000000-0000-4000-8000-000000000001' order by created_at desc limit 1),'audit strips arbitrary secrets and customer fields');
select throws_ok($$select pg_temp.audit((select version from evidence),'APPLIED','cus_other')$$,'40001','Política, contato ou vínculo alterado; desative os avisos e confira novamente.','another customer cannot be marked applied');
select throws_ok($$select pg_temp.audit((select version from evidence),'APPLIED','cus_whatsapp_1','{}','95000000-0000-4000-8000-000000000001')$$,'42501','Acesso negado.','unprivileged actor cannot claim application');
update public.app_clients set phone='27999991111' where id='95000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.audit((select version from evidence))$$,'40001','Política, contato ou vínculo alterado; desative os avisos e confira novamente.','concurrent contact change prevents stale applied audit');
select is(pg_temp.target(1)->>'reason','FAMILY_CONTACT_MISMATCH','conflicting family contact is quarantined');
select is(pg_temp.audit(version,'FAILED')->>'status','FAILED','failure can still be audited after concurrent change') from evidence;
update public.app_clients set phone='27999990001' where id='95000000-0000-4000-8000-000000000001';
select pg_temp.policy(false);
select throws_ok($$select pg_temp.audit(pg_temp.target(1)->>'targetVersion')$$,'40001','Política, contato ou vínculo alterado; desative os avisos e confira novamente.','policy disabled in flight blocks applied result');
select pg_temp.policy(true);
select is(pg_temp.audit(pg_temp.target(1)->>'targetVersion','APPLIED','cus_whatsapp_1','{"notificationDisabled":false,"notifications":[{"id":"not_synthetic","event":"PAYMENT_DUEDATE_WARNING","scheduleOffset":5,"enabled":true,"whatsappEnabledForCustomer":true,"emailEnabledForCustomer":false,"smsEnabledForCustomer":false,"phoneCallEnabledForCustomer":false,"customerPhone":"DO_NOT_SAVE"}]}',null)->>'status','APPLIED','automatic service flow can audit after policy authorization');
select ok((select not(after_config::text like '%DO_NOT_SAVE%') and after_config#>>'{notifications,0,whatsappEnabledForCustomer}'='true' from private.monthly_whatsapp_customer_audit where actor_id is null order by created_at desc limit 1),'only channel configuration enters customer audit');
update public.app_payment_customers set status='REVIEW_REQUIRED' where client_id='95000000-0000-4000-8000-000000000005';
select is(pg_temp.target(5)->>'reason','CUSTOMER_MAPPING_NOT_ACTIVE','ambiguous provider mapping cannot enable delivery');
update public.app_clients set guardian_phone=null where id='95000000-0000-4000-8000-000000000003';
select is(pg_temp.target(3)->>'reason','GUARDIAN_CONTACT_REQUIRED','minor missing guardian contact does not fallback to own phone');
select throws_ok($$select public.get_monthly_whatsapp_target('95000000-0000-4000-8000-000000000001','OTHER')$$,'22023','Ambiente inválido.','provider environment cannot drift');
select ok((select jsonb_build_object('invoice',to_jsonb(i),'provider',to_jsonb(p),'ledger',to_jsonb(f))=b.snapshot from public.app_payment_invoices i join public.app_invoice_provider_payments p on p.invoice_id=i.id join public.financial_transactions f on f.app_payment_invoice_id=i.id cross join financial_before b where i.id='95000000-0000-4000-8000-000000000021'),'notification configuration never changes invoices, money, dates or provider payment state');
select is((select count(*)::integer from private.monthly_whatsapp_policy_audit),3,'all policy changes record actor and transition');
select ok((select bool_and(actor_id='10000000-0000-4000-8000-000000000001'::uuid and length(reason)>=10) from private.monthly_whatsapp_policy_audit),'policy authority and reason preserved');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"95000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select pg_temp.target(1)$$,'42501','Acesso negado.','authenticated JWT cannot invoke service contact resolver');
select throws_ok($$select public.get_monthly_whatsapp_policy()$$,'42501','Acesso negado.','authenticated JWT cannot read private operational policy');
select * from finish();
rollback;
