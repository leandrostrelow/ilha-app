import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const migrationName = '20260914155856_tournament_group_stage.sql';
const [adminApi, migration] = await Promise.all([
  readFile(path.join(projectRoot, 'supabase/functions/tournament-admin-api/index.ts'), 'utf8'),
  readFile(path.join(projectRoot, 'supabase/migrations', migrationName), 'utf8'),
]);

test('API autoriza generateGroup somente com três inscrições confirmadas distintas', () => {
  assert.match(adminApi, /"generateGroup"/);
  assert.match(adminApi, /async function generateGroup\(client: DbClient, actorId: string, payload: Row\)/);
  assert.match(adminApi, /\.in\("status", \["CONFIRMED", "PENDING"\]\)/);
  assert.match(adminApi, /Conclua ou cancele as inscrições pendentes antes de gerar o grupo/);
  assert.match(adminApi, /registrations\.length !== 3/);
  assert.match(adminApi, /new Set\(athleteIds\)\.size !== 3/);
  assert.match(adminApi, /client\.rpc\("tournament_replace_group_stage_atomic"/);
});

test('RPC cria três jogos de grupo em rodadas separadas e uma final privada', () => {
  assert.match(migration, /create or replace function public\.tournament_replace_group_stage_atomic/);
  assert.match(migration, /draw_format = 'GROUPS_AND_KNOCKOUT'/);
  assert.match(migration, /draw_size = 3/);
  assert.match(migration, /p_tournament_id, p_category_id, 1, 'GROUP', 'GROUP', 1/);
  assert.match(migration, /p_tournament_id, p_category_id, 2, 'GROUP', 'GROUP', 1/);
  assert.match(migration, /p_tournament_id, p_category_id, 3, 'GROUP', 'GROUP', 1/);
  assert.match(migration, /p_tournament_id, p_category_id, 4, 'FINAL', 'FINAL', 1/);
  assert.match(migration, /null, null, 'PENDING', 1010, false/);
  assert.match(migration, /null, null, 'PENDING', 4010, false/);
  assert.doesNotMatch(
    migration.slice(
      migration.indexOf('create or replace function public.tournament_replace_group_stage_atomic'),
    ),
    /source1_match_id\s*=|source2_match_id\s*=/,
  );
});

test('geração valida novamente as três inscrições e substitui os jogos atomicamente', () => {
  const rpc = migration.slice(
    migration.indexOf('create or replace function public.tournament_replace_group_stage_atomic'),
  );
  assert.match(rpc, /public\.has_tournament_permission\('tournaments\.write'\)/);
  assert.match(rpc, /confirmed_count <> 3/);
  assert.match(rpc, /pending_count <> 0/);
  assert.match(rpc, /requested_athlete_count <> 3/);
  assert.match(rpc, /perform pg_catalog\.pg_advisory_xact_lock/);
  assert.match(rpc, /delete from public\.tournament_matches[\s\S]*insert into public\.tournament_matches/);
  assert.match(rpc, /jsonb_array_length\(inserted_matches\) <> 4/);
  assert.match(migration, /draw_size in \(2, 4, 8, 16, 32, 64, 128\)/);
  assert.match(migration, /draw_format = 'GROUPS_AND_KNOCKOUT' and draw_size = 3/);
  assert.match(migration, /tournament_categories_three_player_group_capacity_check/);
});

test('geração mata-mata restaura o formato da categoria na mesma transação', () => {
  assert.match(adminApi, /client\.rpc\("tournament_replace_single_elimination_atomic"/);
  const wrapper = migration.slice(
    migration.indexOf('create or replace function public.tournament_replace_single_elimination_atomic'),
    migration.indexOf('create or replace function public.tournament_replace_group_stage_atomic'),
  );
  assert.match(wrapper, /replacement := public\.tournament_replace_bracket_atomic/);
  assert.match(wrapper, /draw_format = 'SINGLE_ELIMINATION'/);
  assert.match(wrapper, /group_stage_previous_max_entries/);
  assert.match(wrapper, /return replacement \|\| jsonb_build_object\('draw_format', 'SINGLE_ELIMINATION'\)/);
});

test('classificação oficial aplica os critérios e só preenche a final com desempate resolvido', () => {
  const refresh = migration.slice(
    migration.indexOf('create or replace function private.refresh_tournament_group_final'),
    migration.indexOf('create or replace function public.tournament_replace_group_stage_atomic'),
  );
  assert.match(refresh, /completed_match_count = 3/);
  assert.match(refresh, /distinct_win_count = 3/);
  assert.match(refresh, /distinct_win_count = 2/);
  assert.match(refresh, /head_to_head_winner/);
  assert.match(refresh, /distinct_win_count = 1/);
  assert.match(refresh, /standings\.set_difference desc, standings\.game_difference desc/);
  assert.match(refresh, /ranked_athletes\[2\]/);
  assert.match(refresh, /ranked_athletes\[3\]/);
  assert.match(refresh, /second_set_difference is distinct from third_set_difference/);
  assert.match(refresh, /first_finalist := null/);
  assert.match(refresh, /second_finalist := null/);
});

test('super tie conta como set, não como games, e placar compacto usa apenas o game principal', () => {
  const metrics = migration.slice(
    migration.indexOf('create or replace function private.tournament_group_score_metrics'),
    migration.indexOf('create or replace function private.tournament_group_stage_standings'),
  );
  assert.match(metrics, /is_super_tie := score_parts\[1\] is not null/);
  assert.match(metrics, /side1_sets := side1_sets \+ 1/);
  assert.match(metrics, /if not is_super_tie then[\s\S]*side1_games := side1_games \+ side1_main/);
  assert.match(metrics, /length\(raw_side1\) >= 2 and left\(raw_side1, 1\) in \('6', '7'\)/);
});

test('mudança de classificados preserva a agenda e é bloqueada após resultado da final', () => {
  const refresh = migration.slice(
    migration.indexOf('create or replace function private.refresh_tournament_group_final'),
    migration.indexOf('create or replace function public.tournament_replace_group_stage_atomic'),
  );
  assert.match(refresh, /finalists_changed and final_match\.winner_athlete_id is not null/);
  assert.match(refresh, /A final já possui vencedor\. Remova o resultado da final antes de corrigir o grupo\./);
  assert.match(refresh, /final_match\.side1_athlete_id = second_finalist/);
  assert.match(refresh, /first_finalist := final_match\.side1_athlete_id/);
  assert.match(refresh, /second_finalist := final_match\.side2_athlete_id/);
  assert.match(refresh, /group_final_manual/);
  assert.match(refresh, /set side1_athlete_id = first_finalist/);
  assert.doesNotMatch(refresh, /set[\s\S]{0,300}match_date\s*=/);
  assert.doesNotMatch(refresh, /set[\s\S]{0,300}match_time\s*=/);
  assert.doesNotMatch(refresh, /set[\s\S]{0,300}court_name\s*=/);
  assert.match(adminApi, /assertNoGroupFinalConflict\(result\.error\)/);
  assert.match(adminApi, /group_final_manual: true/);
});

test('grupo fechado serializa inscrições, exige zero pendências e fixa a lotação em três', () => {
  const groupRpc = migration.slice(
    migration.indexOf('create or replace function public.tournament_replace_group_stage_atomic'),
  );
  assert.match(groupRpc, /from public\.tournament_registrations[\s\S]*order by registration\.id[\s\S]*for update/);
  assert.match(groupRpc, /pending_count <> 0/);
  assert.match(groupRpc, /max_entries = 3/);
  assert.match(groupRpc, /group_stage_previous_max_entries/);
  const registrationLock = groupRpc.indexOf('order by registration.id');
  const categoryLock = groupRpc.indexOf('for update;', registrationLock);
  const advisoryLock = groupRpc.indexOf('pg_advisory_xact_lock');
  assert.ok(registrationLock !== -1 && categoryLock > registrationLock && advisoryLock > categoryLock);
});

test('troca de participantes da final é bloqueada no banco quando já existem palpites', () => {
  const guard = migration.slice(
    migration.indexOf('create or replace function private.guard_tournament_group_final_predictions'),
    migration.indexOf('create or replace function public.tournament_replace_single_elimination_atomic'),
  );
  assert.match(guard, /before update of side1_athlete_id, side2_athlete_id/);
  assert.match(guard, /public\.tournament_predictions/);
  assert.match(guard, /public\.tournament_prediction_requests/);
  assert.match(guard, /A final já possui palpites/);
});
