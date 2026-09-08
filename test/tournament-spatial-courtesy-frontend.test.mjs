import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const readProjectFile = (file) => readFile(path.join(projectRoot, file), 'utf8');

const [adminSource, spatialSource, publicSource, vercelSource, serverSource, workerSource, adminApiSource] = await Promise.all([
  readProjectFile('adm/index.html'),
  readProjectFile('inscricoes/espacial/index.html'),
  readProjectFile('torneios/index.html'),
  readProjectFile('vercel.json'),
  readProjectFile('scripts/serve.mjs'),
  readProjectFile('service-worker.js'),
  readProjectFile('supabase/functions/tournament-admin-api/index.ts'),
]);

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `trecho inicial ausente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `trecho final ausente: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('ADM mantém gerador de convite isento espacial separado do portal pago', () => {
  const links = sourceSection(adminSource, '<section class="section" id="links">', '<section class="section" id="invitations">');
  assert.match(links, /Adicionar Classe Espacial/);
  assert.match(links, /Gerar convite isento — Classe Espacial/);
  for (const id of [
    'spatialCourtesyInviteRegistration',
    'spatialCourtesyInviteEligibilityHint',
    'spatialCourtesyInviteLinkText',
    'spatialCourtesyInviteGenerateBtn',
    'spatialCourtesyInviteCopyBtn',
    'spatialCourtesyInviteWhatsappBtn',
  ]) assert.match(links, new RegExp(`id="${id}"`));
  assert.doesNotMatch(
    sourceSection(links, 'Gerar convite isento — Classe Espacial', '<article class="tournament-link-card">'),
    /arte|imagem|download|Abrir convites|Renovar link/i,
  );
});

