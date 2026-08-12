create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  role text not null default 'secretaria' check (role in ('admin', 'secretaria', 'professor', 'bar')),
  teacher_id uuid,
  active boolean not null default true,
  permissions jsonb not null default '[]'::jsonb,
  notes text,
  avatar_url text,
  job_title text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists permissions jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists notes text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists job_title text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'secretaria', 'professor', 'bar'));

create table if not exists public.bar_user_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  details text,
  due_date date,
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'CONCLUIDA')),
  created_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bar_user_tasks_user_status_idx on public.bar_user_tasks(user_id, status, due_date);
create index if not exists bar_user_tasks_created_by_idx on public.bar_user_tasks(created_by);

create table if not exists public.app_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null default 'aluno' check (type in ('aluno', 'mensalista', 'avulso', 'outro')),
  amount numeric(10, 2) not null default 0,
  weekly_lessons integer not null default 0,
  default_due_day integer check (default_due_day between 1 and 31),
  active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_clients (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  cpf text,
  age integer,
  guardian_name text,
  guardian_phone text,
  profile_photo text,
  official_plan_id uuid references public.app_plans(id) on delete set null,
  official_plan_code text,
  official_plan_name text,
  plan_amount numeric(10, 2) not null default 0,
  weekly_lessons integer not null default 0,
  preferred_days jsonb not null default '[]'::jsonb,
  due_day integer check (due_day between 1 and 31),
  status text not null default 'ATIVO' check (status in ('ATIVO', 'BLOQUEADO', 'PENDENTE')),
  client_type text not null default 'cliente' check (client_type in ('cliente', 'aluno', 'mensalista', 'responsavel', 'socio')),
  source text not null default 'app',
  notes text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists app_clients_email_idx on public.app_clients(lower(email));

alter table public.app_clients add column if not exists cpf text;
alter table public.app_clients add column if not exists age integer;
alter table public.app_clients add column if not exists guardian_name text;
alter table public.app_clients add column if not exists guardian_phone text;
alter table public.app_clients add column if not exists profile_photo text;
alter table public.app_clients add column if not exists official_plan_id uuid references public.app_plans(id) on delete set null;
alter table public.app_clients add column if not exists official_plan_code text;
alter table public.app_clients add column if not exists official_plan_name text;
alter table public.app_clients add column if not exists plan_amount numeric(10, 2) not null default 0;
alter table public.app_clients add column if not exists weekly_lessons integer not null default 0;
alter table public.app_clients add column if not exists preferred_days jsonb not null default '[]'::jsonb;
alter table public.app_clients add column if not exists due_day integer;
alter table public.app_clients drop constraint if exists app_clients_client_type_check;
alter table public.app_clients add constraint app_clients_client_type_check check (client_type in ('cliente', 'aluno', 'mensalista', 'responsavel', 'socio'));

create table if not exists public.app_plan_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.app_clients(id) on delete cascade,
  plan_code text not null,
  plan_name text not null,
  amount numeric(10, 2) not null default 0,
  membership_type text not null default 'aluno',
  weekly_lessons integer not null default 0,
  requested_days jsonb not null default '[]'::jsonb,
  preferred_due_day integer check (preferred_due_day between 1 and 31),
  status text not null default 'SOLICITADO' check (status in ('SOLICITADO', 'EM_ANALISE', 'APROVADO', 'RECUSADO', 'CANCELADO')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_store_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.app_clients(id) on delete cascade,
  product_code text not null,
  product_name text not null,
  quantity integer not null default 1 check (quantity > 0),
  amount numeric(10, 2) not null default 0,
  status text not null default 'SOLICITADO' check (status in ('SOLICITADO', 'EM_ANALISE', 'APROVADO', 'RECUSADO', 'ENTREGUE', 'CANCELADO')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  image_url text,
  link_url text,
  target_type text not null default 'todos' check (target_type in ('todos', 'aluno', 'mensalista', 'avulso', 'outro', 'plano')),
  target_plan_code text,
  active boolean not null default true,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_court_bookings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.app_clients(id) on delete set null,
  client_name text not null,
  opponent_name text not null,
  booking_date date not null,
  starts_at time not null,
  court_name text not null default 'Quadra 1',
  status text not null default 'CONFIRMADO' check (status in ('CONFIRMADO', 'CANCELADO', 'BLOQUEADO')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_payment_invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.app_clients(id) on delete cascade,
  invoice_month date not null,
  description text not null default 'Mensalidade Ilha Tênis',
  plan_code text,
  plan_name text,
  amount numeric(10, 2) not null default 0,
  due_date date,
  status text not null default 'ABERTA' check (status in ('ABERTA', 'AGUARDANDO', 'PAGA', 'VENCIDA', 'CANCELADA')),
  payment_method text,
  paid_at timestamptz,
  pix_payload text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bar_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  category text not null default 'Bebidas',
  sale_price numeric(10, 2) not null default 0 check (sale_price >= 0),
  cost_price numeric(10, 2) not null default 0 check (cost_price >= 0),
  stock_quantity numeric(10, 3) not null default 0,
  minimum_stock numeric(10, 3) not null default 0,
  unit text not null default 'un',
  image_url text,
  active boolean not null default true,
  menu_visible boolean not null default true,
  menu_tv_visible boolean not null default false,
  menu_featured boolean not null default false,
  menu_sort_order integer not null default 1000,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bar_products
  add column if not exists menu_visible boolean not null default true,
  add column if not exists menu_tv_visible boolean;

update public.bar_products
set menu_tv_visible = menu_visible
where menu_tv_visible is null;

alter table public.bar_products
  alter column menu_tv_visible set default false,
  alter column menu_tv_visible set not null,
  add column if not exists menu_featured boolean not null default false,
  add column if not exists menu_sort_order integer not null default 1000;

create table if not exists public.bar_tables (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique check (number > 0),
  name text not null,
  seats integer not null default 4 check (seats > 0),
  qr_token text not null unique default encode(gen_random_bytes(9), 'hex'),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bar_public_cards (
  id uuid primary key default gen_random_uuid(),
  code bigint generated by default as identity unique,
  label text not null unique,
  token text not null unique default encode(gen_random_bytes(12), 'hex'),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bar_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  phone text not null unique check (phone ~ '^[0-9]{10,13}$'),
  last_order_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bar_orders (
  id uuid primary key default gen_random_uuid(),
  table_id uuid references public.bar_tables(id) on delete set null,
  public_access_id uuid references public.bar_public_cards(id) on delete set null,
  command_number bigint generated by default as identity,
  customer_name text,
  customer_phone text,
  source text not null default 'EQUIPE' check (source in ('EQUIPE', 'QR_MESA', 'QR_CARTAO')),
  public_tracking_token text not null unique default encode(gen_random_bytes(12), 'hex'),
  status text not null default 'ABERTA' check (status in ('ABERTA', 'EM_PREPARO', 'PRONTA', 'FECHADA', 'CANCELADA')),
  subtotal numeric(10, 2) not null default 0,
  service_charge numeric(10, 2) not null default 0,
  discount numeric(10, 2) not null default 0,
  total numeric(10, 2) not null default 0,
  payment_status text not null default 'ABERTO' check (payment_status in ('ABERTO', 'PARCIAL', 'PAGO', 'CANCELADO')),
  payment_method text,
  notes text,
  opened_by uuid references public.profiles(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bar_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.bar_orders(id) on delete cascade,
  product_id uuid references public.bar_products(id) on delete set null,
  product_name text not null,
  quantity numeric(10, 3) not null default 1 check (quantity > 0),
  unit_price numeric(10, 2) not null default 0 check (unit_price >= 0),
  cost_price numeric(10, 2) not null default 0 check (cost_price >= 0),
  customer_name text,
  customer_phone text,
  source text not null default 'EQUIPE' check (source in ('EQUIPE', 'QR_MESA', 'QR_CARTAO')),
  status text not null default 'SOLICITADO' check (status in ('SOLICITADO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE', 'CANCELADO')),
  notes text,
  delivery_location text,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bar_service_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.bar_orders(id) on delete cascade,
  request_type text not null check (request_type in ('ATENDIMENTO', 'FECHAR_CONTA')),
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'EM_ATENDIMENTO', 'CONCLUIDO', 'CANCELADO')),
  customer_name text not null,
  customer_phone text not null,
  message text,
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bar_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bar_push_subscriptions_user_idx
  on public.bar_push_subscriptions(user_id, enabled);

create table if not exists public.bar_push_config (
  id boolean primary key default true check (id = true),
  vapid_public_key text not null,
  vapid_private_key text not null,
  subject text not null default 'mailto:contato@ilhatenis.com',
  updated_at timestamptz not null default now()
);

create table if not exists public.bar_runtime_settings (
  id boolean primary key default true check (id = true),
  qr_orders_enabled boolean not null default true,
  closed_message text not null default 'No momento, o Ilha Bar está fechado. Em breve estaremos atendendo novamente.',
  category_images jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.bar_runtime_settings
  add column if not exists category_images jsonb not null default '{}'::jsonb;

insert into public.bar_runtime_settings (id, qr_orders_enabled)
values (true, true)
on conflict (id) do nothing;

create table if not exists public.bar_push_dispatches (
  dispatch_key text primary key,
  order_id uuid not null references public.bar_orders(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.bar_orders
  add column if not exists public_access_id uuid references public.bar_public_cards(id) on delete set null;
alter table public.bar_orders
  add column if not exists source text not null default 'EQUIPE';
alter table public.bar_orders
  add column if not exists public_tracking_token text not null default encode(gen_random_bytes(12), 'hex');
alter table public.bar_orders
  add column if not exists customer_phone text;
alter table public.bar_order_items
  add column if not exists customer_name text;
alter table public.bar_order_items
  add column if not exists customer_phone text;
alter table public.bar_order_items
  add column if not exists source text not null default 'EQUIPE';
alter table public.bar_order_items
  add column if not exists split_group_id uuid;
alter table public.bar_order_items
  add column if not exists split_source_item_id uuid references public.bar_order_items(id) on delete set null;
alter table public.bar_order_items
  add column if not exists split_with text;
alter table public.bar_order_items
  add column if not exists billing_only boolean not null default false;
alter table public.bar_order_items
  add column if not exists delivery_location text;
alter table public.bar_order_items
  drop constraint if exists bar_order_items_delivery_location_check;
alter table public.bar_order_items
  add constraint bar_order_items_delivery_location_check check (
    delivery_location is null or length(trim(delivery_location)) between 2 and 80
  );
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bar_orders_source_check'
  ) then
    alter table public.bar_orders
      add constraint bar_orders_source_check check (source in ('EQUIPE', 'QR_MESA', 'QR_CARTAO'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'bar_order_items_source_check'
  ) then
    alter table public.bar_order_items
      add constraint bar_order_items_source_check check (source in ('EQUIPE', 'QR_MESA', 'QR_CARTAO'));
  end if;
end;
$$;

create table if not exists public.bar_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.bar_products(id) on delete cascade,
  order_item_id uuid references public.bar_order_items(id) on delete set null,
  type text not null check (type in ('ENTRADA', 'SAIDA', 'AJUSTE', 'PERDA', 'ESTORNO')),
  quantity numeric(10, 3) not null check (quantity <> 0),
  unit_cost numeric(10, 2),
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.bar_financial_entries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.bar_orders(id) on delete set null,
  type text not null default 'RECEITA' check (type in ('RECEITA', 'DESPESA')),
  description text not null,
  counterparty text,
  category text not null default 'Bar',
  amount numeric(10, 2) not null default 0 check (amount >= 0),
  due_date date,
  status text not null default 'ABERTO' check (status in ('ABERTO', 'RECEBIDO', 'PAGO', 'VENCIDO', 'CANCELADO')),
  payment_method text,
  paid_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bar_order_payment_parts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.bar_orders(id) on delete cascade,
  position integer not null check (position between 1 and 12),
  person_name text not null check (length(trim(person_name)) between 1 and 80),
  amount numeric(10, 2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('PIX', 'DINHEIRO', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'CONTA_CLIENTE')),
  split_mode text not null default 'equal' check (split_mode in ('equal', 'separate')),
  allocation jsonb not null default '{}'::jsonb,
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'PAGO')),
  paid_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, position)
);

create table if not exists public.bar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 120),
  event_type text not null default 'EVENTO' check (event_type in ('EVENTO', 'TORNEIO', 'MUSICA', 'PROMOCAO', 'MANUTENCAO', 'OUTRO')),
  event_date date not null,
  starts_at time not null,
  ends_at time,
  location text,
  expected_guests integer not null default 0 check (expected_guests >= 0),
  status text not null default 'AGENDADO' check (status in ('AGENDADO', 'CONFIRMADO', 'CONCLUIDO', 'CANCELADO')),
  description text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bar_events_time_range_check check (ends_at is null or ends_at > starts_at)
);

create index if not exists app_plan_requests_client_idx on public.app_plan_requests(client_id, created_at desc);
create index if not exists app_plan_requests_status_idx on public.app_plan_requests(status, created_at desc);
create index if not exists app_plans_active_idx on public.app_plans(active, type);
create index if not exists app_store_requests_client_idx on public.app_store_requests(client_id, created_at desc);
create index if not exists app_store_requests_status_idx on public.app_store_requests(status, created_at desc);
create index if not exists app_announcements_active_idx on public.app_announcements(active, published_at desc);
create index if not exists app_court_bookings_day_idx on public.app_court_bookings(booking_date, court_name, starts_at);
create index if not exists app_payment_invoices_client_idx on public.app_payment_invoices(client_id, invoice_month desc);
create index if not exists app_payment_invoices_status_idx on public.app_payment_invoices(status, due_date);
create unique index if not exists app_payment_invoices_client_month_idx
  on public.app_payment_invoices(client_id, invoice_month);
create unique index if not exists app_court_bookings_slot_unique_idx
  on public.app_court_bookings(booking_date, court_name, starts_at)
  where status <> 'CANCELADO';
create unique index if not exists app_court_bookings_client_day_unique_idx
  on public.app_court_bookings(client_id, booking_date)
  where client_id is not null and status <> 'CANCELADO';
create index if not exists bar_products_active_idx on public.bar_products(active, category, name);
create index if not exists bar_products_stock_idx on public.bar_products(stock_quantity, minimum_stock) where active = true;
create index if not exists bar_products_public_menu_idx on public.bar_products(menu_visible, active, category, menu_sort_order, name);
create index if not exists bar_products_public_tv_menu_idx on public.bar_products(menu_tv_visible, active, category, menu_sort_order, name);
create index if not exists bar_public_cards_active_idx on public.bar_public_cards(active, code);
create index if not exists bar_customers_name_idx on public.bar_customers(lower(name));
create index if not exists bar_customers_last_order_idx on public.bar_customers(last_order_at desc);
create index if not exists bar_orders_status_idx on public.bar_orders(status, opened_at desc);
create unique index if not exists bar_orders_public_tracking_idx on public.bar_orders(public_tracking_token);
create unique index if not exists bar_orders_one_open_per_table_idx
  on public.bar_orders(table_id)
  where table_id is not null and status in ('ABERTA', 'EM_PREPARO', 'PRONTA');
create unique index if not exists bar_orders_one_open_per_card_idx
  on public.bar_orders(public_access_id)
  where public_access_id is not null and status in ('ABERTA', 'EM_PREPARO', 'PRONTA');
create index if not exists bar_order_items_order_idx on public.bar_order_items(order_id, created_at);
create index if not exists bar_order_items_status_idx on public.bar_order_items(status, created_at);
create index if not exists bar_service_requests_order_idx on public.bar_service_requests(order_id, created_at desc);
create index if not exists bar_service_requests_status_idx on public.bar_service_requests(status, created_at);
create index if not exists bar_events_date_idx on public.bar_events(event_date, starts_at);
create index if not exists bar_events_status_idx on public.bar_events(status, event_date desc);
create index if not exists bar_events_created_by_idx on public.bar_events(created_by);
create unique index if not exists bar_service_requests_active_unique_idx
  on public.bar_service_requests(order_id, request_type, customer_phone)
  where status in ('PENDENTE', 'EM_ATENDIMENTO');
create index if not exists bar_inventory_product_idx on public.bar_inventory_movements(product_id, occurred_at desc);
create index if not exists bar_financial_due_idx on public.bar_financial_entries(status, due_date);
create index if not exists bar_order_payment_parts_order_idx on public.bar_order_payment_parts(order_id, position);

create or replace function public.sync_bar_customer_from_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  customer_value text;
  phone_value text;
begin
  customer_value := left(trim(coalesce(new.customer_name, '')), 80);
  phone_value := regexp_replace(coalesce(new.customer_phone, ''), '[^0-9]', '', 'g');

  if length(customer_value) < 2 or length(phone_value) not between 10 and 13 then
    return new;
  end if;

  insert into public.bar_customers (name, phone, last_order_at)
  values (customer_value, phone_value, coalesce(new.opened_at, now()))
  on conflict (phone) do update
    set name = excluded.name,
        last_order_at = greatest(public.bar_customers.last_order_at, excluded.last_order_at),
        updated_at = now();

  return new;
end;
$$;

revoke all on function public.sync_bar_customer_from_order() from public, anon, authenticated;

drop trigger if exists bar_orders_sync_customer on public.bar_orders;
create trigger bar_orders_sync_customer
after insert or update of customer_name, customer_phone on public.bar_orders
for each row execute function public.sync_bar_customer_from_order();

with ranked_customers as (
  select
    left(trim(customer_name), 80) as name,
    regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g') as phone,
    opened_at,
    row_number() over (
      partition by regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g')
      order by opened_at desc, id desc
    ) as position
  from public.bar_orders
  where length(trim(coalesce(customer_name, ''))) between 2 and 80
    and length(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g')) between 10 and 13
)
insert into public.bar_customers (name, phone, last_order_at)
select name, phone, opened_at
from ranked_customers
where position = 1
on conflict (phone) do update
  set name = excluded.name,
      last_order_at = greatest(public.bar_customers.last_order_at, excluded.last_order_at),
      updated_at = now();

create or replace function public.refresh_bar_order_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order_id uuid;
begin
  target_order_id := coalesce(new.order_id, old.order_id);

  update public.bar_orders
     set subtotal = coalesce((
           select sum(quantity * unit_price)
             from public.bar_order_items
            where order_id = target_order_id
              and status <> 'CANCELADO'
         ), 0),
         total = greatest(0, coalesce((
           select sum(quantity * unit_price)
             from public.bar_order_items
            where order_id = target_order_id
              and status <> 'CANCELADO'
         ), 0) + service_charge - discount),
         updated_at = now()
   where id = target_order_id;

  return null;
end;
$$;

drop trigger if exists refresh_bar_order_totals_trigger on public.bar_order_items;
create trigger refresh_bar_order_totals_trigger
  after insert or update or delete on public.bar_order_items
  for each row execute function public.refresh_bar_order_totals();

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
  limit 1
$$;

create or replace function public.is_bar_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'secretaria', 'bar')
$$;

create or replace function public.bar_add_order_item(
  p_order_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_notes text default null,
  p_delivery_location text default null
)
returns public.bar_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  product_row public.bar_products%rowtype;
  item_row public.bar_order_items%rowtype;
  normalized_delivery_location text;
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'Quantidade invalida.';
  end if;

  normalized_delivery_location := nullif(trim(coalesce(p_delivery_location, '')), '');

  if normalized_delivery_location is not null
     and normalized_delivery_location not in (
       'Quadra 1', 'Quadra 2', 'Quadra 3', 'Quadra 4', 'Quadra 5',
       'Salão', 'Deck externo'
     ) then
    raise exception 'Local de entrega invalido.';
  end if;

  if not exists (
    select 1 from public.bar_orders
     where id = p_order_id
       and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
       and payment_status <> 'PAGO'
  ) then
    raise exception 'Comanda nao esta aberta ou o pagamento ja foi registrado.';
  end if;

  select * into product_row
    from public.bar_products
   where id = p_product_id
     and active = true
   for update;

  if not found then
    raise exception 'Produto indisponivel.';
  end if;

  if product_row.stock_quantity < p_quantity then
    raise exception 'Estoque insuficiente para %.', product_row.name;
  end if;

  insert into public.bar_order_items (
    order_id, product_id, product_name, quantity, unit_price, cost_price, notes,
    delivery_location, added_by
  ) values (
    p_order_id, product_row.id, product_row.name, p_quantity, product_row.sale_price,
    product_row.cost_price, nullif(trim(coalesce(p_notes, '')), ''),
    normalized_delivery_location, auth.uid()
  ) returning * into item_row;

  update public.bar_products
     set stock_quantity = stock_quantity - p_quantity,
         updated_at = now()
   where id = product_row.id;

  insert into public.bar_inventory_movements (
    product_id, order_item_id, type, quantity, unit_cost, reason, created_by
  ) values (
    product_row.id, item_row.id, 'SAIDA', -p_quantity, product_row.cost_price,
    'Venda na comanda', auth.uid()
  );

  return item_row;
end;
$$;

create or replace function public.bar_split_order_item(
  p_item_id uuid,
  p_targets jsonb,
  p_source_name text
)
returns setof public.bar_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  source_item public.bar_order_items%rowtype;
  split_id uuid := gen_random_uuid();
  target_count integer;
  participant_count integer;
  total_cents integer;
  base_cents integer;
  remainder_cents integer;
  source_share_cents integer;
  target_share_cents integer;
  source_name text;
  target_names text[];
  all_names text[];
  target record;
  other_names text;
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  if jsonb_typeof(p_targets) <> 'array' then
    raise exception 'Selecione pelo menos uma comanda para dividir.';
  end if;

  target_count := jsonb_array_length(p_targets);
  if target_count < 1 or target_count > 20 then
    raise exception 'Selecione entre 1 e 20 comandas para dividir.';
  end if;

  select item.* into source_item
    from public.bar_order_items item
    join public.bar_orders order_row on order_row.id = item.order_id
   where item.id = p_item_id
     and item.status <> 'CANCELADO'
     and order_row.status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
     and order_row.payment_status <> 'PAGO'
   for update of item;

  if not found then
    raise exception 'Item indisponivel para divisao.';
  end if;

  if source_item.billing_only or source_item.split_group_id is not null then
    raise exception 'Este item ja foi dividido.';
  end if;

  if source_item.quantity <> 1 then
    raise exception 'Divida apenas uma porcao por vez.';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_targets) target_row
     where nullif(target_row ->> 'order_id', '') is null
        or (target_row ->> 'order_id')::uuid = source_item.order_id
  ) or (
    select count(distinct target_row ->> 'order_id')
      from jsonb_array_elements(p_targets) target_row
  ) <> target_count then
    raise exception 'A lista de comandas para divisao e invalida.';
  end if;

  if (
    select count(*)
      from public.bar_orders order_row
     where order_row.id in (
       select (target_row ->> 'order_id')::uuid
         from jsonb_array_elements(p_targets) target_row
     )
       and order_row.status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
       and order_row.payment_status <> 'PAGO'
  ) <> target_count then
    raise exception 'Uma das comandas escolhidas nao esta mais aberta.';
  end if;

  source_name := left(coalesce(nullif(trim(p_source_name), ''), 'Comanda atual'), 80);
  select array_agg(left(coalesce(nullif(trim(target_row ->> 'name'), ''), 'Outra comanda'), 80) order by ordinality)
    into target_names
    from jsonb_array_elements(p_targets) with ordinality as targets(target_row, ordinality);
  all_names := array_prepend(source_name, target_names);

  participant_count := target_count + 1;
  total_cents := round(source_item.quantity * source_item.unit_price * 100)::integer;
  base_cents := total_cents / participant_count;
  remainder_cents := total_cents % participant_count;
  source_share_cents := base_cents + case when remainder_cents > 0 then 1 else 0 end;

  update public.bar_order_items
     set unit_price = source_share_cents::numeric / 100,
         split_group_id = split_id,
         split_source_item_id = id,
         split_with = array_to_string(target_names, ', '),
         updated_at = now()
   where id = source_item.id;

  for target in
    select (target_row ->> 'order_id')::uuid as order_id,
           left(coalesce(nullif(trim(target_row ->> 'name'), ''), 'Outra comanda'), 80) as name,
           ordinality::integer as position
      from jsonb_array_elements(p_targets) with ordinality as targets(target_row, ordinality)
     order by ordinality
  loop
    target_share_cents := base_cents + case when target.position < remainder_cents then 1 else 0 end;
    select string_agg(participant_name, ', ' order by position)
      into other_names
      from unnest(all_names) with ordinality as participants(participant_name, position)
     where position <> target.position + 1;

    insert into public.bar_order_items (
      order_id, product_id, product_name, quantity, unit_price, cost_price,
      customer_name, source, status, added_by, split_group_id,
      split_source_item_id, split_with, billing_only
    ) values (
      target.order_id, source_item.product_id, source_item.product_name, 1,
      target_share_cents::numeric / 100, 0, target.name, 'EQUIPE', 'ENTREGUE',
      auth.uid(), split_id, source_item.id, other_names, true
    );
  end loop;

  return query
    select item.*
      from public.bar_order_items item
     where item.split_group_id = split_id
     order by item.billing_only, item.created_at, item.id;
end;
$$;

create or replace function public.bar_remove_order_item_split(p_item_id uuid)
returns public.bar_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_item public.bar_order_items%rowtype;
  source_item public.bar_order_items%rowtype;
  restored_total numeric(10, 2);
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  select * into selected_item
    from public.bar_order_items
   where id = p_item_id
   for update;

  if not found or selected_item.split_group_id is null then
    raise exception 'Divisao nao encontrada.';
  end if;

  perform 1
    from public.bar_order_items
   where split_group_id = selected_item.split_group_id
   order by id
   for update;

  select * into source_item
    from public.bar_order_items
   where id = selected_item.split_source_item_id
     and split_group_id = selected_item.split_group_id
     and billing_only = false;

  if not found then
    raise exception 'Item original da divisao nao encontrado.';
  end if;

  perform 1
    from public.bar_orders
   where id in (
     select distinct order_id
       from public.bar_order_items
      where split_group_id = selected_item.split_group_id
   )
   order by id
   for update;

  if exists (
    select 1
      from public.bar_orders
     where id in (
       select distinct order_id
         from public.bar_order_items
        where split_group_id = selected_item.split_group_id
     )
       and (
         status not in ('ABERTA', 'EM_PREPARO', 'PRONTA')
         or payment_status = 'PAGO'
       )
  ) then
    raise exception 'Reabra o pagamento das comandas antes de remover a divisao.';
  end if;

  select round(sum(quantity * unit_price), 2)
    into restored_total
    from public.bar_order_items
   where split_group_id = selected_item.split_group_id
     and status <> 'CANCELADO';

  if restored_total is null then
    raise exception 'Nao foi possivel recuperar o valor da divisao.';
  end if;

  delete from public.bar_order_items
   where split_group_id = selected_item.split_group_id
     and billing_only = true;

  update public.bar_order_items
     set unit_price = restored_total / quantity,
         split_group_id = null,
         split_source_item_id = null,
         split_with = null,
         updated_at = now()
   where id = source_item.id
   returning * into source_item;

  return source_item;
end;
$$;

create or replace function public.bar_cancel_order_item(p_item_id uuid)
returns public.bar_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  item_row public.bar_order_items%rowtype;
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  select * into item_row
    from public.bar_order_items
   where id = p_item_id
   for update;

  if not found then
    raise exception 'Item nao encontrado.';
  end if;

  if item_row.status = 'CANCELADO' then
    return item_row;
  end if;

  if item_row.split_group_id is not null then
    raise exception 'Um item dividido nao pode ser excluido isoladamente.';
  end if;

  if exists (
    select 1
      from public.bar_orders
     where id = item_row.order_id
       and payment_status = 'PAGO'
  ) then
    raise exception 'O pagamento desta comanda ja foi registrado. Reabra o pagamento antes de excluir itens.';
  end if;

  update public.bar_order_items
     set status = 'CANCELADO', updated_at = now()
   where id = item_row.id
   returning * into item_row;

  if item_row.product_id is not null then
    update public.bar_products
       set stock_quantity = stock_quantity + item_row.quantity,
           updated_at = now()
     where id = item_row.product_id;

    insert into public.bar_inventory_movements (
      product_id, order_item_id, type, quantity, unit_cost, reason, created_by
    ) values (
      item_row.product_id, item_row.id, 'ESTORNO', item_row.quantity, item_row.cost_price,
      'Cancelamento de item', auth.uid()
    );
  end if;

  return item_row;
end;
$$;

create or replace function public.bar_set_order_item_quantity(p_item_id uuid, p_quantity numeric)
returns public.bar_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  item_row public.bar_order_items%rowtype;
  previous_quantity numeric;
  restored_quantity numeric;
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  if p_quantity is null or p_quantity < 0 then
    raise exception 'Informe uma quantidade valida.';
  end if;

  select * into item_row
    from public.bar_order_items
   where id = p_item_id
   for update;

  if not found then
    raise exception 'Item nao encontrado.';
  end if;

  if item_row.status = 'CANCELADO' then
    raise exception 'Este item ja foi cancelado.';
  end if;

  if item_row.split_group_id is not null then
    raise exception 'Um item dividido nao pode ter a quantidade alterada.';
  end if;

  if exists (
    select 1
      from public.bar_orders
     where id = item_row.order_id
       and payment_status = 'PAGO'
  ) then
    raise exception 'O pagamento desta comanda ja foi registrado. Reabra o pagamento antes de editar itens.';
  end if;

  previous_quantity := item_row.quantity;
  if p_quantity > previous_quantity then
    raise exception 'Esta edicao permite somente reduzir a quantidade atual.';
  end if;

  restored_quantity := previous_quantity - p_quantity;
  if restored_quantity = 0 then
    return item_row;
  end if;

  if p_quantity = 0 then
    update public.bar_order_items
       set status = 'CANCELADO', updated_at = now()
     where id = item_row.id
     returning * into item_row;
  else
    update public.bar_order_items
       set quantity = p_quantity, updated_at = now()
     where id = item_row.id
     returning * into item_row;
  end if;

  if item_row.product_id is not null then
    update public.bar_products
       set stock_quantity = stock_quantity + restored_quantity,
           updated_at = now()
     where id = item_row.product_id;

    insert into public.bar_inventory_movements (
      product_id, order_item_id, type, quantity, unit_cost, reason, created_by
    ) values (
      item_row.product_id, item_row.id, 'ESTORNO', restored_quantity, item_row.cost_price,
      'Reducao de quantidade do item', auth.uid()
    );
  end if;

  return item_row;
end;
$$;

create or replace function public.bar_delete_open_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.bar_orders%rowtype;
  item_row public.bar_order_items%rowtype;
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  select * into order_row
    from public.bar_orders
   where id = p_order_id
     and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
   for update;

  if not found then
    raise exception 'Comanda nao encontrada ou ja encerrada.';
  end if;

  if exists (
    select 1
      from public.bar_financial_entries
     where order_id = order_row.id
       and status = 'RECEBIDO'
  ) then
    raise exception 'A comanda possui recebimentos e nao pode ser excluida.';
  end if;

  if exists (
    select 1
      from public.bar_order_items
     where order_id = order_row.id
       and split_group_id is not null
  ) then
    raise exception 'A comanda possui uma porcao dividida e nao pode ser excluida.';
  end if;

  for item_row in
    select *
      from public.bar_order_items
     where order_id = order_row.id
       and status <> 'CANCELADO'
     for update
  loop
    if item_row.product_id is not null and not item_row.billing_only then
      update public.bar_products
         set stock_quantity = stock_quantity + item_row.quantity,
             updated_at = now()
       where id = item_row.product_id;

      insert into public.bar_inventory_movements (
        product_id, order_item_id, type, quantity, unit_cost, reason, created_by
      ) values (
        item_row.product_id, item_row.id, 'ESTORNO', item_row.quantity, item_row.cost_price,
        'Exclusao da comanda #' || order_row.command_number, auth.uid()
      );
    end if;
  end loop;

  delete from public.bar_orders where id = order_row.id;
  return order_row.id;
end;
$$;

create or replace function public.bar_adjust_stock(
  p_product_id uuid,
  p_type text,
  p_quantity numeric,
  p_reason text default null,
  p_unit_cost numeric default null
)
returns public.bar_products
language plpgsql
security definer
set search_path = public
as $$
declare
  product_row public.bar_products%rowtype;
  signed_quantity numeric;
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  if p_type not in ('ENTRADA', 'SAIDA', 'AJUSTE', 'PERDA') or coalesce(p_quantity, 0) <= 0 then
    raise exception 'Movimentacao de estoque invalida.';
  end if;

  signed_quantity := case when p_type = 'ENTRADA' then p_quantity else -p_quantity end;

  update public.bar_products
     set stock_quantity = stock_quantity + signed_quantity,
         cost_price = case when p_unit_cost is not null then p_unit_cost else cost_price end,
         updated_at = now()
   where id = p_product_id
     and stock_quantity + signed_quantity >= 0
   returning * into product_row;

  if not found then
    raise exception 'Produto nao encontrado ou estoque insuficiente.';
  end if;

  insert into public.bar_inventory_movements (
    product_id, type, quantity, unit_cost, reason, created_by
  ) values (
    product_row.id, p_type, signed_quantity, coalesce(p_unit_cost, product_row.cost_price),
    nullif(trim(coalesce(p_reason, '')), ''), auth.uid()
  );

  return product_row;
end;
$$;

create or replace function public.bar_mark_closed_order_items_delivered()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'FECHADA' and old.status is distinct from new.status then
    update public.bar_order_items
       set status = 'ENTREGUE',
           updated_at = coalesce(new.closed_at, now())
     where order_id = new.id
       and status in ('SOLICITADO', 'EM_PREPARO', 'PRONTO');
  end if;
  return new;
end;
$$;

drop trigger if exists bar_orders_deliver_items_on_close on public.bar_orders;
create trigger bar_orders_deliver_items_on_close
after update of status on public.bar_orders
for each row
execute function public.bar_mark_closed_order_items_delivered();

create or replace function public.bar_close_order(
  p_order_id uuid,
  p_payment_method text,
  p_discount numeric default 0,
  p_service_charge numeric default 0
)
returns public.bar_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.bar_orders%rowtype;
  table_label text;
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  update public.bar_orders
     set discount = greatest(0, coalesce(p_discount, 0)),
         service_charge = greatest(0, coalesce(p_service_charge, 0)),
         total = greatest(0, subtotal + greatest(0, coalesce(p_service_charge, 0)) - greatest(0, coalesce(p_discount, 0))),
         status = 'FECHADA',
         payment_status = 'PAGO',
         payment_method = nullif(trim(coalesce(p_payment_method, '')), ''),
         closed_at = now(),
         updated_at = now()
   where id = p_order_id
     and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
   returning * into order_row;

  if not found then
    raise exception 'Comanda nao encontrada ou ja fechada.';
  end if;

  select name into table_label from public.bar_tables where id = order_row.table_id;

  insert into public.bar_financial_entries (
    order_id, type, description, counterparty, category, amount, due_date,
    status, payment_method, paid_at, created_by
  ) values (
    order_row.id, 'RECEITA', 'Venda da comanda #' || order_row.command_number,
    coalesce(order_row.customer_name, table_label, 'Balcao'), 'Vendas', order_row.total,
    current_date, 'RECEBIDO', order_row.payment_method, now(), auth.uid()
  );

  update public.bar_service_requests
     set status = 'CONCLUIDO',
         handled_by = auth.uid(),
         handled_at = now(),
         updated_at = now()
   where order_id = order_row.id
     and status in ('PENDENTE', 'EM_ATENDIMENTO');

  return order_row;
end;
$$;

create or replace function public.bar_close_order_split(
  p_order_id uuid,
  p_payments jsonb,
  p_discount numeric default 0,
  p_service_charge numeric default 0
)
returns public.bar_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.bar_orders%rowtype;
  table_label text;
  payment_item jsonb;
  payment_index bigint;
  payment_count integer;
  payment_method_value text;
  payment_amount numeric(10, 2);
  payment_total numeric(10, 2) := 0;
  order_total numeric(10, 2);
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  select *
    into order_row
    from public.bar_orders
   where id = p_order_id
     and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
   for update;

  if not found then
    raise exception 'Comanda nao encontrada ou ja fechada.';
  end if;

  if coalesce(jsonb_typeof(p_payments), '') <> 'array' then
    raise exception 'Informe as divisoes de pagamento.';
  end if;

  payment_count := jsonb_array_length(p_payments);
  if payment_count < 2 or payment_count > 12 then
    raise exception 'A conta deve ser dividida entre 2 e 12 pessoas.';
  end if;

  order_total := round(greatest(
    0,
    order_row.subtotal
      + greatest(0, coalesce(p_service_charge, 0))
      - greatest(0, coalesce(p_discount, 0))
  ), 2);

  for payment_item, payment_index in
    select value, ordinality
      from jsonb_array_elements(p_payments) with ordinality
  loop
    payment_method_value := upper(trim(coalesce(payment_item ->> 'payment_method', '')));
    if payment_method_value not in ('PIX', 'DINHEIRO', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'CONTA_CLIENTE') then
      raise exception 'Forma de pagamento invalida na divisao %.', payment_index;
    end if;

    begin
      payment_amount := round(coalesce(nullif(payment_item ->> 'amount', '')::numeric, 0), 2);
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Valor invalido na divisao %.', payment_index;
    end;

    if payment_amount <= 0 then
      raise exception 'O valor da divisao % deve ser maior que zero.', payment_index;
    end if;

    payment_total := payment_total + payment_amount;
  end loop;

  if round(payment_total, 2) <> order_total then
    raise exception 'A soma das divisoes (%) deve ser igual ao total da comanda (%).', round(payment_total, 2), order_total;
  end if;

  update public.bar_orders
     set discount = greatest(0, coalesce(p_discount, 0)),
         service_charge = greatest(0, coalesce(p_service_charge, 0)),
         total = order_total,
         status = 'FECHADA',
         payment_status = 'PAGO',
         payment_method = 'DIVIDIDO',
         closed_at = now(),
         updated_at = now()
   where id = order_row.id
   returning * into order_row;

  select name into table_label from public.bar_tables where id = order_row.table_id;

  for payment_item, payment_index in
    select value, ordinality
      from jsonb_array_elements(p_payments) with ordinality
  loop
    payment_method_value := upper(trim(payment_item ->> 'payment_method'));
    payment_amount := round((payment_item ->> 'amount')::numeric, 2);

    insert into public.bar_financial_entries (
      order_id, type, description, counterparty, category, amount, due_date,
      status, payment_method, paid_at, notes, created_by
    ) values (
      order_row.id,
      'RECEITA',
      'Venda da comanda #' || order_row.command_number || ' · Divisao ' || payment_index || '/' || payment_count,
      coalesce(order_row.customer_name, table_label, 'Balcao'),
      'Vendas',
      payment_amount,
      current_date,
      'RECEBIDO',
      payment_method_value,
      now(),
      'Conta dividida entre ' || payment_count || ' pessoas.',
      auth.uid()
    );
  end loop;

  update public.bar_service_requests
     set status = 'CONCLUIDO',
         handled_by = auth.uid(),
         handled_at = now(),
         updated_at = now()
   where order_id = order_row.id
     and status in ('PENDENTE', 'EM_ATENDIMENTO');

  return order_row;
end;
$$;

create or replace function public.bar_pay_order(
  p_order_id uuid,
  p_payment_method text,
  p_discount numeric default 0,
  p_service_charge numeric default 0
)
returns public.bar_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.bar_orders%rowtype;
  table_label text;
  payment_method_value text;
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  select *
    into order_row
    from public.bar_orders
   where id = p_order_id
     and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
   for update;

  if not found then
    raise exception 'Comanda nao encontrada ou ja encerrada.';
  end if;

  if order_row.payment_status = 'PAGO' then
    return order_row;
  end if;

  payment_method_value := upper(trim(coalesce(p_payment_method, '')));
  if payment_method_value not in ('PIX', 'DINHEIRO', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'CONTA_CLIENTE') then
    raise exception 'Forma de pagamento invalida.';
  end if;

  if exists (
    select 1
      from public.bar_financial_entries
     where order_id = order_row.id
       and type = 'RECEITA'
       and status in ('RECEBIDO', 'PAGO')
  ) then
    raise exception 'O recebimento desta comanda ja foi registrado.';
  end if;

  update public.bar_orders
     set discount = greatest(0, coalesce(p_discount, 0)),
         service_charge = greatest(0, coalesce(p_service_charge, 0)),
         total = greatest(0, subtotal + greatest(0, coalesce(p_service_charge, 0)) - greatest(0, coalesce(p_discount, 0))),
         payment_status = 'PAGO',
         payment_method = payment_method_value,
         closed_at = null,
         updated_at = now()
   where id = order_row.id
   returning * into order_row;

  select name into table_label from public.bar_tables where id = order_row.table_id;

  insert into public.bar_financial_entries (
    order_id, type, description, counterparty, category, amount, due_date,
    status, payment_method, paid_at, notes, created_by
  ) values (
    order_row.id,
    'RECEITA',
    'Venda da comanda #' || order_row.command_number,
    coalesce(order_row.customer_name, table_label, 'Balcao'),
    'Vendas',
    order_row.total,
    current_date,
    'RECEBIDO',
    order_row.payment_method,
    now(),
    nullif(trim(coalesce(order_row.notes, '')), ''),
    auth.uid()
  );

  return order_row;
end;
$$;

create or replace function public.bar_pay_order_split(
  p_order_id uuid,
  p_payments jsonb,
  p_discount numeric default 0,
  p_service_charge numeric default 0
)
returns public.bar_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.bar_orders%rowtype;
  table_label text;
  payment_item jsonb;
  payment_index bigint;
  payment_count integer;
  payment_method_value text;
  payment_amount numeric(10, 2);
  payment_total numeric(10, 2) := 0;
  order_total numeric(10, 2);
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  select *
    into order_row
    from public.bar_orders
   where id = p_order_id
     and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
   for update;

  if not found then
    raise exception 'Comanda nao encontrada ou ja encerrada.';
  end if;

  if order_row.payment_status = 'PAGO' then
    return order_row;
  end if;

  if exists (
    select 1
      from public.bar_financial_entries
     where order_id = order_row.id
       and type = 'RECEITA'
       and status in ('RECEBIDO', 'PAGO')
  ) then
    raise exception 'O recebimento desta comanda ja foi registrado.';
  end if;

  if coalesce(jsonb_typeof(p_payments), '') <> 'array' then
    raise exception 'Informe as divisoes de pagamento.';
  end if;

  payment_count := jsonb_array_length(p_payments);
  if payment_count < 2 or payment_count > 12 then
    raise exception 'A conta deve ser dividida entre 2 e 12 pessoas.';
  end if;

  order_total := round(greatest(
    0,
    order_row.subtotal
      + greatest(0, coalesce(p_service_charge, 0))
      - greatest(0, coalesce(p_discount, 0))
  ), 2);

  for payment_item, payment_index in
    select value, ordinality
      from jsonb_array_elements(p_payments) with ordinality
  loop
    payment_method_value := upper(trim(coalesce(payment_item ->> 'payment_method', '')));
    if payment_method_value not in ('PIX', 'DINHEIRO', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'CONTA_CLIENTE') then
      raise exception 'Forma de pagamento invalida na divisao %.', payment_index;
    end if;

    begin
      payment_amount := round(coalesce(nullif(payment_item ->> 'amount', '')::numeric, 0), 2);
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Valor invalido na divisao %.', payment_index;
    end;

    if payment_amount <= 0 then
      raise exception 'O valor da divisao % deve ser maior que zero.', payment_index;
    end if;

    payment_total := payment_total + payment_amount;
  end loop;

  if round(payment_total, 2) <> order_total then
    raise exception 'A soma das divisoes (%) deve ser igual ao total da comanda (%).', round(payment_total, 2), order_total;
  end if;

  update public.bar_orders
     set discount = greatest(0, coalesce(p_discount, 0)),
         service_charge = greatest(0, coalesce(p_service_charge, 0)),
         total = order_total,
         payment_status = 'PAGO',
         payment_method = 'DIVIDIDO',
         closed_at = null,
         updated_at = now()
   where id = order_row.id
   returning * into order_row;

  select name into table_label from public.bar_tables where id = order_row.table_id;

  for payment_item, payment_index in
    select value, ordinality
      from jsonb_array_elements(p_payments) with ordinality
  loop
    payment_method_value := upper(trim(payment_item ->> 'payment_method'));
    payment_amount := round((payment_item ->> 'amount')::numeric, 2);

    insert into public.bar_financial_entries (
      order_id, type, description, counterparty, category, amount, due_date,
      status, payment_method, paid_at, notes, created_by
    ) values (
      order_row.id,
      'RECEITA',
      'Venda da comanda #' || order_row.command_number || ' · Divisao ' || payment_index || '/' || payment_count,
      coalesce(order_row.customer_name, table_label, 'Balcao'),
      'Vendas',
      payment_amount,
      current_date,
      'RECEBIDO',
      payment_method_value,
      now(),
      concat_ws(
        ' · ',
        'Conta dividida entre ' || payment_count || ' pessoas.',
        nullif(trim(coalesce(order_row.notes, '')), '')
      ),
      auth.uid()
    );
  end loop;

  return order_row;
end;
$$;

create or replace function public.bar_save_order_payment_split(
  p_order_id uuid,
  p_parts jsonb,
  p_discount numeric default 0,
  p_service_charge numeric default 0,
  p_split_mode text default 'equal'
)
returns public.bar_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.bar_orders%rowtype;
  part_item jsonb;
  part_position integer;
  part_name text;
  part_method text;
  part_amount numeric(10, 2);
  part_total numeric(10, 2) := 0;
  order_total numeric(10, 2);
  paid_total numeric(10, 2);
  part_count integer;
  split_mode_value text;
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  select * into order_row
    from public.bar_orders
   where id = p_order_id
     and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
   for update;

  if not found then
    raise exception 'Comanda nao encontrada ou ja encerrada.';
  end if;

  if coalesce(jsonb_typeof(p_parts), '') <> 'array' then
    raise exception 'Informe as pessoas da divisao.';
  end if;

  part_count := jsonb_array_length(p_parts);
  if part_count < 2 or part_count > 12 then
    raise exception 'A conta deve ser dividida entre 2 e 12 pessoas.';
  end if;
  if (select count(distinct (value ->> 'position')) from jsonb_array_elements(p_parts)) <> part_count then
    raise exception 'Cada pessoa deve ocupar uma posicao unica na divisao.';
  end if;

  split_mode_value := lower(trim(coalesce(p_split_mode, 'equal')));
  if split_mode_value not in ('equal', 'separate') then
    raise exception 'Tipo de divisao invalido.';
  end if;

  order_total := round(greatest(
    0,
    order_row.subtotal
      + greatest(0, coalesce(p_service_charge, 0))
      - greatest(0, coalesce(p_discount, 0))
  ), 2);

  for part_item in select value from jsonb_array_elements(p_parts)
  loop
    part_position := coalesce(nullif(part_item ->> 'position', '')::integer, 0);
    part_name := left(trim(coalesce(part_item ->> 'person_name', '')), 80);
    part_method := upper(trim(coalesce(part_item ->> 'payment_method', '')));
    part_amount := round(coalesce(nullif(part_item ->> 'amount', '')::numeric, 0), 2);

    if part_position < 1 or part_position > part_count then
      raise exception 'Posicao invalida na divisao.';
    end if;
    if part_name = '' then
      raise exception 'Informe o nome da pessoa %.', part_position;
    end if;
    if part_method not in ('PIX', 'DINHEIRO', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'CONTA_CLIENTE') then
      raise exception 'Forma de pagamento invalida para %.', part_name;
    end if;
    if part_amount <= 0 then
      raise exception 'O valor de % deve ser maior que zero.', part_name;
    end if;

    if exists (
      select 1 from public.bar_order_payment_parts
       where order_id = order_row.id
         and position = part_position
         and status = 'PAGO'
         and (amount <> part_amount or person_name <> part_name)
    ) then
      raise exception 'A parte ja paga de % nao pode ser alterada.', part_name;
    end if;

    part_total := part_total + part_amount;
  end loop;

  if round(part_total, 2) <> order_total then
    raise exception 'A soma das pessoas (%) deve ser igual ao total da comanda (%).', round(part_total, 2), order_total;
  end if;

  delete from public.bar_order_payment_parts
   where order_id = order_row.id
     and status = 'PENDENTE';

  for part_item in select value from jsonb_array_elements(p_parts)
  loop
    part_position := (part_item ->> 'position')::integer;
    part_name := left(trim(part_item ->> 'person_name'), 80);
    part_method := upper(trim(part_item ->> 'payment_method'));
    part_amount := round((part_item ->> 'amount')::numeric, 2);

    insert into public.bar_order_payment_parts (
      order_id, position, person_name, amount, payment_method, split_mode, allocation, created_by
    ) values (
      order_row.id,
      part_position,
      part_name,
      part_amount,
      part_method,
      split_mode_value,
      coalesce(part_item -> 'allocation', '{}'::jsonb),
      auth.uid()
    )
    on conflict (order_id, position) do update
      set person_name = excluded.person_name,
          amount = excluded.amount,
          payment_method = excluded.payment_method,
          split_mode = excluded.split_mode,
          allocation = excluded.allocation,
          updated_at = now()
      where public.bar_order_payment_parts.status = 'PENDENTE';
  end loop;

  select coalesce(sum(amount), 0) into paid_total
    from public.bar_order_payment_parts
   where order_id = order_row.id
     and status = 'PAGO';

  update public.bar_orders
     set discount = greatest(0, coalesce(p_discount, 0)),
         service_charge = greatest(0, coalesce(p_service_charge, 0)),
         total = order_total,
         payment_status = case when paid_total >= order_total and order_total > 0 then 'PAGO' when paid_total > 0 then 'PARCIAL' else 'ABERTO' end,
         payment_method = 'DIVIDIDO',
         closed_at = null,
         updated_at = now()
   where id = order_row.id
   returning * into order_row;

  return order_row;
end;
$$;

create or replace function public.bar_receive_order_payment_part(
  p_order_id uuid,
  p_position integer,
  p_parts jsonb,
  p_discount numeric default 0,
  p_service_charge numeric default 0,
  p_split_mode text default 'equal',
  p_notes text default null
)
returns public.bar_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.bar_orders%rowtype;
  payment_part public.bar_order_payment_parts%rowtype;
  table_label text;
  paid_total numeric(10, 2);
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  perform public.bar_save_order_payment_split(
    p_order_id,
    p_parts,
    p_discount,
    p_service_charge,
    p_split_mode
  );

  select * into order_row
    from public.bar_orders
   where id = p_order_id
   for update;

  select * into payment_part
    from public.bar_order_payment_parts
   where order_id = p_order_id
     and position = p_position
   for update;

  if not found then
    raise exception 'Pessoa nao encontrada nesta divisao.';
  end if;

  if payment_part.status = 'PAGO' then
    return order_row;
  end if;

  select name into table_label from public.bar_tables where id = order_row.table_id;

  insert into public.bar_financial_entries (
    order_id, type, description, counterparty, category, amount, due_date,
    status, payment_method, paid_at, notes, created_by
  ) values (
    order_row.id,
    'RECEITA',
    'Venda da comanda #' || order_row.command_number || ' · ' || payment_part.person_name,
    payment_part.person_name,
    'Vendas',
    payment_part.amount,
    current_date,
    'RECEBIDO',
    payment_part.payment_method,
    now(),
    concat_ws(' · ', 'Pagamento individual', nullif(trim(coalesce(p_notes, '')), '')),
    auth.uid()
  );

  update public.bar_order_payment_parts
     set status = 'PAGO', paid_at = now(), updated_at = now()
   where id = payment_part.id;

  select coalesce(sum(amount), 0) into paid_total
    from public.bar_order_payment_parts
   where order_id = order_row.id
     and status = 'PAGO';

  update public.bar_orders
     set payment_status = case when paid_total >= total and total > 0 then 'PAGO' else 'PARCIAL' end,
         payment_method = 'DIVIDIDO',
         notes = nullif(trim(coalesce(p_notes, '')), ''),
         updated_at = now()
   where id = order_row.id
   returning * into order_row;

  return order_row;
end;
$$;

create or replace function public.bar_finalize_paid_order(p_order_id uuid)
returns public.bar_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.bar_orders%rowtype;
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  select *
    into order_row
    from public.bar_orders
   where id = p_order_id
   for update;

  if not found then
    raise exception 'Comanda nao encontrada.';
  end if;

  if order_row.status = 'FECHADA' and order_row.payment_status = 'PAGO' then
    return order_row;
  end if;

  if order_row.status not in ('ABERTA', 'EM_PREPARO', 'PRONTA') then
    raise exception 'Comanda nao esta aberta.';
  end if;

  if order_row.payment_status <> 'PAGO' then
    raise exception 'Registre o pagamento antes de encerrar a comanda.';
  end if;

  if exists (
    select 1
      from public.bar_order_items item
      left join public.bar_products product on product.id = item.product_id
     where item.order_id = order_row.id
       and item.status in ('SOLICITADO', 'EM_PREPARO', 'PRONTO')
       and (
         lower(coalesce(product.category, '')) like '%porç%'
         or lower(coalesce(product.category, '')) like '%porc%'
         or lower(coalesce(product.category, '')) like '%almo%'
         or lower(coalesce(product.category, '')) like '%frita%'
         or lower(coalesce(product.category, '')) like '%petisco%'
       )
  ) then
    raise exception 'Ainda existe porção ou refeição aguardando entrega.';
  end if;

  update public.bar_orders
     set status = 'FECHADA',
         closed_at = now(),
         updated_at = now()
   where id = order_row.id
   returning * into order_row;

  update public.bar_service_requests
     set status = 'CONCLUIDO',
         handled_by = auth.uid(),
         handled_at = now(),
         updated_at = now()
   where order_id = order_row.id
     and status in ('PENDENTE', 'EM_ATENDIMENTO');

  return order_row;
end;
$$;

create or replace function public.bar_reopen_order(p_order_id uuid)
returns public.bar_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.bar_orders%rowtype;
  reopen_table_id uuid;
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  select *
    into order_row
    from public.bar_orders
   where id = p_order_id
     and status = 'FECHADA'
   for update;

  if not found then
    raise exception 'Comanda nao encontrada ou nao esta fechada.';
  end if;

  reopen_table_id := order_row.table_id;
  if reopen_table_id is not null and exists (
    select 1
      from public.bar_orders
     where table_id = reopen_table_id
       and id <> order_row.id
       and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
  ) then
    reopen_table_id := null;
  end if;

  update public.bar_financial_entries
     set status = 'CANCELADO',
         paid_at = null,
         notes = concat_ws(
           ' · ',
           nullif(trim(coalesce(notes, '')), ''),
           'Estornado ao reabrir a comanda em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
         ),
         updated_at = now()
   where order_id = order_row.id
     and type = 'RECEITA'
     and status in ('RECEBIDO', 'PAGO');

  update public.bar_orders
     set table_id = reopen_table_id,
         status = 'ABERTA',
         payment_status = 'ABERTO',
         payment_method = null,
         opened_at = now(),
         closed_at = null,
         updated_at = now()
   where id = order_row.id
   returning * into order_row;

  return order_row;
end;
$$;

insert into public.app_plans (code, name, type, amount, weekly_lessons, default_due_day, active, description)
values
  ('aulas_anual_1x', 'Aulas 1x por semana - Anual', 'aluno', 230, 1, 10, true, 'Ciclo de 12 meses. Pix 5% OFF no pagamento do ciclo.'),
  ('aulas_semestral_1x', 'Aulas 1x por semana - Semestral', 'aluno', 250, 1, 10, true, 'Ciclo de 6 meses. Pix 5% OFF no pagamento do ciclo.'),
  ('aulas_mensal_1x', 'Aulas 1x por semana - Mensal', 'aluno', 270, 1, 10, true, 'Plano mensal de aulas uma vez por semana.'),
  ('aulas_anual_2x', 'Aulas 2x por semana - Anual', 'aluno', 350, 2, 10, true, 'Ciclo de 12 meses. Pix 5% OFF no pagamento do ciclo.'),
  ('aulas_semestral_2x', 'Aulas 2x por semana - Semestral', 'aluno', 370, 2, 10, true, 'Ciclo de 6 meses. Pix 5% OFF no pagamento do ciclo.'),
  ('aulas_mensal_2x', 'Aulas 2x por semana - Mensal', 'aluno', 390, 2, 10, true, 'Plano mensal de aulas duas vezes por semana.'),
  ('jogar_anual', 'Somente jogar - Anual', 'mensalista', 130, 0, 10, true, 'Acesso mensal às quadras conforme regras do clube. Ciclo de 12 meses. Pix 5% OFF.'),
  ('jogar_semestral', 'Somente jogar - Semestral', 'mensalista', 140, 0, 10, true, 'Acesso mensal às quadras conforme regras do clube. Ciclo de 6 meses. Pix 5% OFF.'),
  ('jogar_mensal', 'Somente jogar - Mensal', 'mensalista', 150, 0, 10, true, 'Acesso mensal às quadras conforme regras do clube.'),
  ('aula_avulsa', 'Aula avulsa', 'avulso', 80, 0, 10, true, 'Valor por aula avulsa.'),
  ('familia', 'Plano família', 'outro', 0, 0, 10, true, 'Cálculo com a equipe conforme quantidade de pessoas da mesma família.')
on conflict (code) do update
set name = excluded.name,
    type = excluded.type,
    amount = excluded.amount,
    weekly_lessons = excluded.weekly_lessons,
    default_due_day = excluded.default_due_day,
    active = excluded.active,
    description = excluded.description,
    updated_at = now();

insert into public.bar_products (
  name, sku, category, sale_price, cost_price, stock_quantity,
  minimum_stock, unit, active, notes
)
values
  ('Água mineral 500 ml', 'AGUA500', 'Águas', 4.00, 1.50, 48, 12, 'un', true, 'Garrafa gelada 500 ml'),
  ('Água com gás 500 ml', 'AGUAGAS500', 'Águas', 5.00, 2.00, 36, 10, 'un', true, 'Garrafa gelada 500 ml'),
  ('Coca-Cola lata 350 ml', 'COCA350', 'Refrigerantes', 7.00, 3.80, 48, 12, 'un', true, 'Lata gelada 350 ml'),
  ('Coca-Cola Zero lata 350 ml', 'COCAZERO350', 'Refrigerantes', 7.00, 3.80, 36, 10, 'un', true, 'Lata gelada 350 ml'),
  ('Guaraná Antarctica lata 350 ml', 'GUARANA350', 'Refrigerantes', 7.00, 3.50, 36, 10, 'un', true, 'Lata gelada 350 ml'),
  ('Suco Del Valle lata 290 ml', 'SUCO290', 'Bebidas', 7.00, 3.60, 24, 8, 'un', true, 'Consulte os sabores disponíveis'),
  ('Stella Artois Long Neck', 'STELLA01', 'Cervejas', 12.00, 8.50, 36, 12, 'un', true, 'Long neck gelada'),
  ('Heineken Long Neck', 'HEINEKEN330', 'Cervejas', 12.00, 7.50, 48, 12, 'un', true, 'Long neck gelada 330 ml'),
  ('Budweiser Long Neck', 'BUD330', 'Cervejas', 10.00, 6.00, 36, 10, 'un', true, 'Long neck gelada 330 ml'),
  ('Brahma Duplo Malte lata', 'BRAHMADM350', 'Cervejas', 8.00, 4.50, 48, 12, 'un', true, 'Lata gelada 350 ml'),
  ('Porção de batata frita', 'PORCAOBATATA', 'Porções', 28.00, 10.00, 20, 5, 'un', true, 'Batata frita crocante'),
  ('Porção de calabresa', 'PORCAOCALABRESA', 'Porções', 32.00, 14.00, 15, 4, 'un', true, 'Calabresa acebolada'),
  ('Porção mista', 'PORCAOMISTA', 'Porções', 38.00, 17.00, 12, 3, 'un', true, 'Batata frita e calabresa acebolada')
on conflict (sku) do update
set name = excluded.name,
    category = excluded.category,
    sale_price = excluded.sale_price,
    cost_price = excluded.cost_price,
    minimum_stock = excluded.minimum_stock,
    unit = excluded.unit,
    active = excluded.active,
    notes = excluded.notes,
    updated_at = now();

insert into public.bar_public_cards (code, label, notes)
values
  (1, 'Cartão 01', 'Cartão individual para pedidos sem mesa fixa'),
  (2, 'Cartão 02', 'Cartão individual para pedidos sem mesa fixa'),
  (3, 'Cartão 03', 'Cartão individual para pedidos sem mesa fixa'),
  (4, 'Cartão 04', 'Cartão individual para pedidos sem mesa fixa'),
  (5, 'Cartão 05', 'Cartão individual para pedidos sem mesa fixa'),
  (6, 'Cartão 06', 'Cartão individual para pedidos sem mesa fixa'),
  (7, 'Cartão 07', 'Cartão individual para pedidos sem mesa fixa'),
  (8, 'Cartão 08', 'Cartão individual para pedidos sem mesa fixa'),
  (9, 'Cartão 09', 'Cartão individual para pedidos sem mesa fixa'),
  (10, 'Cartão 10', 'Cartão individual para pedidos sem mesa fixa'),
  (11, 'Cartão 11', 'Cartão individual para pedidos sem mesa fixa'),
  (12, 'Cartão 12', 'Cartão individual para pedidos sem mesa fixa'),
  (13, 'Cartão 13', 'Cartão individual para pedidos sem mesa fixa'),
  (14, 'Cartão 14', 'Cartão individual para pedidos sem mesa fixa'),
  (15, 'Cartão 15', 'Cartão individual para pedidos sem mesa fixa'),
  (16, 'Cartão 16', 'Cartão individual para pedidos sem mesa fixa'),
  (17, 'Cartão 17', 'Cartão individual para pedidos sem mesa fixa'),
  (18, 'Cartão 18', 'Cartão individual para pedidos sem mesa fixa'),
  (19, 'Cartão 19', 'Cartão individual para pedidos sem mesa fixa'),
  (20, 'Cartão 20', 'Cartão individual para pedidos sem mesa fixa')
on conflict (code) do update
set label = excluded.label,
    notes = excluded.notes,
    active = true,
    updated_at = now();

select setval(
  pg_get_serial_sequence('public.bar_public_cards', 'code'),
  greatest(1, coalesce((select max(code) from public.bar_public_cards), 1)),
  true
);

alter table public.app_plan_requests add column if not exists membership_type text not null default 'aluno';
alter table public.app_plan_requests add column if not exists weekly_lessons integer not null default 0;
alter table public.app_plan_requests add column if not exists requested_days jsonb not null default '[]'::jsonb;
alter table public.app_plan_requests add column if not exists preferred_due_day integer;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and active = true
  limit 1
$$;

create or replace function public.is_club_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'secretaria', 'professor')
$$;

