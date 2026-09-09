-- Evolui a venda rápida do balcão sem apagar o livro-caixa:
-- 1. todos os produtos podem ser vendidos (itens de preparo seguem para a cozinha);
-- 2. edições criam uma nova revisão e estornam a anterior;
-- 3. exclusões são cancelamentos auditáveis, sem repor comida já preparada;
-- 4. request_id + lock transacional tornam edit/cancel idempotentes.

alter table public.bar_order_items
  add column if not exists counter_revision integer not null default 0,
  add column if not exists requires_production boolean not null default false;

comment on column public.bar_order_items.requires_production is
  'Snapshot imutável: o item exigia cozinha quando foi incluído na venda.';

-- A versão anterior da venda rápida aceitava apenas itens imediatos e gravava
-- tudo como ENTREGUE. Ainda assim, classificamos de forma conservadora qualquer
-- dado legado atípico (por exemplo, inserido administrativamente) antes de passar
-- a confiar exclusivamente no snapshot. O GUC por pedido respeita o guard de
-- integridade já instalado pela migration anterior.
do $$
declare
  legacy_order record;
begin
  for legacy_order in
    select id, counter_request_id
      from public.bar_orders
     where source = 'BALCAO'
       and counter_request_id is not null
     order by id
  loop
    perform pg_catalog.set_config(
      'ilha.bar_counter_request_id',
      legacy_order.counter_request_id::text,
      true
    );

    update public.bar_order_items as item
       set counter_revision = 1,
           requires_production = (
             item.status in ('SOLICITADO', 'EM_PREPARO', 'PRONTO')
             or pg_catalog.translate(
                  pg_catalog.lower(coalesce((
                    select product.category
                      from public.bar_products as product
                     where product.id = item.product_id
                  ), '')),
                  'áàâãäéèêëíìîïóòôõöúùûüç',
                  'aaaaaeeeeiiiiooooouuuuc'
                ) like any (array[
                  '%porc%', '%refeic%', '%almoc%', '%frita%', '%petisco%',
                  '%lanche%', '%sandu%', '%hamburg%', '%torrada%', '%salgad%',
                  '%comida%', '%janta%', '%prato%', '%pizza%'
                ])
             or pg_catalog.translate(
                  pg_catalog.lower(coalesce(item.product_name, '')),
                  'áàâãäéèêëíìîïóòôõöúùûüç',
                  'aaaaaeeeeiiiiooooouuuuc'
                ) like '%mini pizza%'
           ),
           updated_at = item.updated_at
     where item.order_id = legacy_order.id
       and item.source = 'BALCAO'
       and item.counter_revision = 0;
  end loop;

  perform pg_catalog.set_config('ilha.bar_counter_request_id', '', true);
end;
$$;

alter table public.bar_inventory_movements
  add column if not exists reverses_movement_id uuid references public.bar_inventory_movements(id) on delete restrict;

create unique index if not exists bar_inventory_movements_reversal_uidx
  on public.bar_inventory_movements(reverses_movement_id)
  where reverses_movement_id is not null;

create or replace function public.guard_bar_inventory_reversal_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  mutation_request_id text := coalesce(pg_catalog.current_setting('ilha.bar_counter_mutation_request_id', true), '');
  original_movement record;
begin
  if new.reverses_movement_id is null then
    if tg_op = 'UPDATE' then
      if old.reverses_movement_id is not null then
        raise exception 'O vínculo de um estorno não pode ser removido.' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  if mutation_request_id = '' then
    raise exception 'Estornos vinculados só podem ser criados pelo cancelamento ou edição do balcão.'
      using errcode = '42501';
  end if;

  select movement.*, sale.source as original_order_source
    into original_movement
    from public.bar_inventory_movements as movement
    join public.bar_order_items as item on item.id = movement.order_item_id
    join public.bar_orders as sale on sale.id = item.order_id
   where movement.id = new.reverses_movement_id;

  if not found
     or original_movement.original_order_source <> 'BALCAO'
     or original_movement.type <> 'SAIDA'
     or new.type <> 'ESTORNO'
     or new.product_id is distinct from original_movement.product_id
     or new.order_item_id is distinct from original_movement.order_item_id
     or new.quantity is distinct from -original_movement.quantity then
    raise exception 'O estorno não corresponde à saída original da venda.' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if old.reverses_movement_id is distinct from new.reverses_movement_id then
      raise exception 'O vínculo de um estorno não pode ser alterado.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_bar_inventory_reversal_integrity()
  from public, anon, authenticated;

drop trigger if exists guard_bar_inventory_reversal_integrity on public.bar_inventory_movements;
create trigger guard_bar_inventory_reversal_integrity
before insert or update on public.bar_inventory_movements
for each row execute function public.guard_bar_inventory_reversal_integrity();

-- Um produto com movimentação passa a ser arquivado, nunca removido junto com
-- o seu histórico de estoque.
alter table public.bar_inventory_movements
  drop constraint if exists bar_inventory_movements_product_id_fkey;
