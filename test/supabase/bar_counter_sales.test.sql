begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"ci-protected-admin@tests.invalid"}',
  true
);

insert into public.bar_products (
  id, name, sku, category, sale_price, cost_price, stock_quantity, minimum_stock, unit, active
) values
  ('71000000-0000-4000-8000-000000000001'::uuid, 'Gatorade sintético', 'CI-BALCAO-1', 'Bebidas', 8.00, 3.00, 5, 1, 'un', true),
  ('71000000-0000-4000-8000-000000000002'::uuid, 'Água sintética', 'CI-BALCAO-2', 'Bebidas', 4.00, 1.00, 10, 2, 'un', true),
  ('71000000-0000-4000-8000-000000000003'::uuid, 'Porção sintética', 'CI-BALCAO-3', 'Porções', 25.00, 10.00, 3, 1, 'un', true),
  ('71000000-0000-4000-8000-000000000004'::uuid, 'Bauru sintético', 'CI-BALCAO-4', 'Lanches', 18.00, 7.00, 3, 1, 'un', true),
  ('71000000-0000-4000-8000-000000000005'::uuid, 'Mini pizza sintética', 'CI-BALCAO-5', 'Outros', 20.00, 8.00, 3, 1, 'un', true);

select lives_ok(
  $$select public.bar_complete_counter_sale(
    '[{"product_id":"71000000-0000-4000-8000-000000000001","quantity":2},{"product_id":"71000000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
    'PIX',
    '72000000-0000-4000-8000-000000000001'::uuid,
    'Teste sintético'
  )$$,
  'uma venda de balcão válida é concluída'
);

select is(
  (select count(*)::integer from public.bar_orders where counter_request_id = '72000000-0000-4000-8000-000000000001'::uuid),
  1,
  'a venda cria um único pedido'
);

select is(
  (select source || ':' || status || ':' || payment_status || ':' || payment_method
     from public.bar_orders where counter_request_id = '72000000-0000-4000-8000-000000000001'::uuid),
  'BALCAO:FECHADA:PAGO:PIX',
  'o pedido nasce identificado, pago e fechado'
);

select is(
  (select total from public.bar_orders where counter_request_id = '72000000-0000-4000-8000-000000000001'::uuid),
  20.00::numeric,
  'o total usa os preços do banco'
);

select is(
  (select count(*)::integer from public.bar_order_items where order_id = (
    select id from public.bar_orders where counter_request_id = '72000000-0000-4000-8000-000000000001'::uuid
  )),
  2,
  'os itens são vinculados à venda'
);

select is(
  (select count(*)::integer from public.bar_order_items where order_id = (
    select id from public.bar_orders where counter_request_id = '72000000-0000-4000-8000-000000000001'::uuid
  ) and source = 'BALCAO' and status = 'ENTREGUE'),
  2,
  'os itens do balcão ficam entregues'
);

select is(
  (select stock_quantity from public.bar_products where id = '71000000-0000-4000-8000-000000000001'::uuid),
  3.000::numeric,
  'o estoque é baixado pela quantidade exata'
);

select is(
  (select count(*)::integer from public.bar_inventory_movements where order_item_id in (
    select id from public.bar_order_items where order_id = (
      select id from public.bar_orders where counter_request_id = '72000000-0000-4000-8000-000000000001'::uuid
    )
  ) and type = 'SAIDA'),
  2,
  'cada item recebe seu movimento de saída'
);

select is(
  (select count(*)::integer from public.bar_financial_entries where order_id = (
    select id from public.bar_orders where counter_request_id = '72000000-0000-4000-8000-000000000001'::uuid
  ) and type = 'RECEITA' and status = 'RECEBIDO' and amount = 20.00),
  1,
  'o recebimento é lançado uma única vez'
);

select lives_ok(
  $$select public.bar_complete_counter_sale(
    '[{"product_id":"71000000-0000-4000-8000-000000000001","quantity":2},{"product_id":"71000000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
    'PIX',
    '72000000-0000-4000-8000-000000000001'::uuid,
    'Teste sintético'
  )$$,
  'repetir exatamente a tentativa é idempotente'
);

select is(
  (select count(*)::integer from public.bar_financial_entries where order_id = (
    select id from public.bar_orders where counter_request_id = '72000000-0000-4000-8000-000000000001'::uuid
  )),
  1,
  'o retry não duplica o financeiro'
);

select is(
  (select stock_quantity from public.bar_products where id = '71000000-0000-4000-8000-000000000001'::uuid),
  3.000::numeric,
  'o retry não baixa estoque novamente'
);

select throws_ok(
  $$select public.bar_complete_counter_sale(
    '[{"product_id":"71000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    'PIX',
    '72000000-0000-4000-8000-000000000001'::uuid,
    'Teste sintético'
  )$$,
  '22023',
  'Esta tentativa já foi usada por outra venda. Inicie uma nova.',
  'a chave não pode ser reutilizada por outro carrinho'
);

select throws_ok(
  $$select public.bar_complete_counter_sale(
    '[{"product_id":"71000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    'CONTA_CLIENTE',
    '72000000-0000-4000-8000-000000000002'::uuid,
    null
  )$$,
  '22023',
  'Escolha Pix recebido, dinheiro, débito ou crédito.',
  'conta de cliente não vira recebimento imediato'
);

