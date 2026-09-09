begin;

create extension if not exists pgtap with schema extensions;

select plan(42);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"ci-protected-admin@tests.invalid"}',
  true
);

insert into public.bar_products (
  id, name, sku, category, sale_price, cost_price,
  stock_quantity, minimum_stock, unit, active
) values
  (
    '74000000-0000-4000-8000-000000000001'::uuid,
    'Água gestão balcão', 'CI-BALCAO-MGT-1', 'Águas', 4.00, 1.00,
    10, 1, 'un', true
  ),
  (
    '74000000-0000-4000-8000-000000000002'::uuid,
    'Jantinha gestão balcão', 'CI-BALCAO-MGT-2', 'Refeições', 25.00, 10.00,
    8, 1, 'un', true
  ),
  (
    '74000000-0000-4000-8000-000000000003'::uuid,
    'Gatorade gestão balcão', 'CI-BALCAO-MGT-3', 'Bebidas', 8.00, 3.00,
    6, 1, 'un', true
  );

select has_table(
  'public',
  'bar_counter_sale_mutations',
  'a trilha de edição e cancelamento do balcão existe'
);

select ok(
  (select relrowsecurity
     from pg_catalog.pg_class
    where oid = 'public.bar_counter_sale_mutations'::pg_catalog.regclass),
  'RLS protege a trilha interna de auditoria'
);

select lives_ok(
  $$select public.bar_complete_counter_sale(
    '[
      {"product_id":"74000000-0000-4000-8000-000000000001","quantity":2},
      {"product_id":"74000000-0000-4000-8000-000000000002","quantity":1}
    ]'::jsonb,
    'DINHEIRO',
    '75000000-0000-4000-8000-000000000001'::uuid,
    'Venda com jantinha'
  )$$,
  'uma venda pode misturar item imediato e alimento'
);

create temporary table counter_management_state (
  order_id uuid primary key,
  edit_expected_at timestamptz,
  cancel_expected_at timestamptz
) on commit drop;

insert into counter_management_state (order_id, edit_expected_at)
select id, updated_at
  from public.bar_orders
 where counter_request_id = '75000000-0000-4000-8000-000000000001'::uuid;

select is(
  (select source || ':' || status || ':' || payment_status || ':' || payment_method || ':' || total
     from public.bar_orders
    where id = (select order_id from counter_management_state)),
  'BALCAO:FECHADA:PAGO:DINHEIRO:33.00',
  'a venda nasce paga, fechada e com total calculado pelo banco'
);

select ok(
  (select count(*) = 1
     from public.bar_order_items
    where order_id = (select order_id from counter_management_state)
      and product_id = '74000000-0000-4000-8000-000000000001'::uuid
      and status = 'ENTREGUE'
      and requires_production is false
      and counter_revision = 1)
  and
  (select count(*) = 1
     from public.bar_order_items
    where order_id = (select order_id from counter_management_state)
      and product_id = '74000000-0000-4000-8000-000000000002'::uuid
      and status = 'SOLICITADO'
      and requires_production is true
      and counter_revision = 1),
  'item imediato e jantinha guardam o tipo de preparo imutável da venda'
);

select ok(
  (select stock_quantity = 8
     from public.bar_products
    where id = '74000000-0000-4000-8000-000000000001'::uuid)
  and
  (select stock_quantity = 7
     from public.bar_products
    where id = '74000000-0000-4000-8000-000000000002'::uuid),
  'a criação baixa exatamente o estoque dos dois itens'
);

select is(
  (select count(*)::integer
     from public.bar_financial_entries
    where order_id = (select order_id from counter_management_state)
      and type = 'RECEITA'
      and status = 'RECEBIDO'
      and amount = 33.00),
  1,
  'a criação lança um único recebimento'
);

update public.bar_products
   set active = false
 where id = '74000000-0000-4000-8000-000000000001'::uuid;

select lives_ok(
  $$select public.bar_update_counter_sale(
    (select order_id from counter_management_state),
    '[
      {"product_id":"74000000-0000-4000-8000-000000000001","quantity":1},
      {"product_id":"74000000-0000-4000-8000-000000000002","quantity":2},
      {"product_id":"74000000-0000-4000-8000-000000000003","quantity":1}
    ]'::jsonb,
    'PIX',
    'Venda corrigida',
    (select edit_expected_at from counter_management_state),
    '75000000-0000-4000-8000-000000000002'::uuid
  )$$,
  'a edição substitui a composição e permite manter ou reduzir produto arquivado'
);

