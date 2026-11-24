begin;
create extension if not exists pgtap with schema extensions;
select plan(30);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select ('97000000-0000-4000-8000-00000000000'||n)::uuid,'archived-scope-'||n||'@tests.invalid',
 '{"provider":"email","providers":["email"]}','{"app_context":"public"}' from generate_series(1,2)n;
insert into public.app_clients(id,full_name,email,phone,cpf,plan_amount,due_day,status,client_type,birth_date,registration_completed_at)
select ('97000000-0000-4000-8000-00000000000'||n)::uuid,'Synthetic archived payer '||n,'archived-scope-'||n||'@tests.invalid',
 '2799999000'||n,(array['11144477735','52998224725'])[n],100,10,'ATIVO','aluno','1980-01-01',now() from generate_series(1,2)n;
insert into public.app_payment_customers(client_id,provider_environment,external_reference,identity_fingerprint,status,provider_customer_id)
values('97000000-0000-4000-8000-000000000001','SANDBOX','ilha-monthly-customer:97000000-0000-4000-8000-000000000001',repeat('a',64),'ACTIVE','cus_archived_scope');
insert into public.tournament_athletes(id,source_key,full_name,cpf,asaas_customer_id)
values('97000000-0000-4000-8000-000000000011','ci:archived-scope-current','Synthetic current athlete','11144477735','cus_archived_scope');
insert into private.tournament_expired_registration_attempts(id,tournament_id,athlete_id,primary_registration_id,payment_id,registration_snapshot,payment_snapshot,expired_at,cleanup_reason)
values('97000000-0000-4000-8000-000000000021','97000000-0000-4000-8000-000000000031','97000000-0000-4000-8000-000000000041',
 '97000000-0000-4000-8000-000000000051','97000000-0000-4000-8000-000000000061',
 '[{"id":"97000000-0000-4000-8000-000000000051","athlete_id":"97000000-0000-4000-8000-000000000041","tournament_id":"97000000-0000-4000-8000-000000000031","registration_group_id":null}]',
 '{"id":"97000000-0000-4000-8000-000000000061","registration_id":"97000000-0000-4000-8000-000000000051","tournament_id":"97000000-0000-4000-8000-000000000031","registration_group_id":null,"provider":"ASAAS","provider_environment":"SANDBOX","provider_customer_id":"cus_archived_scope","provider_payment_id":"pay_archived_scope","external_reference":"tournament-registration:97000000-0000-4000-8000-000000000051","status":"PENDING"}',
 now()-interval '1 day','PAYMENT_EXPIRED');
create temporary table archive_before as select * from private.tournament_expired_registration_attempts where id='97000000-0000-4000-8000-000000000021';
create function pg_temp.scope() returns jsonb language sql as $$
 select public.get_monthly_whatsapp_customer_scope('97000000-0000-4000-8000-000000000001','SANDBOX');
$$;
create function pg_temp.allowed() returns boolean language sql as $$
 select (pg_temp.scope()->'allowedExternalReferences') ? 'tournament-athlete:97000000-0000-4000-8000-000000000041';
$$;
create function pg_temp.reject_payment(key text,value jsonb) returns boolean language plpgsql as $$
declare rejected boolean;
begin
 update private.tournament_expired_registration_attempts set payment_snapshot=jsonb_set((select payment_snapshot from archive_before),array[key],value)
 where id='97000000-0000-4000-8000-000000000021';
 rejected:=not pg_temp.allowed();
 update private.tournament_expired_registration_attempts set payment_snapshot=(select payment_snapshot from archive_before) where id='97000000-0000-4000-8000-000000000021';
 return rejected;
end;
$$;
create function pg_temp.reject_registration(payload jsonb) returns boolean language plpgsql as $$
declare rejected boolean;
begin
 update private.tournament_expired_registration_attempts set registration_snapshot=payload where id='97000000-0000-4000-8000-000000000021';
 rejected:=not pg_temp.allowed();
 update private.tournament_expired_registration_attempts set registration_snapshot=(select registration_snapshot from archive_before) where id='97000000-0000-4000-8000-000000000021';
 return rejected;
end;
$$;