create or replace function public.is_club_office()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'secretaria')
$$;

create or replace function public.is_bar_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'secretaria', 'bar')
$$;

drop function if exists public.bar_update_order_customer(uuid, text, text, uuid, text);

create or replace function public.bar_update_order_customer(
  p_order_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_table_id uuid,
  p_public_access_id uuid,
  p_notes text
)
returns public.bar_orders
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous_name text;
  customer_value text;
  phone_value text;
  updated_order public.bar_orders%rowtype;
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado.';
  end if;

  customer_value := left(regexp_replace(trim(coalesce(p_customer_name, '')), '\s+', ' ', 'g'), 80);
  if length(customer_value) < 2 then
    raise exception 'Informe um nome com pelo menos 2 caracteres.';
  end if;

  phone_value := nullif(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g'), '');
  if phone_value is not null and length(phone_value) not between 10 and 13 then
    raise exception 'Informe um telefone com DDD válido.';
  end if;

  select customer_name into previous_name
    from public.bar_orders
   where id = p_order_id
     and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
   for update;

  if not found then
    raise exception 'Comanda aberta não encontrada.';
  end if;

  if p_table_id is not null and not exists (
    select 1 from public.bar_tables where id = p_table_id and active = true
  ) then
    raise exception 'Escolha uma mesa ativa.';
  end if;

  if p_table_id is not null and exists (
    select 1
      from public.bar_orders
     where table_id = p_table_id
       and id <> p_order_id
       and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
  ) then
    raise exception 'Essa mesa já possui uma comanda aberta.';
  end if;

  update public.bar_orders
     set customer_name = customer_value,
         customer_phone = phone_value,
         table_id = p_table_id,
         public_access_id = p_public_access_id,
         notes = nullif(left(trim(coalesce(p_notes, '')), 500), ''),
         updated_at = now()
   where id = p_order_id
   returning * into updated_order;

  update public.bar_order_items
     set customer_name = customer_value,
         customer_phone = phone_value,
         updated_at = now()
   where order_id = p_order_id
     and (
       customer_name is null
       or trim(customer_name) = ''
       or lower(trim(customer_name)) = lower(trim(coalesce(previous_name, '')))
     );

  update public.bar_service_requests
     set customer_name = customer_value,
         customer_phone = phone_value,
         updated_at = now()
   where order_id = p_order_id
     and status in ('PENDENTE', 'EM_ATENDIMENTO')
     and (
       customer_name is null
       or trim(customer_name) = ''
       or lower(trim(customer_name)) = lower(trim(coalesce(previous_name, '')))
     );

  return updated_order;
end;
$$;

revoke all on function public.bar_update_order_customer(uuid, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.bar_update_order_customer(uuid, text, text, uuid, uuid, text) to authenticated;

create or replace function public.bar_public_menu(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  table_row public.bar_tables%rowtype;
  card_row public.bar_public_cards%rowtype;
  linked_order_row public.bar_orders%rowtype;
  qr_orders_enabled_value boolean := true;
  closed_message_value text := 'No momento, o Ilha Bar está fechado. Em breve estaremos atendendo novamente.';
  category_images_value jsonb := '{}'::jsonb;
  has_fixed_table boolean := false;
  has_card boolean := false;
begin
  if length(trim(coalesce(p_token, ''))) < 12 then
    raise exception 'QR Code invalido.';
  end if;

  select * into table_row
    from public.bar_tables
   where qr_token = trim(p_token)
     and active = true
   limit 1;
  has_fixed_table := found;

  if has_fixed_table then
    select * into linked_order_row
      from public.bar_orders
     where table_id = table_row.id
       and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
     order by opened_at desc
     limit 1;
  else
    select * into card_row
      from public.bar_public_cards
     where token = trim(p_token)
       and active = true
     limit 1;
    has_card := found;

    if has_card then
      select * into linked_order_row
        from public.bar_orders
       where public_access_id = card_row.id
         and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
       order by opened_at desc
       limit 1;
    end if;
  end if;

  if not has_fixed_table and not has_card then
    raise exception 'Este QR Code nao esta ativo.';
  end if;

  select settings.qr_orders_enabled, settings.closed_message, settings.category_images
    into qr_orders_enabled_value, closed_message_value, category_images_value
    from public.bar_runtime_settings settings
   where settings.id = true;

  qr_orders_enabled_value := coalesce(qr_orders_enabled_value, true);
  closed_message_value := coalesce(nullif(trim(closed_message_value), ''), 'No momento, o Ilha Bar está fechado. Em breve estaremos atendendo novamente.');

  return jsonb_build_object(
    'availability', jsonb_build_object(
      'enabled', qr_orders_enabled_value,
      'message', closed_message_value
    ),
    'category_images', coalesce(category_images_value, '{}'::jsonb),
    'access', jsonb_build_object(
      'kind', case when has_fixed_table then 'MESA' else 'CARTAO' end,
      'label', case when has_fixed_table then table_row.name else card_row.label end,
      'fixed_table_id', case when has_fixed_table then table_row.id else null end,
      'linked_customer_name', linked_order_row.customer_name,
      'linked', linked_order_row.id is not null,
      'linked_command_number', linked_order_row.command_number
    ),
    'tables', case
      when has_fixed_table then jsonb_build_array(jsonb_build_object(
        'id', table_row.id,
        'number', table_row.number,
        'name', table_row.name,
        'seats', table_row.seats
      ))
      else '[]'::jsonb
    end,
    'products', case when qr_orders_enabled_value then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', product.id,
        'name', product.name,
        'category', product.category,
        'price', product.sale_price,
        'image_url', product.image_url,
        'description', product.notes,
        'available_quantity', greatest(0, floor(product.stock_quantity))::integer
      ) order by product.category, product.name)
      from public.bar_products product
      where product.active = true
        and product.stock_quantity > 0
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

drop function if exists public.bar_public_submit_order(text, text, uuid, jsonb, text);

create or replace function public.bar_public_submit_order(
  p_token text,
  p_customer_name text,
  p_table_id uuid default null,
  p_items jsonb default '[]'::jsonb,
  p_notes text default null,
  p_customer_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  access_table public.bar_tables%rowtype;
  card_row public.bar_public_cards%rowtype;
  order_row public.bar_orders%rowtype;
  product_row public.bar_products%rowtype;
  item_row public.bar_order_items%rowtype;
  item_payload jsonb;
  selected_table_id uuid;
  access_card_id uuid;
  access_source text;
  customer_value text;
  phone_value text;
  order_notes text;
  product_id_value uuid;
  quantity_value numeric;
  item_notes text;
  delivery_location_value text;
  has_fixed_table boolean := false;
  has_card boolean := false;
  qr_orders_enabled_value boolean := true;
  closed_message_value text := 'No momento, o Ilha Bar está fechado. Em breve estaremos atendendo novamente.';
begin
  if length(trim(coalesce(p_token, ''))) < 12 then
    raise exception 'QR Code invalido.';
  end if;

  select settings.qr_orders_enabled, settings.closed_message
    into qr_orders_enabled_value, closed_message_value
    from public.bar_runtime_settings settings
   where settings.id = true;

  if not coalesce(qr_orders_enabled_value, true) then
    raise exception '%', coalesce(nullif(trim(closed_message_value), ''), 'No momento, o Ilha Bar está fechado. Em breve estaremos atendendo novamente.');
  end if;

  customer_value := left(trim(coalesce(p_customer_name, '')), 80);
  if length(customer_value) < 2 then
    raise exception 'Informe seu nome.';
  end if;

  phone_value := regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g');
  if length(phone_value) not between 10 and 13 then
    raise exception 'Informe um telefone válido com DDD.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Escolha pelo menos um produto.';
  end if;
  if jsonb_array_length(p_items) > 25 then
    raise exception 'Pedido muito grande. Divida em dois pedidos.';
  end if;

  select * into access_table
    from public.bar_tables
   where qr_token = trim(p_token)
     and active = true
   limit 1;
  has_fixed_table := found;

  if has_fixed_table then
    selected_table_id := access_table.id;
    access_source := 'QR_MESA';
    if p_table_id is not null and p_table_id <> access_table.id then
      raise exception 'A mesa informada nao corresponde ao QR Code.';
    end if;
  else
    select * into card_row
      from public.bar_public_cards
     where token = trim(p_token)
       and active = true
     limit 1;
    has_card := found;
    if not has_card then
      raise exception 'Este QR Code nao esta ativo.';
    end if;
    access_card_id := card_row.id;
    access_source := 'QR_CARTAO';

    if p_table_id is not null then
      raise exception 'Este cartão está vinculado a uma comanda avulsa.';
    end if;
  end if;

  if selected_table_id is not null then
    select * into order_row
      from public.bar_orders
     where table_id = selected_table_id
       and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
     order by opened_at desc
     limit 1
     for update;

    if not found then
      begin
        insert into public.bar_orders (
          table_id, public_access_id, customer_name, customer_phone, source, notes
        ) values (
          selected_table_id, access_card_id, customer_value, phone_value, access_source,
          nullif(left(trim(coalesce(p_notes, '')), 300), '')
        ) returning * into order_row;
      exception when unique_violation then
        select * into order_row
          from public.bar_orders
         where table_id = selected_table_id
           and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
         order by opened_at desc
         limit 1
         for update;
      end;
    end if;
  else
    select * into order_row
      from public.bar_orders
     where public_access_id = access_card_id
       and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
     order by opened_at desc
     limit 1
     for update;

    if not found then
      raise exception 'Este cartão ainda não foi vinculado a uma comanda. Solicite a abertura no balcão.';
    end if;
  end if;

  if order_row.id is null then
    raise exception 'Nao foi possivel abrir a comanda.';
  end if;

  for item_payload in
    select value from jsonb_array_elements(p_items) as payload(value)
  loop
    begin
      product_id_value := nullif(item_payload ->> 'product_id', '')::uuid;
      quantity_value := floor(coalesce(nullif(item_payload ->> 'quantity', '')::numeric, 0));
    exception when others then
      raise exception 'Produto ou quantidade invalida.';
    end;

    if product_id_value is null or quantity_value < 1 or quantity_value > 20 then
      raise exception 'Quantidade invalida no pedido.';
    end if;

    select * into product_row
      from public.bar_products
     where id = product_id_value
       and active = true
     for update;

    if not found then
      raise exception 'Um produto do pedido nao esta mais disponivel.';
    end if;
    if product_row.stock_quantity < quantity_value then
      raise exception 'Estoque insuficiente para %.', product_row.name;
    end if;

    item_notes := nullif(left(trim(coalesce(item_payload ->> 'notes', '')), 160), '');
    delivery_location_value := nullif(left(trim(coalesce(item_payload ->> 'delivery_location', '')), 80), '');
    if has_card and delivery_location_value is null then
      raise exception 'Informe onde você está para receber o pedido.';
    end if;
    if has_fixed_table then
      delivery_location_value := null;
    end if;
    insert into public.bar_order_items (
      order_id, product_id, product_name, quantity, unit_price, cost_price,
      customer_name, customer_phone, source, notes, delivery_location
    ) values (
      order_row.id, product_row.id, product_row.name, quantity_value,
      product_row.sale_price, product_row.cost_price, customer_value, phone_value,
      access_source, item_notes, delivery_location_value
    ) returning * into item_row;

    update public.bar_products
       set stock_quantity = stock_quantity - quantity_value,
           updated_at = now()
     where id = product_row.id;

    insert into public.bar_inventory_movements (
      product_id, order_item_id, type, quantity, unit_cost, reason
    ) values (
      product_row.id, item_row.id, 'SAIDA', -quantity_value,
      product_row.cost_price, 'Pedido online de ' || customer_value
    );
  end loop;

  order_notes := nullif(left(trim(coalesce(p_notes, '')), 300), '');
  update public.bar_orders
     set status = case when status = 'PRONTA' then 'ABERTA' else status end,
         customer_name = coalesce(nullif(customer_name, ''), customer_value),
         customer_phone = coalesce(nullif(customer_phone, ''), phone_value),
         public_access_id = coalesce(public_access_id, access_card_id),
         notes = case
           when order_notes is null then notes
           when notes is null or trim(notes) = '' then customer_value || ': ' || order_notes
           else notes || E'\n' || customer_value || ': ' || order_notes
         end,
         updated_at = now()
   where id = order_row.id
   returning * into order_row;

  return jsonb_build_object(
    'order_id', order_row.id,
    'tracking_token', order_row.public_tracking_token,
    'command_number', order_row.command_number,
    'status', order_row.status,
    'total', order_row.total,
    'table_name', coalesce((
      select table_item.name from public.bar_tables table_item where table_item.id = order_row.table_id
    ), card_row.label, 'Balcao')
  );
end;
$$;

create or replace function public.bar_public_claim_access(
  p_token text,
  p_customer_name text,
  p_customer_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  table_row public.bar_tables%rowtype;
  card_row public.bar_public_cards%rowtype;
  order_row public.bar_orders%rowtype;
  customer_value text;
  phone_value text;
  access_source text;
  access_label text;
  access_kind text;
  has_fixed_table boolean := false;
  qr_orders_enabled_value boolean := true;
  closed_message_value text := 'No momento, o Ilha Bar está fechado. Em breve estaremos atendendo novamente.';
begin
  if length(trim(coalesce(p_token, ''))) < 12 then
    raise exception 'QR Code invalido.';
  end if;

  select settings.qr_orders_enabled, settings.closed_message
    into qr_orders_enabled_value, closed_message_value
    from public.bar_runtime_settings settings
   where settings.id = true;

  if not coalesce(qr_orders_enabled_value, true) then
    raise exception '%', coalesce(nullif(trim(closed_message_value), ''), 'No momento, o Ilha Bar está fechado. Em breve estaremos atendendo novamente.');
  end if;

  customer_value := left(trim(coalesce(p_customer_name, '')), 80);
  if length(customer_value) < 2 then
    raise exception 'Informe seu nome.';
  end if;

  phone_value := regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g');
  if length(phone_value) not between 10 and 13 then
    raise exception 'Informe um telefone válido com DDD.';
  end if;

  select tables.* into table_row
    from public.bar_tables tables
   where tables.qr_token = trim(p_token)
     and tables.active = true
   limit 1
   for update;
  has_fixed_table := found;

  if has_fixed_table then
    access_source := 'QR_MESA';
    access_label := table_row.name;
    access_kind := 'MESA';
  else
    select cards.* into card_row
      from public.bar_public_cards cards
     where cards.token = trim(p_token)
       and cards.active = true
     limit 1
     for update;

    if not found then
      raise exception 'Este QR Code nao esta ativo.';
    end if;

    access_source := 'QR_CARTAO';
    access_label := card_row.label;
    access_kind := 'CARTAO';
  end if;

  select orders.* into order_row
    from public.bar_orders orders
   where (
       (has_fixed_table and orders.table_id = table_row.id)
       or
       (not has_fixed_table and orders.public_access_id = card_row.id)
     )
     and orders.status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
   order by orders.opened_at desc
   limit 1
   for update;

  if not found then
    begin
      insert into public.bar_orders (
        table_id, public_access_id, customer_name, customer_phone, source
      ) values (
        case when has_fixed_table then table_row.id else null end,
        case when has_fixed_table then null else card_row.id end,
        customer_value,
        phone_value,
        access_source
      ) returning * into order_row;
    exception when unique_violation then
      select orders.* into order_row
        from public.bar_orders orders
       where (
           (has_fixed_table and orders.table_id = table_row.id)
           or
           (not has_fixed_table and orders.public_access_id = card_row.id)
         )
         and orders.status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
       order by orders.opened_at desc
       limit 1
       for update;
    end;
  end if;

  if order_row.id is null then
    raise exception 'Nao foi possivel abrir a comanda.';
  end if;

  return jsonb_build_object(
    'command_number', order_row.command_number,
    'status', order_row.status,
    'customer_name', order_row.customer_name,
    'access_label', access_label,
    'access_kind', access_kind
  );
end;
$$;

create or replace function public.bar_public_submit_card_order(
  p_token text,
  p_items jsonb default '[]'::jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.bar_orders%rowtype;
  result_value jsonb;
begin
  select orders.* into order_row
    from public.bar_orders orders
   where orders.status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
     and (
       exists (
         select 1 from public.bar_tables tables
          where tables.id = orders.table_id
            and tables.qr_token = trim(coalesce(p_token, ''))
            and tables.active = true
       )
       or exists (
         select 1 from public.bar_public_cards cards
          where cards.id = orders.public_access_id
            and cards.token = trim(coalesce(p_token, ''))
            and cards.active = true
       )
     )
   order by orders.opened_at desc
   limit 1;

  if not found then
    raise exception 'Este QR Code ainda não foi vinculado a uma comanda. Solicite a abertura no balcão.';
  end if;

  result_value := public.bar_public_submit_order(
    p_token,
    order_row.customer_name,
    null,
    p_items,
    p_notes,
    order_row.customer_phone
  );

  return result_value - 'tracking_token';
end;
$$;

create or replace function public.bar_public_card_order_status(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  order_row public.bar_orders%rowtype;
begin
  select orders.* into order_row
    from public.bar_orders orders
   where orders.status in ('ABERTA', 'EM_PREPARO', 'PRONTA', 'FECHADA', 'CANCELADA')
     and (
       exists (
         select 1 from public.bar_tables tables
          where tables.id = orders.table_id
            and tables.qr_token = trim(coalesce(p_token, ''))
            and tables.active = true
       )
       or exists (
         select 1 from public.bar_public_cards cards
          where cards.id = orders.public_access_id
            and cards.token = trim(coalesce(p_token, ''))
            and cards.active = true
       )
     )
   order by case
              when orders.status in ('ABERTA', 'EM_PREPARO', 'PRONTA') then 0
              else 1
            end,
            orders.opened_at desc
   limit 1;

  if not found then
    raise exception 'Este QR Code não está vinculado a uma comanda aberta.';
  end if;

  return public.bar_public_order_status(order_row.public_tracking_token, null);
end;
$$;

create or replace function public.bar_public_card_request_service(
  p_token text,
  p_request_type text,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.bar_orders%rowtype;
begin
  select orders.* into order_row
    from public.bar_orders orders
   where orders.status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
     and (
       exists (
         select 1 from public.bar_tables tables
          where tables.id = orders.table_id
            and tables.qr_token = trim(coalesce(p_token, ''))
            and tables.active = true
       )
       or exists (
         select 1 from public.bar_public_cards cards
          where cards.id = orders.public_access_id
            and cards.token = trim(coalesce(p_token, ''))
            and cards.active = true
       )
     )
   order by orders.opened_at desc
   limit 1;

  if not found then
    raise exception 'Este QR Code ainda não foi vinculado a uma comanda. Solicite a abertura no balcão.';
  end if;

  return public.bar_public_request_service(
    order_row.public_tracking_token,
    p_request_type,
    order_row.customer_name,
    order_row.customer_phone,
    p_message
  );
end;
$$;

drop function if exists public.bar_public_order_status(text);

create or replace function public.bar_public_order_status(
  p_tracking_token text,
  p_customer_phone text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  order_row public.bar_orders%rowtype;
  phone_value text;
begin
  if length(trim(coalesce(p_tracking_token, ''))) < 12 then
    raise exception 'Comanda invalida.';
  end if;

  select * into order_row
    from public.bar_orders
   where public_tracking_token = trim(p_tracking_token)
   limit 1;

  if not found then
    raise exception 'Comanda nao encontrada.';
  end if;

  phone_value := nullif(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g'), '');

  return jsonb_build_object(
    'order_id', order_row.id,
    'command_number', order_row.command_number,
    'customer_name', order_row.customer_name,
    'table_name', coalesce((
      select table_item.name from public.bar_tables table_item where table_item.id = order_row.table_id
    ), (
      select card_item.label from public.bar_public_cards card_item where card_item.id = order_row.public_access_id
    ), 'Balcao'),
    'status', order_row.status,
    'payment_status', order_row.payment_status,
    'subtotal', order_row.subtotal,
    'total', order_row.total,
    'opened_at', order_row.opened_at,
    'closed_at', order_row.closed_at,
    'service_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request.id,
        'type', request.request_type,
        'status', request.status,
        'created_at', request.created_at,
        'handled_at', request.handled_at
      ) order by request.created_at desc)
      from public.bar_service_requests request
      where request.order_id = order_row.id
        and (phone_value is null or request.customer_phone = phone_value)
        and request.status <> 'CANCELADO'
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'name', item.product_name,
        'quantity', item.quantity,
        'unit_price', item.unit_price,
        'status', item.status,
        'notes', item.notes,
        'customer_name', item.customer_name,
        'created_at', item.created_at
      ) order by item.created_at)
      from public.bar_order_items item
      where item.order_id = order_row.id
        and item.status <> 'CANCELADO'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.bar_public_request_service(
  p_tracking_token text,
  p_request_type text,
  p_customer_name text,
  p_customer_phone text,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.bar_orders%rowtype;
  request_row public.bar_service_requests%rowtype;
  request_type_value text;
  customer_value text;
  phone_value text;
  message_value text;
  phone_matches boolean := false;
begin
  if length(trim(coalesce(p_tracking_token, ''))) < 12 then
    raise exception 'Comanda inválida.';
  end if;

  request_type_value := upper(trim(coalesce(p_request_type, '')));
  if request_type_value not in ('ATENDIMENTO', 'FECHAR_CONTA') then
    raise exception 'Solicitação inválida.';
  end if;

  customer_value := left(trim(coalesce(p_customer_name, '')), 80);
  if length(customer_value) < 2 then
    raise exception 'Informe seu nome.';
  end if;

  phone_value := regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g');
  if length(phone_value) not between 10 and 13 then
    raise exception 'Informe um telefone válido com DDD.';
  end if;
  message_value := nullif(left(trim(coalesce(p_message, '')), 240), '');

  select * into order_row
    from public.bar_orders
   where public_tracking_token = trim(p_tracking_token)
     and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
   limit 1
   for update;

  if not found then
    raise exception 'Esta comanda não está mais aberta.';
  end if;

  phone_matches := regexp_replace(coalesce(order_row.customer_phone, ''), '[^0-9]', '', 'g') = phone_value
    or exists (
      select 1
        from public.bar_order_items item
       where item.order_id = order_row.id
         and regexp_replace(coalesce(item.customer_phone, ''), '[^0-9]', '', 'g') = phone_value
    );

  if not phone_matches then
    if nullif(order_row.customer_phone, '') is null
       and lower(trim(coalesce(order_row.customer_name, ''))) = lower(customer_value) then
      update public.bar_orders
         set customer_phone = phone_value,
             updated_at = now()
       where id = order_row.id;
    else
      raise exception 'O telefone não corresponde a esta comanda.';
    end if;
  end if;

  select * into request_row
    from public.bar_service_requests
   where order_id = order_row.id
     and request_type = request_type_value
     and customer_phone = phone_value
     and status in ('PENDENTE', 'EM_ATENDIMENTO')
   order by created_at desc
   limit 1
   for update;

  if not found then
    begin
      insert into public.bar_service_requests (
        order_id, request_type, customer_name, customer_phone, message
      ) values (
        order_row.id, request_type_value, customer_value, phone_value, message_value
      ) returning * into request_row;
    exception when unique_violation then
      select * into request_row
        from public.bar_service_requests
       where order_id = order_row.id
         and request_type = request_type_value
         and customer_phone = phone_value
         and status in ('PENDENTE', 'EM_ATENDIMENTO')
       order by created_at desc
       limit 1;
    end;
  end if;

  return jsonb_build_object(
    'id', request_row.id,
    'type', request_row.request_type,
    'status', request_row.status,
    'created_at', request_row.created_at
  );
end;
$$;

create or replace function public.ensure_current_user_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  profile_row public.profiles%rowtype;
  assigned_role text;
begin
  if auth.uid() is null then
    raise exception 'Usuario nao autenticado.';
  end if;

  select *
    into profile_row
    from public.profiles
   where id = auth.uid()
   limit 1;

  if found then
    return profile_row;
  end if;

  assigned_role := case
    when not exists (select 1 from public.profiles) then 'admin'
    else 'secretaria'
  end;

  insert into public.profiles (id, full_name, email, role)
  values (
    auth.uid(),
    coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1)),
    coalesce(auth.jwt() ->> 'email', ''),
    assigned_role
  )
  returning * into profile_row;

  return profile_row;
end;
$$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  assigned_role text;
begin
  if coalesce(new.raw_user_meta_data ->> 'app_context', '') <> 'admin' then
    return new;
  end if;

  assigned_role := case
    when not exists (select 1 from public.profiles) then 'admin'
    else 'secretaria'
  end;

  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.email, ''),
    assigned_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

create or replace function public.handle_new_app_client()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'app_context', 'public') = 'admin' then
    return new;
  end if;

  insert into public.app_clients (id, full_name, email, phone, client_type)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1), 'Cliente Ilha'),
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'client_type', ''), 'cliente')
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_app_client on auth.users;
create trigger on_auth_user_created_app_client
  after insert on auth.users
  for each row execute function public.handle_new_app_client();

