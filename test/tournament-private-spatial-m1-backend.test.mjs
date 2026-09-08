import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const readProjectFile = (file) => readFile(path.join(projectRoot, file), 'utf8');

const [migrationSource, registerSource] = await Promise.all([
  readProjectFile('supabase/migrations/20260908131406_allow_m1_private_spatial_a.sql'),
  readProjectFile('supabase/functions/tournament-register/index.ts'),
]);

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `trecho inicial ausente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `trecho final ausente: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('M1 é elegível para ESP-A-M somente na configuração do portal privado', () => {
  const settingsUpdate = sourceSection(
    migrationSource,
    'update public.tournaments as tournament',
    '-- Upgrade only the reviewed private claim RPC.',
  );
  assert.match(settingsUpdate, /spatial_addon_portal,eligibility_overrides/);
  assert.match(settingsUpdate, /'M1'[\s\S]*'category_code', 'ESP-A-M'[\s\S]*'fee', 80/);
  assert.doesNotMatch(settingsUpdate, /'spatial_addons'[\s\S]{0,180}'M1'/);
  assert.match(migrationSource, /settings #> '\{spatial_addons,M1\}' is not null/);
  assert.match(migrationSource, /public_snapshot[\s\S]*spatial_addon_portal/);
  assert.match(migrationSource, /lower\(wrapper_definition\) like '%spatial_addon_portal%'/);
});

test('claim e retomada privados usam regra pública primeiro e override apenas como fallback', () => {
  assert.equal(
    (migrationSource.match(/tournament_row\.settings -> ''spatial_addons'' -> primary_category\.code,[\s\S]{0,180}spatial_addon_portal,eligibility_overrides/g) || []).length,
    2,
  );
  assert.match(migrationSource, /claim_private_tournament_spatial_addon_checkout\(uuid,uuid,uuid,uuid,text,text\)/);
  assert.match(migrationSource, /resume_private_tournament_spatial_addon_checkout\(uuid,uuid,uuid,uuid,text\)/);
  assert.ok(
    (migrationSource.match(/auth\.jwt\(\) ->> ''role''%service_role/g) || []).length >= 2,
    'os patches precisam falhar se as RPCs deixarem de exigir service_role',
  );
  assert.ok(
    (migrationSource.match(/search_path=""/g) || []).length >= 3,
    'RPCs e snapshot precisam continuar com search_path vazio',
  );
});

test('segundo guard aceita o override apenas com capability transacional e reserva standalone de R$ 80', () => {
  const guard = sourceSection(
    migrationSource,
    'create or replace function public.enforce_public_tournament_registration_limits()',
    '-- Fail closed if the new rule leaked',
  );
  assert.match(migrationSource, /set_config\([\s\S]*app\.private_spatial_addon_claim/);
  assert.match(guard, /current_setting\('app\.private_spatial_addon_claim', true\)/);
  assert.match(guard, /new\.tournament_id::text[\s\S]*new\.athlete_id::text[\s\S]*new\.category_id::text/);
  assert.match(guard, /new\.status = 'PENDING'[\s\S]*new\.payment_status = 'PENDING'/);
  assert.match(guard, /new\.request_token is not null/);
  assert.match(guard, /new\.parent_registration_id is null/);
  assert.match(guard, /new\.registration_group_id is null/);
  assert.match(guard, /new\.registration_order_id is null/);
  assert.match(guard, /new\.total_amount = 80/);
  assert.match(guard, /primary_registration\.status = 'CONFIRMED'/);
  assert.match(guard, /primary_registration\.payment_status in \('PAID', 'NOT_REQUIRED'\)/);
  assert.match(guard, /private_override_allowed and not exists/);
  assert.match(guard, /security definer[\s\S]*set search_path = ''/);
  assert.match(migrationSource, /revoke all on function public\.enforce_public_tournament_registration_limits\(\)[\s\S]*service_role/);
});

test('Edge usa a união privada só no lookup e na retomada; inscrição pública permanece isolada', () => {
  const privateMap = sourceSection(
    registerSource,
    'function privateSpatialAddonMap(',
    '\n\nasync function spatialPortalAuthorized(',
  );
  assert.match(privateMap, /portal\.eligibility_overrides/);
  assert.match(privateMap, /settings\.spatial_addons/);
  assert.ok(
    privateMap.indexOf('portal.eligibility_overrides') < privateMap.indexOf('settings.spatial_addons'),
    'a regra pública deve vencer uma chave privada conflitante',
  );

  const retry = sourceSection(
    registerSource,
    'async function resumeTrackedSpatialAddon(',
    '\n\nasync function handleIndividualPaymentRetry(',
  );
  const candidates = sourceSection(
    registerSource,
    'async function loadSpatialAddonCandidates(',
    '\n\nasync function handleSpatialLookup(',
  );
  assert.match(retry, /privateSpatialAddonMap\(checkout\.tournament\)/);
  assert.match(candidates, /privateSpatialAddonMap\(tournament\)/);

  const publicFamily = sourceSection(
    registerSource,
    'failureStage = "family_category_lookup";',
    'failureStage = "family_registration_claim";',
  );
  assert.match(publicFamily, /tournamentSettings\.spatial_addons/);
  assert.doesNotMatch(publicFamily, /privateSpatialAddonMap|eligibility_overrides/);
});
