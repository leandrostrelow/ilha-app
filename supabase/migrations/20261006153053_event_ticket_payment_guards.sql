-- Explicit privilege boundary, including projects with broad default grants.
revoke all on public.bar_event_ticket_types,public.bar_event_orders,public.bar_event_order_items,public.bar_event_tickets,public.bar_event_activity from anon;
revoke insert,update,delete,truncate,references,trigger on public.bar_event_orders,public.bar_event_order_items,public.bar_event_tickets,public.bar_event_activity from authenticated;
revoke delete,truncate,references,trigger on public.bar_event_ticket_types from authenticated;

create or replace function public.event_reconcile_payment(p_order uuid,p_payment text,p_environment text,p_reference text,p_amount integer,p_status text) returns public.bar_event_orders language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_order public.bar_event_orders; v_next text;
begin
  select * into v_order from public.bar_event_orders where id=p_order for update;
  if not found or nullif(p_payment,'') is null or p_environment is distinct from v_order.provider_environment or p_reference is distinct from 'ilha-event:'||v_order.id::text or p_amount is distinct from v_order.total_cents or (v_order.provider_payment_id is not null and v_order.provider_payment_id is distinct from p_payment) then raise exception 'Pagamento divergente do pedido. Solicite revisão.'; end if;
  v_next:=case when p_status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH') then 'PAID' when p_status='REFUNDED' then 'REFUNDED' when p_status in ('DELETED','CANCELLED') then 'CANCELLED' when p_status in ('PENDING','OVERDUE') then 'PENDING' else 'REVIEW' end;
  if v_order.status='REFUNDED' then v_next:='REFUNDED';
  elsif v_order.status='CANCELLED' and v_next not in ('CANCELLED','REFUNDED') then v_next:='REVIEW';
  elsif v_order.status='PAID' and v_next in ('PENDING','CANCELLED') then v_next:='PAID';
  -- Once seats were released or a payment became ambiguous, repeated notifications
  -- cannot issue tickets automatically. A confirmed refund safely resolves review.
  elsif v_order.status='REVIEW' and v_next<>'REFUNDED' then v_next:='REVIEW'; end if;
  update public.bar_event_orders set provider_payment_id=p_payment,provider_status=p_status,status=v_next,paid_at=case when v_next='PAID' then coalesce(paid_at,now()) else paid_at end,pix_payload=case when v_next in ('CANCELLED','REFUNDED','REVIEW') then null else pix_payload end,pix_image=case when v_next in ('CANCELLED','REFUNDED','REVIEW') then null else pix_image end,updated_at=now() where id=p_order returning * into v_order;
  insert into public.bar_event_activity(event_id,order_id,kind,detail) select v_order.event_id,v_order.id,'PAYMENT_'||v_next,'Situação atualizada pelo Asaas.' where not exists(select 1 from public.bar_event_activity where order_id=p_order and kind='PAYMENT_'||v_next);
  return v_order;
end; $$;
