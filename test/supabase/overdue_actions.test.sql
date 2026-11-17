begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values ('83000000-0000-4000-8000-000000000001','overdue@tests.invalid','{"provider":"email","providers":["email"]}','{"app_context":"public"}');
insert into app_clients(id,full_name,email,due_day,status,client_type) values ('83000000-0000-4000-8000-000000000001','Synthetic overdue','overdue@tests.invalid',5,'ATIVO','aluno');
insert into app_monthly_billing_enrollments(client_id,enabled,enabled_at,billing_method) values('83000000-0000-4000-8000-000000000001',true,now(),'CASH');
insert into app_payment_invoices(id,client_id,invoice_month,amount,due_date,status,payment_method) values ('83000000-0000-4000-8000-000000000021','83000000-0000-4000-8000-000000000001','2020-01-01',350,'2020-01-05','VENCIDA','CASH');
-- Reuse the production manual-ledger synchronizer if invoice triggers have created the entry.
insert into financial_transactions(app_payment_invoice_id,type,description,amount,due_date,status,payment_method)
select '83000000-0000-4000-8000-000000000021','RECEITA','Synthetic monthly debt',350,'2020-01-05','VENCIDO','DINHEIRO'
where not exists(select 1 from financial_transactions where app_payment_invoice_id='83000000-0000-4000-8000-000000000021');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"ci-protected-admin@tests.invalid"}',true);
select is(public.admin_resend_overdue_reminder('83000000-0000-4000-8000-000000000021','83000000-0000-4000-8000-000000000031')->>'state','QUEUED','admin can remind a debt older than five days');
select is(public.admin_resend_overdue_reminder('83000000-0000-4000-8000-000000000021','83000000-0000-4000-8000-000000000031')->>'state','QUEUED','retry idempotent');
select throws_ok($$select public.admin_resend_overdue_reminder('83000000-0000-4000-8000-000000000021','83000000-0000-4000-8000-000000000032')$$,'P0001','Um aviso já foi solicitado nos últimos cinco minutos.','rate limited');
insert into public.app_family_members(id,billing_responsible_id,full_name,relationship,monthly_amount,status,birth_date,contact_responsible_name,contact_responsible_phone,reviewed_at)
values('83000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000001','Synthetic dependent','Filho(a)',350,'ATIVO','2015-01-01','Synthetic overdue','27999990001',now());
create temporary table preview as select public.admin_overdue_suspension('83000000-0000-4000-8000-000000000021')->>'version' as version;
select throws_ok($$select public.admin_overdue_suspension('83000000-0000-4000-8000-000000000021',true,'{}','Synthetic suspension reason','stale',true)$$,'P0001','O cadastro mudou. Reabra a operação antes de continuar.','stale version rejected before cancellation');
select throws_ok($$select public.admin_overdue_suspension('83000000-0000-4000-8000-000000000021',true,'{}','Synthetic suspension reason',(select version from preview),false)$$,'P0001','Para suspender o responsável pagador, selecione toda a família. Dependentes podem ser suspensos individualmente.','family scope checked before cancelling');
select is(public.admin_overdue_suspension('83000000-0000-4000-8000-000000000021',true,array['83000000-0000-4000-8000-000000000002']::uuid[],'Synthetic suspension reason',version,true)->>'state','COMPLETED','cancel manual invoice and suspend atomically') from preview;
select ok((select i.status='CANCELADA' and f.status='CANCELADO' and c.status='SUSPENSO' and not e.enabled and i.paid_at is null from app_payment_invoices i join financial_transactions f on f.app_payment_invoice_id=i.id join app_clients c on c.id=i.client_id join app_monthly_billing_enrollments e on e.client_id=c.id where i.id='83000000-0000-4000-8000-000000000021'),'financial records retained and future billing disabled');
select is(public.admin_overdue_suspension('83000000-0000-4000-8000-000000000021',true,array['83000000-0000-4000-8000-000000000002']::uuid[],'Synthetic suspension reason',version,true)->>'state','COMPLETED','repeat suspension idempotent') from preview;
select ok(not public.monthly_payment_notification_is_current((select notification_id from private.manual_overdue_reminders where invoice_id='83000000-0000-4000-8000-000000000021')),'cancelled debt no longer eligible for push');
select ok((select m.billing_paused and m.classes_suspended and s.status='INATIVO' from app_family_members m join students s on s.id=m.student_id where m.id='83000000-0000-4000-8000-000000000002'),'dependent removed from active roster while relationship retained');
select is(public.admin_resume_suspended_enrollment('83000000-0000-4000-8000-000000000001',null,'Synthetic return to classes')->>'state','COMPLETED','resume preserves history');
select ok((select c.status='ATIVO' and not e.enabled from app_clients c join app_monthly_billing_enrollments e on e.client_id=c.id where c.id='83000000-0000-4000-8000-000000000001'),'resume does not silently enable billing');
select ok((select not m.classes_suspended and m.billing_paused and s.status='ATIVO' from app_family_members m join students s on s.id=m.student_id where m.id='83000000-0000-4000-8000-000000000002'),'dependent resume leaves billing pause for explicit review');
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.admin_overdue_suspension('83000000-0000-4000-8000-000000000021')$$,'42501','Sem permissão para suspender aulas.','customer cannot suspend');
select throws_ok($$select public.admin_resend_overdue_reminder('83000000-0000-4000-8000-000000000021','83000000-0000-4000-8000-000000000033')$$,'42501','Seu acesso não permite reenviar cobranças.','customer cannot send reminder');
select * from finish();rollback;
