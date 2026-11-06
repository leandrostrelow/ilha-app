begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table cycle as select date_trunc('month',now() at time zone 'America/Sao_Paulo')::date as m;
insert into app_plans(id,code,name,type,amount,weekly_lessons,default_due_day,active) values
 ('79000000-0000-4000-8000-000000000010','ci-reissue','Synthetic reissue','aluno',250,1,5,true);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values ('79000000-0000-4000-8000-000000000001','reissue1@tests.invalid','{"provider":"email","providers":["email"]}','{"app_context":"public"}');
insert into app_clients(id,full_name,email,phone,cpf,official_plan_id,official_plan_code,official_plan_name,plan_amount,weekly_lessons,due_day,status,client_type,registration_completed_at,email_verified_at)
values ('79000000-0000-4000-8000-000000000001','Synthetic reissue 1','reissue1@tests.invalid','27999990001','11144477735','79000000-0000-4000-8000-000000000010','ci-reissue','Synthetic reissue',250,1,5,'ATIVO','aluno',now(),now());
insert into app_monthly_billing_enrollments(client_id,enabled,first_due_date,billing_method,enabled_at) select '79000000-0000-4000-8000-000000000001',true,m-1,'ASAAS_PIX',now() from cycle;
insert into app_payment_invoices(id,client_id,invoice_month,amount,due_date,status,provider_status) select '79000000-0000-4000-8000-000000000021','79000000-0000-4000-8000-000000000001',m,250,m+2,'CANCELADA','CANCELLED' from cycle;
insert into app_invoice_provider_payments(invoice_id,provider_environment,provider_customer_id,provider_payment_id,external_reference,expected_amount,status,safe_snapshot)
values ('79000000-0000-4000-8000-000000000021','SANDBOX','cus_1','pay_1','ilha-monthly-invoice:79000000-0000-4000-8000-000000000021',250,'CANCELLED','{}');
select private.sync_app_invoice_financial_transaction('79000000-0000-4000-8000-000000000021','CANCELLED',null);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values ('79000000-0000-4000-8000-000000000002','reissue2@tests.invalid','{"provider":"email","providers":["email"]}','{"app_context":"public"}');
insert into app_clients(id,full_name,email,phone,cpf,official_plan_id,official_plan_code,official_plan_name,plan_amount,weekly_lessons,due_day,status,client_type,registration_completed_at,email_verified_at)
values ('79000000-0000-4000-8000-000000000002','Synthetic reissue 2','reissue2@tests.invalid','27999990002','52998224725','79000000-0000-4000-8000-000000000010','ci-reissue','Synthetic reissue',250,1,5,'ATIVO','aluno',now(),now());
insert into app_monthly_billing_enrollments(client_id,enabled,first_due_date,billing_method,enabled_at) select '79000000-0000-4000-8000-000000000002',true,m-1,'ASAAS_PIX',now() from cycle;
insert into app_payment_invoices(id,client_id,invoice_month,amount,due_date,status,provider_status) select '79000000-0000-4000-8000-000000000022','79000000-0000-4000-8000-000000000002',m,250,m+2,'AGUARDANDO','REVIEW_REQUIRED' from cycle;
insert into app_invoice_provider_payments(invoice_id,provider_environment,provider_customer_id,provider_payment_id,external_reference,expected_amount,status,safe_snapshot)
values ('79000000-0000-4000-8000-000000000022','SANDBOX','cus_2','pay_2','ilha-monthly-invoice:79000000-0000-4000-8000-000000000022',250,'REVIEW_REQUIRED','{}');
select private.sync_app_invoice_financial_transaction('79000000-0000-4000-8000-000000000022','REVIEW_REQUIRED',null);
insert into private.monthly_invoice_receipts(invoice_id,requested_by,method,received_on,amount,claim_until,reversed_at) values ('79000000-0000-4000-8000-000000000022','79000000-0000-4000-8000-000000000002','CLUB_PIX',current_date-8,250,now()-interval '1 minute',now());
insert into private.monthly_receipt_reversal_reviews(invoice_id,actor_id,reason,before_state,remote_snapshot) values ('79000000-0000-4000-8000-000000000022','79000000-0000-4000-8000-000000000002','Synthetic reversal before reissue','{"original_paid_at":"2020-01-01"}','{}');
select public.record_historical_club_monthly_receipt('79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000002',(m-interval '1 month')::date,230,(m-interval '1 month')::date+4,(m-interval '1 month')::date+5,'Synthetic prior month receipt remains intact.') from cycle;
create function pg_temp.reissue(n int,v text default null,proof jsonb default null,checked timestamptz default null,newday int default 4) returns jsonb language sql as $$
 select public.prepare_audited_monthly_reissue(('79000000-0000-4000-8000-00000000002'||n)::uuid,('79000000-0000-4000-8000-00000000000'||n)::uuid,250,m,m+2,m+newday,'Synthetic audited replacement preserving history.',v,proof,checked) from cycle;
