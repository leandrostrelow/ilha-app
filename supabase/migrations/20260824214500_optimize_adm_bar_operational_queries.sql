-- Reduce the cost of the ADM Bar operational snapshot, polling and history.
-- All indexes are additive and can be removed independently if a rollback is needed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

create index if not exists bar_orders_opened_at_idx
  on public.bar_orders (opened_at desc, id desc);

create index if not exists bar_orders_closed_at_idx
  on public.bar_orders (closed_at desc, id desc)
  where status = 'FECHADA' and closed_at is not null;

create index if not exists bar_order_items_created_at_idx
  on public.bar_order_items (created_at desc, id desc);

create index if not exists bar_inventory_occurred_at_idx
  on public.bar_inventory_movements (occurred_at desc, id desc);

create index if not exists bar_financial_entries_created_at_idx
  on public.bar_financial_entries (created_at desc, id desc);

create index if not exists bar_financial_entries_order_created_idx
  on public.bar_financial_entries (order_id, created_at desc)
  where order_id is not null;

create index if not exists bar_financial_entries_paid_at_idx
  on public.bar_financial_entries (paid_at desc, created_at desc)
  where paid_at is not null;

-- PostgreSQL does not create indexes automatically for the referencing side of
-- foreign keys. These keep joins, deletes and integrity checks predictable as
-- the Bar history grows.
create index if not exists bar_financial_entries_created_by_idx
  on public.bar_financial_entries (created_by)
  where created_by is not null;

create index if not exists bar_inventory_created_by_idx
  on public.bar_inventory_movements (created_by)
  where created_by is not null;

create index if not exists bar_inventory_order_item_idx
  on public.bar_inventory_movements (order_item_id)
  where order_item_id is not null;

create index if not exists bar_order_items_added_by_idx
  on public.bar_order_items (added_by)
  where added_by is not null;

create index if not exists bar_order_items_product_idx
  on public.bar_order_items (product_id)
  where product_id is not null;

create index if not exists bar_order_items_split_source_idx
  on public.bar_order_items (split_source_item_id)
  where split_source_item_id is not null;

create index if not exists bar_order_payment_parts_created_by_idx
  on public.bar_order_payment_parts (created_by)
  where created_by is not null;

create index if not exists bar_orders_opened_by_idx
  on public.bar_orders (opened_by)
  where opened_by is not null;

create index if not exists bar_push_dispatches_order_idx
  on public.bar_push_dispatches (order_id)
  where order_id is not null;

create index if not exists bar_runtime_settings_updated_by_idx
  on public.bar_runtime_settings (updated_by)
  where updated_by is not null;

create index if not exists bar_service_requests_handled_by_idx
  on public.bar_service_requests (handled_by)
  where handled_by is not null;

commit;
