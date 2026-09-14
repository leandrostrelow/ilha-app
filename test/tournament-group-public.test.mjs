import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const projectRoot = path.resolve(import.meta.dirname, '..');
const publicPage = await readFile(path.join(projectRoot, 'torneios/index.html'), 'utf8');

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `trecho inicial ausente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `trecho final ausente: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('formato grupo e final possui renderer próprio sem alterar o mata-mata', () => {
  const categoryHelpers = sourceSection(publicPage, 'function categoryById', '\n    function categoryCapacity');
  const bracketRenderer = sourceSection(publicPage, 'function bracketBoardHtml', '\n    function groupScoreNumber');

  assert.match(categoryHelpers, /GROUPS_AND_KNOCKOUT/);
  assert.match(categoryHelpers, /return 'Grupo \+ final'/);
  assert.match(bracketRenderer, /isGroupKnockoutCategory\(category\) \|\| rows\.some\(isGroupStageMatch\)/);
  assert.match(bracketRenderer, /return groupBoardHtml\(category,rows\)/);
  assert.match(bracketRenderer, /const rounds = new Map\(\)/);
  assert.match(bracketRenderer, /bracket-upper/);
  assert.match(bracketRenderer, /bracket-final-stage/);
  assert.match(bracketRenderer, /bracket-lower/);
});

test('fase de grupos e final recebem nomes públicos claros', () => {
  const rounds = sourceSection(publicPage, 'function roundLabel', '\n    function matchId');

  assert.match(rounds, /GROUP:'Fase de grupos'/);
  assert.match(rounds, /GROUP_STAGE:'Fase de grupos'/);
  assert.match(rounds, /ROUND_ROBIN:'Fase de grupos'/);
  assert.match(rounds, /FINAL:'Final'/);
  assert.match(rounds, /function isGroupStageMatch/);
  assert.match(rounds, /function isFinalStageMatch/);
});

test('painel público apresenta jogos, tabela, regras e final oficial', () => {
  const groupRenderer = sourceSection(publicPage, 'function groupBoardHtml', '\n    function bracketStageHtml');

  assert.match(groupRenderer, /Cada atleta enfrenta todos os outros uma vez\./);
  assert.match(groupRenderer, /participantCount \+ ' atletas · ' \+ groupRows\.length/);
  assert.match(groupRenderer, /Todos contra todos: cada atleta enfrenta os outros uma vez\./);
  assert.match(groupRenderer, /Cada vitória vale 1 ponto na classificação\./);
  assert.match(groupRenderer, /Os dois melhores colocados disputam a final\./);
  assert.match(groupRenderer, /Empate entre dois: confronto direto\./);
  assert.match(groupRenderer, /Empate entre três ou mais: saldo de sets e depois saldo de games\./);
  assert.match(groupRenderer, /Persistindo, a organização define\./);
  assert.match(groupRenderer, /O super tie vale como um set e não entra no saldo de games\./);
  assert.match(groupRenderer, /groupStandingsHtml\(groupRows,finalMatch\)/);
  assert.match(groupRenderer, /rows\.filter\(isFinalStageMatch\)/);
  assert.match(groupRenderer, /matchCardHtml\(finalMatch\)/);
  assert.match(groupRenderer, /Final · 1º × 2º/);
});

test('painel público reconhece conclusão de grupos com quantidade variável', () => {
  const standingsRenderer = sourceSection(publicPage, 'function groupStandingsHtml', '\n    function groupBoardHtml');
  assert.match(standingsRenderer, /playerCount \* \(playerCount - 1\)/);
  assert.match(standingsRenderer, /groupRows\.length === expectedMatches/);
});