alter table public.bar_inventory_movements
  add constraint bar_inventory_movements_product_id_fkey
  foreign key (product_id) references public.bar_products(id) on delete restrict;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conname = 'bar_order_items_counter_revision_check'
       and conrelid = 'public.bar_order_items'::regclass
  ) then
    alter table public.bar_order_items
      add constraint bar_order_items_counter_revision_check
      check (counter_revision >= 0);
  end if;
end;
$$;

alter table public.bar_orders
  add column if not exists counter_last_edited_at timestamptz,
  add column if not exists counter_last_edited_by uuid references public.profiles(id) on delete set null,
  add column if not exists counter_cancel_reason text,
  add column if not exists counter_cancelled_at timestamptz,
  add column if not exists counter_cancelled_by uuid references public.profiles(id) on delete set null;

alter table public.bar_orders
  drop constraint if exists bar_orders_counter_sale_shape_check;
alter table public.bar_orders
  add constraint bar_orders_counter_sale_shape_check check (
    (
      source = 'BALCAO'
      and counter_request_id is not null
      and counter_payload_hash is not null
      and table_id is null
      and public_access_id is null
      and (
        (status = 'FECHADA' and payment_status = 'PAGO')
        or (status = 'CANCELADA' and payment_status = 'CANCELADO')
      )
    )
    or (
      source <> 'BALCAO'
      and counter_request_id is null
      and counter_payload_hash is null
    )
  );

create table if not exists public.bar_counter_sale_mutations (
  request_id uuid primary key,
  order_id uuid not null references public.bar_orders(id) on delete restrict,
  action text not null check (action in ('EDIT', 'CANCEL')),
  payload_hash text not null,
  reason text,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists bar_counter_sale_mutations_order_idx
  on public.bar_counter_sale_mutations(order_id, created_at desc);

alter table public.bar_counter_sale_mutations enable row level security;
revoke all on table public.bar_counter_sale_mutations from public, anon, authenticated;

create or replace function public.bar_counter_sale_snapshot(p_order_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'order', pg_catalog.to_jsonb(order_row),
    'items', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item_row) order by item_row.created_at, item_row.id)
        from public.bar_order_items as item_row
       where item_row.order_id = order_row.id
    ), '[]'::jsonb),
    'finance', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(finance_row) order by finance_row.created_at, finance_row.id)
        from public.bar_financial_entries as finance_row
       where finance_row.order_id = order_row.id
    ), '[]'::jsonb)
  )
  from public.bar_orders as order_row
  where order_row.id = p_order_id;
$$;

revoke all on function public.bar_counter_sale_snapshot(uuid) from public, anon, authenticated;

create or replace function public.bar_complete_counter_sale(
  p_items jsonb,
  p_payment_method text,
  p_request_id uuid,
  p_notes text default null
)
returns public.bar_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.bar_orders%rowtype;
  product_row public.bar_products%rowtype;
  inserted_item public.bar_order_items%rowtype;
  requested record;
  normalized_item jsonb;
  normalized_items jsonb := '[]'::jsonb;
  request_items_canonical jsonb := '[]'::jsonb;
  payment_method_value text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_payment_method, '')));
  product_category_key text;
  product_name_key text;
  requires_production_value boolean;
  request_fingerprint text;
  legacy_request_fingerprint text;
  sale_total numeric(10, 2) := 0;
  sale_time timestamptz := pg_catalog.transaction_timestamp();
  business_date date := (
    pg_catalog.timezone('America/Sao_Paulo', pg_catalog.transaction_timestamp()) - interval '6 hours'
  )::date;
