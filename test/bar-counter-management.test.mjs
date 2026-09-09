import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const migrationsDirectory = path.join(projectRoot, 'supabase', 'migrations');
const migrationNames = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith('.sql'))
  .sort();
const [adminSource, migrationSources] = await Promise.all([
  readFile(path.join(projectRoot, 'adm', 'index.html'), 'utf8'),
  Promise.all(migrationNames.map(async (name) => ({
    name,
    source: await readFile(path.join(migrationsDirectory, name), 'utf8'),
  }))),
]);
const migrationsSource = migrationSources
  .map(({ name, source }) => `\n-- ${name}\n${source}`)
  .join('\n');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `função ausente: ${name}`);
  const next = source.indexOf('\n    function ', start + 1);
  return source.slice(start, next >= 0 ? next : undefined);
}

function latestSqlFunctionSource(name) {
  const marker = `create or replace function public.${name}`;
  const start = migrationsSource.toLowerCase().lastIndexOf(marker.toLowerCase());
  assert.ok(start >= 0, `RPC ausente: ${name}`);
  const end = migrationsSource.indexOf('\n$$;', start + marker.length);
  assert.ok(end >= 0, `fim da RPC ausente: ${name}`);
  return migrationsSource.slice(start, end + 4);
}

function numericPriorityFor(prioritySource, categoryFragment) {
  const line = prioritySource.split('\n').find((candidate) => candidate.includes(categoryFragment));
  assert.ok(line, `prioridade ausente para categoria: ${categoryFragment}`);
  const match = line.match(/return\s+(\d+)/);
  assert.ok(match, `prioridade numérica ausente para categoria: ${categoryFragment}`);
  return Number(match[1]);
}

test('histórico do balcão permanece acessível e expõe edição e cancelamento', () => {
  assert.match(adminSource, /id="barCounterHistoryBtn"/);
  assert.match(adminSource, /id="barCounterHistoryModal"[^>]*aria-hidden="true"/);
  assert.match(adminSource, /id="barCounterHistoryList"/);
  assert.match(adminSource, /data-bar-counter-history-open/);
  assert.match(adminSource, /data-bar-counter-sale-edit/);
  assert.match(adminSource, /data-bar-counter-sale-cancel/);
  assert.match(adminSource, /id="barCounterCancelReason"/);
  assert.match(adminSource, /id="barCounterCancelConfirm"/);
  assert.match(adminSource, /barCounterOrderItemSummary/);
  assert.match(adminSource, /barFinancePaymentLabel/);
  assert.match(adminSource, /barDateTimeLabel/);
  assert.match(adminSource, /source=eq\.BALCAO[^\n]*(?:CANCELADA|status=in)/);
});

test('catálogo do balcão oferece todos os produtos e ordena comidas no fim', () => {
  const render = functionSource(adminSource, 'renderBarCounterSaleModal');
  const complete = functionSource(adminSource, 'completeBarCounterSaleAction');
  const priority = functionSource(adminSource, 'barProductCategoryPriority');

  assert.match(render, /data-bar-counter-category="__all__"/);
  assert.match(render, /barCounterCategory[^\n]*__all__|__all__[^\n]*barCounterCategory/);
  assert.doesNotMatch(render, /!barProductRequiresProduction\(product\)/);
  assert.doesNotMatch(complete, /Use a comanda normal para itens que precisam de preparo/);
  assert.match(complete, /barProductRequiresProduction\(entry\.product\) \? 'SOLICITADO' : 'ENTREGUE'/);

  const immediatePriorities = ['cervej', 'refriger', 'bebid', 'agua']
    .map((fragment) => numericPriorityFor(priority, fragment));
  const foodPriorities = ['refeic', 'porc', 'lanche']
    .map((fragment) => numericPriorityFor(priority, fragment));
  assert.ok(
    Math.min(...foodPriorities) > Math.max(...immediatePriorities),
    'refeições, porções e lanches devem aparecer depois das bebidas',
  );
});

