-- Stock represents AVAILABLE units: reserve once at checkout, release only
-- after provider cancellation/refund is confirmed. Never expire locally alone.
alter table public.app_store_products
  add column if not exists category text not null default 'Produtos',
  add column if not exists size text not null default '',
  add column if not exists color text not null default '';

create table public.app_store_orders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  created_by uuid not null references auth.users(id),
  client_id uuid references public.app_clients(id),
  customer_name text not null,
  source text not null check (source in ('APP','PRESENCIAL')),
  product_id uuid not null references public.app_store_products(id),
  product_name text not null,
  quantity integer not null check(quantity between 1 and 50),
  unit_price numeric(10,2) not null check(unit_price > 0),
  total numeric(10,2) not null check(total > 0),
  stock_reserved boolean not null default false,
  status text not null default 'CREATED' check(status in ('CREATED','PENDING','PAID','CANCELLED','REFUNDED','REVIEW')),
  provider_environment text not null check(provider_environment in ('SANDBOX','PRODUCTION')),
  provider_payment_id text,
  payment_attempted_at timestamptz,
  pix_payload text,
  pix_image text,
  pix_expires_at text,
  paid_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(created_by, request_id),
  unique(provider_environment, provider_payment_id)
);
create index app_store_orders_client_idx on public.app_store_orders(client_id, created_at desc);
create index app_store_orders_created_idx on public.app_store_orders(created_at desc);
alter table public.app_store_orders enable row level security;
revoke all on public.app_store_orders from public,anon,authenticated;
grant select on public.app_store_orders to authenticated;
grant all on public.app_store_orders to service_role;
create policy store_orders_read on public.app_store_orders for select to authenticated
using (client_id=(select auth.uid()) or (select public.has_club_permission('store')));

create table public.app_store_stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.app_store_products(id),
  order_id uuid references public.app_store_orders(id),
  delta integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index app_store_stock_movements_product_idx on public.app_store_stock_movements(product_id,created_at desc);
alter table public.app_store_stock_movements enable row level security;
revoke all on public.app_store_stock_movements from public,anon,authenticated;
grant select on public.app_store_stock_movements to authenticated;
grant all on public.app_store_stock_movements to service_role;
create policy store_movements_staff_read on public.app_store_stock_movements for select to authenticated
using ((select public.has_club_permission('store')));

-- These service-only functions receive identity ONLY from the authenticated Edge Function.
create function public.store_reserve_order(p_actor uuid, p_client uuid, p_name text, p_source text,
  p_request uuid, p_product uuid, p_quantity integer, p_environment text)
returns public.app_store_orders language plpgsql security invoker set search_path='' as $$
declare o public.app_store_orders; p public.app_store_products;
begin
  if p_actor is null or p_request is null or p_quantity not between 1 and 50 then
    raise exception 'Pedido inválido.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('store-actor:' || p_actor::text,0));
  select * into o from public.app_store_orders where created_by=p_actor and request_id=p_request;
  if found then
    if o.product_id<>p_product or o.quantity<>p_quantity or o.client_id is distinct from p_client
      or o.source<>p_source or o.provider_environment<>p_environment then raise exception 'Pedido já utilizado com outros dados.'; end if;
    return o;
  end if;
  if (select count(*) from public.app_store_orders where created_by=p_actor and status in ('CREATED','PENDING') and created_at>now()-interval '1 day')>=20 then
    raise exception 'Conclua ou cancele os pedidos anteriores antes de continuar.';
  end if;
  select * into p from public.app_store_products where id=p_product for update;
  if not found or not p.active or p.sale_price<=0 then raise exception 'Produto sem preço ou indisponível.'; end if;
  if p.track_stock and p.stock_quantity<p_quantity then raise exception 'Estoque insuficiente.'; end if;
  insert into public.app_store_orders(request_id,created_by,client_id,customer_name,source,product_id,product_name,
    quantity,unit_price,total,stock_reserved,provider_environment)
  values(p_request,p_actor,p_client,p_name,p_source,p.id,concat_ws(' · ',p.name,nullif(p.size,''),nullif(p.color,'')),
    p_quantity,p.sale_price,p.sale_price*p_quantity,p.track_stock,p_environment) returning * into o;
  if p.track_stock then
    update public.app_store_products set stock_quantity=stock_quantity-p_quantity where id=p.id;
    insert into public.app_store_stock_movements(product_id,order_id,delta,reason) values(p.id,o.id,-p_quantity,'RESERVA');
  end if;
  return o;