begin
  if (select auth.uid()) is null
     or not (select public.has_bar_permission('bar.orders')) then
    raise exception 'Seu acesso do Bar não permite registrar vendas de balcão.'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'Identificador da venda inválido.' using errcode = '22023';
  end if;

  if payment_method_value not in ('PIX', 'DINHEIRO', 'CARTAO_CREDITO', 'CARTAO_DEBITO') then
    raise exception 'Escolha Pix recebido, dinheiro, débito ou crédito.' using errcode = '22023';
  end if;

  if p_items is null
     or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) = 0 then
    raise exception 'Adicione pelo menos um produto à venda.' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(p_items) > 50 then
    raise exception 'A venda rápida aceita no máximo 50 linhas de produtos.' using errcode = '22023';
  end if;

  if pg_catalog.length(pg_catalog.btrim(coalesce(p_notes, ''))) > 500 then
    raise exception 'A observação aceita no máximo 500 caracteres.' using errcode = '22023';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_items) as raw(item)
     where pg_catalog.jsonb_typeof(raw.item) <> 'object'
        or coalesce(raw.item ->> 'product_id', '')
             !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        or coalesce(raw.item ->> 'quantity', '') !~ '^[1-9][0-9]{0,2}$'
  ) then
    raise exception 'Confira os produtos e as quantidades da venda.' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'product_id', canonical.product_id,
             'quantity', canonical.quantity,
             'notes', canonical.notes
           ) order by canonical.product_id
         ), '[]'::jsonb)
    into request_items_canonical
    from (
      select (raw.item ->> 'product_id')::uuid as product_id,
             pg_catalog.sum((raw.item ->> 'quantity')::numeric) as quantity,
             pg_catalog.max(nullif(pg_catalog.btrim(raw.item ->> 'notes'), '')) as notes
        from pg_catalog.jsonb_array_elements(p_items) as raw(item)
       group by (raw.item ->> 'product_id')::uuid
    ) as canonical;

  request_fingerprint := pg_catalog.md5(
    request_items_canonical::text || '|' || payment_method_value || '|'
    || pg_catalog.btrim(coalesce(p_notes, ''))
  );
  legacy_request_fingerprint := pg_catalog.md5(
    p_items::text || '|' || payment_method_value || '|' || pg_catalog.btrim(coalesce(p_notes, ''))
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));

  select existing.*
    into order_row
    from public.bar_orders as existing
   where existing.counter_request_id = p_request_id;

  if found then
    if order_row.counter_payload_hash is distinct from request_fingerprint
       and order_row.counter_payload_hash is distinct from legacy_request_fingerprint then
      raise exception 'Esta tentativa já foi usada por outra venda. Inicie uma nova.' using errcode = '22023';
    end if;
    return order_row;
  end if;

  for requested in
    select (raw.item ->> 'product_id')::uuid as product_id,
           pg_catalog.sum((raw.item ->> 'quantity')::numeric) as quantity,
           pg_catalog.max(nullif(pg_catalog.btrim(raw.item ->> 'notes'), '')) as notes
      from pg_catalog.jsonb_array_elements(p_items) as raw(item)
     group by (raw.item ->> 'product_id')::uuid
     order by (raw.item ->> 'product_id')::uuid
  loop
    select product.*
      into product_row
      from public.bar_products as product
     where product.id = requested.product_id
       and product.active is true
     for update;

    if not found then
      raise exception 'Um produto não está mais disponível.' using errcode = '22023';
    end if;

    if requested.quantity > 999 then
      raise exception 'Quantidade inválida para %.', product_row.name using errcode = '22023';
    end if;

    if product_row.stock_quantity < requested.quantity then
      raise exception 'Estoque insuficiente para %.', product_row.name using errcode = '22023';
    end if;

    product_category_key := pg_catalog.translate(
      pg_catalog.lower(coalesce(product_row.category, '')),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    );
    product_name_key := pg_catalog.translate(
      pg_catalog.lower(coalesce(product_row.name, '')),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    );
    requires_production_value :=
      product_category_key like '%porc%'
      or product_category_key like '%refeic%'
      or product_category_key like '%almoc%'
      or product_category_key like '%frita%'
      or product_category_key like '%petisco%'
      or product_category_key like '%lanche%'
      or product_category_key like '%sandu%'
      or product_category_key like '%hamburg%'
      or product_category_key like '%torrada%'
      or product_category_key like '%salgad%'
      or product_category_key like '%comida%'
      or product_category_key like '%janta%'
      or product_category_key like '%prato%'
      or product_category_key like '%pizza%'
      or product_name_key like '%mini pizza%';

    sale_total := sale_total + pg_catalog.round(product_row.sale_price * requested.quantity, 2);
    normalized_items := normalized_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'product_id', product_row.id,
        'product_name', product_row.name,
        'quantity', requested.quantity,
        'unit_price', product_row.sale_price,
        'cost_price', product_row.cost_price,
        'notes', requested.notes,
        'requires_production', requires_production_value
      )
    );
  end loop;

  if sale_total <= 0 then
    raise exception 'O total da venda precisa ser maior que zero.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('ilha.bar_counter_request_id', p_request_id::text, true);

  insert into public.bar_orders (
    customer_name, source, status, subtotal, total, payment_status,
    payment_method, notes, opened_by, opened_at, closed_at,
    counter_request_id, counter_payload_hash
  ) values (
    'Balcão', 'BALCAO', 'FECHADA', sale_total, sale_total, 'PAGO',
    payment_method_value,
    nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
    (select auth.uid()), sale_time, sale_time, p_request_id, request_fingerprint
  )
  returning * into order_row;

  for normalized_item in
    select value from pg_catalog.jsonb_array_elements(normalized_items)
  loop
    insert into public.bar_order_items (
      order_id, product_id, product_name, quantity, unit_price, cost_price,
      source, status, notes, added_by, counter_revision, requires_production, created_at, updated_at
    ) values (
      order_row.id,
      (normalized_item ->> 'product_id')::uuid,
      normalized_item ->> 'product_name',
      (normalized_item ->> 'quantity')::numeric,
      (normalized_item ->> 'unit_price')::numeric,
      (normalized_item ->> 'cost_price')::numeric,
      'BALCAO',
      case when (normalized_item ->> 'requires_production')::boolean then 'SOLICITADO' else 'ENTREGUE' end,
      nullif(normalized_item ->> 'notes', ''),
      (select auth.uid()), 1, (normalized_item ->> 'requires_production')::boolean, sale_time, sale_time
    )
    returning * into inserted_item;

    update public.bar_products
       set stock_quantity = stock_quantity - inserted_item.quantity,
           updated_at = sale_time
     where id = inserted_item.product_id;

    insert into public.bar_inventory_movements (
      product_id, order_item_id, type, quantity, unit_cost, reason,
      created_by, occurred_at, created_at
    ) values (
      inserted_item.product_id, inserted_item.id, 'SAIDA', -inserted_item.quantity,
      inserted_item.cost_price, 'Venda rápida no balcão', (select auth.uid()),
      sale_time, sale_time
    );
  end loop;

  insert into public.bar_financial_entries (
    order_id, type, description, counterparty, category, amount, due_date,
    status, payment_method, paid_at, notes, created_by, created_at, updated_at
  ) values (
    order_row.id, 'RECEITA',
    'Venda de balcão #' || order_row.command_number,
    'Balcão', 'Vendas', sale_total, business_date,
    'RECEBIDO', payment_method_value, sale_time,
    nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
    (select auth.uid()), sale_time, sale_time
  );

  return order_row;
