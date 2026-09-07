import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const readProjectFile = (file) => readFile(path.join(projectRoot, file), 'utf8');

const [registerSource, adminSource, publicPageSource, spatialPageSource, adminPageSource, migrationSource] = await Promise.all([
  readProjectFile('supabase/functions/tournament-register/index.ts'),
  readProjectFile('supabase/functions/tournament-admin-api/index.ts'),
  readProjectFile('torneios/index.html'),
  readProjectFile('inscricoes/espacial/index.html'),
  readProjectFile('adm/index.html'),
  readProjectFile('supabase/migrations/20260907011704_release_expired_tournament_athlete_cpf.sql'),
]);

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `trecho inicial ausente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `trecho final ausente: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('retry por CPF recupera somente órfão confirmado por claim atômico', () => {
  const identityFlow = sourceSection(registerSource, 'failureStage = "athlete_upsert";', 'failureStage = "payment_claim";');
  assert.match(identityFlow, /sourceAthleteResult[\s\S]*\.eq\("source_key", sourceKey\)/);
  assert.match(identityFlow, /cpfAthleteResult[\s\S]*\.eq\("cpf", submittedCpf\)/);
  assert.match(identityFlow, /sourceAthlete\.id !== cpfAthlete\.id[\s\S]*}, 409\)/);
  assert.match(identityFlow, /resolvedByCpfOnly[\s\S]*!registration[\s\S]*athleteHasAnyRegistration[\s\S]*}, 409\)/);
  assert.match(identityFlow, /rpc\("claim_incomplete_tournament_athlete"/);
  assert.match(identityFlow, /Array\.isArray\(claimed\.data\) \? claimed\.data\[0\] : claimed\.data/);
  for (const parameter of [
    'p_athlete_id', 'p_cpf', 'p_new_source_key', 'p_full_name',
    'p_email', 'p_phone', 'p_gender', 'p_city',
  ]) assert.match(identityFlow, new RegExp(`${parameter}:`));
  assert.match(identityFlow, /if \(!claimedAthlete\?\.id\)[\s\S]*vínculo protegido[\s\S]*}, 409\)/);

  const claimRpc = sourceSection(
    migrationSource,
    'create or replace function public.claim_incomplete_tournament_athlete(',
    'create or replace function public.delete_incomplete_tournament_athlete(',
  );
  assert.match(claimRpc, /security definer[\s\S]*set search_path = ''/);
  assert.match(claimRpc, /auth\.jwt\(\) ->> 'role'[\s\S]*<> 'service_role'/);
  assert.match(claimRpc, /where athlete\.id = p_athlete_id[\s\S]*for update/);
  assert.match(claimRpc, /source_key ~ '\^public:\[0-9a-f\]\{64\}\$'/);
  assert.doesNotMatch(claimRpc, /athlete_row\.source_key[\s\S]{0,160}tournament-family/);
  assert.match(claimRpc, /auth_user_id is not null[\s\S]*app_client_id is not null[\s\S]*created_by is not null/);
  for (const relation of [
    'tournament_registrations', 'tournament_registration_orders',
    'tournament_matches', 'tournament_live_state',
  ]) assert.match(claimRpc, new RegExp(`public\\.${relation}`));
  assert.match(claimRpc, /revoke all on function public\.claim_incomplete_tournament_athlete\([\s\S]*from public, anon, authenticated/);
  assert.match(claimRpc, /grant execute on function public\.claim_incomplete_tournament_athlete\([\s\S]*to service_role/);
});

