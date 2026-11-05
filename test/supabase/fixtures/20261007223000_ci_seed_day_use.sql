-- Synthetic catalog prerequisite, copied only into the disposable CI database.
insert into public.bar_products (
  id, name, category, sale_price, cost_price, stock_quantity, active,
  menu_visible, menu_tv_visible
) values (
  '00000000-0000-4000-8000-000000000030', 'Day Use', 'Beach', 30, 0, 0, true,
  false, false
);
