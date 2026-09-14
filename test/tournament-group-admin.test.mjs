import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const projectRoot = path.resolve(import.meta.dirname, '..');
const adminPage = await readFile(path.join(projectRoot, 'adm/index.html'), 'utf8');

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `trecho inicial ausente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `trecho final ausente: ${end}`);
  return source.slice(startIndex, endIndex);
}

function standingsRuntime() {
  const source = [
    sourceSection(adminPage, 'function tournamentGroupMatches', '\n    function tournamentGroupFinal'),
    sourceSection(adminPage, 'function groupMatchIsFinished', '\n    function groupScoreMetrics'),
    sourceSection(adminPage, 'function groupScoreMetrics', '\n    function calculateTournamentGroupStandings'),
    sourceSection(adminPage, 'function calculateTournamentGroupStandings', '\n    function signedGroupBalance'),
    sourceSection(adminPage, 'function parseScoreDetailed', '\n    function buildScoreFromEditorFields'),
    sourceSection(adminPage, 'function scoreCellParts', '\n    function compareScoreCells'),
  ].join('\n');
  const names = { a: 'Ana', b: 'Bia', c: 'Clara' };
  const context = vm.createContext({
    Map,
    Set,
    getPlayerName(id) { return names[id] || ''; },
    scoreTokens(value) { return String(value || '').trim().split(/[\s,;]+/).filter(Boolean); },
  });
  vm.runInContext(source, context);
  return context.calculateTournamentGroupStandings;
}

function groupMatch(round, first, second, winner, score, status = 'FINALIZADO') {
  return {
    jogo_id: `g${round}`,
    fase: 'GROUP',
    rodada: round,
    posicao_chave: 1,
    jogador1_id: first,
    jogador2_id: second,
    vencedor_id: winner,
    placar: score,
    status,
  };
}

test('ADM oferece grupo de três com regras claras e mantém a geração privada', () => {
  assert.match(adminPage, /id="generateGroupBtn" onclick="generateGroup\(\)" disabled>Gerar grupo/);
  assert.match(adminPage, /Todos jogam contra todos e os 2 melhores fazem a final/);
  assert.match(adminPage, /confronto direto quando 2 empatam/);
  assert.match(adminPage, /empate triplo, saldo de sets e depois saldo de games/);
  assert.doesNotMatch(adminPage, /<option value="3">3 \(grupo \+ final\)<\/option>/);

  const generator = sourceSection(adminPage, 'async function generateGroup()', '\n    async function toggleBracketPublication');
  assert.match(generator, /confirmedCount !== 3/);
  assert.match(generator, /action: 'generateGroup'/);
  assert.match(generator, /overwrite: true/);
  assert.match(generator, /Grupo e final criados em modo privado/);
  assert.match(generator, /vai substituir todos eles/);
});

test('renderização separa grupo, classificação e final sem alterar a chave eliminatória', () => {
  const detector = sourceSection(adminPage, 'function tournamentGroupMatches', '\n    function updateBracketFormatControls');
  const renderer = sourceSection(adminPage, 'function renderBracket()', '\n    function getDrawLayout');
  assert.match(detector, /=== 'GROUP'/);
  assert.match(detector, /GROUPS_AND_KNOCKOUT/);
  assert.match(detector, /if \(rows\.length\) return false/);
  assert.match(renderer, /categoryUsesGroupFormat\(selectedTournamentCategory\(\), matches\)/);
  assert.match(renderer, /tournamentGroupBoardHtml\(matches\)/);
  assert.match(renderer, /const layout = getDrawLayout\(matches\)/);
  assert.match(adminPage, /Todos contra todos/);
  assert.match(adminPage, /Classificação/);
  assert.match(adminPage, /1º × 2º/);
  assert.match(adminPage, /GROUP: 'Fase de grupos'/);
});

test('cards do grupo e da final continuam editáveis pelo mesmo editor de jogo', () => {
  const groupCard = sourceSection(adminPage, 'function groupMatchSlotHtml', '\n    function tournamentGroupBoardHtml');
  assert.match(groupCard, /drawMatchHtml\(match, 1, 'group'\)/);
  assert.match(adminPage, /data-open-match=/);
  assert.match(adminPage, /\.group-match-slot \.draw-match/);
});

test('classificação visual ordena por vitórias e marca os dois finalistas', () => {
  const calculate = standingsRuntime();
  const standings = calculate([
    groupMatch(1, 'a', 'b', 'a', '6x2 6x2'),
    groupMatch(2, 'b', 'c', 'b', '6x4 6x4'),
    groupMatch(3, 'a', 'c', 'a', '6x1 6x1'),
  ]);

  assert.equal(standings.complete, true);
  assert.equal(standings.decisionRequired, false);
  assert.deepEqual(Array.from(standings.rows, (row) => row.id), ['a', 'b', 'c']);
  assert.deepEqual(Array.from(standings.rows, (row) => [row.played, row.wins, row.losses]), [
    [2, 2, 0],
    [2, 1, 1],
    [2, 0, 2],
  ]);
  assert.equal(standings.rows[0].setBalance, 4);
  assert.equal(standings.rows[0].gameBalance, 18);
});

test('empate entre dois usa confronto direto e empate triplo persistente pede decisão do ADM', () => {
  const calculate = standingsRuntime();
  const provisional = calculate([
    groupMatch(1, 'a', 'b', 'a', '6x3 6x3'),
    groupMatch(2, 'c', 'a', 'c', '6x4 6x4'),
    groupMatch(3, 'b', 'c', '', '', 'PENDENTE'),
  ]);
  assert.equal(provisional.complete, false);
  assert.equal(provisional.rows[0].id, 'c');
  assert.equal(provisional.rows[1].id, 'a');

  const circular = calculate([
    groupMatch(1, 'a', 'b', 'a', '6x4 4x6 ST10x8'),
    groupMatch(2, 'b', 'c', 'b', '6x4 4x6 ST10x8'),
    groupMatch(3, 'c', 'a', 'c', '6x4 4x6 ST10x8'),
  ]);
  assert.equal(circular.complete, true);
  assert.equal(circular.decisionRequired, true);
  assert.equal(circular.rows.filter((row) => row.needsDecision).length, 3);
  assert.match(adminPage, /Empate persistente: confira os números e defina os finalistas no ADM/);
});

test('empate entre 1º e 2º não pede decisão quando ambos já estão classificados', () => {
  const calculate = standingsRuntime();
  const standings = calculate([
    groupMatch(1, 'a', 'b', 'a', '6x4 6x0'),
    groupMatch(2, 'b', 'c', 'b', '6x0 6x0'),
    groupMatch(3, 'c', 'a', 'c', '6x4 6x4'),
  ]);

  assert.equal(standings.complete, true);
  assert.equal(standings.rows[0].gameBalance, 4);
  assert.equal(standings.rows[1].gameBalance, 4);
  assert.equal(standings.rows[2].gameBalance, -8);
  assert.equal(standings.decisionRequired, false);
  assert.equal(standings.rows.some((row) => row.needsDecision), false);
});

test('arte eliminatória fica protegida enquanto o formato selecionado for grupo', () => {
  const controls = sourceSection(adminPage, 'function updateBracketFormatControls', '\n    function groupMatchIsFinished');
  const download = sourceSection(adminPage, 'async function downloadInstagramImage()', '\n    async function downloadResultsImage');
  assert.match(controls, /instagramButton\.disabled = groupFormat/);
  assert.match(controls, /disponível apenas para chaves eliminatórias/);
  assert.match(download, /categoryUsesGroupFormat\(category, matches\)/);
  assert.match(download, /ainda é exclusiva das chaves eliminatórias/);
});
