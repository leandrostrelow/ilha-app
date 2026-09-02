import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareSupabaseCiProject } from '../scripts/prepare-supabase-ci.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const migrationName = '20260901205554_restrict_client_execution_of_trigger_helpers.sql';
const sqlTestName = 'security_definer_privileges.test.sql';
const migration = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', migrationName),
  'utf8'
);
const sqlContract = await readFile(
  path.join(projectRoot, 'test', 'supabase', sqlTestName),
  'utf8'
);

test('migration revoga somente execuções internas comprovadamente desnecessárias', () => {
  assert.match(migration, /procedure\.prorettype = 'pg_catalog\.trigger'::regtype/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(
    migration,
    /to_regprocedure\('public\.bar_add_order_item\(uuid,uuid,numeric,text\)'\)/
  );
  assert.match(migration, /revoke execute on function %s from public, anon/);

  for (const intentionalRpc of [
    'bar_public_menu',
    'bar_public_submit_order',
    'bar_public_claim_access',
    'bar_public_submit_card_order',
    'bar_public_card_order_status',
    'bar_public_card_request_service',
    'bar_public_order_status',
    'bar_public_request_service',
    'tournament_public_snapshot',
    'tournament_public_registration_status'
  ]) {
    assert.doesNotMatch(migration, new RegExp(`public\\.${intentionalRpc}\\(`));
  }
});

test('contrato SQL cobre menor privilégio e preserva as RPCs públicas intencionais', () => {
  assert.match(sqlContract, /select plan\(5\)/);
  assert.match(sqlContract, /procedure\.prorettype = 'pg_catalog\.trigger'::regtype/);
  assert.match(sqlContract, /public\.bar_add_order_item\(uuid,uuid,numeric,text\)/);
  assert.match(sqlContract, /public\.bar_add_order_item\(uuid,uuid,numeric,text,text\)/);
  assert.match(sqlContract, /public\.bar_public_menu\(text\)/);
  assert.match(sqlContract, /public\.tournament_public_snapshot\(text\)/);
  assert.match(sqlContract, /private\.get_my_family_summary_impl\(uuid\)/);
});

test('preparador da CI inclui o contrato SQL separado', async (context) => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'ilha-function-privileges-'));
  context.after(() => rm(target, { recursive: true, force: true }));

  const result = await prepareSupabaseCiProject(target);
  assert.ok(result.migrations.includes(migrationName));
  assert.ok(result.tests.includes(sqlTestName));
  assert.equal(
    await readFile(path.join(target, 'supabase', 'tests', sqlTestName), 'utf8'),
    sqlContract
  );
});