end $$;

create function public.store_cancel_unattempted(p_order uuid)
returns public.app_store_orders language plpgsql security invoker set search_path='' as $$
declare o public.app_store_orders;
begin
  select * into o from public.app_store_orders where id=p_order for update;
  if not found or o.payment_attempted_at is not null or o.provider_payment_id is not null or o.status<>'CREATED' then
    raise exception 'Aguarde a confirmação do Asaas para cancelar este pedido.';
  end if;
  if o.stock_reserved then
    update public.app_store_products set stock_quantity=stock_quantity+o.quantity where id=o.product_id;
    insert into public.app_store_stock_movements(product_id,order_id,delta,reason) values(o.product_id,o.id,o.quantity,'CANCELADO_ANTES_DO_PIX');
  end if;
  update public.app_store_orders set status='CANCELLED',stock_reserved=false,updated_at=now() where id=o.id returning * into o;
  return o;
end $$;
revoke all on function public.store_cancel_unattempted(uuid) from public,anon,authenticated;
grant execute on function public.store_cancel_unattempted(uuid) to service_role;

create function public.store_reconcile_payment(p_order uuid,p_payment text,p_environment text,p_reference text,p_amount numeric,p_status text)
returns public.app_store_orders language plpgsql security invoker set search_path='' as $$
declare o public.app_store_orders;
begin
  select * into o from public.app_store_orders where id=p_order for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if p_reference is distinct from 'ilha-store:'||o.id::text or p_environment is distinct from o.provider_environment
     or p_amount is distinct from o.total or nullif(p_payment,'') is null
     or (o.provider_payment_id is not null and o.provider_payment_id<>p_payment) then
    raise exception 'Pagamento não corresponde ao pedido.';
  end if;
  update public.app_store_orders set provider_payment_id=p_payment,updated_at=now() where id=o.id;
  if p_status='RECEIVED' then
    if o.status in ('CANCELLED','REFUNDED','REVIEW') then
      update public.app_store_orders set status='REVIEW' where id=o.id;
    else
      update public.app_store_orders set status='PAID',paid_at=coalesce(paid_at,now()) where id=o.id;
    end if;
  elsif p_status in ('DELETED','REFUNDED') then
    -- Do not turn a paid order into cancelled on a delayed deletion event.
    if p_status='DELETED' and o.status in ('PAID','REFUNDED','REVIEW') then return o; end if;
    if o.stock_reserved and o.delivered_at is null then
      update public.app_store_products set stock_quantity=stock_quantity+o.quantity where id=o.product_id;
      insert into public.app_store_stock_movements(product_id,order_id,delta,reason) values(o.product_id,o.id,o.quantity,p_status);
    end if;
    update public.app_store_orders set status=case when p_status='REFUNDED' then 'REFUNDED' else 'CANCELLED' end,
      stock_reserved=false,pix_payload=null,pix_image=null where id=o.id;
  elsif p_status in ('PARTIALLY_REFUNDED','REFUND_PENDING','REFUND_IN_PROGRESS','CHARGEBACK','DISPUTED') then
    update public.app_store_orders set status='REVIEW' where id=o.id;
  elsif o.status='CREATED' then
    update public.app_store_orders set status='PENDING' where id=o.id;
  end if;
  select * into o from public.app_store_orders where id=o.id;
  return o;
end $$;

revoke all on function public.store_reserve_order(uuid,uuid,text,text,uuid,uuid,integer,text) from public,anon,authenticated;
revoke all on function public.store_reconcile_payment(uuid,text,text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.store_reserve_order(uuid,uuid,text,text,uuid,uuid,integer,text) to service_role;
grant execute on function public.store_reconcile_payment(uuid,text,text,text,numeric,text) to service_role;

-- Product editor uses optimistic concurrency to avoid overwriting stock sold
-- while the form was open. Products with orders are retained via FK restrictions.
drop policy if exists "store products staff insert" on public.app_store_products;
drop policy if exists "store products staff update" on public.app_store_products;
drop policy if exists "store products staff delete" on public.app_store_products;
create policy "store products staff insert" on public.app_store_products for insert to authenticated
with check ((select public.has_club_permission('store')));
create policy "store products staff update" on public.app_store_products for update to authenticated
using ((select public.has_club_permission('store'))) with check ((select public.has_club_permission('store')));
create policy "store products staff delete" on public.app_store_products for delete to authenticated
using ((select public.has_club_permission('store')));
