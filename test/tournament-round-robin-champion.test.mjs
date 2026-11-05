import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const publicPage = fs.readFileSync(new URL('../torneios/index.html', import.meta.url), 'utf8');

test('ADM hides the final and crowns first place in a pure round robin', () => {
  assert.match(admin, /function categoryIsRoundRobin/);
  assert.match(admin, /const qualifierCount = roundRobin \? 1 : 2/);
  assert.match(admin, /roundRobin \? '' : '<section class="group-competition-panel final-panel/);
  assert.match(admin, /a 1ª colocada é a campeã/);
  assert.match(admin, /finalMatch \? 'GRUPO \+ FINAL' : 'TODOS CONTRA TODOS'/);
});

test('public bracket explains a pure round robin and omits its final', () => {
  assert.match(publicPage, /const roundRobin = categoryDrawFormat\(category\) === 'ROUND_ROBIN'/);
  assert.match(publicPage, /A atleta com a melhor classificação é a campeã/);
  assert.match(publicPage, /roundRobin \? '' : finalHtml/);
  assert.match(publicPage, /qualifyingPlaces === 1 \? 'A primeira colocada é a campeã\.'/);
});
