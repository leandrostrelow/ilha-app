create or replace function public.bar_delete_test_order(p_order_id uuid)
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
     and lower(trim(coalesce(customer_name, ''))) in ('test', 'teste')
   for update;

  if not found then
    raise exception 'Somente uma comanda de teste aberta pode ser excluida por esta acao.';
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
        'Exclusao da comanda de teste #' || order_row.command_number, auth.uid()
      );
    end if;
  end loop;

  update public.bar_financial_entries
     set status = 'CANCELADO',
         paid_at = null,
         notes = concat_ws(' · ', nullif(trim(coalesce(notes, '')), ''), 'Comanda de teste excluida'),
         updated_at = now()
   where order_id = order_row.id
     and status <> 'CANCELADO';

  delete from public.bar_orders where id = order_row.id;
  return order_row.id;
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
  received_total numeric(10, 2);
  external_received_total numeric(10, 2);
  expected_parts_total numeric(10, 2);
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

  order_total := round(greatest(0, order_row.subtotal + greatest(0, coalesce(p_service_charge, 0)) - greatest(0, coalesce(p_discount, 0))), 2);

  for part_item in select value from jsonb_array_elements(p_parts)
  loop
    part_position := coalesce(nullif(part_item ->> 'position', '')::integer, 0);
    part_name := left(trim(coalesce(part_item ->> 'person_name', '')), 80);
    part_method := upper(trim(coalesce(part_item ->> 'payment_method', '')));
    part_amount := round(coalesce(nullif(part_item ->> 'amount', '')::numeric, 0), 2);

    if part_position < 1 or part_position > part_count then raise exception 'Posicao invalida na divisao.'; end if;
    if part_name = '' then raise exception 'Informe o nome da pessoa %.', part_position; end if;
    if part_method not in ('PIX', 'DINHEIRO', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'CONTA_CLIENTE') then raise exception 'Forma de pagamento invalida para %.', part_name; end if;
    if part_amount <= 0 then raise exception 'O valor de % deve ser maior que zero.', part_name; end if;

    if exists (
      select 1 from public.bar_order_payment_parts
       where order_id = order_row.id and position = part_position and status = 'PAGO'
         and (amount <> part_amount or person_name <> part_name)
    ) then
      raise exception 'A parte ja paga de % nao pode ser alterada.', part_name;
    end if;
    part_total := part_total + part_amount;
  end loop;

  select coalesce(sum(amount), 0) into received_total
    from public.bar_financial_entries
   where order_id = order_row.id and type = 'RECEITA' and status in ('RECEBIDO', 'PAGO');
  select coalesce(sum(amount), 0) into paid_total
    from public.bar_order_payment_parts
   where order_id = order_row.id and status = 'PAGO';

  external_received_total := greatest(0, round(received_total - paid_total, 2));
  expected_parts_total := greatest(0, round(order_total - external_received_total, 2));
  if round(part_total, 2) <> expected_parts_total then
    raise exception 'A soma das pessoas (%) deve ser igual ao saldo da comanda (%).', round(part_total, 2), expected_parts_total;
  end if;

  delete from public.bar_order_payment_parts where order_id = order_row.id and status = 'PENDENTE';

  for part_item in select value from jsonb_array_elements(p_parts)
  loop
    part_position := (part_item ->> 'position')::integer;
    part_name := left(trim(part_item ->> 'person_name'), 80);
    part_method := upper(trim(part_item ->> 'payment_method'));
    part_amount := round((part_item ->> 'amount')::numeric, 2);

    insert into public.bar_order_payment_parts (
      order_id, position, person_name, amount, payment_method, split_mode, allocation, created_by
    ) values (
      order_row.id, part_position, part_name, part_amount, part_method, split_mode_value,
      coalesce(part_item -> 'allocation', '{}'::jsonb), auth.uid()
    )
    on conflict (order_id, position) do update
      set person_name = excluded.person_name, amount = excluded.amount,
          payment_method = excluded.payment_method, split_mode = excluded.split_mode,
          allocation = excluded.allocation, updated_at = now()
      where public.bar_order_payment_parts.status = 'PENDENTE';
  end loop;

  update public.bar_orders
     set discount = greatest(0, coalesce(p_discount, 0)),
         service_charge = greatest(0, coalesce(p_service_charge, 0)),
         total = order_total,
         payment_status = case when received_total >= order_total and order_total > 0 then 'PAGO' when received_total > 0 then 'PARCIAL' else 'ABERTO' end,
         payment_method = 'DIVIDIDO', closed_at = null, updated_at = now()
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
  paid_total numeric(10, 2);
begin
  if not public.is_bar_staff() then raise exception 'Acesso negado ao Bar.'; end if;

  perform public.bar_save_order_payment_split(p_order_id, p_parts, p_discount, p_service_charge, p_split_mode);
  select * into order_row from public.bar_orders where id = p_order_id for update;
  select * into payment_part from public.bar_order_payment_parts where order_id = p_order_id and position = p_position for update;
  if not found then raise exception 'Pessoa nao encontrada nesta divisao.'; end if;
  if payment_part.status = 'PAGO' then return order_row; end if;

  insert into public.bar_financial_entries (
    order_id, type, description, counterparty, category, amount, due_date,
    status, payment_method, paid_at, notes, created_by
  ) values (
    order_row.id, 'RECEITA', 'Venda da comanda #' || order_row.command_number || ' · ' || payment_part.person_name,
    payment_part.person_name, 'Vendas', payment_part.amount, current_date, 'RECEBIDO',
    payment_part.payment_method, now(), concat_ws(' · ', 'Pagamento individual', nullif(trim(coalesce(p_notes, '')), '')), auth.uid()
  );

  update public.bar_order_payment_parts set status = 'PAGO', paid_at = now(), updated_at = now() where id = payment_part.id;
  select coalesce(sum(amount), 0) into paid_total
    from public.bar_financial_entries
   where order_id = order_row.id and type = 'RECEITA' and status in ('RECEBIDO', 'PAGO');

  update public.bar_orders
     set payment_status = case when paid_total >= total and total > 0 then 'PAGO' else 'PARCIAL' end,
         payment_method = 'DIVIDIDO', notes = nullif(trim(coalesce(p_notes, '')), ''), updated_at = now()
   where id = order_row.id
   returning * into order_row;
  return order_row;
end;
$$;

revoke all on function public.bar_delete_test_order(uuid) from public;
revoke all on function public.bar_save_order_payment_split(uuid, jsonb, numeric, numeric, text) from public;
revoke all on function public.bar_receive_order_payment_part(uuid, integer, jsonb, numeric, numeric, text, text) from public;
grant execute on function public.bar_delete_test_order(uuid) to authenticated;
grant execute on function public.bar_save_order_payment_split(uuid, jsonb, numeric, numeric, text) to authenticated;
grant execute on function public.bar_receive_order_payment_part(uuid, integer, jsonb, numeric, numeric, text, text) to authenticated;