end;
$$;

revoke all on function public.bar_complete_counter_sale(jsonb, text, uuid, text)
  from public, anon;
grant execute on function public.bar_complete_counter_sale(jsonb, text, uuid, text)
  to authenticated;

create or replace function public.bar_update_counter_sale(
  p_order_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_notes text,
  p_expected_updated_at timestamptz,
  p_request_id uuid
)
returns public.bar_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.bar_orders%rowtype;
  product_row public.bar_products%rowtype;
  inserted_item public.bar_order_items%rowtype;
  mutation_row public.bar_counter_sale_mutations%rowtype;
  requested record;
  old_item record;
  normalized_item jsonb;
  normalized_items jsonb := '[]'::jsonb;
  request_items_canonical jsonb := '[]'::jsonb;
  previous_item_quantities jsonb := '{}'::jsonb;
  payment_method_value text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_payment_method, '')));
  product_category_key text;
  product_name_key text;
  requires_production_value boolean;
  request_fingerprint text;
  before_snapshot jsonb;
  after_snapshot jsonb;
  next_revision integer;
  original_movement_id uuid;
  sale_total numeric(10, 2) := 0;
  receipt_due_date date;
  receipt_paid_at timestamptz;
  sale_time timestamptz := pg_catalog.transaction_timestamp();
