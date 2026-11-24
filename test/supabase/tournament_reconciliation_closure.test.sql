begin;
create extension if not exists pgtap with schema extensions;
select plan(19);
select set_config('request.jwt.claims','{"role":"service_role"}',true);

insert into public.tournament_athletes(id,source_key,full_name) values
('94000000-0000-4000-8000-000000000001','ci:cancelled-reconciliation','Synthetic cancelled athlete'),
('94000000-0000-4000-8000-000000000002','ci:active-reconciliation','Synthetic active athlete');
insert into public.tournament_registrations(id,tournament_id,category_id,athlete_id,public_name,status,payment_status,total_amount,paid_amount,source,cancelled_at)
select x.id,t.id,c.id,x.athlete,x.name,x.status,'PAID',100,100,'PUBLIC',case when x.status='CANCELLED' then now()-interval '1 day' end
from public.tournaments t join lateral(select id from public.tournament_categories where tournament_id=t.id order by sort_order,id limit 1)c on true
cross join(values
('94000000-0000-4000-8000-000000000011'::uuid,'94000000-0000-4000-8000-000000000001'::uuid,'Synthetic cancelled','CANCELLED'),
('94000000-0000-4000-8000-000000000012'::uuid,'94000000-0000-4000-8000-000000000002'::uuid,'Synthetic active','PENDING')
)x(id,athlete,name,status) where t.slug='ilha-open-2026-teste';
insert into public.tournament_payments(id,tournament_id,registration_id,provider,provider_environment,provider_payment_id,external_reference,billing_type,status,amount,paid_at,next_reconciliation_at)
select x.id,r.tournament_id,r.id,'ASAAS','SANDBOX',x.provider_id,x.external_ref,'PIX','RECEIVED',100,now()-interval '2 days',now()-interval '1 day'
from(values
('94000000-0000-4000-8000-000000000021'::uuid,'94000000-0000-4000-8000-000000000011'::uuid,'pay_ci_closed','ci:closed'),
('94000000-0000-4000-8000-000000000022'::uuid,'94000000-0000-4000-8000-000000000012'::uuid,'pay_ci_active','ci:active')
)x(id,registration_id,provider_id,external_ref) join public.tournament_registrations r on r.id=x.registration_id;
create temporary table before_payment as select status,amount,paid_at,updated_at from tournament_payments where id='94000000-0000-4000-8000-000000000021';
create temporary table before_registration as select cancelled_at from tournament_registrations where id='94000000-0000-4000-8000-000000000011';
create function pg_temp.close_receipt(v timestamptz default null,actor uuid default '10000000-0000-4000-8000-000000000001',reason text default 'Synthetic authorized closure of inactive tournament.') returns jsonb language sql as $$
 select public.close_cancelled_tournament_reconciliation('94000000-0000-4000-8000-000000000021',actor,v,'pay_ci_closed',100,reason);
$$;
select ok(not has_function_privilege('anon','public.close_cancelled_tournament_reconciliation(uuid,uuid,timestamptz,text,numeric,text)','EXECUTE')
 and not has_function_privilege('authenticated','public.close_cancelled_tournament_reconciliation(uuid,uuid,timestamptz,text,numeric,text)','EXECUTE')
 and has_function_privilege('service_role','public.close_cancelled_tournament_reconciliation(uuid,uuid,timestamptz,text,numeric,text)','EXECUTE'),'closure is service-only');
select throws_ok($$select pg_temp.close_receipt(now(),'94000000-0000-4000-8000-000000000099')$$,'42501','Administrador responsável inválido.','unknown actor cannot close');
select throws_ok($$select pg_temp.close_receipt(now(),'10000000-0000-4000-8000-000000000001','short')$$,'22023','Informe o motivo do encerramento.','reason required');
select throws_ok($$select pg_temp.close_receipt(now()-interval '10 days')$$,'P0001','Cobrança alterada durante a conferência.','stale version rejected');
select throws_ok($$select public.close_cancelled_tournament_reconciliation('94000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000001',now(),'pay_ci_active',100,'Synthetic wrong active closure.')$$,'P0001','Somente inscrições canceladas com pagamento preservado podem ser encerradas.','active registration cannot close');
select throws_ok($$select public.close_cancelled_tournament_reconciliation('94000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000001',now(),'pay_ci_closed',200,'Synthetic wrong amount closure.')$$,'P0001','O recebimento não corresponde à conferência.','amount mismatch rejected');

select public.sync_tournament_registration_payment_group('94000000-0000-4000-8000-000000000011','CONFIRMED','PAID',100,now(),null);
select ok((select status='CANCELLED' and payment_status='PAID' and paid_amount=100 and cancelled_at=(select cancelled_at from before_registration) from tournament_registrations where id='94000000-0000-4000-8000-000000000011'),'receipt preserves sporting cancellation and money');
select public.sync_tournament_registration_payment_group('94000000-0000-4000-8000-000000000012','CONFIRMED','PAID',100,now(),null);
select is((select status from tournament_registrations where id='94000000-0000-4000-8000-000000000012'),'CONFIRMED','pending registration still confirms');
select is(pg_temp.close_receipt((select updated_at from before_payment))->>'closed','true','audited closure succeeds');
select ok((select p.status=b.status and p.amount=b.amount and p.paid_at=b.paid_at and p.reconciliation_closed_at is not null and p.next_reconciliation_at is null from tournament_payments p cross join before_payment b where p.id='94000000-0000-4000-8000-000000000021'),'closure only ends periodic reconciliation');
select ok((select count(*)=1 and min(reason)='Synthetic authorized closure of inactive tournament.' from private.tournament_reconciliation_closures where payment_id='94000000-0000-4000-8000-000000000021'),'closure audit contains actor and reason');
select is((select before_state->>'status' from private.tournament_reconciliation_closures where payment_id='94000000-0000-4000-8000-000000000021'),'RECEIVED','audit preserves received status');
select is(pg_temp.close_receipt()->>'already_closed','true','repeated closure idempotent');
select is((select count(*)::integer from private.tournament_reconciliation_closures where payment_id='94000000-0000-4000-8000-000000000021'),1,'retry does not duplicate audit');
update tournament_payments set next_reconciliation_at=now(),updated_at=clock_timestamp() where id='94000000-0000-4000-8000-000000000021';
select ok((select reconciliation_closed_at is not null from tournament_payments where id='94000000-0000-4000-8000-000000000021'),'duplicate receipt cannot reopen closed polling');
update tournament_payments set status='REFUNDED',next_reconciliation_at=now() where id='94000000-0000-4000-8000-000000000021';
select ok((select reconciliation_closed_at is null and next_reconciliation_at is not null from tournament_payments where id='94000000-0000-4000-8000-000000000021'),'later reversal reopens reconciliation');
select throws_ok($$select pg_temp.close_receipt()$$,'P0001','O recebimento não corresponde à conferência.','reversed payment cannot be closed as received');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select pg_temp.close_receipt()$$,'42501','Acesso negado.','direct authenticated closure refused');
select ok(not has_table_privilege('authenticated','private.tournament_reconciliation_closures','INSERT'),'audit cannot be forged by client');
select * from finish();
rollback;
