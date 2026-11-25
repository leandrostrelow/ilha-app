begin;
create extension if not exists pgtap with schema extensions;
select plan(34);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('ilha.monthly_billing_write','1',true);

-- Only synthetic fixtures, in the disposable CI database. No provider request.
create function pg_temp.person(n integer) returns uuid language sql immutable as $$
 select ('96000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.invoice(n integer) returns uuid language sql immutable as $$
 select ('96000000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.today() returns date language sql stable as $$
 select (now() at time zone 'America/Sao_Paulo')::date;
$$;
create function pg_temp.notification(n integer) returns uuid language sql stable as $$
 select id from public.app_client_notifications
 where event_type='FATURA_MENSAL_LEMBRETE' and user_id=pg_temp.person(n)
   and dedupe_key like 'monthly-reminder:%' order by created_at desc limit 1;
$$;
create function pg_temp.target(n integer) returns boolean language sql stable as $$
 select exists(select 1 from private.monthly_payment_reminder_targets(pg_temp.today())
   where invoice_id=pg_temp.invoice(n));
$$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select pg_temp.person(n),'app-reminder-'||n||'@tests.invalid',
 '{"provider":"email","providers":["email"]}','{"app_context":"public"}'
from generate_series(1,16)n;
insert into public.app_clients(id,full_name,email,due_day,status,client_type)
select pg_temp.person(n),'Synthetic app reminder '||n,'app-reminder-'||n||'@tests.invalid',
 10,'ATIVO','aluno' from generate_series(1,16)n;
insert into public.app_monthly_billing_enrollments(client_id,enabled,enabled_at,billing_method)
select pg_temp.person(n),true,now(),case when n=16 then 'CASH' else 'ASAAS_PIX' end
from generate_series(1,16)n;
insert into public.app_payment_invoices(id,client_id,invoice_month,amount,due_date,status,provider_status,pix_payload,pix_expires_at,payment_method)
select pg_temp.invoice(n),pg_temp.person(n),date_trunc('month',pg_temp.today())::date,100,
 pg_temp.today()+case when n<=13 then n-7 when n=16 then -30 else 0 end,
 'AGUARDANDO',case when n=16 then null else 'PENDING' end,
 case when n=16 then null else 'SYNTHETIC-NOT-A-PAYMENT' end,now()+interval '2 days',
 case when n=16 then 'CASH' else 'PIX' end from generate_series(1,16)n;
insert into public.app_family_members(id,billing_responsible_id,member_client_id,full_name,relationship,monthly_amount,status,birth_date,contact_responsible_name,contact_responsible_phone,reviewed_at)
select ('96000000-0000-4000-8002-'||lpad(n::text,12,'0'))::uuid,pg_temp.person(7),pg_temp.person(n),
 'Synthetic dependent '||n,'Filho(a)',100,case when n=14 then 'ATIVO' else 'PENDENTE' end,
 date '2015-01-01','Synthetic payer','27999990007',case when n=14 then now() else null end
from generate_series(14,15)n;
-- Test the family exclusion independently of enrollment changes from triggers.
update public.app_monthly_billing_enrollments set enabled=true where client_id in(pg_temp.person(14),pg_temp.person(15));
create temporary table policy_before as select public.get_monthly_whatsapp_policy() as value;
create temporary table invoices_before as select jsonb_agg(to_jsonb(i) order by id) as value
from public.app_payment_invoices i where client_id in(select pg_temp.person(n) from generate_series(1,16)n);

select ok(not has_function_privilege('anon','public.enqueue_due_monthly_payment_reminders()','EXECUTE')
 and not has_function_privilege('authenticated','public.enqueue_due_monthly_payment_reminders()','EXECUTE')
 and has_function_privilege('service_role','public.enqueue_due_monthly_payment_reminders()','EXECUTE'),'scheduler remains service-only');
select ok(not has_function_privilege('authenticated','private.monthly_payment_reminder_targets(date)','EXECUTE')
 and not has_function_privilege('service_role','private.monthly_payment_reminder_targets(date)','EXECUTE'),'target selector is private');
select ok(not has_function_privilege('anon','private.monthly_payment_reminder_message(date,numeric,date)','EXECUTE')
 and not has_function_privilege('authenticated','public.scheduled_monthly_payment_notification_is_current(uuid)','EXECUTE'),'message helper and internal dispatch validation are not public RPCs');
select is((select array_agg(due_date-pg_temp.today() order by due_date)
 from private.monthly_payment_reminder_targets(pg_temp.today()) where client_id in(select pg_temp.person(n) from generate_series(1,13)n)),
 array[-3,-1,0,1,3],'exactly five reminder milestones, no other day in the thirteen-day window');
select ok(not pg_temp.target(14) and not pg_temp.target(15) and pg_temp.target(7),'only payer receives, excluding active and pending family dependents');
select is(public.enqueue_due_monthly_payment_reminders(),5,'one in-app notification per eligible payer');
select is(public.enqueue_due_monthly_payment_reminders(),0,'cron retry cannot duplicate a payer/cycle/day notification');
select is((select count(*)::integer from public.app_client_notification_dispatches d
 join public.app_client_notifications n on n.id=d.notification_id
 where n.user_id in(select pg_temp.person(n) from generate_series(1,16)n) and n.event_type='FATURA_MENSAL_LEMBRETE'),5,'five notifications enter the existing push dispatch queue');
select is((select title from public.app_client_notifications where id=pg_temp.notification(10)),'Sua mensalidade vence em 3 dias','D−3 message');
select is((select title from public.app_client_notifications where id=pg_temp.notification(8)),'Sua mensalidade vence amanhã','D−1 message');
select is((select title from public.app_client_notifications where id=pg_temp.notification(7)),'Sua mensalidade vence hoje','D0 message');
select is((select title from public.app_client_notifications where id=pg_temp.notification(6)),'Sua mensalidade venceu ontem','D+1 message');
select is((select title from public.app_client_notifications where id=pg_temp.notification(4)),'Sua mensalidade venceu há 3 dias','D+3 message');
select ok((select body like '%R$ 100,00%' and body like '%O pagamento ainda está em aberto.%'
 and link_url='/?view=payments&invoice='||pg_temp.invoice(4)::text from public.app_client_notifications where id=pg_temp.notification(4)),
 'overdue message gives amount and opens the matching payment');
select ok((select bool_and(public.monthly_payment_notification_is_current(pg_temp.notification(n))) from unnest(array[4,6,7,8,10])n),
 'public dispatcher wrapper accepts all five fresh scheduled reminders');
select is(public.get_monthly_whatsapp_policy(),(select value from policy_before),'app schedule does not change the WhatsApp policy');
select is((select jsonb_agg(to_jsonb(i) order by id) from public.app_payment_invoices i
 where client_id in(select pg_temp.person(n) from generate_series(1,16)n)),(select value from invoices_before),
 'enqueue does not change invoices, amounts, due dates or payments');

-- Changes after enqueue must suppress the already-queued push too.
update public.app_payment_invoices set status='PAGA',paid_at=now(),provider_status='RECEIVED' where id=pg_temp.invoice(7);
select ok(not pg_temp.target(7) and not public.monthly_payment_notification_is_current(pg_temp.notification(7)),'paid invoice stops queued reminders');
update public.app_payment_invoices set status='CANCELADA' where id=pg_temp.invoice(8);
select ok(not pg_temp.target(8) and not public.monthly_payment_notification_is_current(pg_temp.notification(8)),'cancelled invoice stops queued reminders');
update public.app_payment_invoices set provider_status='REVIEW_REQUIRED' where id=pg_temp.invoice(10);
select ok(not pg_temp.target(10) and not public.monthly_payment_notification_is_current(pg_temp.notification(10)),'invoice under review stops queued reminders');
update public.app_payment_invoices set due_date=pg_temp.today()+1 where id=pg_temp.invoice(6);
select ok(pg_temp.target(6) and not public.monthly_payment_notification_is_current(pg_temp.notification(6)),
 'moving due date between allowed milestones rejects the old wording');
update public.app_payment_invoices set amount=120 where id=pg_temp.invoice(4);
select ok(pg_temp.target(4) and not public.monthly_payment_notification_is_current(pg_temp.notification(4)),
 'amount change rejects the queued obsolete amount');

-- Restore one fixture for independent guard tests, within this rollback only.
update public.app_payment_invoices set status='AGUARDANDO',paid_at=null,provider_status='PENDING' where id=pg_temp.invoice(7);
update public.app_monthly_billing_enrollments set enabled=false where client_id=pg_temp.person(7);
select ok(not pg_temp.target(7),'disabled enrollment has no reminder');
update public.app_monthly_billing_enrollments set enabled=true where client_id=pg_temp.person(7);
update public.app_clients set status='SUSPENSO' where id=pg_temp.person(7);
select ok(not pg_temp.target(7),'suspended payer has no reminder');
update public.app_clients set status='ATIVO' where id=pg_temp.person(7);
update public.app_payment_invoices set pix_expires_at=now()-interval '1 minute' where id=pg_temp.invoice(7);
select ok(not pg_temp.target(7),'expired Pix is not sent for collection');
update public.app_payment_invoices set pix_expires_at=now()+interval '2 days',pix_payload=' ' where id=pg_temp.invoice(7);
select ok(not pg_temp.target(7),'missing Pix is not sent for collection');
update public.app_payment_invoices set pix_payload='SYNTHETIC-NOT-A-PAYMENT' where id=pg_temp.invoice(7);
insert into public.app_invoice_provider_payments(invoice_id,provider_environment,external_reference,expected_amount,status)
values(pg_temp.invoice(7),'SANDBOX','ilha-monthly-invoice:'||pg_temp.invoice(7)::text,100,'REVIEW_REQUIRED');
select ok(not pg_temp.target(7),'provider review blocks even an older payable invoice snapshot');
update public.app_invoice_provider_payments set status='PENDING' where invoice_id=pg_temp.invoice(7);
insert into private.monthly_invoice_receipts(invoice_id,requested_by,method,received_on,amount)
values(pg_temp.invoice(7),'10000000-0000-4000-8000-000000000001','CLUB_PIX',pg_temp.today(),100);
select ok(not pg_temp.target(7),'manual receipt in progress pauses scheduled collection');
update private.monthly_invoice_receipts set reversed_at=now() where invoice_id=pg_temp.invoice(7);
select ok(pg_temp.target(7),'reversed receipt alone does not hide a currently payable invoice');
select set_config('ilha.invoice_receipt_write','1',true);
update public.app_payment_invoices set received_on=pg_temp.today() where id=pg_temp.invoice(7);
select ok(not pg_temp.target(7),'registered received date blocks an inconsistent open snapshot');
update public.app_payment_invoices set received_on=null where id=pg_temp.invoice(7);
insert into public.app_client_notifications(user_id,title,body,link_url,event_type,dedupe_key)
select pg_temp.person(7),m.title,m.body,'/?view=payments&invoice='||pg_temp.invoice(7)::text,
 'FATURA_MENSAL_LEMBRETE','monthly-reminder:'||pg_temp.person(7)::text||':'||date_trunc('month',pg_temp.today())::date::text||':'||(pg_temp.today()-1)::text
from private.monthly_payment_reminder_message(pg_temp.today(),100,pg_temp.today())m;
select ok(not public.monthly_payment_notification_is_current((select id from public.app_client_notifications
 where dedupe_key='monthly-reminder:'||pg_temp.person(7)::text||':'||date_trunc('month',pg_temp.today())::date::text||':'||(pg_temp.today()-1)::text)),
 'previous-day queue cannot send today');
select is((select title from private.monthly_payment_reminder_message(date '2030-01-01',100,date '2029-12-29')),
 'Sua mensalidade vence em 3 dias','calendar arithmetic crosses month and year boundaries');

select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"ci-protected-admin@tests.invalid"}',true);
select is(public.admin_resend_overdue_reminder(pg_temp.invoice(16),'96000000-0000-4000-8003-000000000016')->>'state',
 'QUEUED','explicit administrative reminder outside automatic days is preserved');
select ok(public.monthly_payment_notification_is_current((select notification_id from private.manual_overdue_reminders where invoice_id=pg_temp.invoice(16))),
 'public wrapper still accepts a valid explicitly requested manual reminder');
select * from finish();
rollback;
