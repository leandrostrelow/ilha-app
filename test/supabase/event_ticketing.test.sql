-- Run as database owner. Every fixture and simulated payment is rolled back.
begin;
do $$
declare e uuid; l uuid; req uuid:=gen_random_uuid(); o public.bar_event_orders; again public.bar_event_orders; result jsonb; ticket text; admin_id uuid; saved uuid;
begin
  insert into public.bar_ticket_events(slug,event_date,status,sales_state,content) values('qa-ticket-'||gen_random_uuid(),current_date+30,'PUBLICADO','OPEN','{"title":"QA only","time":"19:00","location":"Test"}') returning id into e;
  insert into public.bar_event_ticket_types(event_id,name,price_cents,capacity,active) values(e,'QA lot',12500,2,true) returning id into l;
  select * into o from public.event_reserve_order((select slug from public.bar_ticket_events where id=e),req,repeat('a',64),'hash','{"name":"QA Buyer","email":"qa@example.invalid","cpf":"52998224725","phone":"27999999999"}',jsonb_build_array(jsonb_build_object('ticket_type_id',l,'quantity',2)),jsonb_build_array(jsonb_build_object('ticket_type_id',l,'name','QA One'),jsonb_build_object('ticket_type_id',l,'name','QA Two')),'SANDBOX');
  assert o.total_cents=25000 and o.quantity=2 and o.status='CREATED','server total';
  select * into again from public.event_reserve_order((select slug from public.bar_ticket_events where id=e),req,repeat('a',64),'hash','{}','[]','[]','SANDBOX');
  assert again.id=o.id,'idempotent reservation';
  begin
    perform public.event_reserve_order((select slug from public.bar_ticket_events where id=e),req,repeat('b',64),'hash','{}','[]','[]','SANDBOX');raise exception 'FAILED token mismatch';
  exception when others then if sqlerrm='FAILED token mismatch' then raise; end if;end;
  begin
    perform public.event_reserve_order((select slug from public.bar_ticket_events where id=e),gen_random_uuid(),repeat('a',64),'hash','{}',jsonb_build_array(jsonb_build_object('ticket_type_id',l,'quantity',1)),jsonb_build_array(jsonb_build_object('ticket_type_id',l,'name','Overflow')),'SANDBOX');raise exception 'FAILED capacity';
  exception when others then if sqlerrm='FAILED capacity' then raise; end if;end;
  assert (select held=2 and sold=0 from public.event_inventory(e)),'held seats';
  begin perform public.event_reconcile_payment(o.id,'qa-payment','SANDBOX','ilha-event:'||o.id,1,'RECEIVED');raise exception 'FAILED amount';exception when others then if sqlerrm='FAILED amount' then raise;end if;end;
  begin perform public.event_reconcile_payment(o.id,'qa-payment','PRODUCTION','ilha-event:'||o.id,25000,'RECEIVED');raise exception 'FAILED env';exception when others then if sqlerrm='FAILED env' then raise;end if;end;
  begin perform public.event_reconcile_payment(o.id,'qa-payment','SANDBOX',null,25000,'RECEIVED');raise exception 'FAILED null reference';exception when others then if sqlerrm='FAILED null reference' then raise;end if;end;
  perform public.event_reconcile_payment(o.id,'qa-payment','SANDBOX','ilha-event:'||o.id,25000,'RECEIVED');
  assert (select status='PAID' from public.bar_event_orders where id=o.id),'confirmed';
  perform public.event_reconcile_payment(o.id,'qa-payment','SANDBOX','ilha-event:'||o.id,25000,'PENDING');
  assert (select status='PAID' from public.bar_event_orders where id=o.id),'stale pending cannot erase paid';
  assert (public.event_metrics(e)->>'revenue')::integer=25000,'all-order aggregation';
  select code into ticket from public.bar_event_tickets where order_id=o.id limit 1;
  begin perform public.event_checkin(e,ticket);raise exception 'FAILED anonymous checkin';exception when others then if sqlerrm='FAILED anonymous checkin' then raise;end if;end;
  select id into admin_id from public.profiles where role='admin' and active=true limit 1;
  assert admin_id is not null,'admin test context';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  perform set_config('role','authenticated',true);
  result:=public.event_checkin(e,ticket);assert (result->>'already_checked_in')::boolean=false,'first entry';
  result:=public.event_checkin(e,ticket);assert (result->>'already_checked_in')::boolean=true,'duplicate entry';
  begin perform public.event_checkin(gen_random_uuid(),ticket);raise exception 'FAILED wrong event';exception when others then if sqlerrm='FAILED wrong event' then raise;end if;end;
  begin perform public.event_save((select to_jsonb(ev) from public.bar_ticket_events ev where id=e),jsonb_build_array(jsonb_build_object('id',l,'name','QA lot','price_cents',12500,'capacity',1,'active',true)));raise exception 'FAILED lower capacity';exception when others then if sqlerrm='FAILED lower capacity' then raise;end if;end;
  saved:=public.event_save((select to_jsonb(ev) from public.bar_ticket_events ev where id=e),jsonb_build_array(jsonb_build_object('id',l,'name','QA lot','price_cents',13000,'capacity',2,'active',true)));
  assert saved=e,'save event';assert o.total_cents=25000,'saved order price preserved';
  perform set_config('role','postgres',true);
  perform public.event_reconcile_payment(o.id,'qa-payment','SANDBOX','ilha-event:'||o.id,25000,'REFUNDED');
  perform public.event_reconcile_payment(o.id,'qa-payment','SANDBOX','ilha-event:'||o.id,25000,'RECEIVED');
  assert (select status='REFUNDED' from public.bar_event_orders where id=o.id),'refund finality';
  assert (select held=0 and sold=0 from public.event_inventory(e)),'refund releases seats';
  begin perform public.event_checkin(e,ticket);raise exception 'FAILED refunded entry';exception when others then if sqlerrm='FAILED refunded entry' then raise;end if;end;
  -- Simulate cancellation followed by two late payment observations.
  update public.bar_event_orders set status='CANCELLED' where id=o.id;
  perform public.event_reconcile_payment(o.id,'qa-payment','SANDBOX','ilha-event:'||o.id,25000,'RECEIVED');
  perform public.event_reconcile_payment(o.id,'qa-payment','SANDBOX','ilha-event:'||o.id,25000,'RECEIVED');
  assert (select status='REVIEW' from public.bar_event_orders where id=o.id),'late duplicates cannot reissue released seats';
  assert not has_table_privilege('anon','public.bar_event_orders','select'),'private buyer data';
  assert not has_function_privilege('anon','public.event_reserve_order(text,uuid,text,text,jsonb,jsonb,jsonb,text)','execute'),'no direct guest reservation';
  assert not has_table_privilege('authenticated','public.bar_event_orders','update'),'staff cannot forge paid';
end $$;
rollback;
select 'PASS: totals, stock, idempotency, tamper rejection, payment states, check-in, editing, privacy. Fixtures rolled back.' as result;
