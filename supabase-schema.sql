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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists permissions jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists notes text;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'secretaria', 'professor', 'bar'));

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
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.bar_orders (
  id uuid primary key default gen_random_uuid(),
  table_id uuid references public.bar_tables(id) on delete set null,
  command_number bigint generated by default as identity,
  customer_name text,
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
  status text not null default 'SOLICITADO' check (status in ('SOLICITADO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE', 'CANCELADO')),
  notes text,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
create index if not exists bar_orders_status_idx on public.bar_orders(status, opened_at desc);
create unique index if not exists bar_orders_one_open_per_table_idx
  on public.bar_orders(table_id)
  where table_id is not null and status in ('ABERTA', 'EM_PREPARO', 'PRONTA');
create index if not exists bar_order_items_order_idx on public.bar_order_items(order_id, created_at);
create index if not exists bar_order_items_status_idx on public.bar_order_items(status, created_at);
create index if not exists bar_inventory_product_idx on public.bar_inventory_movements(product_id, occurred_at desc);
create index if not exists bar_financial_due_idx on public.bar_financial_entries(status, due_date);

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
  p_notes text default null
)
returns public.bar_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  product_row public.bar_products%rowtype;
  item_row public.bar_order_items%rowtype;
begin
  if not public.is_bar_staff() then
    raise exception 'Acesso negado ao Bar.';
  end if;

  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'Quantidade invalida.';
  end if;

  if not exists (
    select 1 from public.bar_orders
     where id = p_order_id
       and status in ('ABERTA', 'EM_PREPARO', 'PRONTA')
  ) then
    raise exception 'Comanda nao esta aberta.';
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
    order_id, product_id, product_name, quantity, unit_price, cost_price, notes, added_by
  ) values (
    p_order_id, product_row.id, product_row.name, p_quantity, product_row.sale_price,
    product_row.cost_price, nullif(trim(coalesce(p_notes, '')), ''), auth.uid()
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
alter table public.app_plans enable row level security;
alter table public.app_clients enable row level security;
alter table public.app_plan_requests enable row level security;
alter table public.app_store_requests enable row level security;
alter table public.app_announcements enable row level security;
alter table public.app_court_bookings enable row level security;
alter table public.app_payment_invoices enable row level security;
alter table public.bar_products enable row level security;
alter table public.bar_tables enable row level security;
alter table public.bar_orders enable row level security;
alter table public.bar_order_items enable row level security;
alter table public.bar_inventory_movements enable row level security;
alter table public.bar_financial_entries enable row level security;
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

grant usage on schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select, insert, update, delete on
  public.profiles,
  public.app_plans,
  public.app_clients,
  public.app_plan_requests,
  public.app_store_requests,
  public.app_announcements,
  public.app_court_bookings,
  public.app_payment_invoices,
  public.bar_products,
  public.bar_tables,
  public.bar_orders,
  public.bar_order_items,
  public.bar_inventory_movements,
  public.bar_financial_entries,
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
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_club_staff() to authenticated;
grant execute on function public.is_club_office() to authenticated;
grant execute on function public.is_bar_staff() to authenticated;
grant execute on function public.ensure_current_user_profile() to authenticated;
grant execute on function public.ensure_current_app_client(text, text) to authenticated;
grant execute on function public.bar_add_order_item(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.bar_cancel_order_item(uuid) to authenticated;
grant execute on function public.bar_adjust_stock(uuid, text, numeric, text, numeric) to authenticated;
grant execute on function public.bar_close_order(uuid, text, numeric, numeric) to authenticated;

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
drop policy if exists "bar staff manage tables" on public.bar_tables;
drop policy if exists "bar staff manage orders" on public.bar_orders;
drop policy if exists "bar staff manage order items" on public.bar_order_items;
drop policy if exists "bar staff manage inventory" on public.bar_inventory_movements;
drop policy if exists "bar staff manage finance" on public.bar_financial_entries;
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

create policy "bar staff manage tables"
on public.bar_tables for all
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