create or replace function public.ensure_current_app_client(
  p_full_name text default null,
  p_phone text default null
)
returns public.app_clients
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  client_row public.app_clients%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Usuario nao autenticado.';
  end if;

  insert into public.app_clients (id, full_name, email, phone, last_login_at)
  values (
    auth.uid(),
    coalesce(nullif(p_full_name, ''), auth.jwt() -> 'user_metadata' ->> 'full_name', split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), 'Cliente Ilha'),
    coalesce(auth.jwt() ->> 'email', ''),
    coalesce(nullif(p_phone, ''), auth.jwt() -> 'user_metadata' ->> 'phone'),
    now()
  )
  on conflict (id) do update
    set full_name = coalesce(nullif(p_full_name, ''), public.app_clients.full_name),
        phone = coalesce(nullif(p_phone, ''), public.app_clients.phone),
        email = excluded.email,
        last_login_at = now(),
        updated_at = now()
  returning * into client_row;

  return client_row;
end;
$$;

create or replace function public.protect_app_client_official_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_club_office() then
    return new;
  end if;

  if new.official_plan_id is distinct from old.official_plan_id
    or new.official_plan_code is distinct from old.official_plan_code
    or new.official_plan_name is distinct from old.official_plan_name
    or new.plan_amount is distinct from old.plan_amount
    or new.weekly_lessons is distinct from old.weekly_lessons
    or new.preferred_days is distinct from old.preferred_days
    or new.due_day is distinct from old.due_day
    or new.status is distinct from old.status
    or new.client_type is distinct from old.client_type
  then
    raise exception 'Plano oficial e dados financeiros so podem ser alterados pela equipe do clube.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_app_client_official_fields on public.app_clients;