test('expiração libera somente atletas públicos/família sem qualquer vínculo', () => {
  assert.equal((migrationSource.match(/create or replace function public\.archive_expired_tournament_payment\(/g) || []).length, 2);
  const helper = sourceSection(
    migrationSource,
    'create or replace function private.delete_orphaned_public_tournament_athletes(',
    'create or replace function public.archive_expired_tournament_payment(',
  );
  assert.match(helper, /source_key ~ '\^public:\[0-9a-f\]\{64\}\$'/);
  assert.match(helper, /source_key ~ '\^tournament-family:\[0-9a-f\]\{64\}\$'/);
  assert.doesNotMatch(helper, /source_key like 'public:%'/);
  assert.match(helper, /auth_user_id is null[\s\S]*app_client_id is null[\s\S]*created_by is null/);
  for (const relation of [
    'tournament_registrations', 'tournament_registration_orders',
    'tournament_matches', 'tournament_live_state',
  ]) assert.match(helper, new RegExp(`public\\.${relation}`));
  assert.match(helper, /revoke all[\s\S]*from public, anon, authenticated, service_role/);

  assert.ok(
    (migrationSource.match(/perform private\.delete_orphaned_public_tournament_athletes\(snapshot_athlete_ids\)/g) || []).length >= 2,
    'os dois overloads de expiração precisam liberar os atletas do snapshot',
  );
  assert.match(migrationSource, /private\.tournament_expired_registration_attempts[\s\S]*jsonb_array_elements/);
  assert.doesNotMatch(migrationSource, /Luciano|10805677712|d91372cb-beb9-4332-9c6d-b98951e785b3/i);
});

test('ADM só exclui tentativa incompleta aprovada pela RPC fail-closed', () => {
  assert.match(adminSource, /"deleteIncompleteTournamentAthlete"/);
  assert.match(adminSource, /rpc\("list_incomplete_tournament_athlete_ids"/);
  assert.match(adminSource, /rpc\("delete_incomplete_tournament_athlete"/);
  assert.match(adminSource, /deletionResult\.data !== true[\s\S]*vínculo protegido/);
  assert.match(adminSource, /tentativa_incompleta: includePrivate && incomplete/);
  assert.match(adminPageSource, /data-delete-incomplete-player/);
  assert.match(adminPageSource, /action: 'deleteIncompleteTournamentAthlete'/);
  assert.match(adminPageSource, /O CPF foi liberado para uma nova inscrição/);

  const deleteRpc = sourceSection(
    migrationSource,
    'create or replace function public.delete_incomplete_tournament_athlete(',
    '-- One-time repair',
  );
  assert.match(deleteRpc, /list_incomplete_tournament_athlete_ids\(p_tournament_id\)/);
  assert.match(deleteRpc, /delete_orphaned_public_tournament_athletes\(array\[p_athlete_id\]\)/);
  assert.match(deleteRpc, /revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(deleteRpc, /grant execute[\s\S]*to service_role/);
});

test('Classe Espacial tem link recuperável, rotação e abertura independente', () => {
  assert.match(migrationSource, /add column if not exists spatial_portal_token_ciphertext text/);
  assert.match(migrationSource, /tournaments_spatial_portal_token_ciphertext_check/);
  assert.match(migrationSource, /pg_get_functiondef[\s\S]*REGISTRATION_CLOSED[\s\S]*IN_PROGRESS/);
  assert.match(migrationSource, /prosecdef[\s\S]*search_path=""[\s\S]*auth\.jwt\(\)[\s\S]*service_role/);
  assert.match(migrationSource, /is_published = true[\s\S]*spatial_addon_portal,enabled/);
  assert.match(migrationSource, /parcialmente atualizada/);
  assert.match(migrationSource, /Não foi possível desacoplar com segurança a Classe Espacial/);
  assert.match(adminSource, /AES-GCM/);
  assert.match(adminSource, /delete row\.spatial_portal_token_ciphertext/);
  assert.match(adminSource, /delete spatialPortal\.token_hash/);
  assert.match(adminSource, /#chave=\$\{encodeURIComponent\(rawToken\)\}/);
  for (const action of ['getSpatialPortalShareLink', 'rotateSpatialPortalShareLink', 'setSpatialPortalOpen']) {
    assert.match(adminSource, new RegExp(action));
    assert.match(adminPageSource, new RegExp(action));
  }
  assert.match(adminPageSource, /Inscrições abertas[\s\S]*Inscrições fechadas/);
  assert.match(adminPageSource, /Renovar o link privado[\s\S]*endereço anterior deixará de funcionar/);

  const portalGuard = sourceSection(registerSource, 'function spatialTournamentIsOpen(', 'async function consumeSpatialNetworkLimit(');
  assert.match(portalGuard, /REGISTRATION_OPEN/);
  assert.match(portalGuard, /REGISTRATION_CLOSED/);
  assert.match(portalGuard, /IN_PROGRESS/);
  assert.doesNotMatch(portalGuard, /registration_open|registration_opens_at|registration_closes_at/);
  assert.match(registerSource, /portal\.enabled !== true[\s\S]*token_hash/);
});

test('checkout tem margem de rede sem alongar chamadas comuns', () => {
  assert.match(publicPageSource, /DEFAULT_REQUEST_TIMEOUT_MS = 18000/);
  assert.match(publicPageSource, /CHECKOUT_REQUEST_TIMEOUT_MS = 90000/);
  assert.match(publicPageSource, /submitRegistrationPayload[\s\S]*CHECKOUT_REQUEST_TIMEOUT_MS/);
  assert.match(publicPageSource, /retry_payment[\s\S]*CHECKOUT_REQUEST_TIMEOUT_MS/);
  assert.match(publicPageSource, /pode continuar sendo processada[\s\S]*mesmos dados/);

  assert.match(spatialPageSource, /DEFAULT_REQUEST_TIMEOUT_MS = 18000/);
  assert.match(spatialPageSource, /CHECKOUT_REQUEST_TIMEOUT_MS = 90000/);
  assert.match(spatialPageSource, /spatial_checkout[\s\S]*CHECKOUT_REQUEST_TIMEOUT_MS/);
  assert.match(spatialPageSource, /retry_payment[\s\S]*CHECKOUT_REQUEST_TIMEOUT_MS/);
  assert.match(spatialPageSource, /pode continuar sendo processada[\s\S]*mesmos dados/);
});
