import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const [adminSource, migrationSource] = await Promise.all([
  readFile(path.join(projectRoot, 'adm', 'index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'supabase', 'migrations', '20260909145301_bar_counter_quick_sales.sql'), 'utf8'),
]);

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `função ausente: ${name}`);
  const next = source.indexOf('\n    function ', start + 1);
  return source.slice(start, next >= 0 ? next : undefined);
}

test('ADM Bar oferece um balcão fixo, histórico diário e checkout compacto', () => {
  assert.match(adminSource, /id="barCounterPanel"/);
  assert.match(adminSource, /id="barCounterSalesCount"/);
  assert.match(adminSource, /id="barCounterSalesTotal"/);
  assert.match(adminSource, /id="barCounterHistory"/);
  assert.match(adminSource, /id="barCounterSaleModal"/);
  assert.match(adminSource, /data-bar-counter-payment="PIX"[^>]*>Pix recebido/);
  assert.match(adminSource, /data-bar-counter-payment="DINHEIRO"/);
  assert.match(adminSource, /data-bar-counter-payment="CARTAO_DEBITO"/);
  assert.match(adminSource, /data-bar-counter-payment="CARTAO_CREDITO"/);
  assert.match(adminSource, /height: calc\(100dvh - 16px\)/);
  assert.match(adminSource, /env\(safe-area-inset-bottom\)/);
});

test('venda rápida usa uma única RPC e mantém chave idempotente durante falhas', () => {
  const complete = functionSource(adminSource, 'completeBarCounterSaleAction');
  assert.match(complete, /beginBarAction\(actionKey\)/);
  assert.match(complete, /ensureBarCounterRequest\(\)/);
  assert.equal((complete.match(/rpc\/bar_complete_counter_sale/g) || []).length, 1);
  assert.match(complete, /p_request_id: requestId/);
  assert.match(complete, /await loadBarData\(true\)/);
  assert.ok(
    complete.indexOf('resetBarCounterRequest();') > complete.indexOf("await loadBarData(true)"),
    'a chave só deve ser descartada depois da confirmação e recarga',
  );
  assert.doesNotMatch(complete, /bar_add_order_items|bar_pay_order|bar_finalize_paid_order/);
  assert.match(functionSource(adminSource, 'ensureBarCounterRequest'), /sessionStorage\.getItem\(BAR_COUNTER_REQUEST_KEY\)/);
  assert.match(functionSource(adminSource, 'renderBarCounterSaleModal'), /barCounterNotes'\)\.disabled = opsState\.barCounterSaving/);
});

test('balcão evita itens de cozinha e reinicia pelo dia operacional das 06h', () => {
  assert.match(functionSource(adminSource, 'renderBarCounterSaleModal'), /!barProductRequiresProduction\(product\)/);
  assert.match(functionSource(adminSource, 'completeBarCounterSaleAction'), /Use a comanda normal para itens que precisam de preparo/);
  assert.match(functionSource(adminSource, 'barCounterTodayOrders'), /barOperationalDateString\(\)/);
  assert.match(adminSource, /O movimento reinicia automaticamente às 06h/);
  assert.equal((adminSource.match(/source=eq\.BALCAO[^\n]*closed_at=gte[^\n]*, true\)/g) || []).length, 2);
  assert.match(migrationSource, /product_category_key like '%lanche%'/);
  assert.match(migrationSource, /product_name_key like '%mini pizza%'/);
});

test('migration cria ledger atômico, autorizado e imutável para o balcão', () => {
  assert.match(migrationSource, /add column if not exists counter_request_id uuid/);
  assert.match(migrationSource, /bar_orders_counter_request_id_uidx/);
  assert.match(migrationSource, /source in \('EQUIPE', 'QR_MESA', 'QR_CARTAO', 'BALCAO'\)/);
  assert.match(migrationSource, /create or replace function public\.bar_complete_counter_sale/);
  assert.match(migrationSource, /security definer\s+set search_path = ''/);
  assert.match(migrationSource, /has_bar_permission\('bar\.orders'\)/);
  assert.match(migrationSource, /pg_advisory_xact_lock/);
  assert.match(migrationSource, /for update;/);
  assert.match(migrationSource, /insert into public\.bar_orders/);
  assert.match(migrationSource, /insert into public\.bar_order_items/);
  assert.match(migrationSource, /update public\.bar_products/);
  assert.match(migrationSource, /insert into public\.bar_inventory_movements/);
  assert.match(migrationSource, /insert into public\.bar_financial_entries/);
  assert.match(migrationSource, /'BALCAO', 'ENTREGUE'/);
  assert.match(migrationSource, /'RECEBIDO', payment_method_value/);
  assert.match(migrationSource, /revoke all on function public\.bar_complete_counter_sale[\s\S]*from public, anon/);
  assert.match(migrationSource, /grant execute on function public\.bar_complete_counter_sale[\s\S]*to authenticated/);
  assert.match(migrationSource, /guard_bar_counter_order_integrity/);
  assert.match(migrationSource, /guard_bar_counter_detail_integrity/);
  assert.match(migrationSource, /array\[old_related_order_id, new_related_order_id\]/);
});

test('a chave idempotente não pode ser reutilizada com outro carrinho', () => {
  assert.match(migrationSource, /counter_payload_hash text/);
  assert.match(migrationSource, /request_fingerprint := pg_catalog\.md5/);
  assert.match(migrationSource, /counter_payload_hash is distinct from request_fingerprint/);
  assert.match(migrationSource, /Esta tentativa já foi usada por outra venda/);
});