begin
  if (select auth.uid()) is null
     or not (select public.has_bar_permission('bar.orders')) then
    raise exception 'Seu acesso do Bar não permite editar vendas de balcão.'
      using errcode = '42501';
  end if;

  if p_order_id is null or p_request_id is null or p_expected_updated_at is null then
    raise exception 'Dados de edição inválidos. Atualize o histórico e tente novamente.' using errcode = '22023';
  end if;

  if payment_method_value not in ('PIX', 'DINHEIRO', 'CARTAO_CREDITO', 'CARTAO_DEBITO') then
    raise exception 'Escolha Pix recebido, dinheiro, débito ou crédito.' using errcode = '22023';
  end if;

  if p_items is null
     or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) = 0
     or pg_catalog.jsonb_array_length(p_items) > 50 then
    raise exception 'Confira os produtos da venda.' using errcode = '22023';
  end if;

  if pg_catalog.length(pg_catalog.btrim(coalesce(p_notes, ''))) > 500 then
    raise exception 'A observação aceita no máximo 500 caracteres.' using errcode = '22023';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_items) as raw(item)
     where pg_catalog.jsonb_typeof(raw.item) <> 'object'
        or coalesce(raw.item ->> 'product_id', '')
             !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        or coalesce(raw.item ->> 'quantity', '') !~ '^[1-9][0-9]{0,2}$'
  ) then
    raise exception 'Confira os produtos e as quantidades da venda.' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'product_id', canonical.product_id,
             'quantity', canonical.quantity,
             'notes', canonical.notes
           ) order by canonical.product_id
         ), '[]'::jsonb)
    into request_items_canonical
    from (
      select (raw.item ->> 'product_id')::uuid as product_id,
             pg_catalog.sum((raw.item ->> 'quantity')::numeric) as quantity,
             pg_catalog.max(nullif(pg_catalog.btrim(raw.item ->> 'notes'), '')) as notes
        from pg_catalog.jsonb_array_elements(p_items) as raw(item)
       group by (raw.item ->> 'product_id')::uuid
    ) as canonical;

  request_fingerprint := pg_catalog.md5(
    p_order_id::text || '|' || request_items_canonical::text || '|' || payment_method_value || '|'
    || pg_catalog.btrim(coalesce(p_notes, '')) || '|' || p_expected_updated_at::text
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));

  select mutation.*
    into mutation_row
    from public.bar_counter_sale_mutations as mutation
   where mutation.request_id = p_request_id;
  if found then
    if mutation_row.order_id is distinct from p_order_id
       or mutation_row.action <> 'EDIT'
       or mutation_row.payload_hash is distinct from request_fingerprint then
      raise exception 'Esta tentativa já foi usada em outra alteração.' using errcode = '22023';
    end if;
    select current_order.* into order_row
      from public.bar_orders as current_order
     where current_order.id = p_order_id;
    return order_row;
  end if;

  select current_order.*
    into order_row
    from public.bar_orders as current_order
   where current_order.id = p_order_id
   for update;

  if not found or order_row.source <> 'BALCAO' then
    raise exception 'Venda de balcão não encontrada.' using errcode = 'P0002';
  end if;
  if order_row.status <> 'FECHADA' or order_row.payment_status <> 'PAGO' then
    raise exception 'Somente uma venda concluída pode ser editada.' using errcode = '22023';
  end if;
  if exists (
    select 1
      from public.bar_order_items as item
     where item.order_id = p_order_id
       and item.status in ('EM_PREPARO', 'PRONTO', 'ENTREGUE')
       and item.requires_production is true
  ) then
    raise exception 'Uma comida desta venda já entrou em preparo ou foi entregue. Cancele a venda para manter a cozinha correta.'
      using errcode = '22023';
  end if;
  if order_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'Esta venda foi alterada em outro aparelho. Atualize o histórico e tente novamente.' using errcode = '40001';
  end if;

  before_snapshot := public.bar_counter_sale_snapshot(p_order_id);
  select coalesce(
           pg_catalog.jsonb_object_agg(active_item.product_id::text, active_item.quantity),
           '{}'::jsonb
         )
    into previous_item_quantities
    from (
      select item.product_id, pg_catalog.sum(item.quantity) as quantity
        from public.bar_order_items as item
       where item.order_id = p_order_id
         and item.status <> 'CANCELADO'
         and item.product_id is not null
       group by item.product_id
    ) as active_item;
  perform pg_catalog.set_config('ilha.bar_counter_request_id', order_row.counter_request_id::text, true);
  perform pg_catalog.set_config('ilha.bar_counter_mutation_request_id', p_request_id::text, true);

  select coalesce(finance.due_date, (pg_catalog.timezone('America/Sao_Paulo', coalesce(order_row.closed_at, order_row.opened_at, sale_time)) - interval '6 hours')::date),
         coalesce(finance.paid_at, order_row.closed_at, order_row.opened_at, sale_time)
    into receipt_due_date, receipt_paid_at
    from (select 1) as required_row
    left join lateral (
      select entry.due_date, entry.paid_at
        from public.bar_financial_entries as entry
       where entry.order_id = p_order_id
         and entry.type = 'RECEITA'
         and entry.status <> 'CANCELADO'
       order by entry.created_at desc, entry.id desc
       limit 1
    ) as finance on true;

  -- Bloqueia todos os produtos envolvidos em ordem estável antes de devolver
  -- ou retirar estoque, evitando resultados diferentes entre dois caixas.
  perform product.id
    from public.bar_products as product
   where product.id in (
     select item.product_id
       from public.bar_order_items as item
      where item.order_id = p_order_id
        and item.status <> 'CANCELADO'
        and item.product_id is not null
     union
     select (raw.item ->> 'product_id')::uuid
       from pg_catalog.jsonb_array_elements(p_items) as raw(item)
   )
   order by product.id
   for update;

  select coalesce(pg_catalog.max(item.counter_revision), 0) + 1
    into next_revision
    from public.bar_order_items as item
   where item.order_id = p_order_id;

  for old_item in
    select item.*
      from public.bar_order_items as item
     where item.order_id = p_order_id
       and item.status <> 'CANCELADO'
     order by item.id
  loop
    if old_item.product_id is not null then
      select movement.id
        into original_movement_id
        from public.bar_inventory_movements as movement
       where movement.order_item_id = old_item.id
         and movement.type = 'SAIDA'
       order by movement.occurred_at, movement.id
       limit 1;
      if original_movement_id is null then
        raise exception 'A saída de estoque da venda está incompleta. Fale com o administrador.' using errcode = '23514';
      end if;

      update public.bar_products
         set stock_quantity = stock_quantity + old_item.quantity,
             updated_at = sale_time
       where id = old_item.product_id;

      insert into public.bar_inventory_movements (
        product_id, order_item_id, type, quantity, unit_cost, reason,
        created_by, occurred_at, created_at, reverses_movement_id
      ) values (
        old_item.product_id, old_item.id, 'ESTORNO', old_item.quantity,
        old_item.cost_price, 'Estorno para edição da venda de balcão #' || order_row.command_number,
        (select auth.uid()), sale_time, sale_time, original_movement_id
      );
    end if;
  end loop;

  update public.bar_order_items
     set status = 'CANCELADO', updated_at = sale_time
   where order_id = p_order_id
     and status <> 'CANCELADO';

  for requested in
    select (raw.item ->> 'product_id')::uuid as product_id,
           pg_catalog.sum((raw.item ->> 'quantity')::numeric) as quantity,
           pg_catalog.max(nullif(pg_catalog.btrim(raw.item ->> 'notes'), '')) as notes
      from pg_catalog.jsonb_array_elements(p_items) as raw(item)
     group by (raw.item ->> 'product_id')::uuid
     order by (raw.item ->> 'product_id')::uuid
  loop
    select product.*
      into product_row
      from public.bar_products as product
     where product.id = requested.product_id
     for update;

    if not found then
      raise exception 'Um produto não está mais disponível.' using errcode = '22023';
    end if;
    if product_row.active is not true
       and requested.quantity > coalesce(
         (previous_item_quantities ->> requested.product_id::text)::numeric,
         0
       ) then
      raise exception 'Um produto foi arquivado. Mantenha a quantidade anterior ou remova esse item da venda.'
        using errcode = '22023';
    end if;
    if requested.quantity > 999 then
      raise exception 'Quantidade inválida para %.', product_row.name using errcode = '22023';
    end if;
    if product_row.stock_quantity < requested.quantity then
      raise exception 'Estoque insuficiente para %.', product_row.name using errcode = '22023';
    end if;

    product_category_key := pg_catalog.translate(
      pg_catalog.lower(coalesce(product_row.category, '')),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    );
    product_name_key := pg_catalog.translate(
      pg_catalog.lower(coalesce(product_row.name, '')),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    );
    requires_production_value :=
      product_category_key like '%porc%'
      or product_category_key like '%refeic%'
      or product_category_key like '%almoc%'
      or product_category_key like '%frita%'
      or product_category_key like '%petisco%'
      or product_category_key like '%lanche%'
      or product_category_key like '%sandu%'
      or product_category_key like '%hamburg%'
      or product_category_key like '%torrada%'
      or product_category_key like '%salgad%'
      or product_category_key like '%comida%'
      or product_category_key like '%janta%'
      or product_category_key like '%prato%'
      or product_category_key like '%pizza%'
      or product_name_key like '%mini pizza%';

    sale_total := sale_total + pg_catalog.round(product_row.sale_price * requested.quantity, 2);
    normalized_items := normalized_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'product_id', product_row.id,
        'product_name', product_row.name,
        'quantity', requested.quantity,
        'unit_price', product_row.sale_price,
        'cost_price', product_row.cost_price,
        'notes', requested.notes,
        'requires_production', requires_production_value
      )
    );
  end loop;

  if sale_total <= 0 then
    raise exception 'O total da venda precisa ser maior que zero.' using errcode = '22023';
  end if;

  for normalized_item in
    select value from pg_catalog.jsonb_array_elements(normalized_items)
  loop
    insert into public.bar_order_items (
      order_id, product_id, product_name, quantity, unit_price, cost_price,
      source, status, notes, added_by, counter_revision, requires_production, created_at, updated_at
    ) values (
      p_order_id,
      (normalized_item ->> 'product_id')::uuid,
      normalized_item ->> 'product_name',
      (normalized_item ->> 'quantity')::numeric,
      (normalized_item ->> 'unit_price')::numeric,
      (normalized_item ->> 'cost_price')::numeric,
      'BALCAO',
      case when (normalized_item ->> 'requires_production')::boolean then 'SOLICITADO' else 'ENTREGUE' end,
      nullif(normalized_item ->> 'notes', ''),
      (select auth.uid()), next_revision, (normalized_item ->> 'requires_production')::boolean, sale_time, sale_time
    )
    returning * into inserted_item;

    update public.bar_products
       set stock_quantity = stock_quantity - inserted_item.quantity,
           updated_at = sale_time
     where id = inserted_item.product_id;

    insert into public.bar_inventory_movements (
      product_id, order_item_id, type, quantity, unit_cost, reason,
      created_by, occurred_at, created_at
    ) values (
      inserted_item.product_id, inserted_item.id, 'SAIDA', -inserted_item.quantity,
      inserted_item.cost_price, 'Venda rápida no balcão · revisão ' || next_revision,
      (select auth.uid()), sale_time, sale_time
    );
  end loop;

  update public.bar_financial_entries
     set status = 'CANCELADO', updated_at = sale_time,
         notes = concat_ws(E'\n', nullif(notes, ''), 'Substituído pela revisão ' || next_revision || ' da venda.')
   where order_id = p_order_id
     and type = 'RECEITA'
     and status <> 'CANCELADO';

  insert into public.bar_financial_entries (
    order_id, type, description, counterparty, category, amount, due_date,
    status, payment_method, paid_at, notes, created_by, created_at, updated_at
  ) values (
    p_order_id, 'RECEITA',
    'Venda de balcão #' || order_row.command_number || ' · revisão ' || next_revision,
    'Balcão', 'Vendas', sale_total, receipt_due_date,
    'RECEBIDO', payment_method_value, receipt_paid_at,
    nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
    (select auth.uid()), sale_time, sale_time
  );

  update public.bar_orders
     set subtotal = sale_total,
         total = sale_total,
         payment_method = payment_method_value,
         notes = nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
         counter_last_edited_at = sale_time,
         counter_last_edited_by = (select auth.uid()),
         updated_at = sale_time
   where id = p_order_id
  returning * into order_row;

  after_snapshot := public.bar_counter_sale_snapshot(p_order_id);
  insert into public.bar_counter_sale_mutations (
    request_id, order_id, action, payload_hash, before_state, after_state, created_by, created_at
  ) values (
    p_request_id, p_order_id, 'EDIT', request_fingerprint,
    before_snapshot, after_snapshot, (select auth.uid()), sale_time
  );

  return order_row;
