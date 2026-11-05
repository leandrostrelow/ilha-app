begin;
set local lock_timeout='5s';
lock table public.app_store_orders in share row exclusive mode;

-- Preserve the old order/payment identity. Line items are the immutable price
-- and stock snapshot; old one-product clients continue through the wrapper.
create table public.app_store_order_items (
  order_id uuid not null references public.app_store_orders(id),
  product_id uuid not null references public.app_store_products(id),
  product_name text not null,
  quantity integer not null check(quantity between 1 and 50),
  unit_price numeric(10,2) not null check(unit_price > 0),
  total numeric(10,2) not null check(total = quantity * unit_price),
  stock_reserved boolean not null default false,
  primary key(order_id,product_id)
);
create index app_store_order_items_product_idx on public.app_store_order_items(product_id);
alter table public.app_store_order_items enable row level security;
revoke all on public.app_store_order_items from public,anon,authenticated;
grant select on public.app_store_order_items to authenticated;
grant select,insert,update on public.app_store_order_items to service_role;
create policy store_order_items_read on public.app_store_order_items for select to authenticated
using (exists(select 1 from public.app_store_orders o where o.id=order_id));

insert into public.app_store_order_items(order_id,product_id,product_name,quantity,unit_price,total,stock_reserved)
select id,product_id,product_name,quantity,unit_price,total,stock_reserved from public.app_store_orders;
alter table public.app_store_orders alter column product_id drop not null,
  alter column unit_price drop not null;

create function public.store_reserve_cart(p_actor uuid,p_client uuid,p_name text,p_source text,
  p_request uuid,p_items jsonb,p_environment text)
returns public.app_store_orders language plpgsql security invoker set search_path='' as $$
declare o public.app_store_orders; p public.app_store_products; line record;
  canonical jsonb; existing jsonb; snapshots jsonb:='[]'; units integer; total_amount numeric:=0;
  has_stock boolean:=false; snapshot_name text;
