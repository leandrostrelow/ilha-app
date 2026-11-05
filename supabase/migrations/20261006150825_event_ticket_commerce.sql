-- Ticketing is independent from the bar's tabs and club monthly billing.
alter table public.bar_ticket_events add column if not exists sales_state text not null default 'CLOSED' check (sales_state in ('CLOSED','OPEN'));
alter table public.bar_ticket_events add column if not exists max_per_order integer not null default 10 check (max_per_order between 1 and 20);

create table public.bar_event_ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.bar_ticket_events(id) on delete restrict,
  name text not null check (length(name) between 2 and 100),
  description text not null default '',
  price_cents integer check (price_cents between 1 and 10000000),
  capacity integer check (capacity between 1 and 100000),
  sales_start timestamptz,
  sales_end timestamptz,
  active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (sales_end is null or sales_start is null or sales_end > sales_start)
);
create index on public.bar_event_ticket_types(event_id);

create table public.bar_event_orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.bar_ticket_events(id) on delete restrict,
  request_id uuid not null unique,
  access_token_hash text not null check (access_token_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null,
  buyer_name text not null,
  buyer_email text not null,
  buyer_phone text not null,
  buyer_cpf text not null,
  status text not null default 'CREATED' check (status in ('CREATED','PENDING','PAID','CANCELLED','REFUNDED','REVIEW')),
  total_cents integer not null check (total_cents > 0),
  quantity integer not null check (quantity between 1 and 20),
  provider_environment text not null check (provider_environment in ('SANDBOX','PRODUCTION')),
  provider_payment_id text unique,
  provider_status text,
  payment_attempted_at timestamptz,
  pix_payload text,
  pix_image text,
  pix_expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.bar_event_orders(event_id,created_at desc);
create index on public.bar_event_orders(event_id,status);

create table public.bar_event_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.bar_event_orders(id) on delete restrict,
  ticket_type_id uuid not null references public.bar_event_ticket_types(id) on delete restrict,
  name text not null,
  unit_cents integer not null,
  quantity integer not null check(quantity between 1 and 20),
  unique(order_id,ticket_type_id)
);
create index on public.bar_event_order_items(ticket_type_id);
create table public.bar_event_tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.bar_event_orders(id) on delete restrict,
  ticket_type_id uuid not null references public.bar_event_ticket_types(id) on delete restrict,
  attendee_name text not null check(length(attendee_name) between 2 and 120),
  code text not null unique default upper(replace(gen_random_uuid()::text,'-','')),
  checked_in_at timestamptz,
  checked_in_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.bar_event_tickets(order_id);
