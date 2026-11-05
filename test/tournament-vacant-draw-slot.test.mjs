import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260921150000_fill_vacant_draw_slot_after_inactive_player.sql', import.meta.url),
  'utf8',
);

test('chave gerada aceita somente uma vaga real da primeira rodada', () => {
  assert.match(migration, /round_no = \([\s\S]*select min\(first_round\.round_no\)/);
  assert.match(migration, /side1_athlete_id is null or tournament_match\.side2_athlete_id is null/);
  assert.match(migration, /if category_has_draw and not draw_has_vacancy then/);
  assert.match(migration, /A chave desta classe já está completa/);
});

test('atleta inativo não ocupa o limite da classe', () => {
  assert.match(migration, /join public\.tournament_athletes as athlete/);
  assert.match(migration, /athlete\.active is true/);
  assert.match(migration, /athlete\.status = 'ACTIVE'/);
});

test('inscrição confirmada preenche automaticamente o espaço vazio da chave', () => {
  assert.match(migration, /fill_tournament_draw_vacancy_from_registration/);
  assert.match(migration, /after insert or update of status, category_id, athlete_id/);
  assert.match(migration, /set side1_athlete_id = new\.athlete_id/);
  assert.match(migration, /set side2_athlete_id = new\.athlete_id/);
});