begin
  if p_actor is null or p_request is null or p_source is null or p_source not in ('APP','PRESENCIAL')
    or p_environment is null or p_environment not in ('SANDBOX','PRODUCTION')
    or length(trim(coalesce(p_name,'')))<3 or length(p_name)>120
    or (p_source='APP' and p_client is distinct from p_actor)
    or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Pedido inválido.'; end if;
  if jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'Adicione de 1 a 20 produtos ao pedido.'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) item where
    jsonb_typeof(item) is distinct from 'object'
    or coalesce(item->>'product_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(item->'quantity') is distinct from 'number'
    or coalesce(item->>'quantity','') !~ '^[1-9][0-9]?$') then
    raise exception 'Produto ou quantidade inválida.'; end if;
  select jsonb_agg(jsonb_build_object('product_id',product_id,'quantity',quantity) order by product_id),sum(quantity)
    into canonical,units from (
      select (item->>'product_id')::uuid as product_id,sum((item->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) item group by (item->>'product_id')::uuid
    ) grouped;
  if units>50 then raise exception 'O pedido aceita até 50 unidades no total.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('store-actor:'||p_actor::text,0));
  select * into o from public.app_store_orders where created_by=p_actor and request_id=p_request;
  if found then
    select jsonb_agg(jsonb_build_object('product_id',product_id,'quantity',quantity) order by product_id)
      into existing from public.app_store_order_items where order_id=o.id;
    if existing is distinct from canonical or o.client_id is distinct from p_client
      or o.customer_name is distinct from trim(p_name) or o.source<>p_source or o.provider_environment<>p_environment then
      raise exception 'Pedido já utilizado com outros dados.'; end if;
    return o;
  end if;
  if (select count(*) from public.app_store_orders where created_by=p_actor
    and status in ('CREATED','PENDING') and created_at>now()-interval '1 day')>=20 then
    raise exception 'Conclua ou cancele os pedidos anteriores antes de continuar.'; end if;

  -- Lock every SKU in a consistent order. Any invalid line rolls back the
  -- entire cart; the payment provider is called only after this transaction.
  for line in select * from jsonb_to_recordset(canonical) as x(product_id uuid,quantity integer) order by product_id loop
    select * into p from public.app_store_products where id=line.product_id for update;
    if not found or p.active is distinct from true or coalesce(p.sale_price,0)<=0 then
      raise exception 'Produto sem preço ou indisponível.'; end if;
    if p.track_stock and coalesce(p.stock_quantity,0)<line.quantity then
      raise exception 'Estoque insuficiente para %.',p.name; end if;
    snapshot_name:=concat_ws(' · ',p.name,nullif(p.size,''),nullif(p.color,''));
    snapshots:=snapshots||jsonb_build_array(jsonb_build_object('product_id',p.id,'product_name',snapshot_name,
      'quantity',line.quantity,'unit_price',p.sale_price,'total',p.sale_price*line.quantity,'stock_reserved',coalesce(p.track_stock,false)));
    total_amount:=total_amount+p.sale_price*line.quantity;
    has_stock:=has_stock or coalesce(p.track_stock,false);
  end loop;
  insert into public.app_store_orders(request_id,created_by,client_id,customer_name,source,product_id,product_name,
    quantity,unit_price,total,stock_reserved,provider_environment,payment_flow)
  values(p_request,p_actor,p_client,trim(p_name),p_source,
    case when jsonb_array_length(snapshots)=1 then (snapshots#>>'{0,product_id}')::uuid end,
    case when jsonb_array_length(snapshots)=1 then snapshots#>>'{0,product_name}' else 'Pedido com '||jsonb_array_length(snapshots)||' produtos' end,
    units,case when jsonb_array_length(snapshots)=1 then (snapshots#>>'{0,unit_price}')::numeric end,
    total_amount,has_stock,p_environment,case when p_source='PRESENCIAL' and p_client is null then 'STATIC_QR' else 'CHARGE' end)
    returning * into o;
  for line in select * from jsonb_to_recordset(snapshots)
    as x(product_id uuid,product_name text,quantity integer,unit_price numeric,total numeric,stock_reserved boolean) order by product_id loop
    insert into public.app_store_order_items values(o.id,line.product_id,line.product_name,line.quantity,line.unit_price,line.total,line.stock_reserved);
    if line.stock_reserved then
      update public.app_store_products set stock_quantity=stock_quantity-line.quantity,updated_at=now() where id=line.product_id;
      insert into public.app_store_stock_movements(product_id,order_id,delta,reason) values(line.product_id,o.id,-line.quantity,'RESERVA');
    end if;
  end loop;
  return o;
end $$;
revoke all on function public.store_reserve_cart(uuid,uuid,text,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.store_reserve_cart(uuid,uuid,text,text,uuid,jsonb,text) to service_role;

create or replace function public.store_reserve_order(p_actor uuid,p_client uuid,p_name text,p_source text,
  p_request uuid,p_product uuid,p_quantity integer,p_environment text)
returns public.app_store_orders language sql security invoker set search_path='' as $$
  select public.store_reserve_cart(p_actor,p_client,p_name,p_source,p_request,
    jsonb_build_array(jsonb_build_object('product_id',p_product,'quantity',p_quantity)),p_environment);
$$;

-- Called only after the caller has proven cancellation/refund and locked the
-- order. Keep provider matching, paid-order protection and delivery checks.
create function public.store_release_cart_stock(p_order uuid,p_reason text)
returns void language plpgsql security invoker set search_path='' as $$
declare o public.app_store_orders; item public.app_store_order_items;
begin
  select * into strict o from public.app_store_orders where id=p_order for update;
  if not o.stock_reserved or o.delivered_at is not null then return; end if;
  for item in select * from public.app_store_order_items where order_id=o.id and stock_reserved order by product_id for update loop
    update public.app_store_products set stock_quantity=stock_quantity+item.quantity,updated_at=now() where id=item.product_id;
    insert into public.app_store_stock_movements(product_id,order_id,delta,reason) values(item.product_id,o.id,item.quantity,p_reason);
    update public.app_store_order_items set stock_reserved=false where order_id=o.id and product_id=item.product_id;
  end loop;
end $$;
revoke all on function public.store_release_cart_stock(uuid,text) from public,anon,authenticated;
grant execute on function public.store_release_cart_stock(uuid,text) to service_role;

do $$
declare definition text; before_block text; spec record;
begin
  for spec in select * from (values
    ('public.store_cancel_unattempted(uuid)','CANCELADO_ANTES_DO_PIX'),
    ('public.store_cancel_static_qr(uuid,text)','QR_AVULSO_CANCELADO'),
    ('public.store_reconcile_payment(uuid,text,text,text,numeric,text)',null)
  ) v(signature,reason) loop
    definition:=pg_get_functiondef(spec.signature::regprocedure);
    before_block:='update public.app_store_products set stock_quantity=stock_quantity\+o.quantity where id=o.product_id;\s*insert into public.app_store_stock_movements\(product_id,order_id,delta,reason\)\s*values\(o.product_id,o.id,o.quantity,'||
      case when spec.reason is null then 'p_status' else quote_literal(spec.reason) end||'\);';
    if definition !~ before_block then raise exception 'Unexpected stock release implementation: %',spec.signature; end if;
    execute regexp_replace(definition,before_block,'perform public.store_release_cart_stock(o.id,'||
      case when spec.reason is null then 'p_status' else quote_literal(spec.reason) end||');');
  end loop;
end $$;

commit;