select ok(
  (select total = 62.00
      and subtotal = 62.00
      and payment_method = 'PIX'
      and notes = 'Venda corrigida'
      and counter_last_edited_at is not null
     from public.bar_orders
    where id = (select order_id from counter_management_state)),
  'a edição atualiza valor, pagamento, observação e metadados'
);

select ok(
  (select count(*) = 2 and min(counter_revision) = 1 and max(counter_revision) = 1
     from public.bar_order_items
    where order_id = (select order_id from counter_management_state)
      and counter_revision = 1)
  and
  (select count(*) = 3 and min(counter_revision) = 2 and max(counter_revision) = 2
     from public.bar_order_items
    where order_id = (select order_id from counter_management_state)
      and counter_revision = 2),
  'a edição preserva a revisão original e cria a revisão seguinte'
);

select is(
  (select count(*)::integer
     from public.bar_order_items
    where order_id = (select order_id from counter_management_state)
      and counter_revision = 1
      and status = 'CANCELADO'),
  2,
  'todos os itens da revisão anterior ficam cancelados'
);

select ok(
  (select count(*) = 1
     from public.bar_order_items
    where order_id = (select order_id from counter_management_state)
      and counter_revision = 2
      and product_id = '74000000-0000-4000-8000-000000000002'::uuid
      and status = 'SOLICITADO')
  and
  (select count(*) = 2
     from public.bar_order_items
    where order_id = (select order_id from counter_management_state)
      and counter_revision = 2
      and status = 'ENTREGUE'),
  'a nova revisão mantém comida na cozinha e entrega os itens imediatos'
);

select ok(
  (select stock_quantity = 9
     from public.bar_products
    where id = '74000000-0000-4000-8000-000000000001'::uuid)
  and
  (select stock_quantity = 6
     from public.bar_products
    where id = '74000000-0000-4000-8000-000000000002'::uuid)
  and
  (select stock_quantity = 5
     from public.bar_products
    where id = '74000000-0000-4000-8000-000000000003'::uuid),
  'a edição devolve a revisão antiga e baixa somente a nova'
);

select throws_ok(
  $$select public.bar_update_counter_sale(
    (select order_id from counter_management_state),
    '[
      {"product_id":"74000000-0000-4000-8000-000000000001","quantity":2},
      {"product_id":"74000000-0000-4000-8000-000000000002","quantity":2},
      {"product_id":"74000000-0000-4000-8000-000000000003","quantity":1}
    ]'::jsonb,
    'PIX',
    'Tentativa de aumentar arquivado',
    (select updated_at from public.bar_orders where id = (select order_id from counter_management_state)),
    '75000000-0000-4000-8000-000000000008'::uuid
  )$$,
  '22023',
  'Um produto foi arquivado. Mantenha a quantidade anterior ou remova esse item da venda.',
  'produto arquivado não pode ganhar quantidade nova durante uma correção'
);

select ok(
  (select count(*) = 1
     from public.bar_financial_entries
    where order_id = (select order_id from counter_management_state)
      and status = 'CANCELADO'
      and amount = 33.00)
  and
  (select count(*) = 1
     from public.bar_financial_entries
    where order_id = (select order_id from counter_management_state)
      and status = 'RECEBIDO'
      and amount = 62.00
      and payment_method = 'PIX'),
  'o recebimento antigo é cancelado e a revisão lança apenas o novo valor'
);

select ok(
  (select count(*) = 1
      and bool_and(action = 'EDIT')
      and bool_and(created_by = '10000000-0000-4000-8000-000000000001'::uuid)
      and min(pg_catalog.jsonb_array_length(before_state -> 'items')) = 2
      and min(pg_catalog.jsonb_array_length(after_state -> 'items')) = 5
     from public.bar_counter_sale_mutations
    where order_id = (select order_id from counter_management_state)
      and request_id = '75000000-0000-4000-8000-000000000002'::uuid),
  'a auditoria da edição guarda autor e estados anterior/posterior'
);

