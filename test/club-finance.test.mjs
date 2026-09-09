import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { projectRoot } from '../scripts/project-files.mjs';

const adminPath = path.join(projectRoot, 'adm', 'index.html');
const migrationPath = path.join(
  projectRoot,
  'supabase',
  'migrations',
  '20260909042520_professional_club_finance.sql',
);

const [adminSource, migrationSource] = await Promise.all([
  readFile(adminPath, 'utf8'),
  readFile(migrationPath, 'utf8'),
]);

const adminCssMatch = adminSource.match(/<style>([\s\S]*?)<\/style>/i);
assert.ok(adminCssMatch, 'folha de estilos inline do ADM não encontrada');
const adminCss = adminCssMatch[1];

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `função ${name} não encontrada`);
  const nextFunctionPattern = /\n\s{4}(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/g;
  nextFunctionPattern.lastIndex = start + 1;
  const next = nextFunctionPattern.exec(source);
  return source.slice(start, next ? next.index : source.length);
}

function tagWithId(source, id) {
  const pattern = new RegExp(`<[^>]+\\bid=["']${id}["'][^>]*>`, 'i');
  const match = source.match(pattern);
  assert.ok(match, `elemento #${id} não encontrado`);
  return match[0];
}

function blockBody(source, openingBraceIndex) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  let inComment = false;

  for (let index = openingBraceIndex; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (inComment) {
      if (current === '*' && next === '/') {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === quote) quote = '';
      continue;
    }
    if (current === '/' && next === '*') {
      inComment = true;
      index += 1;
      continue;
    }
    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }
    if (current === '{') depth += 1;
    if (current !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBraceIndex + 1, index);
  }
  assert.fail('bloco CSS sem fechamento');
}

function maxWidthMediaBodies(source, maximumWidth) {
  const bodies = [];
  const mediaPattern = /@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)\s*\{/g;
  let match;
  while ((match = mediaPattern.exec(source))) {
    if (Number(match[1]) <= maximumWidth) {
      bodies.push(blockBody(source, match.index + match[0].lastIndexOf('{')));
    }
  }
  return bodies.join('\n');
}

function declarationsFor(source, selectorFragment) {
  const declarations = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rulePattern.exec(source))) {
    if (match[1].includes(selectorFragment)) declarations.push(match[2]);
  }
  return declarations.join('\n');
}