test('classificação considera somente o grupo e aplica saldo de sets e games no empate triplo', () => {
  const rankingSource = sourceSection(publicPage, 'function groupScoreNumber', '\n    function bracketStageHtml');
  const context = {
    clean: (value) => String(value ?? '').trim(),
    field: (row, ...names) => {
      for (const name of names) if (row?.[name] !== null && row?.[name] !== undefined && row[name] !== '') return row[name];
      return '';
    },
    isGroupStageMatch: (row) => String(row.phase || row.round_code || '').toUpperCase() === 'GROUP',
    isFinalized: (row) => Boolean(row.winner_athlete_id) || String(row.status || '').toUpperCase() === 'FINISHED',
    playerId: (row, slot) => String(row[`side${slot}_athlete_id`] || ''),
    playerName: (row, slot) => String(row[`side${slot}_name`] || ''),
    winnerId: (row) => String(row.winner_athlete_id || ''),
  };
  vm.runInNewContext(rankingSource, context);

  const matches = [
    { phase: 'GROUP', status: 'FINISHED', side1_athlete_id: 'a', side1_name: 'Ana', side2_athlete_id: 'b', side2_name: 'Bia', winner_athlete_id: 'a', score: '6x0 6x0' },
    { phase: 'GROUP', status: 'FINISHED', side1_athlete_id: 'a', side1_name: 'Ana', side2_athlete_id: 'c', side2_name: 'Clara', winner_athlete_id: 'c', score: '4x6 4x6' },
    { phase: 'GROUP', status: 'FINISHED', side1_athlete_id: 'b', side1_name: 'Bia', side2_athlete_id: 'c', side2_name: 'Clara', winner_athlete_id: 'b', score: '6x4 6x4' },
    { phase: 'FINAL', status: 'FINISHED', side1_athlete_id: 'a', side1_name: 'Ana', side2_athlete_id: 'c', side2_name: 'Clara', winner_athlete_id: 'a', score: '6x0 6x0' },
  ];
  const standings = context.groupStandingRows(matches);

  assert.deepEqual(Array.from(standings, (row) => row.id), ['a', 'c', 'b']);
  assert.deepEqual(Array.from(standings, (row) => row.played), [2, 2, 2]);
  assert.deepEqual(Array.from(standings, (row) => row.wins), [1, 1, 1]);
  assert.deepEqual(Array.from(standings, (row) => row.setBalance), [0, 0, 0]);
  assert.deepEqual(Array.from(standings, (row) => row.gameBalance), [8, 0, -8]);

  const topTwoTied = context.groupStandingRows([
    { phase: 'GROUP', status: 'FINISHED', side1_athlete_id: 'a', side1_name: 'Ana', side2_athlete_id: 'c', side2_name: 'Clara', winner_athlete_id: 'a', score: '6x0 6x0' },
    { phase: 'GROUP', status: 'FINISHED', side1_athlete_id: 'b', side1_name: 'Bia', side2_athlete_id: 'a', side2_name: 'Ana', winner_athlete_id: 'b', score: '6x2 6x2' },
    { phase: 'GROUP', status: 'FINISHED', side1_athlete_id: 'c', side1_name: 'Clara', side2_athlete_id: 'b', side2_name: 'Bia', winner_athlete_id: 'c', score: '6x4 6x4' },
  ]);
  assert.deepEqual(Array.from(topTwoTied, (row) => row.gameBalance), [4, 4, -8]);
  assert.equal(topTwoTied.some((row) => row.tiePending), false, 'empate entre 1º e 2º não muda os finalistas');

  const cutoffTied = context.groupStandingRows([
    { phase: 'GROUP', status: 'FINISHED', side1_athlete_id: 'a', side1_name: 'Ana', side2_athlete_id: 'c', side2_name: 'Clara', winner_athlete_id: 'a', score: '6x0 6x0' },
    { phase: 'GROUP', status: 'FINISHED', side1_athlete_id: 'b', side1_name: 'Bia', side2_athlete_id: 'a', side2_name: 'Ana', winner_athlete_id: 'b', score: '6x4 6x4' },
    { phase: 'GROUP', status: 'FINISHED', side1_athlete_id: 'c', side1_name: 'Clara', side2_athlete_id: 'b', side2_name: 'Bia', winner_athlete_id: 'c', score: '6x2 6x2' },
  ]);
  assert.deepEqual(Array.from(cutoffTied, (row) => row.gameBalance), [8, -4, -4]);
  assert.equal(cutoffTied[0].tiePending, false);
  assert.equal(cutoffTied[1].tiePending, true);
  assert.equal(cutoffTied[2].tiePending, true);
});

test('super tie conta como set e não distorce o saldo de games', () => {
  const rankingSource = sourceSection(publicPage, 'function groupScoreNumber', '\n    function bracketStageHtml');
  const context = {
    clean: (value) => String(value ?? '').trim(),
    field: (row, ...names) => {
      for (const name of names) if (row?.[name] !== null && row?.[name] !== undefined && row[name] !== '') return row[name];
      return '';
    },
    isGroupStageMatch: () => true,
    isFinalized: () => true,
    playerId: () => '',
    playerName: () => '',
    winnerId: () => '',
  };
  vm.runInNewContext(rankingSource, context);

  const balance = context.groupMatchBalance({ score: '6x4 4x6 ST10x8' });
  assert.deepEqual({ ...balance }, { sets1: 2, sets2: 1, games1: 10, games2: 10 });
  const compactTiebreak = context.groupMatchBalance({ score: '710x78' });
  assert.deepEqual({ ...compactTiebreak }, { sets1: 1, sets2: 0, games1: 7, games2: 7 });
});

test('agenda e resultados identificam fase de grupos e final', () => {
  const schedule = sourceSection(publicPage, 'function publicMatchContextLabel', '\n    function agendaEventHtml');
  const results = sourceSection(publicPage, 'function scoreText', '\n    function allSponsors');

  assert.match(schedule, /isGroupKnockoutCategory\(matchCategoryId\(row\)\)/);
  assert.match(schedule, /isGroupStageMatch\(row\)/);
  assert.match(schedule, /isFinalStageMatch\(row\)/);
  assert.match(schedule, /\[category,stage\]\.filter\(Boolean\)\.join\(' · '\)/);
  assert.match(schedule, /escapeHtml\(publicMatchContextLabel\(row\)\)/);
  assert.match(results, /class="result-context"/);
  assert.match(results, /escapeHtml\(publicMatchContextLabel\(row\)\)/);
});

test('grupo permanece legível no celular sem criar rolagem na página', () => {
  const desktopStyles = sourceSection(publicPage, '.group-board', '\n    .agenda-list');
  const mobileStyles = sourceSection(publicPage, '@media (max-width: 620px)', '\n  </style>');

  assert.match(desktopStyles, /\.group-match-grid \{[^}]*grid-template-columns: repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(desktopStyles, /\.group-standings \{[^}]*width: 100%;[^}]*table-layout: fixed/);
  assert.match(desktopStyles, /\.group-standings tr\.finalist td \{[^}]*background: var\(--lime-soft\)/);
  assert.match(mobileStyles, /\.group-rules-list, \.group-match-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(mobileStyles, /\.group-standings th:not\(:first-child\) \{ width: 34px; \}/);
});