$$;
create temporary table evidence as select n,pg_temp.reissue(n)->>'version' as v,jsonb_build_object('payment',jsonb_build_object('id','pay_'||n,'customer','cus_'||n,'external_reference','ilha-monthly-invoice:79000000-0000-4000-8000-00000000002'||n,'value',250,'due_date',m+2,'billing_type','PIX','status','OVERDUE','deleted',true)) as proof from cycle cross join generate_series(1,2) n;
select pg_temp.reissue(n,v,proof,clock_timestamp()) from evidence order by n;
create temporary table target as select new_invoice_id as id from private.monthly_invoice_reissues where old_invoice_id='79000000-0000-4000-8000-000000000022';
select set_config('ilha.monthly_billing_write','1',true);
update app_invoice_provider_payments set status='FAILED',last_error='Synthetic invalid_dueDate refusal' where invoice_id=(select id from target);
update app_payment_invoices set provider_status='FAILED',status='ABERTA' where id=(select id from target);
select private.sync_app_invoice_financial_transaction((select id from target),'FAILED',null);
create function pg_temp.reschedule(v text default null,proof jsonb default null,checked timestamptz default null,newdate date default (date_trunc('month',now() at time zone 'America/Sao_Paulo')+interval '1 month-1 day')::date) returns jsonb language sql as $$
 select public.prepare_failed_reissue_reschedule(id,'79000000-0000-4000-8000-000000000002',250,m,m+4,newdate,'Synthetic authorized extension after refusal.',v,proof,checked) from target cross join cycle;
$$;
update app_invoice_provider_payments set provider_payment_id='pay_must_block' where invoice_id=(select id from target);
select throws_ok($$select pg_temp.reschedule()$$,'P0001','Somente substituta recusada, sem cobrança remota nem recebimento, pode ser reagendada.','remote binding blocks reschedule');
update app_invoice_provider_payments set provider_payment_id=null where invoice_id=(select id from target);
update app_payment_invoices set paid_at=now() where id=(select id from target);
select throws_ok($$select pg_temp.reschedule()$$,'P0001','Somente substituta recusada, sem cobrança remota nem recebimento, pode ser reagendada.','paid invoice blocks reschedule');
update app_payment_invoices set paid_at=null where id=(select id from target);
create temporary table absence as select pg_temp.reschedule()->>'version' as v,jsonb_build_object('externalReference','ilha-monthly-invoice:'||id,'environment','SANDBOX','totalCount',0,'hasMore',false,'data','[]'::jsonb) as proof from target;
select is(pg_temp.reschedule()->>'state','CHECK_ABSENCE','inspect without changing failed invoice');
select throws_ok($$select pg_temp.reschedule(null,null,null,(now() at time zone 'America/Sao_Paulo')::date-1)$$,'P0001','Use nova data não vencida dentro da competência atual.','reject past due extension');
select throws_ok($$select pg_temp.reschedule('stale',(select proof from absence),clock_timestamp())$$,'P0001','Dados alterados durante a conferência; consulte novamente.','stale version rejected');
select throws_ok($$select pg_temp.reschedule((select v from absence),(select jsonb_set(proof,'{totalCount}','1') from absence),clock_timestamp())$$,'P0001','Ausência de cobrança remota não comprovada.','existing remote blocks replacement');
select is(pg_temp.reschedule(v,proof,clock_timestamp())->>'state','READY_DISPATCH','create authorized replacement') from absence;
select is(pg_temp.reschedule()->>'invoiceId',(select new_invoice_id::text from private.monthly_reissue_reschedules),'retry reuses same invoice');
select ok((select i.status='CANCELADA' and i.due_date=m+4 and i.superseded_at is not null and f.status='CANCELADO' from target join app_payment_invoices i on i.id=target.id join financial_transactions f on f.app_payment_invoice_id=i.id cross join cycle),'failed original date and ledger preserved');
select ok((select i.due_date=(date_trunc('month',now() at time zone 'America/Sao_Paulo')+interval '1 month-1 day')::date and i.amount=250 and i.paid_at is null and p.status='READY' and f.due_date=i.due_date from private.monthly_reissue_reschedules a join app_payment_invoices i on i.id=a.new_invoice_id join app_invoice_provider_payments p on p.invoice_id=i.id join financial_transactions f on f.app_payment_invoice_id=i.id),'invoice provider and ledger agree without payment');
select is((select count(*)::int from app_payment_invoices where client_id='79000000-0000-4000-8000-000000000002' and invoice_month=(select m from cycle) and superseded_at is null),1,'one active invoice');
select ok((select status='PAGA' and amount=230 from app_payment_invoices where client_id='79000000-0000-4000-8000-000000000002' and invoice_month=(select (m-interval '1 month')::date from cycle)),'paid prior month untouched');
select ok((select reversed_at is not null and completed_at is null from private.monthly_invoice_receipts where invoice_id='79000000-0000-4000-8000-000000000022'),'reversed receipt intact');
select ok(not has_function_privilege('authenticated','public.prepare_failed_reissue_reschedule(uuid,uuid,numeric,date,date,date,text,text,jsonb,timestamptz)','EXECUTE') and not has_table_privilege('service_role','private.monthly_reissue_reschedules','UPDATE'),'audit immutable and service-only');
select * from finish(); rollback;
