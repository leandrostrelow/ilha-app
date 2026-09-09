-- Venda rápida de balcão: uma venda fechada por atendimento, com estoque,
-- recebimento e histórico gravados na mesma transação.

alter table public.bar_orders
  add column if not exists counter_request_id uuid,
  add column if not exists counter_payload_hash text;

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
      and status in ('FECHADA', 'CANCELADA')
      and payment_status in ('PAGO', 'CANCELADO')
    )
    or (
      source <> 'BALCAO'
      and counter_request_id is null
      and counter_payload_hash is null
    )
  );

create unique index if not exists bar_orders_counter_request_id_uidx
  on public.bar_orders(counter_request_id)
  where counter_request_id is not null;

create index if not exists bar_orders_counter_closed_at_idx
  on public.bar_orders(closed_at desc, id desc)
  where source = 'BALCAO';

alter table public.bar_orders
  drop constraint if exists bar_orders_source_check;
alter table public.bar_orders
  add constraint bar_orders_source_check
  check (source in ('EQUIPE', 'QR_MESA', 'QR_CARTAO', 'BALCAO'));

alter table public.bar_order_items
  drop constraint if exists bar_order_items_source_check;
alter table public.bar_order_items
  add constraint bar_order_items_source_check
  check (source in ('EQUIPE', 'QR_MESA', 'QR_CARTAO', 'BALCAO'));

-- Linhas de balcão são um livro-caixa imutável. Elas só podem nascer dentro da
-- RPC transacional abaixo; assim uma edição REST não separa pedido, estoque e
-- financeiro.
create or replace function public.guard_bar_counter_order_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_request_id text := coalesce(pg_catalog.current_setting('ilha.bar_counter_request_id', true), '');
  protected_request_id uuid;
  protected_source text;
begin
  protected_request_id := case when tg_op = 'DELETE' then old.counter_request_id else new.counter_request_id end;
  protected_source := case when tg_op = 'DELETE' then old.source else new.source end;

  if tg_op = 'UPDATE' and old.source = 'BALCAO' then
    protected_request_id := old.counter_request_id;
    protected_source := old.source;
  end if;

  if protected_source = 'BALCAO'
     and (protected_request_id is null or expected_request_id <> protected_request_id::text) then
    raise exception 'Vendas de balcão só podem ser alteradas pelo fluxo de venda rápida.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.guard_bar_counter_detail_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_related_order_id uuid;
  new_related_order_id uuid;
  candidate_order_id uuid;
  related_request_id uuid;
  related_source text;
  expected_request_id text := coalesce(pg_catalog.current_setting('ilha.bar_counter_request_id', true), '');
begin
  if tg_table_name = 'bar_order_items' then
    if tg_op <> 'INSERT' then old_related_order_id := old.order_id; end if;
    if tg_op <> 'DELETE' then new_related_order_id := new.order_id; end if;
  elsif tg_table_name = 'bar_financial_entries' then
    if tg_op <> 'INSERT' then old_related_order_id := old.order_id; end if;
    if tg_op <> 'DELETE' then new_related_order_id := new.order_id; end if;
  elsif tg_table_name = 'bar_inventory_movements' then
    if tg_op <> 'INSERT' and old.order_item_id is not null then
      select item.order_id into old_related_order_id
        from public.bar_order_items as item
       where item.id = old.order_item_id;
    end if;
    if tg_op <> 'DELETE' and new.order_item_id is not null then
      select item.order_id into new_related_order_id
        from public.bar_order_items as item
       where item.id = new.order_item_id;
    end if;
  end if;

  -- Em UPDATE, protege os dois lados do vínculo. Isso impede retirar um item,
  -- movimento ou recebimento do pedido BALCAO para então editá-lo como comum.
  foreach candidate_order_id in array array[old_related_order_id, new_related_order_id]
  loop
    continue when candidate_order_id is null;

    select order_row.source, order_row.counter_request_id
      into related_source, related_request_id
      from public.bar_orders as order_row
     where order_row.id = candidate_order_id;

    if related_source = 'BALCAO'
       and (related_request_id is null or expected_request_id <> related_request_id::text) then
      raise exception 'O histórico da venda de balcão não pode ser alterado diretamente.'
        using errcode = '42501';
    end if;
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.guard_bar_counter_order_integrity() from public, anon, authenticated;
revoke all on function public.guard_bar_counter_detail_integrity() from public, anon, authenticated;

drop trigger if exists guard_bar_counter_order_integrity on public.bar_orders;
create trigger guard_bar_counter_order_integrity
before insert or update or delete on public.bar_orders
for each row execute function public.guard_bar_counter_order_integrity();

drop trigger if exists guard_bar_counter_item_integrity on public.bar_order_items;
create trigger guard_bar_counter_item_integrity
before insert or update or delete on public.bar_order_items
for each row execute function public.guard_bar_counter_detail_integrity();

drop trigger if exists guard_bar_counter_inventory_integrity on public.bar_inventory_movements;
create trigger guard_bar_counter_inventory_integrity
before insert or update or delete on public.bar_inventory_movements
for each row execute function public.guard_bar_counter_detail_integrity();

drop trigger if exists guard_bar_counter_finance_integrity on public.bar_financial_entries;
create trigger guard_bar_counter_finance_integrity
before insert or update or delete on public.bar_financial_entries
for each row execute function public.guard_bar_counter_detail_integrity();

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
  payment_method_value text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_payment_method, '')));
  product_category_key text;
  product_name_key text;
  request_fingerprint text;
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

  request_fingerprint := pg_catalog.md5(
    p_items::text || '|' || payment_method_value || '|' || pg_catalog.btrim(coalesce(p_notes, ''))
  );

  -- Serializa tentativas com a mesma chave e torna o retry seguro.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));

  select existing.*
    into order_row
    from public.bar_orders as existing
   where existing.counter_request_id = p_request_id;

  if found then
    if order_row.counter_payload_hash is distinct from request_fingerprint then
      raise exception 'Esta tentativa já foi usada por outra venda. Inicie uma nova.' using errcode = '22023';
    end if;
    return order_row;
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

  -- O ORDER BY mantém uma ordem de lock estável entre vendas concorrentes.
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

    if product_category_key like '%porc%'
       or product_category_key like '%refeic%'
       or product_category_key like '%almoc%'
       or product_category_key like '%frita%'
       or product_category_key like '%petisco%'
       or product_category_key like '%lanche%'
       or product_category_key like '%sandu%'
       or product_category_key like '%hamburg%'
       or product_category_key like '%torrada%'
       or product_name_key like '%mini pizza%' then
      raise exception 'Use a comanda normal para % porque o item precisa de preparo.', product_row.name
        using errcode = '22023';
    end if;

    sale_total := sale_total + pg_catalog.round(product_row.sale_price * requested.quantity, 2);
    normalized_items := normalized_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'product_id', product_row.id,
        'product_name', product_row.name,
        'quantity', requested.quantity,
        'unit_price', product_row.sale_price,
        'cost_price', product_row.cost_price,
        'notes', requested.notes
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
      source, status, notes, added_by, created_at, updated_at
    ) values (
      order_row.id,
      (normalized_item ->> 'product_id')::uuid,
      normalized_item ->> 'product_name',
      (normalized_item ->> 'quantity')::numeric,
      (normalized_item ->> 'unit_price')::numeric,
      (normalized_item ->> 'cost_price')::numeric,
      'BALCAO', 'ENTREGUE',
      nullif(normalized_item ->> 'notes', ''),
      (select auth.uid()), sale_time, sale_time
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