end;
$$;

revoke all on function public.bar_update_counter_sale(uuid, jsonb, text, text, timestamptz, uuid)
  from public, anon;
grant execute on function public.bar_update_counter_sale(uuid, jsonb, text, text, timestamptz, uuid)
  to authenticated;

create or replace function public.bar_cancel_counter_sale(
  p_order_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz,
  p_request_id uuid
)
returns public.bar_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.bar_orders%rowtype;
  mutation_row public.bar_counter_sale_mutations%rowtype;
  old_item record;
  request_fingerprint text;
  before_snapshot jsonb;
  after_snapshot jsonb;
  original_movement_id uuid;
  cancellation_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  sale_time timestamptz := pg_catalog.transaction_timestamp();
begin
  if (select auth.uid()) is null
     or not (select public.has_bar_permission('bar.orders')) then
    raise exception 'Seu acesso do Bar não permite cancelar vendas de balcão.'
      using errcode = '42501';
  end if;

  if p_order_id is null or p_request_id is null or p_expected_updated_at is null then
    raise exception 'Dados de cancelamento inválidos. Atualize o histórico e tente novamente.' using errcode = '22023';
  end if;
  if cancellation_reason is null or pg_catalog.length(cancellation_reason) < 3 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = '22023';
  end if;
  if pg_catalog.length(cancellation_reason) > 500 then
    raise exception 'O motivo aceita no máximo 500 caracteres.' using errcode = '22023';
  end if;

  request_fingerprint := pg_catalog.md5(
    p_order_id::text || '|' || cancellation_reason || '|' || p_expected_updated_at::text
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));

  select mutation.*
    into mutation_row
    from public.bar_counter_sale_mutations as mutation
   where mutation.request_id = p_request_id;
  if found then
    if mutation_row.order_id is distinct from p_order_id
       or mutation_row.action <> 'CANCEL'
       or mutation_row.payload_hash is distinct from request_fingerprint then
      raise exception 'Esta tentativa já foi usada em outra alteração.' using errcode = '22023';
    end if;
    select current_order.* into order_row
      from public.bar_orders as current_order
     where current_order.id = p_order_id;
    return order_row;
  end if;

  select current_order.*
    into order_row
    from public.bar_orders as current_order
   where current_order.id = p_order_id
   for update;

  if not found or order_row.source <> 'BALCAO' then
    raise exception 'Venda de balcão não encontrada.' using errcode = 'P0002';
  end if;
  if order_row.status = 'CANCELADA' then
    raise exception 'Esta venda já foi cancelada.' using errcode = '22023';
  end if;
  if order_row.status <> 'FECHADA' or order_row.payment_status <> 'PAGO' then
    raise exception 'Somente uma venda concluída pode ser cancelada.' using errcode = '22023';
  end if;
  if order_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'Esta venda foi alterada em outro aparelho. Atualize o histórico e tente novamente.' using errcode = '40001';
  end if;

  before_snapshot := public.bar_counter_sale_snapshot(p_order_id);
  perform pg_catalog.set_config('ilha.bar_counter_request_id', order_row.counter_request_id::text, true);
  perform pg_catalog.set_config('ilha.bar_counter_mutation_request_id', p_request_id::text, true);

  perform product.id
    from public.bar_products as product
   where product.id in (
     select item.product_id
       from public.bar_order_items as item
      where item.order_id = p_order_id
        and item.status <> 'CANCELADO'
        and item.product_id is not null
   )
   order by product.id
   for update;

  for old_item in
    select item.*
      from public.bar_order_items as item
     where item.order_id = p_order_id
       and item.status <> 'CANCELADO'
     order by item.id
  loop
    if old_item.product_id is not null
       and not (
         old_item.status in ('EM_PREPARO', 'PRONTO', 'ENTREGUE')
         and old_item.requires_production is true
       ) then
      select movement.id
        into original_movement_id
        from public.bar_inventory_movements as movement
       where movement.order_item_id = old_item.id
         and movement.type = 'SAIDA'
       order by movement.occurred_at, movement.id
       limit 1;
      if original_movement_id is null then
        raise exception 'A saída de estoque da venda está incompleta. Fale com o administrador.' using errcode = '23514';
      end if;

      update public.bar_products
         set stock_quantity = stock_quantity + old_item.quantity,
             updated_at = sale_time
       where id = old_item.product_id;

      insert into public.bar_inventory_movements (
        product_id, order_item_id, type, quantity, unit_cost, reason,
        created_by, occurred_at, created_at, reverses_movement_id
      ) values (
        old_item.product_id, old_item.id, 'ESTORNO', old_item.quantity,
        old_item.cost_price, 'Cancelamento da venda de balcão #' || order_row.command_number || ': ' || cancellation_reason,
        (select auth.uid()), sale_time, sale_time, original_movement_id
      );
    end if;
  end loop;

  update public.bar_order_items
     set status = 'CANCELADO', updated_at = sale_time
   where order_id = p_order_id
     and status <> 'CANCELADO';

  update public.bar_financial_entries
     set status = 'CANCELADO', updated_at = sale_time,
         notes = concat_ws(E'\n', nullif(notes, ''), 'Cancelamento: ' || cancellation_reason)
   where order_id = p_order_id
     and status <> 'CANCELADO';

  update public.bar_orders
     set status = 'CANCELADA',
         payment_status = 'CANCELADO',
         subtotal = order_row.subtotal,
         total = order_row.total,
         counter_cancel_reason = cancellation_reason,
         counter_cancelled_at = sale_time,
         counter_cancelled_by = (select auth.uid()),
         updated_at = sale_time
   where id = p_order_id
  returning * into order_row;

  after_snapshot := public.bar_counter_sale_snapshot(p_order_id);
  insert into public.bar_counter_sale_mutations (
    request_id, order_id, action, payload_hash, reason,
    before_state, after_state, created_by, created_at
  ) values (
    p_request_id, p_order_id, 'CANCEL', request_fingerprint, cancellation_reason,
    before_snapshot, after_snapshot, (select auth.uid()), sale_time
  );

  return order_row;