create trigger protect_app_client_official_fields
  before update on public.app_clients
  for each row execute function public.protect_app_client_official_fields();

create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  status text not null default 'ATIVO',
  weekly_lessons integer,
  monthly_value numeric(10, 2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.courts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lesson_slots (
  id uuid primary key default gen_random_uuid(),
  day text not null check (day in ('segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo')),
  time time not null,
  period text not null check (period in ('manha', 'tarde', 'noite')),
  court_id uuid references public.courts(id),
  court_name text,
  teacher_id uuid references public.teachers(id),
  teacher_name text,
  level text not null default 'Iniciante',
  capacity integer not null default 4,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lesson_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  slot_id uuid not null references public.lesson_slots(id) on delete cascade,
  type text not null default 'FIXO',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lesson_slots_day_time_idx on public.lesson_slots(day, time);
create index if not exists lesson_enrollments_slot_idx on public.lesson_enrollments(slot_id) where active = true;
create index if not exists lesson_enrollments_student_idx on public.lesson_enrollments(student_id) where active = true;

alter table public.students add column if not exists email text;
alter table public.students add column if not exists birth_date date;
alter table public.students add column if not exists guardian_name text;
alter table public.students add column if not exists plan_name text;
alter table public.students add column if not exists level text;
alter table public.students add column if not exists financial_status text not null default 'OK';
alter table public.students add column if not exists relationship_status text not null default 'ATIVO';

create table if not exists public.student_interactions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  type text not null default 'NOTE',
  title text not null,
  body text,
  due_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.club_agenda_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null default 'EVENTO',
  starts_at timestamptz not null,
  ends_at timestamptz,
  court_id uuid references public.courts(id),
  court_name text,
  owner_name text,
  status text not null default 'CONFIRMADO',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete set null,
  counterparty text,
  description text not null,
  category text not null default 'Aulas',
  type text not null default 'RECEITA' check (type in ('RECEITA', 'DESPESA')),
  amount numeric(10, 2) not null default 0,
  due_date date,
  paid_at timestamptz,
  status text not null default 'ABERTO',
  payment_method text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.financial_transactions add column if not exists counterparty text;

create table if not exists public.communication_audiences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  filters jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null default 'WHATSAPP',
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_campaigns (
  id uuid primary key default gen_random_uuid(),
  audience_id uuid references public.communication_audiences(id),
  template_id uuid references public.communication_templates(id),
  title text not null,
  channel text not null default 'WHATSAPP',
  status text not null default 'RASCUNHO',
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_interactions_student_idx on public.student_interactions(student_id);
create index if not exists club_agenda_events_starts_idx on public.club_agenda_events(starts_at);
create index if not exists financial_transactions_due_idx on public.financial_transactions(due_date, status);
create index if not exists communication_campaigns_status_idx on public.communication_campaigns(status);

alter table public.profiles enable row level security;
alter table public.bar_user_tasks enable row level security;
alter table public.app_plans enable row level security;
alter table public.app_clients enable row level security;
alter table public.app_plan_requests enable row level security;
alter table public.app_store_requests enable row level security;
alter table public.app_announcements enable row level security;
alter table public.app_court_bookings enable row level security;
alter table public.app_payment_invoices enable row level security;
alter table public.bar_products enable row level security;
alter table public.bar_tables enable row level security;
alter table public.bar_public_cards enable row level security;
alter table public.bar_customers enable row level security;
alter table public.bar_orders enable row level security;
alter table public.bar_order_items enable row level security;
alter table public.bar_service_requests enable row level security;
alter table public.bar_inventory_movements enable row level security;
alter table public.bar_financial_entries enable row level security;
alter table public.bar_order_payment_parts enable row level security;
alter table public.bar_events enable row level security;
alter table public.bar_push_subscriptions enable row level security;
alter table public.bar_push_config enable row level security;
alter table public.bar_runtime_settings enable row level security;
alter table public.bar_push_dispatches enable row level security;
alter table public.teachers enable row level security;
alter table public.students enable row level security;
alter table public.courts enable row level security;
alter table public.lesson_slots enable row level security;
alter table public.lesson_enrollments enable row level security;
alter table public.student_interactions enable row level security;
alter table public.club_agenda_events enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.communication_audiences enable row level security;
alter table public.communication_templates enable row level security;
alter table public.communication_campaigns enable row level security;

grant usage on schema public to anon, authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select, insert, update, delete on
  public.profiles,
  public.bar_user_tasks,
  public.app_plans,
  public.app_clients,
  public.app_plan_requests,
  public.app_store_requests,
  public.app_announcements,
  public.app_court_bookings,
  public.app_payment_invoices,
  public.bar_products,
  public.bar_tables,
  public.bar_public_cards,
  public.bar_customers,
  public.bar_orders,
  public.bar_order_items,
  public.bar_service_requests,
  public.bar_inventory_movements,
  public.bar_financial_entries,
  public.bar_order_payment_parts,
  public.bar_events,
  public.bar_push_subscriptions,
  public.bar_runtime_settings,
  public.teachers,
  public.students,
  public.courts,
  public.lesson_slots,
  public.lesson_enrollments,
  public.student_interactions,
  public.club_agenda_events,
  public.financial_transactions,
  public.communication_audiences,
  public.communication_templates,
  public.communication_campaigns
to authenticated;

revoke all on table public.bar_push_config from anon, authenticated;
revoke all on table public.bar_push_dispatches from anon, authenticated;
grant select on table public.bar_push_config to service_role;
grant select, insert, delete on table public.bar_push_dispatches to service_role;
grant select, insert, update, delete on table public.bar_push_subscriptions to service_role;
grant select on table public.bar_orders, public.bar_order_items, public.bar_tables to service_role;

grant select, insert, update, delete on table public.bar_customers to service_role;
revoke all on table public.bar_customers from anon;
revoke all on table public.bar_service_requests from anon;
revoke all on table public.bar_events from anon;
revoke all on table public.bar_products from anon;
grant select (
  id,
  name,
  category,
  sale_price,
  image_url,
  notes,
  active,
  menu_visible,
  menu_tv_visible,
  menu_featured,
  menu_sort_order,
  updated_at
) on table public.bar_products to anon;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_club_staff() to authenticated;
grant execute on function public.is_club_office() to authenticated;
revoke all on function public.is_bar_staff() from public;
grant execute on function public.is_bar_staff() to authenticated;
grant execute on function public.ensure_current_user_profile() to authenticated;
grant execute on function public.ensure_current_app_client(text, text) to authenticated;
revoke all on function public.bar_add_order_item(uuid, uuid, numeric, text, text) from public;
revoke all on function public.bar_split_order_item(uuid, jsonb, text) from public;
revoke all on function public.bar_remove_order_item_split(uuid) from public;
revoke all on function public.bar_cancel_order_item(uuid) from public;
revoke all on function public.bar_set_order_item_quantity(uuid, numeric) from public;
revoke all on function public.bar_adjust_stock(uuid, text, numeric, text, numeric) from public;
revoke all on function public.bar_close_order(uuid, text, numeric, numeric) from public;
revoke all on function public.bar_close_order_split(uuid, jsonb, numeric, numeric) from public;
revoke all on function public.bar_pay_order(uuid, text, numeric, numeric) from public;
revoke all on function public.bar_pay_order_split(uuid, jsonb, numeric, numeric) from public;
revoke all on function public.bar_save_order_payment_split(uuid, jsonb, numeric, numeric, text) from public;
revoke all on function public.bar_receive_order_payment_part(uuid, integer, jsonb, numeric, numeric, text, text) from public;
revoke all on function public.bar_finalize_paid_order(uuid) from public;
revoke all on function public.bar_reopen_order(uuid) from public;
revoke all on function public.refresh_bar_order_totals() from public;
grant execute on function public.bar_add_order_item(uuid, uuid, numeric, text, text) to authenticated;
grant execute on function public.bar_split_order_item(uuid, jsonb, text) to authenticated;
grant execute on function public.bar_remove_order_item_split(uuid) to authenticated;
grant execute on function public.bar_cancel_order_item(uuid) to authenticated;
grant execute on function public.bar_set_order_item_quantity(uuid, numeric) to authenticated;
revoke all on function public.bar_delete_open_order(uuid) from public;
grant execute on function public.bar_delete_open_order(uuid) to authenticated;
grant execute on function public.bar_adjust_stock(uuid, text, numeric, text, numeric) to authenticated;
grant execute on function public.bar_close_order(uuid, text, numeric, numeric) to authenticated;
grant execute on function public.bar_close_order_split(uuid, jsonb, numeric, numeric) to authenticated;
grant execute on function public.bar_pay_order(uuid, text, numeric, numeric) to authenticated;
grant execute on function public.bar_pay_order_split(uuid, jsonb, numeric, numeric) to authenticated;
grant execute on function public.bar_save_order_payment_split(uuid, jsonb, numeric, numeric, text) to authenticated;
grant execute on function public.bar_receive_order_payment_part(uuid, integer, jsonb, numeric, numeric, text, text) to authenticated;
grant execute on function public.bar_finalize_paid_order(uuid) to authenticated;
grant execute on function public.bar_reopen_order(uuid) to authenticated;
revoke all on function public.bar_public_menu(text) from public;
revoke all on function public.bar_public_submit_order(text, text, uuid, jsonb, text, text) from public;
revoke all on function public.bar_public_claim_access(text, text, text) from public;
revoke all on function public.bar_public_submit_card_order(text, jsonb, text) from public;
revoke all on function public.bar_public_card_order_status(text) from public;
revoke all on function public.bar_public_card_request_service(text, text, text) from public;
revoke all on function public.bar_public_order_status(text, text) from public;
revoke all on function public.bar_public_request_service(text, text, text, text, text) from public;
grant execute on function public.bar_public_menu(text) to anon, authenticated;
grant execute on function public.bar_public_submit_order(text, text, uuid, jsonb, text, text) to anon, authenticated;
grant execute on function public.bar_public_claim_access(text, text, text) to anon, authenticated;
grant execute on function public.bar_public_submit_card_order(text, jsonb, text) to anon, authenticated;
grant execute on function public.bar_public_card_order_status(text) to anon, authenticated;
grant execute on function public.bar_public_card_request_service(text, text, text) to anon, authenticated;
grant execute on function public.bar_public_order_status(text, text) to anon, authenticated;
grant execute on function public.bar_public_request_service(text, text, text, text, text) to anon, authenticated;

drop policy if exists "public read teachers" on public.teachers;
drop policy if exists "public read students" on public.students;
drop policy if exists "public read courts" on public.courts;
drop policy if exists "public read lesson_slots" on public.lesson_slots;
drop policy if exists "public read lesson_enrollments" on public.lesson_enrollments;
drop policy if exists "public read student_interactions" on public.student_interactions;
drop policy if exists "public read club_agenda_events" on public.club_agenda_events;
drop policy if exists "public read financial_transactions" on public.financial_transactions;
drop policy if exists "public read communication_audiences" on public.communication_audiences;
drop policy if exists "public read communication_templates" on public.communication_templates;
drop policy if exists "public read communication_campaigns" on public.communication_campaigns;

drop policy if exists "profiles read own or admin" on public.profiles;
drop policy if exists "profiles admin manage" on public.profiles;
drop policy if exists "plans read active or staff" on public.app_plans;
drop policy if exists "plans staff manage" on public.app_plans;
drop policy if exists "clients read own or staff" on public.app_clients;
drop policy if exists "clients insert own" on public.app_clients;
drop policy if exists "clients update own or staff" on public.app_clients;
drop policy if exists "clients staff manage" on public.app_clients;
drop policy if exists "plan requests read own or staff" on public.app_plan_requests;
drop policy if exists "plan requests insert own" on public.app_plan_requests;
drop policy if exists "plan requests update own draft or staff" on public.app_plan_requests;
drop policy if exists "plan requests staff manage" on public.app_plan_requests;
drop policy if exists "store requests read own or staff" on public.app_store_requests;
drop policy if exists "store requests insert own" on public.app_store_requests;
drop policy if exists "store requests staff manage" on public.app_store_requests;
drop policy if exists "announcements read active or staff" on public.app_announcements;
drop policy if exists "announcements staff manage" on public.app_announcements;
drop policy if exists "court bookings read authenticated" on public.app_court_bookings;
drop policy if exists "court bookings insert own" on public.app_court_bookings;
drop policy if exists "court bookings update own or staff" on public.app_court_bookings;
drop policy if exists "court bookings staff manage" on public.app_court_bookings;
drop policy if exists "payment invoices read own or staff" on public.app_payment_invoices;
drop policy if exists "payment invoices staff manage" on public.app_payment_invoices;
drop policy if exists "bar staff manage products" on public.bar_products;
drop policy if exists "public read visible menu products" on public.bar_products;
drop policy if exists "bar staff manage tables" on public.bar_tables;
drop policy if exists "bar staff manage public cards" on public.bar_public_cards;
drop policy if exists "bar staff manage customers" on public.bar_customers;
drop policy if exists "bar staff manage orders" on public.bar_orders;
drop policy if exists "bar staff manage order items" on public.bar_order_items;
drop policy if exists "bar staff manage service requests" on public.bar_service_requests;
drop policy if exists "bar staff manage inventory" on public.bar_inventory_movements;
drop policy if exists "bar staff manage finance" on public.bar_financial_entries;
drop policy if exists "bar staff manage order payment parts" on public.bar_order_payment_parts;
drop policy if exists "bar staff manage events" on public.bar_events;
drop policy if exists "bar staff manage own push subscriptions" on public.bar_push_subscriptions;
drop policy if exists "bar staff manage runtime settings" on public.bar_runtime_settings;
drop policy if exists "staff read teachers" on public.teachers;
drop policy if exists "office manage teachers" on public.teachers;
drop policy if exists "staff read students" on public.students;
drop policy if exists "office manage students" on public.students;
drop policy if exists "staff manage students" on public.students;
drop policy if exists "staff read courts" on public.courts;
drop policy if exists "office manage courts" on public.courts;
drop policy if exists "staff read lesson_slots" on public.lesson_slots;
drop policy if exists "office manage lesson_slots" on public.lesson_slots;
drop policy if exists "staff read lesson_enrollments" on public.lesson_enrollments;
drop policy if exists "staff manage lesson_enrollments" on public.lesson_enrollments;
drop policy if exists "staff read student_interactions" on public.student_interactions;
drop policy if exists "staff manage student_interactions" on public.student_interactions;
drop policy if exists "staff read club_agenda_events" on public.club_agenda_events;
drop policy if exists "staff manage club_agenda_events" on public.club_agenda_events;
drop policy if exists "office read financial_transactions" on public.financial_transactions;
drop policy if exists "office manage financial_transactions" on public.financial_transactions;
drop policy if exists "staff read communication_audiences" on public.communication_audiences;
drop policy if exists "office manage communication_audiences" on public.communication_audiences;
drop policy if exists "staff read communication_templates" on public.communication_templates;
drop policy if exists "office manage communication_templates" on public.communication_templates;
drop policy if exists "staff read communication_campaigns" on public.communication_campaigns;
drop policy if exists "office manage communication_campaigns" on public.communication_campaigns;

create policy "profiles read own or admin"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.current_user_role() = 'admin');

create policy "profiles admin manage"
on public.profiles for all
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "bar users read own tasks" on public.bar_user_tasks;
drop policy if exists "bar users update own tasks" on public.bar_user_tasks;
drop policy if exists "bar access managers manage tasks" on public.bar_user_tasks;
drop policy if exists "bar access managers add tasks" on public.bar_user_tasks;
drop policy if exists "bar access managers delete tasks" on public.bar_user_tasks;

create policy "bar users read own tasks"
on public.bar_user_tasks for select
to authenticated
using (user_id = (select auth.uid()) or public.current_user_role() = 'admin');

create policy "bar users update own tasks"
on public.bar_user_tasks for update
to authenticated
using (user_id = (select auth.uid()) or public.current_user_role() = 'admin')
with check (user_id = (select auth.uid()) or public.current_user_role() = 'admin');

create policy "bar access managers add tasks"
on public.bar_user_tasks for insert
to authenticated
with check (public.current_user_role() = 'admin');

create policy "bar access managers delete tasks"
on public.bar_user_tasks for delete
to authenticated
using (public.current_user_role() = 'admin');

create policy "plans read active or staff"
on public.app_plans for select
to authenticated
using (active = true or public.is_club_staff());

create policy "plans staff manage"
on public.app_plans for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "clients read own or staff"
on public.app_clients for select
to authenticated
using (id = auth.uid() or public.is_club_staff());

create policy "clients insert own"
on public.app_clients for insert
to authenticated
with check (id = auth.uid());

create policy "clients update own or staff"
on public.app_clients for update
to authenticated
using (id = auth.uid() or public.is_club_staff())
with check (id = auth.uid() or public.is_club_staff());

create policy "clients staff manage"
on public.app_clients for delete
to authenticated
using (public.is_club_office());

create policy "plan requests read own or staff"
on public.app_plan_requests for select
to authenticated
using (client_id = auth.uid() or public.is_club_staff());

create policy "plan requests insert own"
on public.app_plan_requests for insert
to authenticated
with check (client_id = auth.uid());

create policy "plan requests staff manage"
on public.app_plan_requests for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "store requests read own or staff"
on public.app_store_requests for select
to authenticated
using (client_id = auth.uid() or public.is_club_staff());

create policy "store requests insert own"
on public.app_store_requests for insert
to authenticated
with check (client_id = auth.uid());

create policy "store requests staff manage"
on public.app_store_requests for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "announcements read active or staff"
on public.app_announcements for select
to authenticated
using (active = true or public.is_club_staff());

create policy "announcements staff manage"
on public.app_announcements for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "court bookings read authenticated"
on public.app_court_bookings for select
to authenticated
using (status <> 'CANCELADO' or client_id = auth.uid() or public.is_club_staff());

create policy "court bookings insert own"
on public.app_court_bookings for insert
to authenticated
with check (
  (client_id = auth.uid() and length(trim(opponent_name)) > 0)
  or public.is_club_office()
);

create policy "court bookings update own or staff"
on public.app_court_bookings for update
to authenticated
using (client_id = auth.uid() or public.is_club_staff())
with check (client_id = auth.uid() or public.is_club_staff());

create policy "court bookings staff manage"
on public.app_court_bookings for delete
to authenticated
using (public.is_club_office());

create policy "payment invoices read own or staff"
on public.app_payment_invoices for select
to authenticated
using (client_id = auth.uid() or public.is_club_staff());

create policy "payment invoices staff manage"
on public.app_payment_invoices for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "bar staff manage products"
on public.bar_products for all
to authenticated
using (public.is_bar_staff())
with check (public.is_bar_staff());

create policy "public read visible menu products"
on public.bar_products for select
to anon
using (active = true and (menu_visible = true or menu_tv_visible = true));

create policy "bar staff manage tables"
on public.bar_tables for all
to authenticated
using (public.is_bar_staff())
with check (public.is_bar_staff());

create policy "bar staff manage public cards"
on public.bar_public_cards for all
to authenticated
using (public.is_bar_staff())
with check (public.is_bar_staff());

create policy "bar staff manage customers"
on public.bar_customers for all
to authenticated
using (public.is_bar_staff())
with check (public.is_bar_staff());

create policy "bar staff manage orders"
on public.bar_orders for all
to authenticated
using (public.is_bar_staff())
with check (public.is_bar_staff());

create policy "bar staff manage order items"
on public.bar_order_items for all
to authenticated
using (public.is_bar_staff())
with check (public.is_bar_staff());

create policy "bar staff manage service requests"
on public.bar_service_requests for all
to authenticated
using (public.is_bar_staff())
with check (public.is_bar_staff());

create policy "bar staff manage inventory"
on public.bar_inventory_movements for all
to authenticated
using (public.is_bar_staff())
with check (public.is_bar_staff());

create policy "bar staff manage finance"
on public.bar_financial_entries for all
to authenticated
using (public.is_bar_staff())
with check (public.is_bar_staff());

create policy "bar staff manage order payment parts"
on public.bar_order_payment_parts for all
to authenticated
using (public.is_bar_staff())
with check (public.is_bar_staff());

create policy "bar staff manage events"
on public.bar_events for all
to authenticated
using (public.is_bar_staff())
with check (public.is_bar_staff());

create policy "bar staff manage own push subscriptions"
on public.bar_push_subscriptions for all
to authenticated
using (user_id = (select auth.uid()) and public.is_bar_staff())
with check (user_id = (select auth.uid()) and public.is_bar_staff());

create policy "bar staff manage runtime settings"
on public.bar_runtime_settings for all
to authenticated
using (public.is_bar_staff())
with check (public.is_bar_staff());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bar_orders'
    ) then
      alter publication supabase_realtime add table public.bar_orders;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bar_order_items'
    ) then
      alter publication supabase_realtime add table public.bar_order_items;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bar_service_requests'
    ) then
      alter publication supabase_realtime add table public.bar_service_requests;
    end if;
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bar-products',
  'bar-products',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "bar staff view product images" on storage.objects;
