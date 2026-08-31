create table if not exists public.app_store_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  sale_price numeric(10, 2) not null default 0 check (sale_price >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  track_stock boolean not null default true,
  image_url text,
  active boolean not null default true,
  display_order integer not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_store_products_code_format check (code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  constraint app_store_products_name_length check (char_length(trim(name)) between 2 and 120)
);

alter table public.app_store_products enable row level security;

grant select, insert, update, delete on public.app_store_products to authenticated;
grant select, insert, update, delete on public.app_store_products to service_role;

drop policy if exists "store products read active or staff" on public.app_store_products;
drop policy if exists "store products staff insert" on public.app_store_products;
drop policy if exists "store products staff update" on public.app_store_products;
drop policy if exists "store products staff delete" on public.app_store_products;

create policy "store products read active or staff"
on public.app_store_products for select
to authenticated
using (
  active is true
  or (select public.is_club_office())
);

create policy "store products staff insert"
on public.app_store_products for insert
to authenticated
with check ((select public.is_club_office()));

create policy "store products staff update"
on public.app_store_products for update
to authenticated
using ((select public.is_club_office()))
with check ((select public.is_club_office()));

create policy "store products staff delete"
on public.app_store_products for delete
to authenticated
using ((select public.is_club_office()));

insert into public.app_store_products (
  code, name, description, sale_price, stock_quantity, track_stock, image_url, active, display_order
)
values
  ('camisa_preta', 'Camisa preta Ilha', 'Uniforme oficial do clube.', 0, 0, false, '/camisapreta.png', true, 10),
  ('camisa_roxa', 'Camisa roxa Ilha', 'Uniforme oficial do clube.', 0, 0, false, '/camisaroxa.png', true, 20),
  ('camisa_verde', 'Camisa verde Ilha', 'Uniforme oficial do clube.', 0, 0, false, '/camisaverde.png', true, 30),
  ('bolinhas', 'Bolinhas de tênis', 'Compra de bolas na secretaria.', 0, 0, false, '/bolas.png', true, 40),
  ('encordoamento', 'Encordoamento', 'Serviço de corda para raquete.', 0, 0, false, '/cordas.png', true, 50)
on conflict (code) do nothing;

alter table public.app_store_requests
  add column if not exists product_id uuid references public.app_store_products(id) on delete set null;

update public.app_store_requests as request
   set product_id = product.id
  from public.app_store_products as product
 where request.product_id is null
   and product.code = request.product_code;

create index if not exists app_store_products_catalog_idx
  on public.app_store_products(active, display_order, name);

create index if not exists app_store_requests_product_idx
  on public.app_store_requests(product_id, created_at desc);

create or replace function public.touch_app_store_product_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.touch_app_store_product_updated_at() from public, anon, authenticated;

drop trigger if exists touch_app_store_product_updated_at_trigger on public.app_store_products;
create trigger touch_app_store_product_updated_at_trigger
before update on public.app_store_products
for each row execute function public.touch_app_store_product_updated_at();

create or replace function public.validate_app_store_request_product()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  product_row public.app_store_products%rowtype;
begin
  select product.* into product_row
    from public.app_store_products as product
   where (product.id = new.product_id or (new.product_id is null and product.code = new.product_code))
     and product.active is true
     and (product.track_stock is false or product.stock_quantity >= new.quantity)
   order by (product.id = new.product_id) desc
   limit 1;

  if product_row.id is null then
    raise exception 'Este produto está indisponível no momento.' using errcode = '23514';
  end if;

  new.product_id := product_row.id;
  new.product_code := product_row.code;
  new.product_name := product_row.name;
  new.amount := product_row.sale_price * new.quantity;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validate_app_store_request_product() from public, anon, authenticated;

drop trigger if exists validate_app_store_request_product_trigger on public.app_store_requests;
create trigger validate_app_store_request_product_trigger
before insert or update of product_id, product_code, product_name, amount, quantity
on public.app_store_requests
for each row execute function public.validate_app_store_request_product();

create or replace function public.sync_app_store_request_inventory()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_id uuid;
  tracked_product_exists boolean := false;
begin
  if tg_op = 'UPDATE'
     and old.status is distinct from 'ENTREGUE'
     and new.status = 'ENTREGUE' then
    select product.id, product.track_stock
      into target_id, tracked_product_exists
      from public.app_store_products as product
     where product.id = new.product_id or (new.product_id is null and product.code = new.product_code)
     order by (product.id = new.product_id) desc
     limit 1;

    if target_id is not null and tracked_product_exists then
      update public.app_store_products
         set stock_quantity = stock_quantity - new.quantity
       where id = target_id
         and stock_quantity >= new.quantity;

      if not found then
        raise exception 'Estoque insuficiente para concluir a entrega.' using errcode = '23514';
      end if;
    end if;
  elsif (tg_op = 'UPDATE' and old.status = 'ENTREGUE' and new.status is distinct from 'ENTREGUE')
     or (tg_op = 'DELETE' and old.status = 'ENTREGUE') then
    select product.id, product.track_stock
      into target_id, tracked_product_exists
      from public.app_store_products as product
     where product.id = old.product_id or (old.product_id is null and product.code = old.product_code)
     order by (product.id = old.product_id) desc
     limit 1;

    if target_id is not null and tracked_product_exists then
      update public.app_store_products
         set stock_quantity = stock_quantity + old.quantity
       where id = target_id;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.sync_app_store_request_inventory() from public, anon, authenticated;

drop trigger if exists sync_app_store_request_inventory_trigger on public.app_store_requests;
create trigger sync_app_store_request_inventory_trigger
after update of status or delete on public.app_store_requests
for each row execute function public.sync_app_store_request_inventory();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ilha-store-products',
  'ilha-store-products',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ilha store product images insert" on storage.objects;
drop policy if exists "ilha store product images update" on storage.objects;
drop policy if exists "ilha store product images delete" on storage.objects;

create policy "ilha store product images insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'ilha-store-products'
  and (select public.is_club_office())
);

create policy "ilha store product images update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'ilha-store-products'
  and (select public.is_club_office())
)
with check (
  bucket_id = 'ilha-store-products'
  and (select public.is_club_office())
);

create policy "ilha store product images delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'ilha-store-products'
  and (select public.is_club_office())
);