select lives_ok(
  $$select public.bar_update_counter_sale(
    (select order_id from counter_management_state),
    '[
      {"product_id":"74000000-0000-4000-8000-000000000001","quantity":1},
      {"product_id":"74000000-0000-4000-8000-000000000002","quantity":2},
      {"product_id":"74000000-0000-4000-8000-000000000003","quantity":1}
    ]'::jsonb,
    'PIX',
    'Venda corrigida',
    (select edit_expected_at from counter_management_state),
    '75000000-0000-4000-8000-000000000002'::uuid
  )$$,
  'repetir a mesma edição com a mesma chave é idempotente'
);

select ok(
  (select count(*) = 1
     from public.bar_counter_sale_mutations
    where order_id = (select order_id from counter_management_state))
  and
  (select count(*) = 5
     from public.bar_order_items
    where order_id = (select order_id from counter_management_state))
  and
  (select count(*) = 2
     from public.bar_financial_entries
    where order_id = (select order_id from counter_management_state))
  and
  (select count(*) = 7
     from public.bar_inventory_movements
    where order_item_id in (
      select id from public.bar_order_items
       where order_id = (select order_id from counter_management_state)
    )),
  'o retry da edição não duplica itens, caixa, estoque ou auditoria'
);

select throws_ok(
  $$select public.bar_update_counter_sale(
    (select order_id from counter_management_state),
    '[{"product_id":"74000000-0000-4000-8000-000000000001","quantity":3}]'::jsonb,
    'PIX',
    'Venda corrigida',
    (select edit_expected_at from counter_management_state),
    '75000000-0000-4000-8000-000000000002'::uuid
  )$$,
  '22023',
  'Esta tentativa já foi usada em outra alteração.',
  'a chave de edição não pode ser reaproveitada com outro conteúdo'
);

select throws_ok(
  $$select public.bar_update_counter_sale(
    (select order_id from counter_management_state),
    '[{"product_id":"74000000-0000-4000-8000-000000000001","quantity":3}]'::jsonb,
    'DINHEIRO',
    'Edição concorrente',
    '2000-01-01 00:00:00+00'::timestamptz,
    '75000000-0000-4000-8000-000000000004'::uuid
  )$$,
  '40001',
  'Esta venda foi alterada em outro aparelho. Atualize o histórico e tente novamente.',
  'uma edição baseada em versão antiga é rejeitada'
);

select ok(
  (select total = 62.00 and payment_method = 'PIX'
     from public.bar_orders
    where id = (select order_id from counter_management_state))
  and
  (select count(*) = 1
     from public.bar_counter_sale_mutations
    where order_id = (select order_id from counter_management_state))
  and
  (select stock_quantity = 9
     from public.bar_products
    where id = '74000000-0000-4000-8000-000000000001'::uuid),
  'a concorrência rejeitada não deixa alteração parcial'
);

select lives_ok(
  $$select public.bar_update_counter_item_status(
    (
      select id from public.bar_order_items
       where order_id = (select order_id from counter_management_state)
         and product_id = '74000000-0000-4000-8000-000000000002'::uuid
         and counter_revision = 2
         and status = 'SOLICITADO'
    ),
    'PRONTO',
    (
      select updated_at from public.bar_order_items
       where order_id = (select order_id from counter_management_state)
         and product_id = '74000000-0000-4000-8000-000000000002'::uuid
         and counter_revision = 2
         and status = 'SOLICITADO'
    )
  )$$,
  'a cozinha atualiza o alimento da venda já editada para pronto'
);

update counter_management_state
   set cancel_expected_at = (
     select updated_at from public.bar_orders
      where id = counter_management_state.order_id
   );

select is(
  (select status
     from public.bar_order_items
    where order_id = (select order_id from counter_management_state)
      and product_id = '74000000-0000-4000-8000-000000000002'::uuid
      and counter_revision = 2),
  'PRONTO',
  'a atualização da cozinha fica registrada na revisão ativa'
);

select throws_ok(
  $$select public.bar_update_counter_item_status(
    (
      select id from public.bar_order_items
       where order_id = (select order_id from counter_management_state)
         and product_id = '74000000-0000-4000-8000-000000000002'::uuid
         and counter_revision = 2
    ),
    'ENTREGUE',
    '2000-01-01 00:00:00+00'::timestamptz
  )$$,
  '40001',
  'Este item foi atualizado em outro aparelho. Atualize e tente novamente.',
  'uma versão desatualizada da cozinha é rejeitada'
);

select is(
  (select status
     from public.bar_order_items
    where order_id = (select order_id from counter_management_state)
      and product_id = '74000000-0000-4000-8000-000000000002'::uuid
      and counter_revision = 2),
  'PRONTO',
  'a falha de concorrência não altera o item'
);