drop policy if exists "bar staff upload product images" on storage.objects;
drop policy if exists "bar staff update product images" on storage.objects;
drop policy if exists "bar staff delete product images" on storage.objects;

create policy "bar staff view product images"
on storage.objects for select
to authenticated
using (bucket_id = 'bar-products' and public.is_bar_staff());

create policy "bar staff upload product images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'bar-products' and public.is_bar_staff());

create policy "bar staff update product images"
on storage.objects for update
to authenticated
using (bucket_id = 'bar-products' and public.is_bar_staff())
with check (bucket_id = 'bar-products' and public.is_bar_staff());

create policy "bar staff delete product images"
on storage.objects for delete
to authenticated
using (bucket_id = 'bar-products' and public.is_bar_staff());

create policy "staff read teachers"
on public.teachers for select
to authenticated
using (public.is_club_staff());

create policy "office manage teachers"
on public.teachers for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "staff read students"
on public.students for select
to authenticated
using (public.is_club_staff());

create policy "staff manage students"
on public.students for all
to authenticated
using (public.is_club_staff())
with check (public.is_club_staff());

create policy "staff read courts"
on public.courts for select
to authenticated
using (public.is_club_staff());

create policy "office manage courts"
on public.courts for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "staff read lesson_slots"
on public.lesson_slots for select
to authenticated
using (public.is_club_staff());