function financeRpcEndpointPrefix() {
  const helper = functionSource(adminSource, 'financeRpc');
  const forwardsPath = /function\s+financeRpc\(\s*path\s*,[\s\S]*supabaseRest\(\s*path\s*,/.test(helper);
  const prefixesName = /function\s+financeRpc\(\s*name\s*,[\s\S]*supabaseRest\(\s*['"]rpc\/['"]\s*\+\s*name\s*,/.test(helper);
  assert.ok(
    forwardsPath || prefixesName,
    'financeRpc deve encaminhar um path completo ou prefixar o nome com rpc/',
  );
  return forwardsPath ? 'rpc/' : '';
}

function assertFinanceRpcCall(source, rpcName) {
  const endpoint = financeRpcEndpointPrefix() + rpcName;
  assert.match(
    source,
    new RegExp(`financeRpc\\(\\s*['"]${endpoint}['"]`),
    `ADM não chama ${rpcName} pelo helper auditado`,
  );
}

test('Financeiro profissional separa competência, mensalidades e recorrências', () => {
  assert.match(tagWithId(adminSource, 'financePeriodMonth'), /type=["']month["']/i);
  for (const id of [
    'financeReceivedMetric',
    'financePaidMetric',
    'financeBalanceMetric',
    'financeReceivableMetric',
    'financePayableMetric',
    'financeOverdueMetric',
  ]) tagWithId(adminSource, id);

  assert.match(adminSource, /data-finance-view=["']recurring["']/i);
  assert.match(adminSource, /data-finance-panel=["']recurring["']/i);
  tagWithId(adminSource, 'financeRecurringRows');
  tagWithId(adminSource, 'financeNewRecurringBtn');
  tagWithId(adminSource, 'financeGenerateRecurringBtn');
  assert.match(adminSource, /Histórico protegido/i);
  assert.match(adminSource, /lançamentos já gerados permanecem intactos/i);
});

test('formulário único diferencia lançamento avulso de recorrência mensal', () => {
  for (const id of [
    'financeFormTitle',
    'financeFormHint',
    'financeFrequency',
    'financeClassification',
    'financeDueDay',
    'financeStartMonth',
    'financeEndMonth',
    'financeSaveBtn',
    'financeCancelEditBtn',
  ]) tagWithId(adminSource, id);

  assert.match(adminSource, /<option\s+value=["']ONCE["'][^>]*>/i);
  assert.match(adminSource, /<option\s+value=["']MONTHLY["'][^>]*>/i);
  assert.match(adminSource, /<option\s+value=["']FIXO["'][^>]*>/i);
  assert.match(adminSource, /<option\s+value=["']VARIAVEL["'][^>]*>/i);
  assert.match(tagWithId(adminSource, 'financeDueDay'), /min=["']1["'][\s\S]*max=["']28["']/i);
  assert.match(tagWithId(adminSource, 'financeCancelEditBtn'), /type=["']button["'][\s\S]*hidden/i);
});

test('Asaas genérico aparece como etapa futura e não como opção acionável', () => {
  const processingOptions = adminSource.match(
    /<div class=["']finance-processing-options["']>[\s\S]*?<\/div>/i,
  )?.[0] || '';
  assert.match(processingOptions, /Manual/i);
  assert.match(processingOptions, /Asaas automático/i);
  assert.match(processingOptions, /aria-disabled=["']true["']/i);
  assert.match(processingOptions, /próxima etapa|preparad[oa]/i);
  assert.doesNotMatch(processingOptions, /<(?:input|button|option)\b[^>]*value=["']ASAAS_PREPARED["']/i);
  assert.match(migrationSource, /if normalized_processing = 'ASAAS_PREPARED'[\s\S]*permanece bloqueado[\s\S]*errcode = '55000'/i);
});

test('mapeadores preservam competência, origem e snapshot da recorrência', () => {
  const transactionMapper = functionSource(adminSource, 'mapFinanceRow');
  for (const field of [
    'recurringRuleId',
    'recurringRuleVersion',
    'competenceMonth',
    'classification',
    'processingMethod',
  ]) assert.match(transactionMapper, new RegExp(`${field}\\s*:`));

  const recurringMapper = functionSource(adminSource, 'mapFinanceRecurringRule');
  for (const field of [
    'id',
    'active',
    'pausedAt',
    'archivedAt',
    'classification',
    'processingMethod',
    'startsOn',
    'endsOn',
    'dueDay',
    'version',
  ]) assert.match(recurringMapper, new RegExp(`${field}\\s*:`));
});

test('ADM carrega regras recorrentes apenas dentro do módulo financeiro autorizado', () => {
  const loader = functionSource(adminSource, 'loadOpsData');
  assert.match(loader, /allowed\(\s*['"]finance\.read['"][\s\S]*financial_recurring_rules\?select=/i);
  assert.match(loader, /map\(mapFinanceRecurringRule\)/);
  assert.match(adminSource, /financeRecurringRules\s*:\s*\[/);
  assert.match(adminSource, /financePeriodMonth\s*:/);
});

test('lançamentos avulsos usam RPC auditada para salvar e baixar', () => {
  const rpc = functionSource(adminSource, 'financeRpc');
  const save = functionSource(adminSource, 'createFinanceAction');
  const settle = functionSource(adminSource, 'markFinancePaidAction');
  const settleCore = /setFinanceStatusAction\(/.test(settle)
    ? functionSource(adminSource, 'setFinanceStatusAction')
    : settle;
  financeRpcEndpointPrefix();
  assert.match(rpc, /method\s*:\s*['"]POST['"]/);
  assertFinanceRpcCall(save, 'admin_save_financial_transaction');
  assert.match(save, /p_transaction_id/);
  assert.match(save, /p_classification/);
  assert.doesNotMatch(save, /supabaseInsert\(\s*['"]financial_transactions['"]/);
  assertFinanceRpcCall(settleCore, 'admin_set_financial_transaction_status');
  assert.match(settleCore, /p_transaction_id/);
  assert.doesNotMatch(settleCore, /financial_transactions\?id=eq\./);
});

test('nenhum fluxo administrativo mantém escrita direta no razão protegido', () => {
  assert.doesNotMatch(
    adminSource,
    /supabase(?:Insert|InsertMany)\(\s*['"]financial_transactions['"]/,
  );
  assert.doesNotMatch(
    adminSource,
    /supabaseRest\(\s*['"]financial_transactions\?id=eq\./,
  );
});

test('salvar, pausar e materializar recorrências usam os RPCs idempotentes', () => {
  for (const rpc of [
    'admin_save_financial_recurring_rule',
    'admin_set_financial_recurring_rule_active',
    'admin_archive_financial_recurring_rule',
    'admin_generate_financial_recurring_transactions',
  ]) {
    assertFinanceRpcCall(adminSource, rpc);
    assert.match(migrationSource, new RegExp(`function public\\.${rpc}\\(`, 'i'));
  }
  assert.match(adminSource, /p_generate_current/);
  assert.match(adminSource, /p_active/);
  assert.match(adminSource, /p_month/);
  assert.doesNotMatch(
    functionSource(adminSource, 'createFinanceAction'),
    /functions\/v1\/app-monthly-billing|monthlyBillingRequest\(/,
  );
  assert.match(migrationSource, /unique index financial_transactions_recurring_competence_uidx/i);
  assert.match(migrationSource, /on conflict \(recurring_rule_id, competence_month\)[\s\S]*do nothing/i);
});

test('regras recorrentes oferecem editar, pausar e retomar preservando histórico', () => {
  const renderer = functionSource(adminSource, 'renderFinanceRecurringRules');
  assert.match(renderer, /data-finance-recurring-edit/);
  assert.match(renderer, /data-finance-recurring-active/);
  assert.match(renderer, /data-finance-recurring-archive/);
  assert.match(renderer, /Pausar/);
  assert.match(renderer, /Retomar/);
  assert.match(renderer, /próxim|competência|histórico/i);
  assert.match(adminSource, /financeCancelEditBtn[\s\S]*addEventListener/);
});

test('itens controlados pelo Asaas não recebem edição nem baixa manual', () => {
  const renderer = functionSource(adminSource, 'renderFinanceItem');
  assert.match(renderer, /appPaymentInvoiceId|processingMethod/);
  const combinedProviderGuard = /providerManaged\s*=\s*(?:Boolean\()?item\.appPaymentInvoiceId\)?\s*\|\|\s*item\.processingMethod\s*===?\s*['"]ASAAS['"]/;
  const splitProviderGuards = /providerManaged\s*=\s*Boolean\(item\.appPaymentInvoiceId\)/.test(renderer)
    && /asaasManaged\s*=\s*item\.processingMethod\s*===?\s*['"]ASAAS['"]/.test(renderer);
  assert.ok(
    combinedProviderGuard.test(renderer) || splitProviderGuards,
    'a UI precisa identificar mensalidade vinculada e processamento ASAAS',
  );
  assert.match(renderer, /Sincronizado pelo Asaas|Gerenciado pelo Asaas|Asaas[^\n]{0,40}baixa automática/i);
  const canEdit = renderer.match(/canEdit\s*=\s*([^;]+);/)?.[1] || '';
  const canSettle = renderer.match(/canSettle\s*=\s*([^;]+);/)?.[1] || '';
  for (const expression of [canEdit, canSettle]) {
    assert.match(expression, /!providerManaged/);
    if (splitProviderGuards) assert.match(expression, /!asaasManaged/);
  }
  assert.match(migrationSource, /app_payment_invoice_id is not null or old_row\.processing_method = 'ASAAS'[\s\S]*errcode = '42501'/i);
});

test('filtros de mensalidades são rotulados, persistem no estado e afetam a lista', () => {
  for (const id of [
    'monthlyBillingSearch',
    'monthlyBillingStatusFilter',
    'monthlyBillingMethodFilter',
  ]) {
    tagWithId(adminSource, id);
    assert.match(adminSource, new RegExp(`<label[^>]+for=["']${id}["']`, 'i'));
    assert.match(adminSource, new RegExp(`\\$\\('${id}'\\)\\.addEventListener`));
  }
  assert.match(adminSource, /monthlyBillingSearch\s*:/);
  assert.match(adminSource, /monthlyBillingStatusFilter\s*:/);
  assert.match(adminSource, /monthlyBillingMethodFilter\s*:/);

  const renderer = functionSource(adminSource, 'renderMonthlyBilling');
  assert.match(renderer, /monthlyBillingSearch/);
  assert.match(renderer, /monthlyBillingStatusFilter/);
  assert.match(renderer, /monthlyBillingMethodFilter/);
  assert.doesNotMatch(renderer, /['"]Cadastro ['"]\s*\+\s*candidate\.clientId/);
});

test('motivo de competência passada tem mensagem compreensível no ADM', () => {
  const labels = functionSource(adminSource, 'monthlyBillingReasonLabel');
  assert.match(labels, /DUE_DATE_IN_PAST\s*:/);
  assert.match(labels, /mês|competência|passad[oa]|retroativ/i);
});

test('mensalidades viram cartões legíveis no celular sem tabela de 760px', () => {
  const mobileCss = maxWidthMediaBodies(adminCss, 860);
  const narrowCss = maxWidthMediaBodies(adminCss, 520);
  const table = declarationsFor(adminCss, '.monthly-billing-table');
  const head = declarationsFor(mobileCss, '.monthly-billing-table-head');
  const row = declarationsFor(mobileCss, '.monthly-billing-table-row');
  const narrowRow = declarationsFor(narrowCss, '.monthly-billing-table-row');

  assert.match(table, /min-width\s*:\s*0\s*;/);
  assert.doesNotMatch(table, /min-width\s*:\s*760px/);
  assert.match(head, /display\s*:\s*none\s*;/);
  assert.match(row, /grid-template-columns\s*:\s*(?:repeat\(2\s*,\s*minmax\(0\s*,\s*1fr\)\)|1fr)\s*;/);
  assert.match(narrowRow, /grid-template-columns\s*:\s*1fr\s*;/);
  assert.match(mobileCss, /content\s*:\s*attr\(data-label\)\s*;/);

  const renderer = functionSource(adminSource, 'renderMonthlyBilling');
  for (const label of ['Pagador', 'Estado', 'Vencimento', 'Valor', 'Detalhe', 'Ações']) {
    assert.match(renderer, new RegExp(`data-label=["']${label}["']`));
  }
});

test('competência selecionada limita resumo, lista e exportação', () => {
  const renderer = functionSource(adminSource, 'renderFinanceModule');
  const exporter = functionSource(adminSource, 'exportFinanceAction');
  assert.match(renderer, /financePeriodMonth/);
  assert.match(renderer, /competenceMonth|finance.*Period/i);
  assert.match(exporter, /financePeriodMonth|finance.*Period/i);
  assert.match(adminSource, /\$\('financePeriodMonth'\)\.addEventListener\('change'/);
  assert.match(adminSource, /\$\('financeRefreshBtn'\)\.addEventListener\('click'/);
});
