import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const readProjectFile = (file) => readFile(path.join(projectRoot, file), 'utf8');

const [migrationSource, usedScopeIndexMigrationSource, registerSource, adminSource] = await Promise.all([
  readProjectFile('supabase/migrations/20260908145509_add_private_spatial_courtesy_invites.sql'),
  readProjectFile('supabase/migrations/20260908150434_cover_spatial_courtesy_used_scope_fk.sql'),
  readProjectFile('supabase/functions/tournament-register/index.ts'),
  readProjectFile('supabase/functions/tournament-admin-api/index.ts'),
]);

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `trecho inicial ausente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `trecho final ausente: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('convite espacial isento é uma capability dedicada, vinculada e de uso único', () => {
  assert.match(migrationSource, /create table public\.tournament_spatial_courtesy_invites/);
  assert.match(migrationSource, /primary_registration_id uuid not null/);
  assert.match(migrationSource, /athlete_id uuid not null/);
  assert.match(migrationSource, /target_category_id uuid not null/);
  assert.match(migrationSource, /token_hash text not null unique/);
  assert.match(migrationSource, /status in \('ACTIVE', 'USED', 'REVOKED'\)/);
  assert.match(migrationSource, /used_registration_id is not null and used_at is not null/);
  assert.match(migrationSource, /foreign key \(primary_registration_id, tournament_id, athlete_id\)/);
  assert.match(migrationSource, /foreign key \(target_category_id, tournament_id\)/);
  assert.match(migrationSource, /foreign key \(used_registration_id, tournament_id, athlete_id, target_category_id\)/);
  assert.match(
    usedScopeIndexMigrationSource,
    /tournament_spatial_courtesy_invites_used_scope_idx[\s\S]*used_registration_id,[\s\S]*tournament_id,[\s\S]*athlete_id,[\s\S]*target_category_id/,
  );
  assert.match(usedScopeIndexMigrationSource, /commit;\s*$/);
  assert.match(migrationSource, /tournament_spatial_courtesy_invites_primary_scope_idx[\s\S]*primary_registration_id,[\s\S]*tournament_id,[\s\S]*athlete_id/);
  assert.match(migrationSource, /tournament_spatial_courtesy_invites_athlete_idx[\s\S]*\(athlete_id\)/);
  assert.match(migrationSource, /tournament_spatial_courtesy_invites_target_scope_idx[\s\S]*\(target_category_id, tournament_id\)/);
  assert.match(migrationSource, /tournament_spatial_courtesy_invites_created_by_idx[\s\S]*where created_by is not null/);
  assert.match(migrationSource, /tournament_id,[\s\S]*athlete_id,[\s\S]*target_category_id[\s\S]*where status = 'ACTIVE'/);
  assert.doesNotMatch(migrationSource, /alter table public\.tournaments[\s\S]*spatial_courtesy_portal_token/);
  assert.doesNotMatch(migrationSource, /settings[\s\S]{0,80}spatial_courtesy_portal/);
});

test('criação deriva a categoria no servidor, limita validade e não reserva vaga', () => {
  const createClaim = sourceSection(
    migrationSource,
    'create or replace function public.create_private_tournament_spatial_courtesy_invite(',
    'create or replace function public.lookup_private_tournament_spatial_courtesy(',
  );
  assert.match(createClaim, /security definer[\s\S]*set search_path = ''/);
  assert.match(createClaim, /auth\.jwt\(\) ->> 'role'[\s\S]*service_role/);
  assert.match(createClaim, /p_primary_registration_id[\s\S]*status = 'CONFIRMED'[\s\S]*payment_status in \('PAID', 'NOT_REQUIRED'\)/);
  assert.match(createClaim, /coalesce\([\s\S]*settings -> 'spatial_addons'[\s\S]*spatial_addon_portal,eligibility_overrides/);
  assert.match(createClaim, /category\.registration_open = true/);
  assert.doesNotMatch(createClaim, /spatial_addon_portal,enabled/);
  assert.match(createClaim, /athlete\.active = true[\s\S]*athlete\.status = 'ACTIVE'/);
  assert.match(createClaim, /tournament_row\.ends_on \+ 1/);
  assert.match(createClaim, /interval '90 days'/);
  assert.match(createClaim, /status in \('PENDING', 'CONFIRMED'\)[\s\S]*max_entries/);
  assert.match(createClaim, /set status = 'REVOKED'[\s\S]*status = 'ACTIVE'/);
  assert.match(createClaim, /registration\.category_id = target_category\.id\s*\n\s*\) then/);
  assert.match(createClaim, /insert into public\.tournament_spatial_courtesy_invites/);
  assert.doesNotMatch(createClaim, /insert into public\.tournament_registrations/);
  assert.match(createClaim, /revoke all on function[\s\S]*service_role[\s\S]*grant execute[\s\S]*service_role/);
});