create policy "office manage lesson_slots"
on public.lesson_slots for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "staff read lesson_enrollments"
on public.lesson_enrollments for select
to authenticated
using (public.is_club_staff());

create policy "staff manage lesson_enrollments"
on public.lesson_enrollments for all
to authenticated
using (public.is_club_staff())
with check (public.is_club_staff());

create policy "staff read student_interactions"
on public.student_interactions for select
to authenticated
using (public.is_club_staff());

create policy "staff manage student_interactions"
on public.student_interactions for all
to authenticated
using (public.is_club_staff())
with check (public.is_club_staff());

create policy "staff read club_agenda_events"
on public.club_agenda_events for select
to authenticated
using (public.is_club_staff());

create policy "staff manage club_agenda_events"
on public.club_agenda_events for all
to authenticated
using (public.is_club_staff())
with check (public.is_club_staff());

create policy "office read financial_transactions"
on public.financial_transactions for select
to authenticated
using (public.is_club_office());

create policy "office manage financial_transactions"
on public.financial_transactions for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "staff read communication_audiences"
on public.communication_audiences for select
to authenticated
using (public.is_club_staff());

create policy "office manage communication_audiences"
on public.communication_audiences for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "staff read communication_templates"
on public.communication_templates for select
to authenticated
using (public.is_club_staff());