select lives_ok(
  $$select public.bar_update_counter_item_status(
    (
      select id from public.bar_order_items
       where order_id = (select order_id from counter_management_state)
         and product_id = '74000000-0000-4000-8000-000000000002'::uuid
         and counter_revision = 2
         and status = 'PRONTO'
    ),
    'ENTREGUE',
    (
      select updated_at from public.bar_order_items
       where order_id = (select order_id from counter_management_state)
         and product_id = '74000000-0000-4000-8000-000000000002'::uuid
         and counter_revision = 2
         and status = 'PRONTO'
    )
  )$$,
  'a comida pronta pode ser entregue antes do cancelamento financeiro'
);

update counter_management_state
   set cancel_expected_at = (
     select updated_at from public.bar_orders
      where id = counter_management_state.order_id
   );

select throws_ok(
  $$select public.bar_update_counter_sale(
    (select order_id from counter_management_state),
    '[
      {"product_id":"74000000-0000-4000-8000-000000000001","quantity":1},
      {"product_id":"74000000-0000-4000-8000-000000000002","quantity":1},
      {"product_id":"74000000-0000-4000-8000-000000000003","quantity":1}
    ]'::jsonb,
    'PIX',
    'Tentativa após preparo',
    (select cancel_expected_at from counter_management_state),
    '75000000-0000-4000-8000-000000000007'::uuid
  )$$,
  '22023',
  'Uma comida desta venda já entrou em preparo ou foi entregue. Cancele a venda para manter a cozinha correta.',
  'a venda não pode ser reeditada depois que a cozinha iniciou o preparo'
);

select lives_ok(
  $$select public.bar_cancel_counter_sale(
    (select order_id from counter_management_state),
    'Cliente desistiu antes da retirada',
    (select cancel_expected_at from counter_management_state),
    '75000000-0000-4000-8000-000000000005'::uuid
  )$$,
  'o cancelamento é concluído pela RPC transacional'
);

select ok(
  (select status = 'CANCELADA'
      and payment_status = 'CANCELADO'
      and subtotal = 62.00
      and total = 62.00
      and counter_cancel_reason = 'Cliente desistiu antes da retirada'
      and counter_cancelled_at is not null
     from public.bar_orders
    where id = (select order_id from counter_management_state)),
  'o pedido preservado recebe status e motivo de cancelamento'
);

select is(
  (select count(*)::integer
     from public.bar_order_items
    where order_id = (select order_id from counter_management_state)
      and status = 'CANCELADO'),
  5,
  'o cancelamento mantém e marca todas as revisões de itens'
);

select is(
  (select count(*)::integer
     from public.bar_financial_entries
    where order_id = (select order_id from counter_management_state)
      and status = 'CANCELADO'),
  2,
  'o cancelamento mantém e marca todos os lançamentos financeiros'
);

select ok(
  (select stock_quantity = 10
     from public.bar_products
    where id = '74000000-0000-4000-8000-000000000001'::uuid)
  and
  (select stock_quantity = 6
     from public.bar_products
    where id = '74000000-0000-4000-8000-000000000002'::uuid)
  and
  (select stock_quantity = 6
     from public.bar_products
    where id = '74000000-0000-4000-8000-000000000003'::uuid),
  'cancelar devolve os itens retornáveis sem recolocar comida já preparada no estoque'
);

select ok(
  (select count(*) = 5
     from public.bar_inventory_movements
    where order_item_id in (
      select id from public.bar_order_items
       where order_id = (select order_id from counter_management_state)
    )
      and type = 'SAIDA')
  and
  (select count(*) = 4
     from public.bar_inventory_movements
    where order_item_id in (
      select id from public.bar_order_items
       where order_id = (select order_id from counter_management_state)
    )
      and type = 'ESTORNO'
      and reverses_movement_id is not null)
  and
  (select count(distinct reverses_movement_id) = 4
     from public.bar_inventory_movements
    where order_item_id in (
      select id from public.bar_order_items
       where order_id = (select order_id from counter_management_state)
    )
      and type = 'ESTORNO'),
  'cada item retornável recebe no máximo um estorno rastreável'
);

