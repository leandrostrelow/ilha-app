begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
select set_config('request.jwt.claims','{"role":"service_role"}',true);

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('76000000-0000-4000-8000-000000000001','due-day@tests.invalid','{"provider":"email","providers":["email"]}','{"app_context":"public"}');
insert into public.app_plans(id,code,name,type,amount,weekly_lessons,default_due_day,active)
values ('76000000-0000-4000-8000-000000000010','ci-due-day','Synthetic due day','aluno',100,1,10,true);
insert into public.app_clients(id,full_name,email,phone,cpf,official_plan_id,official_plan_code,official_plan_name,plan_amount,weekly_lessons,due_day,status,client_type,registration_completed_at,email_verified_at)
values ('76000000-0000-4000-8000-000000000001','Synthetic due day','due-day@tests.invalid','27999990001','11144477735','76000000-0000-4000-8000-000000000010','ci-due-day','Synthetic due day',100,1,30,'ATIVO','aluno',now(),now());
-- Disabled enrollment avoids any HTTP queue or real provider invocation.
insert into public.app_monthly_billing_enrollments(client_id,enabled,first_due_date,billing_method)
values ('76000000-0000-4000-8000-000000000001',false,'2026-11-03','ASAAS_PIX');

select is(private.first_monthly_due_date('76000000-0000-4000-8000-000000000001','2026-11-01'),date '2026-11-30','activation on day 3 does not replace agreed day 30');
select is((select first_due_date from public.app_monthly_billing_enrollments where client_id='76000000-0000-4000-8000-000000000001'),date '2026-11-03','historical activation date remains untouched');
select is(private.first_monthly_due_date('76000000-0000-4000-8000-000000000001','2026-12-01'),null::date,'subsequent months use the ordinary recurring calculation');
select is(private.monthly_billing_due_date('2027-02-01',30),date '2027-02-28','day 30 is clamped at February month end');
select is(private.monthly_billing_due_date('2028-02-01',30),date '2028-02-29','leap-year February is supported');

update public.app_clients set due_day=1 where id='76000000-0000-4000-8000-000000000001';
select is((select due_date from private.monthly_billing_candidates(date_trunc('month',now() at time zone 'America/Sao_Paulo')::date,'76000000-0000-4000-8000-000000000001')),date_trunc('month',now() at time zone 'America/Sao_Paulo')::date,'preview keeps day 1 instead of silently moving a past due date to tomorrow');
select ok(not has_function_privilege('authenticated','private.first_monthly_due_date(uuid,date)','EXECUTE') and not has_function_privilege('anon','private.first_monthly_due_date(uuid,date)','EXECUTE'),'private due-date helper does not gain public access');
select * from finish();
rollback;
