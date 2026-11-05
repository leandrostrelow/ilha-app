-- Presential guest sales use an Asaas static QR Code with a fixed amount.
-- The buyer name remains in Ilha Store; Asaas creates the payer/payment only
-- after the Pix is received, so no CPF is required before showing the QR Code.
alter table public.app_store_orders
  add column if not exists payment_flow text not null default 'CHARGE',
  add column if not exists provider_qr_code_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_store_orders_payment_flow_check'
      and conrelid = 'public.app_store_orders'::regclass
  ) then
    alter table public.app_store_orders
      add constraint app_store_orders_payment_flow_check
      check (payment_flow in ('CHARGE','STATIC_QR'));
  end if;
end $$;

create unique index if not exists app_store_orders_provider_qr_unique
  on public.app_store_orders(provider_environment,provider_qr_code_id)
  where provider_qr_code_id is not null;

create or replace function public.store_reserve_order(p_actor uuid, p_client uuid, p_name text, p_source text,
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
    quantity,unit_price,total,stock_reserved,provider_environment,payment_flow)
  values(p_request,p_actor,p_client,p_name,p_source,p.id,concat_ws(' · ',p.name,nullif(p.size,''),nullif(p.color,'')),
    p_quantity,p.sale_price,p.sale_price*p_quantity,p.track_stock,p_environment,
    case when p_source='PRESENCIAL' and p_client is null then 'STATIC_QR' else 'CHARGE' end) returning * into o;
  if p.track_stock then
    update public.app_store_products set stock_quantity=stock_quantity-p_quantity where id=p.id;
    insert into public.app_store_stock_movements(product_id,order_id,delta,reason) values(p.id,o.id,-p_quantity,'RESERVA');
  end if;
  return o;
end $$;

create function public.store_attach_static_qr(p_order uuid,p_qr_code text,p_payload text,p_image text,p_expires text)
returns public.app_store_orders language plpgsql security invoker set search_path='' as $$
declare o public.app_store_orders;
begin
  select * into o from public.app_store_orders where id=p_order for update;
  if not found or o.payment_flow<>'STATIC_QR' or o.source<>'PRESENCIAL' or o.client_id is not null
     or o.status not in ('CREATED','PENDING') or o.provider_payment_id is not null
     or nullif(p_qr_code,'') is null or nullif(p_payload,'') is null or nullif(p_image,'') is null then
    raise exception 'QR Code avulso não corresponde ao pedido.';
  end if;
  if o.provider_qr_code_id is not null and o.provider_qr_code_id<>p_qr_code then
    raise exception 'Outro QR Code já está vinculado ao pedido.';
  end if;
  update public.app_store_orders set provider_qr_code_id=p_qr_code,pix_payload=p_payload,pix_image=p_image,
    pix_expires_at=nullif(p_expires,''),status='PENDING',updated_at=now()
  where id=o.id returning * into o;
  return o;
end $$;

create function public.store_cancel_static_qr(p_order uuid,p_qr_code text)
returns public.app_store_orders language plpgsql security invoker set search_path='' as $$
declare o public.app_store_orders;
begin
  select * into o from public.app_store_orders where id=p_order for update;
  if not found or o.payment_flow<>'STATIC_QR' or o.provider_qr_code_id is distinct from p_qr_code
     or o.provider_payment_id is not null or o.status not in ('CREATED','PENDING') then
    raise exception 'O QR Code não pode mais ser cancelado automaticamente.';
  end if;
  if o.stock_reserved then
    update public.app_store_products set stock_quantity=stock_quantity+o.quantity where id=o.product_id;
    insert into public.app_store_stock_movements(product_id,order_id,delta,reason)
      values(o.product_id,o.id,o.quantity,'QR_AVULSO_CANCELADO');
  end if;
  update public.app_store_orders set status='CANCELLED',stock_reserved=false,pix_payload=null,pix_image=null,updated_at=now()
  where id=o.id returning * into o;
  return o;
end $$;

revoke all on function public.store_attach_static_qr(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.store_cancel_static_qr(uuid,text) from public,anon,authenticated;
grant execute on function public.store_attach_static_qr(uuid,text,text,text,text) to service_role;
grant execute on function public.store_cancel_static_qr(uuid,text) to service_role;
