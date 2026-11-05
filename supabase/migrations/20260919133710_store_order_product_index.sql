set local lock_timeout = '5s';

create index if not exists app_store_orders_product_id_idx
  on public.app_store_orders(product_id);