end;
$$;

revoke all on function public.bar_cancel_counter_sale(uuid, text, timestamptz, uuid)
  from public, anon;
grant execute on function public.bar_cancel_counter_sale(uuid, text, timestamptz, uuid)
  to authenticated;

create or replace function public.bar_update_counter_item_status(
  p_item_id uuid,
  p_status text,
  p_expected_updated_at timestamptz
)
returns public.bar_order_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row public.bar_order_items%rowtype;
  order_row public.bar_orders%rowtype;
  target_order_id uuid;
  status_value text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_status, '')));
  change_time timestamptz := pg_catalog.transaction_timestamp();
begin
  if (select auth.uid()) is null
     or not (
       (select public.has_bar_permission('bar.kitchen'))
       or (select public.has_bar_permission('bar.orders'))
     ) then
    raise exception 'Seu acesso do Bar não permite atualizar a produção.' using errcode = '42501';
  end if;

  if p_item_id is null or p_expected_updated_at is null
     or status_value not in ('PRONTO', 'ENTREGUE') then
    raise exception 'Atualização de produção inválida.' using errcode = '22023';
  end if;

  select item.order_id
    into target_order_id
    from public.bar_order_items as item
   where item.id = p_item_id;

  if not found then
    raise exception 'Item de balcão não encontrado.' using errcode = 'P0002';
  end if;

  select sale.*
    into order_row
    from public.bar_orders as sale
   where sale.id = target_order_id
     and sale.source = 'BALCAO'
   for update;
  if not found or order_row.status <> 'FECHADA' then
    raise exception 'A venda de balcão não está disponível para produção.' using errcode = '22023';
  end if;

  select item.*
    into item_row
    from public.bar_order_items as item
   where item.id = p_item_id
     and item.order_id = order_row.id
   for update;

  if not found or item_row.source <> 'BALCAO' then
    raise exception 'Item de balcão não encontrado.' using errcode = 'P0002';
  end if;
  if item_row.requires_production is not true then
    raise exception 'Este item não pertence à fila da cozinha.' using errcode = '22023';
  end if;
  if item_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'Este item foi atualizado em outro aparelho. Atualize e tente novamente.' using errcode = '40001';
  end if;
  if item_row.status = 'CANCELADO' then
    raise exception 'Um item cancelado não pode voltar para a produção.' using errcode = '22023';
  end if;
  if status_value = 'PRONTO' and item_row.status not in ('SOLICITADO', 'EM_PREPARO') then
    raise exception 'Este item não está aguardando preparo.' using errcode = '22023';
  end if;
  if status_value = 'ENTREGUE' and item_row.status <> 'PRONTO' then
    raise exception 'Marque o item como pronto antes de entregar.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('ilha.bar_counter_request_id', order_row.counter_request_id::text, true);

  update public.bar_order_items
     set status = status_value, updated_at = change_time
   where id = p_item_id
  returning * into item_row;

  update public.bar_orders
     set updated_at = change_time
   where id = order_row.id;

  return item_row;
end;
$$;

revoke all on function public.bar_update_counter_item_status(uuid, text, timestamptz)
  from public, anon;
grant execute on function public.bar_update_counter_item_status(uuid, text, timestamptz)
  to authenticated;
