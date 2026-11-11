begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('82000000-0000-4000-8000-000000000001','dashboard@tests.invalid','{"provider":"email","providers":["email"]}','{"app_context":"public"}');
insert into app_clients(id,full_name,email,plan_amount,status,phone,cpf,due_day,weekly_lessons,client_type,registration_completed_at,email_verified_at)
values('82000000-0000-4000-8000-000000000001','Synthetic dashboard client','dashboard@tests.invalid',350,'ATIVO','27999990001','11144477735',5,2,'aluno',now(),now());
insert into app_payment_invoices(id,client_id,invoice_month,amount,due_date,status,provider_status,paid_at) values
('82000000-0000-4000-8000-000000000010','82000000-0000-4000-8000-000000000001','2026-11-01',350,'2026-11-05','PAGA','RECEIVED',now()),
('82000000-0000-4000-8000-000000000011','82000000-0000-4000-8000-000000000001','2026-12-01',350,'2026-12-05','ABERTA',null,null);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"ci-protected-admin@tests.invalid"}',true);
set local role authenticated;
select lives_ok($$insert into public.admin_dashboard_payment_dismissals(user_id,invoice_id) values(auth.uid(),'82000000-0000-4000-8000-000000000010')$$,'finance admin can dismiss confirmed payment');
select is((select count(*)::int from public.admin_dashboard_payment_dismissals),1,'own dismissal is visible');
select throws_ok($$insert into public.admin_dashboard_payment_dismissals(user_id,invoice_id) values(auth.uid(),'82000000-0000-4000-8000-000000000011')$$,'42501',null,'open invoice cannot be dismissed as confirmed');
select throws_ok($$insert into public.admin_dashboard_payment_dismissals(user_id,invoice_id) values('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000010')$$,'42501',null,'cannot hide payments for another user');
select set_config('request.jwt.claims','{"sub":"82000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*)::int from public.admin_dashboard_payment_dismissals),0,'customer cannot read administrative dismissals');
reset role;
select ok(not has_table_privilege('anon','public.admin_dashboard_payment_dismissals','SELECT') and not has_table_privilege('authenticated','public.admin_dashboard_payment_dismissals','UPDATE'),'no anonymous access or arbitrary dismissal updates');
select ok((select amount=350 and status='PAGA' and provider_status='RECEIVED' and paid_at is not null from app_payment_invoices where id='82000000-0000-4000-8000-000000000010'),'dismissal preserves financial record');
select * from finish();
rollback;
