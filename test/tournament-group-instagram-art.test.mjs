import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const adminSource = fs.readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');

test('admin allows Instagram art export for group categories', () => {
  assert.match(adminSource, /function drawInstagramGroup\(ctx, canvas, matches, category, background\)/);
  assert.match(adminSource, /categoryUsesGroupFormat\(category, matches\)[\s\S]*?drawInstagramGroup\(ctx, poster, matches, category, background\)/);
  assert.match(adminSource, /instagramButton\.disabled = !hasCategory \|\| state\.saving \|\| !\(matches \|\| \[\]\)\.length/);
  assert.doesNotMatch(adminSource, /arte automática do Instagram ainda é exclusiva das chaves eliminatórias/);
});

test('group artwork includes every group match and its final', () => {
  const renderer = adminSource.slice(
    adminSource.indexOf('function drawInstagramGroup'),
    adminSource.indexOf('function drawInstagramBracket')
  );
  assert.match(renderer, /tournamentGroupMatches\(matches\)/);
  assert.match(renderer, /groupMatches\.forEach/);
  assert.match(renderer, /tournamentGroupFinal\(matches\)/);
  assert.match(renderer, /'GRUPO \+ FINAL'/);
  assert.match(renderer, /'FINAL'/);
});
