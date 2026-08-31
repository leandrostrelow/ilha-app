import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { projectRoot } from '../scripts/project-files.mjs';

const repairMigration = await readFile(
  path.join(
    projectRoot,
    'supabase',
    'migrations',
    '20260828153000_repair_client_broadcast_execution.sql'
  ),
  'utf8'
);
const stagingE2e = await readFile(path.join(projectRoot, 'scripts', 'e2e', 'staging.mjs'), 'utf8');

test('reparo encapsula o fanout sem reabrir dados de clientes', () => {
  assert.match(repairMigration, /alter function public\.enqueue_app_client_broadcast[\s\S]*security definer/i);
  assert.match(repairMigration, /set search_path = ''/i);
  assert.match(repairMigration, /owner to postgres/i);
  assert.match(repairMigration, /revoke all[\s\S]*from public, anon, authenticated/i);
  assert.match(repairMigration, /grant execute[\s\S]*to service_role/i);
  assert.doesNotMatch(repairMigration, /grant\s+select[\s\S]*app_clients/i);
});

test('E2E espera o contrato assíncrono atual e exige dispatcher iniciado', () => {
  assert.match(stagingE2e, /payload\?\.queued/);
  assert.match(stagingE2e, /payload\?\.recipients/);
  assert.match(stagingE2e, /payload\?\.delivery !== 'queued'/);
  assert.match(stagingE2e, /payload\?\.processing_requested !== true/);
  assert.doesNotMatch(stagingE2e, /payload\?\.sent \|\| 0/);
});