select ok(
  (select count(*) = 1
      and bool_and(action = 'CANCEL')
      and bool_and(reason = 'Cliente desistiu antes da retirada')
      and bool_and(before_state -> 'order' ->> 'status' = 'FECHADA')
      and bool_and(before_state @> '{"items":[{"status":"ENTREGUE","requires_production":true}]}'::jsonb)
      and bool_and(after_state -> 'order' ->> 'status' = 'CANCELADA')
     from public.bar_counter_sale_mutations
    where order_id = (select order_id from counter_management_state)
      and request_id = '75000000-0000-4000-8000-000000000005'::uuid),
  'a auditoria do cancelamento guarda motivo e transição de estado'
);

select lives_ok(
  $$select public.bar_cancel_counter_sale(
    (select order_id from counter_management_state),
    'Cliente desistiu antes da retirada',
    (select cancel_expected_at from counter_management_state),
    '75000000-0000-4000-8000-000000000005'::uuid
  )$$,
  'repetir o mesmo cancelamento com a mesma chave é idempotente'
);

select ok(
  (select count(*) = 2
     from public.bar_counter_sale_mutations
    where order_id = (select order_id from counter_management_state))
  and
  (select count(*) = 9
     from public.bar_inventory_movements
    where order_item_id in (
      select id from public.bar_order_items
       where order_id = (select order_id from counter_management_state)
    ))
  and
  (select count(*) = 2
     from public.bar_financial_entries
    where order_id = (select order_id from counter_management_state)),
  'o retry do cancelamento não duplica estornos nem auditoria'
);

select throws_ok(
  $$select public.bar_cancel_counter_sale(
    (select order_id from counter_management_state),
    'Novo cancelamento indevido',
    (select updated_at from public.bar_orders where id = (select order_id from counter_management_state)),
    '75000000-0000-4000-8000-000000000006'::uuid
  )$$,
  '22023',
  'Esta venda já foi cancelada.',
  'uma nova chave não cancela novamente a mesma venda'
);

select set_config('ilha.bar_counter_request_id', '', true);

select throws_ok(
  $$delete from public.bar_orders
     where id = (select order_id from counter_management_state)$$,
  '42501',
  'Vendas de balcão só podem ser alteradas pelo fluxo de venda rápida.',
  'nem um administrador apaga fisicamente a venda pelo SQL comum'
);

select ok(
  exists (
    select 1 from public.bar_orders
     where id = (select order_id from counter_management_state)
       and status = 'CANCELADA'
  )
  and
  (select count(*) = 5
     from public.bar_order_items
    where order_id = (select order_id from counter_management_state))
  and
  (select count(*) = 2
     from public.bar_financial_entries
    where order_id = (select order_id from counter_management_state)),
  'pedido, itens e financeiro continuam disponíveis no histórico'
);

select ok(
  not has_table_privilege('anon', 'public.bar_counter_sale_mutations', 'SELECT')
    and not has_table_privilege('anon', 'public.bar_counter_sale_mutations', 'INSERT')
    and not has_table_privilege('authenticated', 'public.bar_counter_sale_mutations', 'SELECT')
    and not has_table_privilege('authenticated', 'public.bar_counter_sale_mutations', 'INSERT')
    and not has_table_privilege('authenticated', 'public.bar_counter_sale_mutations', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.bar_counter_sale_mutations', 'DELETE'),
  'a tabela de auditoria não é exposta diretamente à API'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.bar_update_counter_sale(uuid,jsonb,text,text,timestamp with time zone,uuid)',
    'EXECUTE'
  )
    and has_function_privilege(
      'authenticated',
      'public.bar_update_counter_sale(uuid,jsonb,text,text,timestamp with time zone,uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.bar_cancel_counter_sale(uuid,text,timestamp with time zone,uuid)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.bar_cancel_counter_sale(uuid,text,timestamp with time zone,uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.bar_update_counter_item_status(uuid,text,timestamp with time zone)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.bar_update_counter_item_status(uuid,text,timestamp with time zone)',
      'EXECUTE'
    ),
  'somente authenticated alcança as RPCs, que repetem a permissão no servidor'
);

select ok(
  not has_function_privilege('anon', 'public.bar_counter_sale_snapshot(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.bar_counter_sale_snapshot(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.guard_bar_counter_order_integrity()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_bar_counter_order_integrity()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.guard_bar_counter_detail_integrity()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_bar_counter_detail_integrity()', 'EXECUTE'),
  'snapshot e guards internos não são endpoints públicos'
);

select * from finish();

rollback;