create policy "office manage communication_templates"
on public.communication_templates for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "staff read communication_campaigns"
on public.communication_campaigns for select
to authenticated
using (public.is_club_staff());

create policy "office manage communication_campaigns"
on public.communication_campaigns for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

-- Public traffic stays outside the operational data. The /adm app now reads and writes
-- through Supabase Auth with admin, secretaria and professor profiles.

-- Adds an editable cart to the Bar while keeping product insertion and stock movements
-- atomic: every item is persisted or the whole cart is rolled back.
create or replace function public.bar_add_order_items(
  p_order_id uuid,
  p_items jsonb
)
returns setof public.bar_order_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  product_id uuid;
  quantity numeric;
  inserted_item public.bar_order_items%rowtype;
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Adicione pelo menos um produto ao carrinho.';
  end if;

  if jsonb_array_length(p_items) > 100 then
    raise exception 'O carrinho aceita no maximo 100 produtos diferentes.';
  end if;

  for item in
    select value from jsonb_array_elements(p_items)
  loop
    product_id := nullif(item ->> 'product_id', '')::uuid;
    quantity := nullif(item ->> 'quantity', '')::numeric;

    if product_id is null then
      raise exception 'Produto invalido no carrinho.';
    end if;

    inserted_item := public.bar_add_order_item(
      p_order_id,
      product_id,
      quantity,
      nullif(item ->> 'notes', ''),
      nullif(item ->> 'delivery_location', '')
    );
    return next inserted_item;
  end loop;