test('edição reaproveita a venda existente e usa RPC atômica com concorrência otimista', () => {
  assert.match(adminSource, /barCounterEditingOrderId/);
  assert.match(adminSource, /data-bar-counter-sale-edit/);
  assert.match(adminSource, /rpc\/bar_update_counter_sale/);
  assert.match(adminSource, /p_expected_updated_at/);
  assert.match(adminSource, /p_request_id/);
  assert.match(adminSource, /barCounterEditingOrderId[^\n]*(?:order|sale)|(?:order|sale)[^\n]*barCounterEditingOrderId/i);

  const updateRpc = latestSqlFunctionSource('bar_update_counter_sale');
  assert.match(updateRpc, /p_order_id\s+uuid/i);
  assert.match(updateRpc, /p_items\s+jsonb/i);
  assert.match(updateRpc, /p_payment_method\s+text/i);
  assert.match(updateRpc, /p_expected_updated_at\s+(?:timestamp with time zone|timestamptz)/i);
  assert.match(updateRpc, /p_request_id\s+uuid/i);
  assert.match(updateRpc, /security definer\s+set search_path = ''/i);
  assert.match(updateRpc, /has_bar_permission\('bar\.orders'\)/i);
  assert.match(updateRpc, /for update/i);
  assert.match(updateRpc, /pg_advisory_xact_lock/i);
  assert.match(updateRpc, /bar_products/i);
  assert.match(updateRpc, /bar_inventory_movements/i);
  assert.match(updateRpc, /bar_financial_entries/i);
  assert.doesNotMatch(updateRpc, /delete\s+from\s+public\.bar_(?:orders|order_items|inventory_movements|financial_entries)/i);
});

test('cancelamento do balcão exige confirmação, usa RPC e preserva trilha auditável', () => {
  const cancel = functionSource(adminSource, 'cancelBarCounterSaleAction');
  assert.match(adminSource, /data-bar-counter-sale-cancel/);
  assert.match(cancel, /barCounterCancelReason/);
  assert.match(cancel, /rpc\/bar_cancel_counter_sale/);
  assert.match(cancel, /p_expected_updated_at/);
  assert.match(cancel, /p_request_id/);
  assert.match(cancel, /await loadBarData\(true\)/);

  const cancelRpc = latestSqlFunctionSource('bar_cancel_counter_sale');
  assert.match(cancelRpc, /p_order_id\s+uuid/i);
  assert.match(cancelRpc, /p_reason\s+text/i);
  assert.match(cancelRpc, /p_expected_updated_at\s+(?:timestamp with time zone|timestamptz)/i);
  assert.match(cancelRpc, /p_request_id\s+uuid/i);
  assert.match(cancelRpc, /security definer\s+set search_path = ''/i);
  assert.match(cancelRpc, /has_bar_permission\('bar\.orders'\)/i);
  assert.match(cancelRpc, /for update/i);
  assert.match(cancelRpc, /pg_advisory_xact_lock/i);
  assert.match(cancelRpc, /status\s*=\s*'CANCELADA'/i);
  assert.match(cancelRpc, /status\s*=\s*'CANCELADO'/i);
  assert.match(cancelRpc, /bar_inventory_movements/i);
  assert.match(cancelRpc, /bar_financial_entries/i);
  assert.doesNotMatch(cancelRpc, /delete\s+from/i);
});

test('itens de preparo seguem para produção e itens imediatos saem entregues', () => {
  const completeRpc = latestSqlFunctionSource('bar_complete_counter_sale');
  const kitchenQueue = functionSource(adminSource, 'barKitchenActivePortionItems');
  assert.match(completeRpc, /SOLICITADO/i);
  assert.match(completeRpc, /ENTREGUE/i);
  assert.match(completeRpc, /product_category_key|product_name_key/i);
  assert.match(completeRpc, /bar_order_items/i);
  assert.match(
    kitchenQueue,
    /BALCAO/,
    'a cozinha deve aceitar itens SOLICITADO do balcão mesmo com a venda já fechada',
  );
});

test('cozinha preserva pendências do balcão após a virada do dia e o financeiro mantém a data da venda', () => {
  const backlogLoader = functionSource(adminSource, 'fetchBarCounterKitchenBacklogOrders');
  const signature = functionSource(adminSource, 'barOperationalSignature');
  const salesGroups = functionSource(adminSource, 'barFinanceActiveSaleGroups');

  assert.match(backlogLoader, /source=eq\.BALCAO/);
  assert.match(backlogLoader, /status=in\.\(SOLICITADO,EM_PREPARO,PRONTO\)/);
  assert.match(backlogLoader, /status=eq\.FECHADA/);
  assert.match(signature, /barCounterPendingKitchenOrderIds/);
  assert.match(salesGroups, /sourceOrder\.closedAt\s*\|\|\s*sourceOrder\.openedAt/);
});