create index on public.bar_event_tickets(ticket_type_id);
create index on public.bar_event_tickets(checked_in_by);
create table public.bar_event_activity (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.bar_ticket_events(id) on delete restrict,
  order_id uuid references public.bar_event_orders(id) on delete restrict,
  kind text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index on public.bar_event_activity(event_id,created_at desc);
create index on public.bar_event_activity(order_id);
create table public.bar_event_rate_limits (
  key text primary key,
  hits integer not null default 1,
  reset_at timestamptz not null
);
alter table public.bar_event_rate_limits enable row level security;
revoke all on public.bar_event_rate_limits from anon,authenticated;
grant all on public.bar_event_rate_limits to service_role;

alter table public.bar_event_ticket_types enable row level security;
alter table public.bar_event_orders enable row level security;
alter table public.bar_event_order_items enable row level security;
alter table public.bar_event_tickets enable row level security;
alter table public.bar_event_activity enable row level security;
grant all on public.bar_event_ticket_types, public.bar_event_orders, public.bar_event_order_items, public.bar_event_tickets, public.bar_event_activity to service_role;
grant usage,select on sequence public.bar_event_activity_id_seq to service_role;
grant select,insert,update on public.bar_event_ticket_types to authenticated;
grant select on public.bar_event_orders,public.bar_event_order_items,public.bar_event_tickets,public.bar_event_activity to authenticated;
create policy event_types_staff on public.bar_event_ticket_types for all to authenticated using ((select public.has_bar_permission('bar.events'))) with check ((select public.has_bar_permission('bar.events')));
create policy event_orders_staff on public.bar_event_orders for select to authenticated using ((select public.has_bar_permission('bar.events')));
create policy event_items_staff on public.bar_event_order_items for select to authenticated using ((select public.has_bar_permission('bar.events')));
create policy event_tickets_staff on public.bar_event_tickets for select to authenticated using ((select public.has_bar_permission('bar.events')));
create policy event_activity_staff on public.bar_event_activity for select to authenticated using ((select public.has_bar_permission('bar.events')));

create function public.event_take_rate_limit(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql security invoker set search_path = public,pg_temp as $$
declare v_hits integer;
begin
  insert into public.bar_event_rate_limits(key,hits,reset_at) values(p_key,1,now()+make_interval(secs=>p_seconds))
  on conflict(key) do update set hits=case when bar_event_rate_limits.reset_at<=now() then 1 else bar_event_rate_limits.hits+1 end,
    reset_at=case when bar_event_rate_limits.reset_at<=now() then now()+make_interval(secs=>p_seconds) else bar_event_rate_limits.reset_at end
  returning hits into v_hits;
  return v_hits<=p_limit;
end; $$;

create function public.event_save(p_event jsonb,p_types jsonb) returns uuid language plpgsql security invoker set search_path = public,pg_temp as $$
declare v_id uuid; v_current public.bar_ticket_events; v_type jsonb; v_type_id uuid; v_seen uuid[]:='{}';
begin
  if not public.has_bar_permission('bar.events') then raise exception 'Acesso não autorizado.'; end if;
  if jsonb_typeof(p_types)<>'array' or jsonb_array_length(p_types)>30 then raise exception 'Revise os lotes.'; end if;
  v_id:=nullif(p_event->>'id','')::uuid;
  if v_id is null then
    insert into public.bar_ticket_events(slug,event_date,status,content,created_by,max_per_order)
    values(p_event->>'slug',(p_event->>'event_date')::date,'RASCUNHO',p_event->'content',auth.uid(),coalesce((p_event->>'max_per_order')::integer,10)) returning id into v_id;
  else
    select * into v_current from public.bar_ticket_events where id=v_id for update;
    if not found then raise exception 'Evento não encontrado.'; end if;
    if v_current.updated_at is distinct from (p_event->>'updated_at')::timestamptz then raise exception 'Outra pessoa editou este evento. Atualize antes de salvar.'; end if;
    update public.bar_ticket_events set slug=p_event->>'slug',event_date=(p_event->>'event_date')::date,content=p_event->'content',max_per_order=coalesce((p_event->>'max_per_order')::integer,10),updated_at=now() where id=v_id;
  end if;
  for v_type in select * from jsonb_array_elements(p_types) loop
    v_type_id:=coalesce(nullif(v_type->>'id','')::uuid,gen_random_uuid());
    if exists(select 1 from public.bar_event_ticket_types where id=v_type_id and event_id<>v_id) then raise exception 'Lote de outro evento.'; end if;
    if nullif(v_type->>'capacity','') is not null and (v_type->>'capacity')::integer < coalesce((select sum(i.quantity) from public.bar_event_order_items i join public.bar_event_orders o on o.id=i.order_id where i.ticket_type_id=v_type_id and o.status not in ('CANCELLED','REFUNDED')),0) then raise exception 'A capacidade não pode ser menor que as vagas já vendidas ou reservadas.'; end if;
    insert into public.bar_event_ticket_types(id,event_id,name,description,price_cents,capacity,sales_start,sales_end,active,sort_order)
    values(v_type_id,v_id,v_type->>'name',coalesce(v_type->>'description',''),nullif(v_type->>'price_cents','')::integer,nullif(v_type->>'capacity','')::integer,nullif(v_type->>'sales_start','')::timestamptz,nullif(v_type->>'sales_end','')::timestamptz,coalesce((v_type->>'active')::boolean,false),coalesce((v_type->>'sort_order')::integer,0))
    on conflict(id) do update set name=excluded.name,description=excluded.description,price_cents=excluded.price_cents,capacity=excluded.capacity,sales_start=excluded.sales_start,sales_end=excluded.sales_end,active=excluded.active,sort_order=excluded.sort_order;
    v_seen:=array_append(v_seen,v_type_id);
  end loop;
  update public.bar_event_ticket_types set active=false where event_id=v_id and not(id=any(v_seen));
  -- Saving incomplete sale settings closes checkout; publishing information remains possible.
  if not exists(select 1 from public.bar_event_ticket_types where event_id=v_id and active and price_cents>0 and capacity>0) or coalesce(p_event->'content'->>'time','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    update public.bar_ticket_events set sales_state='CLOSED' where id=v_id;
  end if;
  return v_id;
end; $$;

create function public.event_reserve_order(p_slug text,p_request uuid,p_token_hash text,p_request_hash text,p_buyer jsonb,p_items jsonb,p_attendees jsonb,p_environment text) returns public.bar_event_orders language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_event public.bar_ticket_events; v_order public.bar_event_orders; v_type public.bar_event_ticket_types; v_item jsonb; v_person jsonb; v_qty integer; v_total integer:=0; v_count integer:=0; v_held integer; v_ids uuid[]:='{}';
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
    if not found or not v_type.active or v_type.price_cents is null or v_type.capacity is null or (v_type.sales_start is not null and v_type.sales_start>now()) or (v_type.sales_end is not null and v_type.sales_end<now()) then raise exception 'Este lote não está disponível.'; end if;
    select coalesce(sum(i.quantity),0) into v_held from public.bar_event_order_items i join public.bar_event_orders o on o.id=i.order_id where i.ticket_type_id=v_type.id and o.status not in ('CANCELLED','REFUNDED');
    if v_held+v_qty>v_type.capacity then raise exception 'Este lote não tem vagas suficientes. Atualize a seleção.'; end if;
    if (select count(*) from jsonb_array_elements(p_attendees) a where a->>'ticket_type_id'=v_type.id::text)<>v_qty then raise exception 'Informe o nome de cada participante.'; end if;
    v_ids:=array_append(v_ids,v_type.id); v_count:=v_count+v_qty; v_total:=v_total+v_type.price_cents*v_qty;
  end loop;
  if v_count>v_event.max_per_order or jsonb_array_length(p_attendees)<>v_count then raise exception 'Limite de ingressos por pedido excedido.'; end if;
  insert into public.bar_event_orders(event_id,request_id,access_token_hash,request_hash,buyer_name,buyer_email,buyer_phone,buyer_cpf,total_cents,quantity,provider_environment)
  values(v_event.id,p_request,p_token_hash,p_request_hash,p_buyer->>'name',p_buyer->>'email',p_buyer->>'phone',p_buyer->>'cpf',v_total,v_count,p_environment) returning * into v_order;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_type from public.bar_event_ticket_types where id=(v_item->>'ticket_type_id')::uuid;
    insert into public.bar_event_order_items(order_id,ticket_type_id,name,unit_cents,quantity) values(v_order.id,v_type.id,v_type.name,v_type.price_cents,(v_item->>'quantity')::integer);
  end loop;
  for v_person in select * from jsonb_array_elements(p_attendees) loop
    if length(trim(v_person->>'name')) not between 2 and 120 then raise exception 'Revise o nome dos participantes.'; end if;
    insert into public.bar_event_tickets(order_id,ticket_type_id,attendee_name) values(v_order.id,(v_person->>'ticket_type_id')::uuid,trim(v_person->>'name'));
  end loop;
  insert into public.bar_event_activity(event_id,order_id,kind,detail) values(v_event.id,v_order.id,'ORDER_CREATED','Pedido reservado; aguardando pagamento.');
  return v_order;
end; $$;

create function public.event_reconcile_payment(p_order uuid,p_payment text,p_environment text,p_reference text,p_amount integer,p_status text) returns public.bar_event_orders language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_order public.bar_event_orders; v_next text;
begin
  select * into v_order from public.bar_event_orders where id=p_order for update;
  if not found or p_environment<>v_order.provider_environment or p_reference<>'ilha-event:'||v_order.id::text or p_amount<>v_order.total_cents or (v_order.provider_payment_id is not null and v_order.provider_payment_id<>p_payment) then raise exception 'Pagamento divergente do pedido. Solicite revisão.'; end if;
  v_next:=case when p_status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH') then 'PAID' when p_status='REFUNDED' then 'REFUNDED' when p_status in ('DELETED','CANCELLED') then 'CANCELLED' when p_status in ('PENDING','OVERDUE') then 'PENDING' else 'REVIEW' end;
  -- A stale observation must never resurrect a refunded/cancelled ticket or erase payment.
  if v_order.status='REFUNDED' then v_next:='REFUNDED';
  elsif v_order.status='CANCELLED' and v_next not in ('CANCELLED','REFUNDED') then v_next:='REVIEW';
  elsif v_order.status='PAID' and v_next in ('PENDING','CANCELLED') then v_next:='PAID';
  elsif v_order.status='REVIEW' and v_next='PENDING' then v_next:='REVIEW'; end if;
  update public.bar_event_orders set provider_payment_id=p_payment,provider_status=p_status,status=v_next,paid_at=case when v_next='PAID' then coalesce(paid_at,now()) else paid_at end,pix_payload=case when v_next in ('CANCELLED','REFUNDED','REVIEW') then null else pix_payload end,pix_image=case when v_next in ('CANCELLED','REFUNDED','REVIEW') then null else pix_image end,updated_at=now() where id=p_order returning * into v_order;
  insert into public.bar_event_activity(event_id,order_id,kind,detail) select v_order.event_id,v_order.id,'PAYMENT_'||v_next,'Situação atualizada pelo Asaas.' where not exists(select 1 from public.bar_event_activity where order_id=p_order and kind='PAYMENT_'||v_next);
  return v_order;
end; $$;

create function public.event_checkin(p_event uuid,p_code text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ticket public.bar_event_tickets; v_order public.bar_event_orders; v_already boolean;
begin
  if auth.uid() is null or not public.has_bar_permission('bar.events') then raise exception 'Acesso não autorizado.'; end if;
  select * into v_ticket from public.bar_event_tickets where code=upper(trim(p_code)) for update;
  if not found then raise exception 'Ingresso não encontrado.'; end if;
  select * into v_order from public.bar_event_orders where id=v_ticket.order_id for update;
  if v_order.event_id<>p_event then raise exception 'Este ingresso pertence a outro evento.'; end if;
  if v_order.status<>'PAID' then raise exception 'Entrada não liberada: pagamento não confirmado ou estornado.'; end if;
  v_already:=v_ticket.checked_in_at is not null;
  if not v_already then
    update public.bar_event_tickets set checked_in_at=now(),checked_in_by=auth.uid() where id=v_ticket.id returning * into v_ticket;
    insert into public.bar_event_activity(event_id,order_id,kind,detail) values(p_event,v_order.id,'CHECK_IN','Entrada de '||v_ticket.attendee_name);
  end if;
  return jsonb_build_object('ticket',to_jsonb(v_ticket),'already_checked_in',v_already);
end; $$;

create function public.event_inventory(p_event uuid) returns table(ticket_type_id uuid,sold bigint,held bigint,checked_in bigint) language sql security invoker set search_path=public,pg_temp as $$
  select tt.id,count(t.id) filter(where o.status='PAID'),count(t.id) filter(where o.status in ('CREATED','PENDING','REVIEW')),count(t.id) filter(where o.status='PAID' and t.checked_in_at is not null)
  from public.bar_event_ticket_types tt left join public.bar_event_tickets t on t.ticket_type_id=tt.id left join public.bar_event_orders o on o.id=t.order_id where tt.event_id=p_event group by tt.id;
$$;

create function public.event_metrics(p_event uuid) returns jsonb language sql security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('revenue',coalesce(sum(total_cents) filter(where status='PAID'),0),'sold',coalesce(sum(quantity) filter(where status='PAID'),0),'paid_orders',count(*) filter(where status='PAID'),'pending',count(*) filter(where status in ('CREATED','PENDING')),'pending_value',coalesce(sum(total_cents) filter(where status in ('CREATED','PENDING')),0),'review',count(*) filter(where status='REVIEW'),'orders',count(*)) from public.bar_event_orders where event_id=p_event;
$$;
revoke all on function public.event_metrics(uuid) from public,anon,authenticated;
grant execute on function public.event_metrics(uuid) to service_role;

revoke all on function public.event_take_rate_limit(text,integer,integer),public.event_reserve_order(text,uuid,text,text,jsonb,jsonb,jsonb,text),public.event_reconcile_payment(uuid,text,text,text,integer,text),public.event_inventory(uuid) from public,anon,authenticated;
grant execute on function public.event_take_rate_limit(text,integer,integer),public.event_reserve_order(text,uuid,text,text,jsonb,jsonb,jsonb,text),public.event_reconcile_payment(uuid,text,text,text,integer,text),public.event_inventory(uuid) to service_role;
revoke all on function public.event_save(jsonb,jsonb),public.event_checkin(uuid,text) from public,anon;
grant execute on function public.event_save(jsonb,jsonb),public.event_checkin(uuid,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('bar-event-art','bar-event-art',true,10485760,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
create policy event_art_staff_insert on storage.objects for insert to authenticated with check(bucket_id='bar-event-art' and (select public.has_bar_permission('bar.events')));
create policy event_art_staff_select on storage.objects for select to authenticated using(bucket_id='bar-event-art' and (select public.has_bar_permission('bar.events')));

update public.bar_ticket_events set content=content || '{"poster":"/assets/events/halloween-ilha-2026-poster.png","accent":"#ff9a3c","secondary":"#d4e968","tagline":"Fora das quadras. Dentro da festa.","time":"","salesOpen":false,"buffetNote":"Seleção inicial do buffet, sujeita a ajustes. Confira as inclusões de cada ingresso quando os lotes forem divulgados.","dressCode":"Entre no clima de Halloween: sua fantasia é bem-vinda.","contactPhone":"","program":[{"time":"Em breve","title":"O encontro","description":"Tenistas, alunos, famílias e amigos reunidos para uma noite especial no Ilha."},{"time":"Em breve","title":"Sabores da noite","description":"Entradas, mesa mineira, petiscos e strogonoff de filé-mignon no buffet previsto."},{"time":"Em breve","title":"Clima de Halloween","description":"Fantasia, decoração temática e bons encontros no clube. A programação será atualizada aqui."}],"faq":[{"question":"Quem pode participar?","answer":"O encontro é para alunos, tenistas, familiares e convidados do Ilha."},{"question":"Preciso ir fantasiado?","answer":"A fantasia é bem-vinda para entrar no clima. As orientações finais serão divulgadas nesta página."},{"question":"O que está incluído no ingresso?","answer":"O buffet e as bebidas desta página são a seleção prevista. As inclusões, os valores e as condições de cada ingresso serão divulgados junto com os lotes."},{"question":"Como vou receber meu ingresso?","answer":"Após a confirmação do pagamento, seu ingresso ficará disponível nesta página, com um código individual para a entrada. Salve o link do seu pedido."},{"question":"Crianças podem participar?","answer":"As famílias são bem-vindas. Os valores e as condições para crianças serão informados pela organização antes da abertura das vendas."}],"rules":"Horário, valores e condições de participação serão divulgados antes da abertura das vendas."}'::jsonb,updated_at=now() where slug='halloween-ilha-2026';
insert into public.bar_event_ticket_types(event_id,name,description,active) select id,'Ingresso individual · 1º lote','Defina preço, quantidade e inclusões antes de disponibilizar.',false from public.bar_ticket_events where slug='halloween-ilha-2026';