end;
$$;

revoke all on function public.bar_add_order_items(uuid, jsonb) from public;
grant execute on function public.bar_add_order_items(uuid, jsonb) to authenticated;

-- User profiles and operational task list for the Bar team.
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists job_title text;
alter table public.profiles add column if not exists bio text;

create table if not exists public.bar_user_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  details text,
  due_date date,
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'CONCLUIDA')),
  created_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bar_user_tasks_user_status_idx on public.bar_user_tasks(user_id, status, due_date);
create index if not exists bar_user_tasks_created_by_idx on public.bar_user_tasks(created_by);
alter table public.bar_user_tasks enable row level security;
grant select, insert, update, delete on public.bar_user_tasks to authenticated;

drop policy if exists "bar users read own tasks" on public.bar_user_tasks;
drop policy if exists "bar users update own tasks" on public.bar_user_tasks;
drop policy if exists "bar access managers manage tasks" on public.bar_user_tasks;
drop policy if exists "bar access managers add tasks" on public.bar_user_tasks;
drop policy if exists "bar access managers delete tasks" on public.bar_user_tasks;

create policy "bar users read own tasks"
on public.bar_user_tasks for select
to authenticated
using (user_id = (select auth.uid()) or public.current_user_role() = 'admin');

create policy "bar users update own tasks"
on public.bar_user_tasks for update
to authenticated
using (user_id = (select auth.uid()) or public.current_user_role() = 'admin')
with check (user_id = (select auth.uid()) or public.current_user_role() = 'admin');

create policy "bar access managers add tasks"
on public.bar_user_tasks for insert
to authenticated
with check (public.current_user_role() = 'admin');

create policy "bar access managers delete tasks"
on public.bar_user_tasks for delete
to authenticated
using (public.current_user_role() = 'admin');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bar-profiles',
  'bar-profiles',
  false,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "bar profile photos read" on storage.objects;
drop policy if exists "bar profile photos insert" on storage.objects;
drop policy if exists "bar profile photos update" on storage.objects;
drop policy if exists "bar profile photos delete" on storage.objects;

create policy "bar profile photos read"
on storage.objects for select
to authenticated
using (bucket_id = 'bar-profiles' and public.is_bar_staff());

create policy "bar profile photos insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'bar-profiles'
  and public.is_bar_staff()
  and ((storage.foldername(name))[1] = (select auth.uid())::text or public.current_user_role() = 'admin')
);

create policy "bar profile photos update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'bar-profiles'
  and public.is_bar_staff()
  and ((storage.foldername(name))[1] = (select auth.uid())::text or public.current_user_role() = 'admin')
)
with check (
  bucket_id = 'bar-profiles'
  and public.is_bar_staff()
  and ((storage.foldername(name))[1] = (select auth.uid())::text or public.current_user_role() = 'admin')
);

create policy "bar profile photos delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'bar-profiles'
  and public.is_bar_staff()
  and ((storage.foldername(name))[1] = (select auth.uid())::text or public.current_user_role() = 'admin')
);

create or replace function public.bar_update_own_profile(
  p_full_name text,
  p_phone text,
  p_job_title text,
  p_bio text,
  p_avatar_url text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.profiles%rowtype;
begin
  if auth.uid() is null or not public.is_bar_staff() then
    raise exception 'Acesso negado ao perfil do Bar.';
  end if;

  update public.profiles
  set full_name = left(nullif(trim(p_full_name), ''), 80),
      phone = left(nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''), 13),
      job_title = left(nullif(trim(p_job_title), ''), 80),
      bio = left(nullif(trim(p_bio), ''), 500),
      avatar_url = left(nullif(trim(p_avatar_url), ''), 1000),
      updated_at = now()
  where id = auth.uid()
  returning * into saved;

  if saved.id is null then
    raise exception 'Perfil não encontrado.';
  end if;
  return saved;
end;
$$;

revoke all on function public.bar_update_own_profile(text, text, text, text, text) from public;
grant execute on function public.bar_update_own_profile(text, text, text, text, text) to authenticated;
