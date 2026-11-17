begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('85000000-0000-4000-8000-000000000001','pause-payer@tests.invalid','{"provider":"email","providers":["email"]}','{"app_context":"public"}'),
('85000000-0000-4000-8000-000000000003','pause-member@tests.invalid','{"provider":"email","providers":["email"]}','{"app_context":"public"}');
insert into public.app_clients(id,full_name,email,phone,cpf,birth_date,plan_amount,weekly_lessons,due_day,status,client_type,registration_completed_at,email_verified_at) values
('85000000-0000-4000-8000-000000000001','Synthetic pause payer','pause-payer@tests.invalid','27999990001','11144477735','1980-01-01',350,0,5,'ATIVO','cliente',now(),now()),
('85000000-0000-4000-8000-000000000003','Synthetic registered member','pause-member@tests.invalid','27999990002','52998224725','1985-01-01',0,0,5,'ATIVO','cliente',now(),now());
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"ci-protected-admin@tests.invalid"}',true);
insert into public.app_family_members(id,billing_responsible_id,full_name,relationship,monthly_amount,status,birth_date,cpf,contact_responsible_name,contact_responsible_phone,reviewed_at)
values('85000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000001','Synthetic provisional member','CONJUGE',250,'ATIVO','1985-01-01','52998224725','Synthetic pause payer','27999990001',now());
create temporary table original_student as select student_id from app_family_members where id='85000000-0000-4000-8000-000000000002';
select public.admin_link_family_member('85000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000003',null);
select is((select count(*)::int from students where app_client_id='85000000-0000-4000-8000-000000000003'),1,'linking keeps one operational student');
select is((select student_id from app_family_members where id='85000000-0000-4000-8000-000000000002'),(select student_id from original_student),'provisional history preserved by linking');
select public.admin_authorize_family_billing(id,updated_at) from app_family_members where id='85000000-0000-4000-8000-000000000002';
select public.admin_generate_family_invoice('85000000-0000-4000-8000-000000000001','2026-10-01','2026-10-05');
create temporary table invoice_snapshot as select to_jsonb(i) as data from app_payment_invoices i where client_id='85000000-0000-4000-8000-000000000001';
create function pg_temp.pause_family(version timestamptz default null) returns jsonb language sql as $$
 select public.admin_suspend_family_enrollment(id,coalesce(version,updated_at),'Synthetic temporary absence') from app_family_members where id='85000000-0000-4000-8000-000000000002';
$$;
select throws_ok($$select pg_temp.pause_family('2000-01-01')$$,'40001','O cadastro mudou. Reabra a ficha antes de continuar.','stale data rejected');
select is(pg_temp.pause_family()->>'state','COMPLETED','pause without a debt succeeds');
select ok((select m.billing_paused and m.classes_suspended and m.status='ATIVO' and m.monthly_amount=250 and s.status='INATIVO' from app_family_members m join students s on s.id=m.student_id where m.id='85000000-0000-4000-8000-000000000002'),'individual paused with relationship and price preserved');
select ok((select status='SUSPENSO' from app_clients where id='85000000-0000-4000-8000-000000000003'),'linked registration suspended');
select ok((select status='ATIVO' and plan_amount=350 from app_clients where id='85000000-0000-4000-8000-000000000001'),'payer remains active unchanged');
select is((select to_jsonb(i) from app_payment_invoices i where client_id='85000000-0000-4000-8000-000000000001'),(select data from invoice_snapshot),'existing invoice not changed or cancelled');
select is((private.client_family_summary_data('85000000-0000-4000-8000-000000000001')->>'total_monthly_amount')::numeric,350::numeric,'future family bill excludes member');
select is(pg_temp.pause_family()->>'state','COMPLETED','retry is idempotent');
select is((select count(*)::int from private.family_enrollment_suspensions where family_member_id='85000000-0000-4000-8000-000000000002'),1,'single audit preserves prior state');
select is(public.admin_resume_suspended_enrollment(null,'85000000-0000-4000-8000-000000000002','Synthetic return')->>'state','COMPLETED','existing resume works');
select ok((select not m.classes_suspended and m.billing_paused and s.status='ATIVO' from app_family_members m join students s on s.id=m.student_id where m.id='85000000-0000-4000-8000-000000000002'),'resume does not silently bill');
select set_config('request.jwt.claims','{"sub":"85000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select pg_temp.pause_family()$$,'42501','Sem permissão para suspender aulas.','customer cannot suspend');
select ok(not has_function_privilege('anon','public.admin_suspend_family_enrollment(uuid,timestamptz,text)','EXECUTE') and not has_table_privilege('authenticated','private.family_enrollment_suspensions','UPDATE'),'anonymous operation and audit edits denied');
select * from finish();
rollback;