select ok(pg_temp.allowed(),'exact expired individual archive links the removed origin to the current financial identity');
select is(pg_temp.scope()->>'state','READY','archived pending state is not mistaken for a current foreign debt');
select is(jsonb_array_length(pg_temp.scope()->'allowedExternalReferences'),1,'only the proved original reference is exposed');
select ok((select to_jsonb(a)=to_jsonb(b) from private.tournament_expired_registration_attempts a cross join archive_before b where a.id=b.id),'scope reads do not alter historical evidence');
select ok(not(pg_temp.scope() ? 'cpf') and not(pg_temp.scope() ? 'phone'),'historical evidence does not expose fiscal or contact details');
update public.tournament_athletes set asaas_customer_id=null where id='97000000-0000-4000-8000-000000000011';
select ok(pg_temp.allowed(),'unique current CPF plus exact archived customer proves origin when current cache is absent');
update public.tournament_athletes set asaas_customer_id='cus_other' where id='97000000-0000-4000-8000-000000000011';
select ok(not pg_temp.allowed(),'conflicting current customer cache cannot be replaced with an archive');
update public.tournament_athletes set asaas_customer_id='cus_archived_scope',cpf='52998224725' where id='97000000-0000-4000-8000-000000000011';
select ok(not pg_temp.allowed(),'different current fiscal identity rejects historical reuse');
update public.tournament_athletes set cpf='11144477735',app_client_id='97000000-0000-4000-8000-000000000002' where id='97000000-0000-4000-8000-000000000011';
select ok(not pg_temp.allowed(),'conflicting current app identity rejects historical reuse');
update public.tournament_athletes set app_client_id=null where id='97000000-0000-4000-8000-000000000011';
select ok(pg_temp.reject_payment('id','"97000000-0000-4000-8000-000000000099"'),'archive payment id cannot diverge from snapshot');
select ok(pg_temp.reject_payment('registration_id','"97000000-0000-4000-8000-000000000099"'),'payment must belong to the archived primary registration');
select ok(pg_temp.reject_payment('tournament_id','"97000000-0000-4000-8000-000000000099"'),'payment must belong to the archived tournament');
select ok(pg_temp.reject_payment('provider_customer_id','"cus_other"'),'another customer cannot borrow an archived origin');
select ok(pg_temp.reject_payment('provider_environment','"PRODUCTION"'),'another environment cannot borrow archived evidence');
select ok(pg_temp.reject_payment('provider','"OTHER"'),'another provider cannot borrow archived evidence');
select ok(pg_temp.reject_payment('external_reference','"store:unrelated"'),'payment reference must point exactly to archived registration');
select ok(pg_temp.reject_payment('provider_payment_id','null'),'incomplete provider payment identity is rejected');
select ok(pg_temp.reject_payment('registration_group_id','"97000000-0000-4000-8000-000000000099"'),'family payment snapshots are outside individual archive authorization');
select ok(pg_temp.reject_payment('status','"RECEIVED"'),'paid histories cannot be reclassified as expired attempts');
select ok(pg_temp.reject_registration(jsonb_build_array((select registration_snapshot->0 from archive_before)-'athlete_id')),'missing athlete link fails closed');
select ok(pg_temp.reject_registration(jsonb_build_array(jsonb_set((select registration_snapshot->0 from archive_before),'{athlete_id}','"97000000-0000-4000-8000-000000000099"'))),'another athlete cannot borrow registration proof');
select ok(pg_temp.reject_registration((select registration_snapshot||registration_snapshot from archive_before)),'ambiguous registration arrays are rejected');
select ok(pg_temp.reject_registration('{}'),'malformed historical arrays fail closed without an SQL error');
update private.tournament_expired_registration_attempts set cleanup_reason='ADMIN_UNPAID_DELETE' where id='97000000-0000-4000-8000-000000000021';
select ok(not pg_temp.allowed(),'other archive cleanup classes are not authorized by this extension');
update private.tournament_expired_registration_attempts set cleanup_reason='PAYMENT_EXPIRED' where id='97000000-0000-4000-8000-000000000021';
insert into private.tournament_expired_registration_attempts(id,tournament_id,athlete_id,primary_registration_id,payment_id,registration_snapshot,payment_snapshot,expired_at,cleanup_reason)
select '97000000-0000-4000-8000-000000000022',tournament_id,athlete_id,primary_registration_id,'97000000-0000-4000-8000-000000000062',registration_snapshot,payment_snapshot,expired_at,cleanup_reason from archive_before;
select ok(not pg_temp.allowed(),'multiple archives for the same removed athlete require manual review');
delete from private.tournament_expired_registration_attempts where id='97000000-0000-4000-8000-000000000022';
insert into public.tournament_athletes(id,source_key,full_name) values('97000000-0000-4000-8000-000000000041','ci:archived-scope-restored','Synthetic restored original');
select ok(not pg_temp.allowed(),'live original entities must use the normal current-record proof');
delete from public.tournament_athletes where id='97000000-0000-4000-8000-000000000041';
update public.app_clients set status='BLOQUEADO' where id='97000000-0000-4000-8000-000000000001';
select ok(pg_temp.scope()->>'state'='READY' and public.get_monthly_whatsapp_target('97000000-0000-4000-8000-000000000001','SANDBOX')->>'state'='BLOCKED','identity scope can support a safe disable but never overrides inactive recipient eligibility');
select ok(not has_function_privilege('anon','public.get_monthly_whatsapp_customer_scope(uuid,text)','EXECUTE') and not has_function_privilege('authenticated','public.get_monthly_whatsapp_customer_scope(uuid,text)','EXECUTE'),'replacement preserves service-only scope permissions');
select ok(not has_table_privilege('authenticated','private.tournament_expired_registration_attempts','INSERT'),'client cannot manufacture the historical proof');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select pg_temp.scope()$$,'42501','Acesso negado.','replacement still checks service role in its body');
select * from finish();
rollback;
