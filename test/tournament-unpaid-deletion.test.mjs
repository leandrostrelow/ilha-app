import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const [adminSource, adminPageSource, migrationSource] = await Promise.all([
  readFile(path.join(projectRoot, 'supabase/functions/tournament-admin-api/index.ts'), 'utf8'),
  readFile(path.join(projectRoot, 'adm/index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'supabase/migrations/20260909190000_delete_unpaid_tournament_registration.sql'), 'utf8'),
]);

test('exclusão administrativa cancela somente cobrança Asaas ainda não paga', () => {
  assert.match(adminSource, /"deleteUnpaidTournamentRegistration"/);
  assert.match(adminSource, /LOCAL_UNPAID_PAYMENT_STATUSES/);
  assert.match(adminSource, /payment\.paid_at[\s\S]*não pode ser excluída/);
  assert.match(adminSource, /findAsaasPayment\(payment\)/);
  assert.match(adminSource, /assertMatchingAsaasPayment\(payment, remotePayment\)/);
  assert.match(adminSource, /REMOVABLE_ASAAS_PAYMENT_STATUSES\.has\(remoteStatus\)[\s\S]*method: "DELETE"/);
  assert.match(adminSource, /rpc\("delete_unpaid_tournament_registration"/);
  assert.match(adminSource, /O Asaas não permitiu cancelar esta cobrança\. Nada foi excluído do sistema/);
});

test('RPC repete as travas financeiras sob lock e mantém auditoria recuperável', () => {
  assert.match(migrationSource, /security definer[\s\S]*set search_path = ''/);
  assert.match(migrationSource, /auth\.jwt\(\) ->> 'role'[\s\S]*service_role/);
  assert.match(migrationSource, /pg_advisory_xact_lock/);
  assert.match(migrationSource, /from public\.tournament_payments[\s\S]*for update/);
  assert.match(migrationSource, /payment_row\.paid_at is not null/);
  assert.match(migrationSource, /registration\.paid_amount, 0\) <> 0/);
  assert.match(migrationSource, /registration\.confirmed_at is not null/);
  assert.match(migrationSource, /registration\.registration_order_id is not null/);
  assert.match(migrationSource, /tournament_matches/);
  assert.match(migrationSource, /tournament_live_state/);
  assert.match(migrationSource, /cleanup_reason[\s\S]*ADMIN_UNPAID_DELETE/);
  assert.match(migrationSource, /delete_orphaned_public_tournament_athletes/);
  assert.match(migrationSource, /revoke all on function public\.delete_unpaid_tournament_registration[\s\S]*from public, anon, authenticated/);
  assert.match(migrationSource, /grant execute on function public\.delete_unpaid_tournament_registration[\s\S]*to service_role/);
});

test('ADM oferece a ação apenas quando o backend classifica a cobrança como removível', () => {
  assert.match(adminSource, /remocao_permitida: !row\.paid_at && LOCAL_UNPAID_PAYMENT_STATUSES\.has\(status\)/);
  assert.match(adminPageSource, /onlinePayment\.remocao_permitida/);
  assert.match(adminPageSource, /data-delete-unpaid-registration/);
  assert.match(adminPageSource, /Excluir inscrição não paga/);
  assert.match(adminPageSource, /Inscrições pagas ou confirmadas são bloqueadas automaticamente/);
  assert.match(adminPageSource, /action: 'deleteUnpaidTournamentRegistration'/);
});

test('exclusão genérica não contorna o cancelamento seguro da cobrança', () => {
  const start = adminSource.indexOf('async function deleteRegistration(');
  const end = adminSource.indexOf('\nfunction matchPayload(', start);
  assert.ok(start >= 0 && end > start);
  const section = adminSource.slice(start, end);
  assert.match(section, /tournament_payments/);
  assert.match(section, /possui pagamento confirmado ou protegido/);
  assert.match(section, /Use “Excluir inscrição não paga”/);
});
