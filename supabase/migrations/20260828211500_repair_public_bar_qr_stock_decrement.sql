-- Pedidos públicos por QR são autenticados pelo token da mesa/cartão, não por
-- uma conta da equipe. A função anterior chamava bar_adjust_stock(), que exige
-- a permissão administrativa bar.products e bloqueava todo pedido anônimo.
-- Mantemos a validação e a baixa atômica dentro da própria RPC pública.
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

    item_notes := nullif(left(trim(coalesce(item_payload ->> 'notes', '')), 200), '');
    delivery_location_value := nullif(left(trim(coalesce(item_payload ->> 'delivery_location', '')), 80), '');
    if has_card and delivery_location_value is null then
      raise exception 'Informe onde você está para receber o pedido.';
    end if;
    if has_fixed_table then
      delivery_location_value := null;
    end if;

    insert into public.bar_order_items (
      order_id, product_id, product_name, quantity, unit_price, cost_price,
      customer_name, customer_phone, source, status, notes, delivery_location
    ) values (
      order_row.id, product_row.id, product_row.name, quantity_value,
      product_row.sale_price, product_row.cost_price, customer_value, phone_value,
      access_source, 'SOLICITADO', item_notes, delivery_location_value
    ) returning * into item_row;

    update public.bar_products
       set stock_quantity = stock_quantity - quantity_value,
           updated_at = now()
     where id = product_row.id
       and stock_quantity >= quantity_value
     returning * into product_row;

    if not found then
      raise exception 'Estoque insuficiente para o produto solicitado.';
    end if;

    insert into public.bar_inventory_movements (
      product_id, order_item_id, type, quantity, unit_cost, reason
    ) values (
      product_row.id, item_row.id, 'SAIDA', -quantity_value,
      product_row.cost_price, 'Pedido QR #' || order_row.command_number
    );
  end loop;

  order_notes := nullif(left(trim(coalesce(p_notes, '')), 300), '');
  update public.bar_orders
     set customer_name = coalesce(nullif(customer_name, ''), customer_value),
         customer_phone = coalesce(nullif(customer_phone, ''), phone_value),
         source = case when source = 'EQUIPE' then source else access_source end,
         public_access_id = coalesce(public_access_id, access_card_id),
         notes = coalesce(order_notes, notes),
         updated_at = now()
   where id = order_row.id
   returning * into order_row;

  select * into order_row from public.bar_orders where id = order_row.id;

  return jsonb_build_object(
    'order_id', order_row.id,
    'command_number', order_row.command_number,
    'tracking_token', order_row.public_tracking_token,
    'table_name', coalesce(
      (select table_item.name from public.bar_tables table_item where table_item.id = order_row.table_id),
      (select card_item.label from public.bar_public_cards card_item where card_item.id = order_row.public_access_id),
      'Balcão'
    ),
    'status', order_row.status,
    'total', order_row.total
  );
end;
$$;

revoke all on function public.bar_public_submit_order(text, text, uuid, jsonb, text, text) from public;
grant execute on function public.bar_public_submit_order(text, text, uuid, jsonb, text, text) to anon, authenticated;