test('lookup é capability-first, aceita só CPF bound e rederiva elegibilidade', () => {
  const lookup = sourceSection(
    migrationSource,
    'create or replace function public.lookup_private_tournament_spatial_courtesy(',
    'create or replace function public.claim_private_tournament_spatial_courtesy(',
  );
  assert.ok(
    lookup.indexOf('invite.token_hash = lower(p_invite_token_hash)') < lookup.indexOf('athlete_row.cpf'),
    'o token deve ser resolvido antes de consultar o CPF bound',
  );
  assert.match(lookup, /primary_registration\.registration_group_id is not null/);
  assert.match(lookup, /registration_group\.id = primary_registration\.registration_group_id/);
  assert.match(lookup, /registration_group\.payer_cpf = normalized_cpf/);
  assert.ok((lookup.match(/Este convite ou CPF não é válido\./g) || []).length >= 4);
  assert.match(lookup, /settings -> 'spatial_addons'[\s\S]*spatial_addon_portal,eligibility_overrides/);
  assert.match(lookup, /target_category\.code is distinct from addon_rule ->> 'category_code'/);
  assert.doesNotMatch(lookup, /spatial_addon_portal,enabled/);
  assert.match(lookup, /athlete\.active = true[\s\S]*athlete\.status = 'ACTIVE'/);
  assert.doesNotMatch(lookup, /lookup_private_tournament_spatial_addon_athlete_ids|\.in\("id"/);
});

test('claim consome ACTIVE para USED atomicamente e só repete o mesmo request', () => {
  const claim = sourceSection(
    migrationSource,
    'create or replace function public.claim_private_tournament_spatial_courtesy(',
    '-- Keep the public per-athlete guard',
  );
  assert.match(claim, /pg_advisory_xact_lock[\s\S]*for update/);
  assert.match(claim, /invitation\.status = 'USED'[\s\S]*registration\.request_token = p_request_token/);
  assert.match(claim, /registration\.source = 'PUBLIC'/);
  assert.match(claim, /registration\.paid_amount = 0/);
  assert.match(claim, /registration\.confirmed_at is not null/);
  assert.doesNotMatch(claim, /spatial_addon_portal,enabled/);
  assert.match(claim, /athlete\.active = true[\s\S]*athlete\.status = 'ACTIVE'/);
  assert.match(claim, /not exists \([\s\S]*public\.tournament_payments/);
  assert.match(claim, /insert into public\.tournament_registrations[\s\S]*invitation\.athlete_id/);
  assert.match(claim, /'CONFIRMED',[\s\S]*'NOT_REQUIRED',[\s\S]*0,[\s\S]*'PUBLIC'/);
  assert.match(claim, /set status = 'USED',[\s\S]*used_registration_id = spatial_registration\.id/);
  assert.equal((claim.match(/'primary_registration_id', invitation\.primary_registration_id/g) || []).length, 2);
  assert.doesNotMatch(claim, /insert into public\.tournament_payments|ASAAS|billing_type/);
});

test('segundo guard permite M1 isento somente para a forma exata da RPC', () => {
  const guard = sourceSection(
    migrationSource,
    'create or replace function public.enforce_public_tournament_registration_limits()',
    '-- Fail closed at deploy time',
  );
  assert.match(guard, /current_setting\('app\.private_spatial_courtesy_claim', true\)/);
  assert.match(guard, /new\.status = 'CONFIRMED'[\s\S]*new\.payment_status = 'NOT_REQUIRED'/);
  assert.match(guard, /new\.total_amount = 0/);
  assert.match(guard, /new\.terms_accepted_at is not null/);
  assert.match(guard, /new\.confirmed_at is not null/);
  assert.match(guard, /convite isento de uso único/);
  assert.match(guard, /private_override_allowed/);
  assert.match(migrationSource, /force row level security/);
  assert.match(migrationSource, /revoke all on table[\s\S]*public, anon, authenticated/);
  assert.match(migrationSource, /commit;\s*$/);
});

test('ADM gera token separado e Edge confirma sem tocar no checkout pago', () => {
  assert.match(adminSource, /"createSpatialCourtesyInvite"/);
  assert.match(adminSource, /ilha-tournament-spatial-courtesy-invite:/);
  assert.match(adminSource, /payload\.primary_registration_id/);
  assert.match(adminSource, /rpc\("create_private_tournament_spatial_courtesy_invite"/);
  assert.match(adminSource, /\/espacial-convite#chave=/);

  const edgeCourtesy = sourceSection(
    registerSource,
    'async function handleSpatialCourtesyLookup(',
    '\n\nDeno.serve(async (request) => {',
  );
  assert.match(registerSource, /spatial-courtesy-proof-token:/);
  assert.match(edgeCourtesy, /rpc\("lookup_private_tournament_spatial_courtesy"/);
  assert.match(edgeCourtesy, /rpc\("claim_private_tournament_spatial_courtesy"/);
  assert.match(edgeCourtesy, /amount: 0/);
  assert.match(edgeCourtesy, /courtesy: true/);
  assert.doesNotMatch(edgeCourtesy, /claim_private_tournament_spatial_addon_checkout|resume_private_tournament_spatial_addon_checkout/);
  assert.doesNotMatch(edgeCourtesy, /createOrRecoverPayment|asaasConfig\(|safePayment\(/);
  assert.match(registerSource, /action === "spatial_courtesy_lookup"/);
  assert.match(registerSource, /action === "spatial_courtesy_claim"/);
  assert.match(registerSource, /action === "spatial_checkout"/);
});