select throws_ok(
  $$select public.bar_complete_counter_sale(
    '[{"product_id":"71000000-0000-4000-8000-000000000001","quantity":4}]'::jsonb,
    'DINHEIRO',
    '72000000-0000-4000-8000-000000000003'::uuid,
    null
  )$$,
  '22023',
  'Estoque insuficiente para Gatorade sintético.',
  'estoque insuficiente rejeita a venda inteira'
);

select throws_ok(
  $$select public.bar_complete_counter_sale(
    '[{"product_id":"71000000-0000-4000-8000-000000000003","quantity":1}]'::jsonb,
    'DINHEIRO',
    '72000000-0000-4000-8000-000000000004'::uuid,
    null
  )$$,
  '22023',
  'Use a comanda normal para Porção sintética porque o item precisa de preparo.',
  'produto de cozinha não é encerrado pelo atalho'
);

select throws_ok(
  $$select public.bar_complete_counter_sale(
    '[{"product_id":"71000000-0000-4000-8000-000000000004","quantity":1}]'::jsonb,
    'DINHEIRO',
    '72000000-0000-4000-8000-000000000005'::uuid,
    null
  )$$,
  '22023',
  'Use a comanda normal para Bauru sintético porque o item precisa de preparo.',
  'lanches também precisam passar pela comanda normal'
);

select throws_ok(
  $$select public.bar_complete_counter_sale(
    '[{"product_id":"71000000-0000-4000-8000-000000000005","quantity":1}]'::jsonb,
    'DINHEIRO',
    '72000000-0000-4000-8000-000000000006'::uuid,
    null
  )$$,
  '22023',
  'Use a comanda normal para Mini pizza sintética porque o item precisa de preparo.',
  'mini pizza não pode contornar a cozinha pelo nome'
);

select is(
  (select count(*)::integer from public.bar_orders where counter_request_id in (
    '72000000-0000-4000-8000-000000000003'::uuid,
    '72000000-0000-4000-8000-000000000004'::uuid,
    '72000000-0000-4000-8000-000000000005'::uuid,
    '72000000-0000-4000-8000-000000000006'::uuid
  )),
  0,
  'falhas não deixam pedidos parciais'
);

insert into public.bar_orders (
  id, customer_name, source, status, payment_status
) values (
  '73000000-0000-4000-8000-000000000001'::uuid,
  'Comanda sintética', 'EQUIPE', 'ABERTA', 'ABERTO'
);

insert into public.bar_order_items (
  id, order_id, product_id, product_name, quantity, unit_price, cost_price, source, status
) values (
  '73000000-0000-4000-8000-000000000002'::uuid,
  '73000000-0000-4000-8000-000000000001'::uuid,
  '71000000-0000-4000-8000-000000000002'::uuid,
  'Item comum sintético', 1, 4.00, 1.00, 'EQUIPE', 'SOLICITADO'
);

select set_config('ilha.bar_counter_request_id', '', true);

select throws_ok(
  $$update public.bar_order_items
       set order_id = '73000000-0000-4000-8000-000000000001'::uuid
     where order_id = (
       select id from public.bar_orders
        where counter_request_id = '72000000-0000-4000-8000-000000000001'::uuid
     )$$,
  '42501',
  'O histórico da venda de balcão não pode ser alterado diretamente.',
  'item não pode ser retirado do ledger do balcão'
);

select throws_ok(
  $$update public.bar_financial_entries
       set order_id = '73000000-0000-4000-8000-000000000001'::uuid
     where order_id = (
       select id from public.bar_orders
        where counter_request_id = '72000000-0000-4000-8000-000000000001'::uuid
     )$$,
  '42501',
  'O histórico da venda de balcão não pode ser alterado diretamente.',
  'recebimento não pode ser retirado do ledger do balcão'
);

select throws_ok(
  $$update public.bar_inventory_movements
       set order_item_id = '73000000-0000-4000-8000-000000000002'::uuid
     where order_item_id in (
       select item.id
         from public.bar_order_items as item
        where item.order_id = (
          select id from public.bar_orders
           where counter_request_id = '72000000-0000-4000-8000-000000000001'::uuid
        )
     )$$,
  '42501',
  'O histórico da venda de balcão não pode ser alterado diretamente.',
  'movimento não pode ser retirado do ledger do balcão'
);

select throws_ok(
  $$delete from public.bar_orders where counter_request_id = '72000000-0000-4000-8000-000000000001'::uuid$$,
  '42501',
  'Vendas de balcão só podem ser alteradas pelo fluxo de venda rápida.',
  'o histórico da venda não pode ser apagado diretamente'
);

select ok(
  not has_function_privilege('anon', 'public.bar_complete_counter_sale(jsonb,text,uuid,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.bar_complete_counter_sale(jsonb,text,uuid,text)', 'EXECUTE'),
  'somente usuário autenticado alcança a RPC'
);

select ok(
  not has_function_privilege('anon', 'public.guard_bar_counter_order_integrity()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_bar_counter_order_integrity()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.guard_bar_counter_detail_integrity()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_bar_counter_detail_integrity()', 'EXECUTE'),
  'funções de trigger não são executáveis pelos papéis da API'
);

select * from finish();

rollback;
