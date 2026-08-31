-- A QR Code pode estar vinculado a uma comanda aberta criada pela equipe sem
-- telefone. Nesse caso, a identificação pública precisa completar a própria
-- comanda antes que bar_public_submit_card_order reutilize os dados dela.
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

  -- O token comprova a posse do cartão/mesa. Sempre persistimos o telefone
  -- validado informado neste acesso para corrigir comandas abertas sem contato.
  update public.bar_orders
     set customer_name = coalesce(nullif(trim(customer_name), ''), customer_value),
         customer_phone = phone_value,
         updated_at = now()
   where id = order_row.id
   returning * into order_row;

  return jsonb_build_object(
    'command_number', order_row.command_number,
    'status', order_row.status,
    'customer_name', order_row.customer_name,
    'access_label', access_label,
    'access_kind', access_kind
  );
end;
$$;

revoke all on function public.bar_public_claim_access(text, text, text) from public;
grant execute on function public.bar_public_claim_access(text, text, text) to anon, authenticated;
