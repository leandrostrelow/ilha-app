begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('81000000-0000-4000-8000-000000000001','family-pause@tests.invalid','{"provider":"email","providers":["email"]}','{"app_context":"public"}');
insert into public.app_clients(id,full_name,email,phone,cpf,plan_amount,weekly_lessons,due_day,status,client_type,registration_completed_at,email_verified_at)
values('81000000-0000-4000-8000-000000000001','Synthetic pause payer','family-pause@tests.invalid','27999990001','11144477735',350,2,5,'ATIVO','aluno',now(),now());
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"ci-protected-admin@tests.invalid"}',true);
insert into public.app_family_members(id,billing_responsible_id,full_name,relationship,monthly_amount,status,birth_date)
values('81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','Synthetic dependent','Filho(a)',350,'ATIVO','2015-01-01');
create function pg_temp.set_pause(paused boolean, version timestamptz default null) returns jsonb language sql as $$
 select public.admin_set_family_billing_paused(id,paused,coalesce(version,updated_at),'Synthetic temporary billing pause')
 from public.app_family_members where id='81000000-0000-4000-8000-000000000002';
$$;
select public.admin_authorize_family_billing(id,updated_at) from app_family_members where id='81000000-0000-4000-8000-000000000002';
select public.admin_generate_family_invoice('81000000-0000-4000-8000-000000000001','2026-10-01','2026-10-05');
select is((select amount from app_payment_invoices where client_id='81000000-0000-4000-8000-000000000001' and invoice_month='2026-10-01'),700::numeric,'initial family invoice includes both');
select is((pg_temp.set_pause(true)->>'billing_paused')::boolean,true,'pause succeeds');
select is((select amount from private.monthly_billing_candidates('2027-01-01','81000000-0000-4000-8000-000000000001')),350::numeric,'automatic billing preview excludes paused dependent');
select is((private.client_family_summary_data('81000000-0000-4000-8000-000000000001')->>'total_monthly_amount')::numeric,350::numeric,'client summary excludes paused dependent');
select ok((select status='ATIVO' and monthly_amount=350 and billing_paused from app_family_members where id='81000000-0000-4000-8000-000000000002'),'contract price and active relationship preserved');
select is((select amount from app_payment_invoices where client_id='81000000-0000-4000-8000-000000000001' and invoice_month='2026-10-01'),700::numeric,'existing invoice untouched');
select public.admin_generate_family_invoice('81000000-0000-4000-8000-000000000001','2026-11-01','2026-11-05');
select is((select amount from app_payment_invoices where client_id='81000000-0000-4000-8000-000000000001' and invoice_month='2026-11-01'),350::numeric,'new invoice excludes paused member');
select is((select count(*)::int from app_family_invoice_items f join app_payment_invoices i on i.id=f.invoice_id where i.client_id='81000000-0000-4000-8000-000000000001' and i.invoice_month='2026-11-01' and f.item_type='MEMBRO'),0,'paused dependent absent from new invoice snapshot');
select throws_ok($$select pg_temp.set_pause(false,'2000-01-01')$$,'40001','O cadastro mudou. Reabra a ficha e confira o valor novamente.','stale version blocked');
select is((pg_temp.set_pause(false)->>'billing_paused')::boolean,false,'resume succeeds');
select is((select amount from private.monthly_billing_candidates('2027-01-01','81000000-0000-4000-8000-000000000001')),700::numeric,'automatic billing preview restores original price');
select public.admin_generate_family_invoice('81000000-0000-4000-8000-000000000001','2026-12-01','2026-12-05');
select is((select amount from app_payment_invoices where client_id='81000000-0000-4000-8000-000000000001' and invoice_month='2026-12-01'),700::numeric,'resumed member restores contracted amount for next invoice');
select is((select count(*)::int from private.family_billing_pause_audit where family_member_id='81000000-0000-4000-8000-000000000002'),2,'both transitions audited');
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select pg_temp.set_pause(true)$$,'42501','Seu acesso não permite pausar cobrança familiar.','customer cannot pause financial billing');
select ok(not has_function_privilege('anon','public.admin_set_family_billing_paused(uuid,boolean,timestamptz,text)','EXECUTE') and not has_table_privilege('authenticated','private.family_billing_pause_audit','UPDATE'),'anonymous RPC and audit modification blocked');
select * from finish();
rollback;
