import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const projectRoot = path.resolve(import.meta.dirname, '..');
const readProjectFile = (file) => readFile(path.join(projectRoot, file), 'utf8');

const [spatialPageSource, lookupMigrationSource] = await Promise.all([
  readProjectFile('inscricoes/espacial/index.html'),
  readProjectFile('supabase/migrations/20260903113000_private_spatial_cpf_lookup_rpc.sql'),
]);

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `trecho inicial ausente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `trecho final ausente: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('CPF do responsável localiza sua inscrição direta e os atletas do grupo familiar', () => {
  assert.match(lookupMigrationSource, /regexp_replace\(athlete\.cpf[\s\S]*= normalized_cpf/);
  assert.match(lookupMigrationSource, /public\.tournament_registration_groups/);
  assert.match(lookupMigrationSource, /registration_group\.payer_cpf = normalized_cpf/);
  assert.match(lookupMigrationSource, /registration\.tournament_id = registration_group\.tournament_id/);
  assert.match(lookupMigrationSource, /union/);
});

test('tela preserva responsável e dependentes indisponíveis em vez de escondê-los', () => {
  const valueFrom = sourceSection(
    spatialPageSource,
    'function valueFrom(',
    '\n      function normalizeCandidates(',
  );
  const normalization = sourceSection(
    spatialPageSource,
    'function normalizeCandidates(',
    '\n      function candidateStateLabel(',
  );
  const sandbox = {};
  vm.runInNewContext(`
    const clean = (value) => value === null || value === undefined ? '' : String(value).trim();
    const ACTIONABLE_CANDIDATE_STATES = new Set(['ELIGIBLE', 'PAYMENT_PENDING']);
    ${valueFrom}
    ${normalization}
    candidates = normalizeCandidates({ candidates: [
      {
        athlete_name: 'Responsável',
        current_class: '4ª Classe Masculina',
        spatial_class: 'Espacial A Masculino',
        amount: 80,
        state: 'FULL',
        candidate_proof: null,
      },
      {
        athlete_name: 'Dependente elegível',
        current_class: '4ª Classe Masculina',
        spatial_class: 'Espacial A Masculino',
        amount: 80,
        state: 'ELIGIBLE',
        candidate_proof: 'prova-assinada',
      },
      {
        athlete_name: 'Dependente já inscrito',
        current_class: '4ª Classe Masculina',
        spatial_class: 'Espacial A Masculino',
        amount: 80,
        state: 'ALREADY_REGISTERED',
        candidate_proof: '',
      },
    ] });
    actionable = candidates.map(candidateActionable);
  `, sandbox);

  assert.equal(sandbox.candidates.length, 3);
  assert.deepEqual(Array.from(sandbox.actionable), [false, true, false]);
});

test('somente candidatos acionáveis podem ser selecionados e os motivos ficam visíveis', () => {
  const render = sourceSection(
    spatialPageSource,
    'function renderCandidates()',
    '\n      function selectCandidate(',
  );
  assert.match(render, /input\.disabled = !candidateActionable\(candidate\)/);
  assert.match(render, /label\.classList\.toggle\('unavailable'/);
  assert.match(spatialPageSource, /FULL: 'Sem vaga'/);
  assert.match(spatialPageSource, /ALREADY_REGISTERED: 'Já inscrito'/);
  assert.match(spatialPageSource, /CLOSED: 'Inscrições fechadas'/);
  assert.match(spatialPageSource, /REVIEW_REQUIRED: 'Em revisão'/);
  assert.match(spatialPageSource, /if \(!candidateActionable\(state\.candidates\[nextIndex\]\)\) return/);
});

test('após um Pix o responsável pode repetir a consulta para outro atleta com novo captcha', () => {
  assert.match(spatialPageSource, /id="anotherAthleteButton"[\s\S]*Inscrever outro atleta vinculado/);
  assert.match(spatialPageSource, /anotherAthleteButton'\)\.addEventListener\('click', startAnotherLinkedAthlete\)/);
  const restart = sourceSection(
    spatialPageSource,
    'function startAnotherLinkedAthlete()',
    '\n      function schedulePaymentExpiry(',
  );
  assert.match(restart, /state\.cpf = ''/);
  assert.match(restart, /state\.requestTokens\.clear\(\)/);
  assert.match(restart, /state\.trackingToken = ''/);
  assert.match(restart, /resetCaptcha\('Confirme novamente/);
  assert.match(restart, /setStep\(1\)/);
  assert.match(spatialPageSource, /state\.courtesyMode \|\| state\.linkedCandidateCount < 2 \|\| !confirmed/);
});

test('convite cortesia continua individual e não é ampliado para toda a família', () => {
  const checkout = sourceSection(
    spatialPageSource,
    'async function submitCheckout(',
    '\n      function renderCourtesySuccess(',
  );
  assert.match(checkout, /if \(state\.courtesyMode\)[\s\S]*state\.portalToken = ''/);
  assert.match(checkout, /state\.linkedCandidateCount = 0/);
  assert.match(spatialPageSource, /state\.courtesyMode \? 'spatial_courtesy_lookup' : 'spatial_lookup'/);
});