test('ADM gera um convite novo de uso único antes de copiar ou compartilhar', () => {
  assert.match(adminSource, /action: 'createSpatialCourtesyInvite'/);
  assert.match(adminSource, /primary_registration_id: primaryRegistrationId/);
  assert.match(adminSource, /\/espacial-convite#chave=/);
  assert.match(adminSource, /copySpatialCourtesyInvite/);
  assert.match(adminSource, /shareSpatialCourtesyInviteWhatsapp/);
  assert.match(adminSource, /currentUrl \? 'Gerar outro' : 'Gerar convite'/);
  const generation = sourceSection(
    adminSource,
    'async function generateSpatialCourtesyInvite()',
    '\n    function currentSpatialCourtesyInviteUrl()',
  );
  assert.match(generation, /Gerar um novo convite\? Se já houver um link ativo para esta pessoa, ele deixará de funcionar/);
  assert.doesNotMatch(generation, /currentSpatialCourtesyInviteUrl\(\)\s*&&/);
  assert.match(adminSource, /copy\.disabled = !currentUrl/);
  assert.match(adminSource, /whatsapp\.disabled = !currentUrl/);
  assert.match(adminSource, /https:\/\/wa\.me\/\?text=/);
  assert.match(adminSource, /Nenhuma cobrança será gerada/);
  assert.match(adminSource, /Este convite é de uso único/);
  assert.doesNotMatch(adminSource, /getSpatialCourtesyPortalShareLink|rotateSpatialCourtesyPortalShareLink|setSpatialCourtesyPortalOpen/);
});

test('seletor limita o convite a uma inscrição principal confirmada, elegível e com vaga', () => {
  const eligibility = sourceSection(
    adminSource,
    'function spatialCourtesyAddonRules()',
    '\n    function renderSpatialCourtesyInviteOptions()',
  );
  assert.match(eligibility, /status !== 'CONFIRMED'/);
  assert.match(eligibility, /'PAGO', 'PAID', 'ISENTO', 'NOT_REQUIRED'/);
  assert.match(eligibility, /athlete\.active !== true/);
  assert.match(eligibility, /athlete\.database_status/);
  assert.match(eligibility, /eligibility_overrides/);
  assert.match(eligibility, /spatial_addons/);
  assert.match(eligibility, /alreadyRegistered/);
  assert.match(eligibility, /occupiedByCategory/);
  assert.match(eligibility, /maxEntries/);
  assert.match(adminSource, /candidate\.athleteName \+ ' · ' \+ candidate\.currentClass \+ ' → ' \+ candidate\.spatialClass/);
  assert.match(adminSource, /state\.spatialCourtesyInvitePrimaryRegistrationId === registrationId/);
  const courtesyControls = sourceSection(
    adminSource,
    'function renderSpatialCourtesyInviteControls()',
    '\n    async function createSpatialCourtesyInvite()',
  );
  assert.doesNotMatch(courtesyControls, /spatialPortalOpen|portalOpen|card acima|portal pago/);
  const duplicateGuard = sourceSection(
    eligibility,
    'const alreadyRegistered = registrations.some',
    '\n        if (alreadyRegistered)',
  );
  assert.doesNotMatch(duplicateGuard, /CANCELLED|CANCELADO|REFUNDED|ESTORNADO/);
  const athleteSnapshot = sourceSection(
    adminApiSource,
    'function mapAthlete(',
    '\n\nfunction mapRegistration(',
  );
  assert.match(athleteSnapshot, /database_status: text\(row\.status, 30\)\.toUpperCase\(\) \|\| "ACTIVE"/);
  assert.match(athleteSnapshot, /active: row\.active !== false/);
});

test('portal privado alterna entre pagamento e convite isento sem misturar contratos', () => {
  assert.match(spatialSource, /routePortalKind\(\) === 'espacial-convite'/);
  assert.match(spatialSource, /\['espacial', 'espacial-convite'\]\.includes\(portalKind\)/);
  assert.match(spatialSource, /state\.courtesyMode \? 'spatial_courtesy_lookup' : 'spatial_lookup'/);
  assert.match(spatialSource, /state\.courtesyMode \? 'spatial_courtesy_claim' : 'spatial_checkout'/);
  assert.match(spatialSource, /terms_accepted: true/);
  assert.match(spatialSource, /candidate_proof: candidate\.proof/);
  assert.match(spatialSource, /request_token: requestToken/);
  assert.match(spatialSource, /renderCourtesySuccess\(result \|\| \{}, candidate\)/);
  assert.match(spatialSource, /Nenhum pagamento foi gerado/);
  assert.match(spatialSource, /Sem cobrança/);
  assert.match(spatialSource, /Confirmar inscrição isenta/);
  assert.match(spatialSource, /else \{[\s\S]*state\.paymentFallback[\s\S]*renderPayment\(result \|\| \{}\)/);
});

test('rota do convite isento usa a página privada e nunca cai na inscrição pública', () => {
  assert.match(
    vercelSource,
    /"source"\s*:\s*"\/inscricoes\/:slug\/espacial-convite"\s*,\s*"destination"\s*:\s*"\/inscricoes\/espacial"/,
  );
  assert.ok(
    vercelSource.indexOf('"/inscricoes/:slug/espacial-convite"') < vercelSource.indexOf('"/inscricoes/:slug"'),
    'a rota privada precisa vir antes do fallback público',
  );
  assert.match(vercelSource, /"source"\s*:\s*"\/inscricoes\/:slug\/espacial-convite"[\s\S]*?"X-Robots-Tag"[\s\S]*?"noindex, nofollow, noarchive"/);
  assert.match(serverSource, /espacial\(\?:-convite\)\?/);
  assert.match(workerSource, /espacial\(\?:-convite\)\?/);
});

test('configuração do convite isento não amplia a oferta espacial da inscrição pública', () => {
  const publicMap = sourceSection(publicSource, 'function spatialAddonMap(', '\n    function spatialAddonCodes(');
  assert.match(publicMap, /spatial_addons/);
  assert.doesNotMatch(publicMap, /spatial_courtesy_portal|spatial_addon_portal|eligibility_overrides/);
});
