import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../adm/index.html', import.meta.url), 'utf8');
function source(name) {
  const start = html.indexOf('    function ' + name + '(');
  assert.ok(start >= 0, name);
  return html.slice(start, html.indexOf('\n    }', start) + 6);
}
function setup() {
  const entries = [
    { id: 'credit', orderId: 'split', type: 'RECEITA', status: 'RECEBIDO', paymentMethod: 'CARTAO_CREDITO', amount: 60 },
    { id: 'debit', orderId: 'split', type: 'RECEITA', status: 'RECEBIDO', paymentMethod: 'CARTAO_DEBITO', amount: 40 },
    { id: 'cancel', type: 'RECEITA', status: 'CANCELADO', paymentMethod: 'CARTAO_CREDITO', amount: 200 },
    { id: 'pending', type: 'RECEITA', status: 'ABERTO', paymentMethod: 'CARTAO_CREDITO', amount: 30 },
    { id: 'expense', type: 'DESPESA', status: 'PAGO', paymentMethod: 'CARTAO_DEBITO', amount: 5 },
    { id: 'legacy', type: 'RECEITA', status: 'RECEBIDO', paymentMethod: 'CARTAO', amount: 20 },
    { id: 'unknown', type: 'RECEITA', status: 'RECEBIDO', paymentMethod: '', amount: 10 }
  ];
  const context = { opsState: { barFinanceFilter: 'todos', barFinancePaymentFilter: 'TODOS' },
    opsData: { barFinance: entries }, barFinancePeriodEntries: () => entries, barOrderTotal: () => 100 };
  vm.createContext(context);
  for (const name of ['barFinanceIsSettled', 'barFinanceIsConfirmed', 'barDayClosingMethodMatches', 'barFinanceFilteredEntries', 'barFinanceSettlementMethods', 'barReceivedPaymentsForOrder', 'barDayClosingPaymentsForOrder', 'barDayClosingAmountForOrder']) {
    vm.runInContext(source(name), context);
  }
  return context;
}
test('separa crédito, débito, cartão legado e forma vazia sem inferir subtipo', () => {
  const c = setup(), matches = c.barDayClosingMethodMatches;
  for (const method of ['CARTAO_CREDITO', 'CARTAO_DEBITO', 'CARTAO']) {
    assert.equal(matches(method, method), true);
    for (const other of ['CARTAO_CREDITO', 'CARTAO_DEBITO', 'CARTAO'].filter(m => m !== method)) assert.equal(matches(method, other), false);
    assert.equal(matches(method, 'OUTROS'), false);
  }
  assert.equal(matches('CARTÃO', 'CARTAO'), true);
  assert.equal(matches('CARTAO_OUTRO', 'CARTAO'), true);
  assert.equal(matches('', 'SEM_FORMA'), true);
  assert.equal(matches(null, 'SEM_FORMA'), true);
  assert.equal(matches('BOLETO', 'OUTROS'), true);
});
test('combina forma e situação; recebidos não inclui cancelados, abertos nem despesas', () => {
  const c = setup();
  c.opsState.barFinancePaymentFilter = 'CARTAO_CREDITO';
  assert.deepEqual(Array.from(c.barFinanceFilteredEntries(), i => i.id), ['credit', 'cancel', 'pending']);
  c.opsState.barFinanceFilter = 'recebidos';
  assert.deepEqual(Array.from(c.barFinanceFilteredEntries(), i => i.id), ['credit']);
  c.opsState.barFinancePaymentFilter = 'CARTAO_DEBITO';
  assert.deepEqual(Array.from(c.barFinanceFilteredEntries(), i => i.id), ['debit']);
  c.opsState.barFinanceFilter = 'despesas';
  assert.deepEqual(Array.from(c.barFinanceFilteredEntries(), i => i.id), ['expense']);
  c.opsState.barFinancePaymentFilter = 'CARTAO_CREDITO';
  c.opsState.barFinanceFilter = 'pendentes';
  assert.deepEqual(Array.from(c.barFinanceFilteredEntries(), i => i.id), ['pending']);
  c.opsState.barFinanceFilter = 'cancelados';
  assert.deepEqual(Array.from(c.barFinanceFilteredEntries(), i => i.id), ['cancel']);
});
test('pagamento dividido soma só a parcela da forma selecionada', () => {
  const c = setup(), order = { id: 'split', source: 'COMANDA', paymentMethod: 'DIVIDIDO' };
  assert.equal(c.barDayClosingAmountForOrder(order, 'CARTAO_CREDITO'), 60);
  assert.equal(c.barDayClosingAmountForOrder(order, 'CARTAO_DEBITO'), 40);
  assert.equal(c.barDayClosingAmountForOrder(order, 'TODOS'), 100);
});
test('CSV usa os mesmos filtros e não atribui produtos inteiros a uma parcela de pagamento', () => {
  const body = source('exportBarFinanceReport');
  assert.match(body, /barFinanceFilteredEntries\(\)/);
  assert.match(body, /includeProducts = opsState\.barFinanceFilter === 'todos' && opsState\.barFinancePaymentFilter === 'TODOS'/);
  assert.match(source('barCounterHistoryOrders'), /barDayClosingMethodMatches\(order\.paymentMethod, opsState\.barCounterHistoryPayment\)/);
});
test('novas baixas exigem forma conhecida; cartão genérico não é uma opção nova', () => {
  const c = setup();
  assert.equal(c.barFinanceSettlementMethods().includes('CARTAO'), false);
  assert.equal(c.barFinanceSettlementMethods().includes(''), false);
  assert.equal(c.barFinanceSettlementMethods().includes('CARTAO_CREDITO'), true);
  assert.equal(c.barFinanceSettlementMethods().includes('CARTAO_DEBITO'), true);
  const start = html.indexOf('    async function settleBarFinanceAction(');
  const body = html.slice(start, html.indexOf('\n    }', start) + 6);
  assert.match(body, /barFinanceSettlementMethods\(\)\.includes\(paymentMethod\)/);
  assert.match(body, /payment_method: paymentMethod/);
  assert.match(body, /status=eq\./);
  assert.match(body, /if \(!row \|\| !row.id\) throw/);
});
