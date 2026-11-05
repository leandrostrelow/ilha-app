-- Age-based ticket pricing; zero-price guests count toward shared event capacity.
alter table public.bar_ticket_events add column capacity_total integer check(capacity_total between 1 and 100000);
alter table public.bar_event_ticket_types drop constraint bar_event_ticket_types_price_cents_check;
alter table public.bar_event_ticket_types add constraint bar_event_ticket_types_price_cents_check check(price_cents between 0 and 10000000);
alter table public.bar_event_ticket_types add column min_age integer check(min_age between 0 and 120), add column max_age integer check(max_age between 0 and 120), add constraint event_age_range check(min_age is null or max_age is null or min_age<=max_age);
alter table public.bar_event_orders drop constraint bar_event_orders_total_cents_check;
alter table public.bar_event_orders add constraint bar_event_orders_total_cents_check check(total_cents>=0);
alter table public.bar_event_tickets add column attendee_age integer check(attendee_age between 0 and 120);
CREATE OR REPLACE FUNCTION public.event_save(p_event jsonb, p_types jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_id uuid; v_current public.bar_ticket_events; v_type jsonb; v_type_id uuid; v_seen uuid[]:='{}';
begin
  if not public.has_bar_permission('bar.events') then raise exception 'Acesso não autorizado.'; end if;
  if jsonb_typeof(p_types)<>'array' or jsonb_array_length(p_types)>30 then raise exception 'Revise os lotes.'; end if;
  v_id:=nullif(p_event->>'id','')::uuid;
  if v_id is null then
    insert into public.bar_ticket_events(slug,event_date,status,content,created_by,max_per_order,capacity_total)
    values(p_event->>'slug',(p_event->>'event_date')::date,'RASCUNHO',p_event->'content',auth.uid(),coalesce((p_event->>'max_per_order')::integer,10),nullif(p_event->>'capacity_total','')::integer) returning id into v_id;
  else
    select * into v_current from public.bar_ticket_events where id=v_id for update;
    if not found then raise exception 'Evento não encontrado.'; end if;
    if v_current.updated_at is distinct from (p_event->>'updated_at')::timestamptz then raise exception 'Outra pessoa editou este evento. Atualize antes de salvar.'; end if;
    update public.bar_ticket_events set slug=p_event->>'slug',event_date=(p_event->>'event_date')::date,content=p_event->'content',max_per_order=coalesce((p_event->>'max_per_order')::integer,10),capacity_total=nullif(p_event->>'capacity_total','')::integer,updated_at=now() where id=v_id;
  end if;
  if nullif(p_event->>'capacity_total','')::integer < coalesce((select sum(quantity) from public.bar_event_orders where event_id=v_id and status not in ('CANCELLED','REFUNDED')),0) then raise exception 'O limite total não pode ser menor que os ingressos vendidos ou reservados.'; end if;
  for v_type in select * from jsonb_array_elements(p_types) loop
    v_type_id:=coalesce(nullif(v_type->>'id','')::uuid,gen_random_uuid());
    if exists(select 1 from public.bar_event_ticket_types where id=v_type_id and event_id<>v_id) then raise exception 'Lote de outro evento.'; end if;
    if nullif(v_type->>'capacity','') is not null and (v_type->>'capacity')::integer < coalesce((select sum(i.quantity) from public.bar_event_order_items i join public.bar_event_orders o on o.id=i.order_id where i.ticket_type_id=v_type_id and o.status not in ('CANCELLED','REFUNDED')),0) then raise exception 'A capacidade não pode ser menor que as vagas já vendidas ou reservadas.'; end if;
    insert into public.bar_event_ticket_types(id,event_id,name,description,price_cents,capacity,sales_start,sales_end,active,sort_order,min_age,max_age)
    values(v_type_id,v_id,v_type->>'name',coalesce(v_type->>'description',''),nullif(v_type->>'price_cents','')::integer,nullif(v_type->>'capacity','')::integer,nullif(v_type->>'sales_start','')::timestamptz,nullif(v_type->>'sales_end','')::timestamptz,coalesce((v_type->>'active')::boolean,false),coalesce((v_type->>'sort_order')::integer,0),nullif(v_type->>'min_age','')::integer,nullif(v_type->>'max_age','')::integer)
    on conflict(id) do update set name=excluded.name,description=excluded.description,price_cents=excluded.price_cents,capacity=excluded.capacity,sales_start=excluded.sales_start,sales_end=excluded.sales_end,active=excluded.active,sort_order=excluded.sort_order,min_age=excluded.min_age,max_age=excluded.max_age;
    v_seen:=array_append(v_seen,v_type_id);
  end loop;
  update public.bar_event_ticket_types set active=false where event_id=v_id and not(id=any(v_seen));
  -- Saving incomplete sale settings closes checkout; publishing information remains possible.
  if not exists(select 1 from public.bar_event_ticket_types where event_id=v_id and active and price_cents>=0) or coalesce(p_event->'content'->>'time','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    update public.bar_ticket_events set sales_state='CLOSED' where id=v_id;
  end if;
  return v_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.event_reserve_order(p_slug text, p_request uuid, p_token_hash text, p_request_hash text, p_buyer jsonb, p_items jsonb, p_attendees jsonb, p_environment text)
 RETURNS bar_event_orders
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_event public.bar_ticket_events; v_order public.bar_event_orders; v_type public.bar_event_ticket_types; v_item jsonb; v_person jsonb; v_qty integer; v_total integer:=0; v_count integer:=0; v_held integer; v_ids uuid[]:='{}'; v_age integer; v_occupied integer;
begin
  select * into v_event from public.bar_ticket_events where slug=p_slug for update;
  if not found then raise exception 'Evento não encontrado.'; end if;
  select * into v_order from public.bar_event_orders where request_id=p_request;
  if found then
    if v_order.access_token_hash<>p_token_hash or v_order.request_hash<>p_request_hash or v_order.event_id<>v_event.id then raise exception 'Pedido já utilizado. Reabra seu pedido original.'; end if;
    return v_order;
  end if;
  if v_event.status<>'PUBLICADO' or v_event.sales_state<>'OPEN' or v_event.event_date<(now() at time zone 'America/Sao_Paulo')::date then raise exception 'As vendas deste evento estão fechadas.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 20 or jsonb_typeof(p_attendees)<>'array' then raise exception 'Selecione seus ingressos.'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty:=(v_item->>'quantity')::integer;
    if v_qty not between 1 and 20 or (v_item->>'ticket_type_id')::uuid=any(v_ids) then raise exception 'Quantidade inválida.'; end if;
    select * into v_type from public.bar_event_ticket_types where id=(v_item->>'ticket_type_id')::uuid and event_id=v_event.id for update;
    if not found or not v_type.active or v_type.price_cents is null or (v_type.sales_start is not null and v_type.sales_start>now()) or (v_type.sales_end is not null and v_type.sales_end<now()) then raise exception 'Este lote não está disponível.'; end if;
    select coalesce(sum(i.quantity),0) into v_held from public.bar_event_order_items i join public.bar_event_orders o on o.id=i.order_id where i.ticket_type_id=v_type.id and o.status not in ('CANCELLED','REFUNDED');
    if v_held+v_qty>v_type.capacity then raise exception 'Este lote não tem vagas suficientes. Atualize a seleção.'; end if;
    if (select count(*) from jsonb_array_elements(p_attendees) a where a->>'ticket_type_id'=v_type.id::text)<>v_qty then raise exception 'Informe o nome de cada participante.'; end if;
    v_ids:=array_append(v_ids,v_type.id); v_count:=v_count+v_qty; v_total:=v_total+v_type.price_cents*v_qty;
  end loop;
  if v_count>v_event.max_per_order or jsonb_array_length(p_attendees)<>v_count then raise exception 'Limite de ingressos por pedido excedido.'; end if;
  if v_event.content->>'freeRequiresAdult'='true'
     and exists(select 1 from public.bar_event_ticket_types where id=any(v_ids) and price_cents=0)
     and not exists(select 1 from public.bar_event_ticket_types where id=any(v_ids) and price_cents>0 and min_age>=15) then
    raise exception 'Para incluir crianças gratuitas, compre ao menos um ingresso integral de adulto no mesmo pedido.';
  end if;
  if v_event.capacity_total is not null then
    select coalesce(sum(quantity),0) into v_occupied from public.bar_event_orders where event_id=v_event.id and status not in ('CANCELLED','REFUNDED');
    if v_occupied+v_count>v_event.capacity_total then raise exception 'O evento não tem vagas suficientes para este pedido.'; end if;
  end if;
  for v_person in select * from jsonb_array_elements(p_attendees) loop
    select * into v_type from public.bar_event_ticket_types where id=(v_person->>'ticket_type_id')::uuid and event_id=v_event.id;
    if not found or not(v_type.id=any(v_ids)) then raise exception 'Participante com ingresso inválido.'; end if;
    v_age:=nullif(v_person->>'age','')::integer;
    if (v_type.min_age is not null or v_type.max_age is not null) and (v_age is null or v_age<0 or v_age>120 or v_age<coalesce(v_type.min_age,0) or v_age>coalesce(v_type.max_age,120)) then
      raise exception 'A idade na data do evento não corresponde ao ingresso %.',v_type.name;
    end if;
  end loop;
  insert into public.bar_event_orders(event_id,request_id,access_token_hash,request_hash,buyer_name,buyer_email,buyer_phone,buyer_cpf,total_cents,quantity,provider_environment)
  values(v_event.id,p_request,p_token_hash,p_request_hash,p_buyer->>'name',p_buyer->>'email',p_buyer->>'phone',p_buyer->>'cpf',v_total,v_count,p_environment) returning * into v_order;
  if v_total=0 then
    update public.bar_event_orders set status='PAID',provider_status='FREE',paid_at=now() where id=v_order.id returning * into v_order;
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_type from public.bar_event_ticket_types where id=(v_item->>'ticket_type_id')::uuid;
    insert into public.bar_event_order_items(order_id,ticket_type_id,name,unit_cents,quantity) values(v_order.id,v_type.id,v_type.name,v_type.price_cents,(v_item->>'quantity')::integer);
  end loop;
  for v_person in select * from jsonb_array_elements(p_attendees) loop
    if length(trim(v_person->>'name')) not between 2 and 120 then raise exception 'Revise o nome dos participantes.'; end if;
    insert into public.bar_event_tickets(order_id,ticket_type_id,attendee_name,attendee_age) values(v_order.id,(v_person->>'ticket_type_id')::uuid,trim(v_person->>'name'),nullif(v_person->>'age','')::integer);
  end loop;
  insert into public.bar_event_activity(event_id,order_id,kind,detail) values(v_event.id,v_order.id,'ORDER_CREATED',case when v_total=0 then 'Ingressos gratuitos confirmados, sem cobrança.' else 'Pedido reservado; aguardando pagamento.' end);
  return v_order;
end; $function$;
