begin;
-- Everything, including pg_net jobs, rolls back. No email/provider is contacted.
do $test$
declare e uuid; t uuid; o public.bar_event_orders; job public.bar_event_email_deliveries;
begin
 if has_table_privilege('anon','public.bar_event_email_deliveries','SELECT') or has_table_privilege('authenticated','public.bar_event_delivery_config','SELECT') then raise exception 'email data exposed'; end if;
 if has_function_privilege('authenticated','public.event_claim_ticket_email(uuid)','EXECUTE') or public.event_email_dispatch_allowed('invalid') then raise exception 'dispatch authentication bypass'; end if;
 insert into public.bar_ticket_events(slug,event_date,status,sales_state,content) values('qa-delivery-'||gen_random_uuid(),'2026-10-29','PUBLICADO','OPEN','{"title":"QA rollback","time":"18:30"}') returning id into e;
 insert into public.bar_event_ticket_types(event_id,name,price_cents,active,min_age) values(e,'Integral',19500,true,15) returning id into t;
 select * into o from public.event_reserve_order((select slug from public.bar_ticket_events where id=e),gen_random_uuid(),repeat('a',64),'qa','{"name":"QA","cpf":"52998224725","email":"qa@example.invalid","phone":"27999999999"}',jsonb_build_array(jsonb_build_object('ticket_type_id',t,'quantity',1)),jsonb_build_array(jsonb_build_object('ticket_type_id',t,'name','QA Adulto','age',30)),'SANDBOX');
 if exists(select 1 from public.bar_event_email_deliveries where order_id=o.id) then raise exception 'email queued before paid'; end if;
 perform public.event_reconcile_payment(o.id,'qa-delivery','SANDBOX','ilha-event:'||o.id,19500,'CONFIRMED');
 perform public.event_reconcile_payment(o.id,'qa-delivery','SANDBOX','ilha-event:'||o.id,19500,'CONFIRMED');
 if (select count(*) from public.bar_event_email_deliveries where order_id=o.id)<>1 then raise exception 'outbox duplicate'; end if;
 select * into job from public.event_claim_ticket_email(o.id);
 if job.status<>'SENDING' or job.attempts<>1 then raise exception 'claim failed'; end if;
 if exists(select 1 from public.event_claim_ticket_email(o.id)) then raise exception 'concurrent lease bypass'; end if;
 if public.event_finish_ticket_email(o.id,gen_random_uuid(),'wrong',null) then raise exception 'wrong lease allowed'; end if;
 if not public.event_finish_ticket_email(o.id,job.lease_token,'fixture-message',null) then raise exception 'finish failed'; end if;
 if exists(select 1 from public.event_claim_ticket_email(o.id)) then raise exception 'sent email reclaimed'; end if;
 update public.bar_event_email_deliveries set status='FAILED',next_attempt_at=now(),first_attempt_at=now()-interval '24 hours' where order_id=o.id;
 perform public.event_claim_ticket_email(o.id);
 if (select status from public.bar_event_email_deliveries where order_id=o.id)<>'REVIEW' then raise exception 'idempotency expiry unsafe'; end if;
 update public.bar_event_orders set status='REFUNDED' where id=o.id;
 update public.bar_event_email_deliveries set status='PENDING',first_attempt_at=null where order_id=o.id;
 perform public.event_claim_ticket_email(o.id);
 if (select status from public.bar_event_email_deliveries where order_id=o.id)<>'CANCELLED' then raise exception 'refunded email not blocked'; end if;
end $test$;
rollback;
