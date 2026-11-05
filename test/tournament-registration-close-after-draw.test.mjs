import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const apiPath = new URL('../supabase/functions/tournament-admin-api/index.ts', import.meta.url);
const adminPath = new URL('../adm/index.html', import.meta.url);
const publicPath = new URL('../torneios/index.html', import.meta.url);
const migrationPath = new URL(
  '../supabase/migrations/20260914170724_close_tournament_registration_after_draw.sql',
  import.meta.url,
);

const [apiSource, adminSource, publicSource, migrationSource] = await Promise.all([
  readFile(apiPath, 'utf8'),
  readFile(adminPath, 'utf8'),
  readFile(publicPath, 'utf8'),
  readFile(migrationPath, 'utf8'),
]);

test('normal draw refuses pending registrations before generating matches', () => {
  const generateBracket = apiSource.slice(
    apiSource.indexOf('async function generateBracket'),
    apiSource.indexOf('async function generateGroup'),
  );

  assert.match(generateBracket, /\.in\("status", \["CONFIRMED", "PENDING"\]\)/);
  assert.match(generateBracket, /activeRegistrations\.some[\s\S]*status[\s\S]*=== "PENDING"/);
  assert.match(generateBracket, /Conclua ou cancele as inscrições pendentes antes de gerar a chave\./);
  assert.ok(
    generateBracket.indexOf('activeRegistrations.some') <
      generateBracket.indexOf('tournament_replace_single_elimination_atomic'),
  );
});

test('database rejects new registrations after any draw exists', () => {
  assert.match(migrationSource, /create or replace function private\.enforce_tournament_registration_capacity/);
  assert.match(migrationSource, /category_has_draw boolean/);
  assert.match(migrationSource, /from public\.tournament_matches[\s\S]*category_has_draw/);
  assert.match(migrationSource, /As inscrições desta classe foram encerradas porque a chave já foi gerada\./);
});

test('first generated match closes the category atomically and rejects pending rows', () => {
  assert.match(migrationSource, /create or replace function private\.close_tournament_category_on_draw/);
  assert.match(migrationSource, /from public\.tournament_registrations[\s\S]*order by registration\.id[\s\S]*for update/);
  assert.match(migrationSource, /registration\.status = 'PENDING'/);
  assert.match(migrationSource, /set registration_open = false/);
  assert.match(
    migrationSource,
    /create trigger close_tournament_category_on_draw\s+before insert on public\.tournament_matches/,
  );
});

test('category cannot be reopened while its draw exists', () => {
  assert.match(migrationSource, /create or replace function private\.guard_tournament_category_registration_reopen/);
  assert.match(migrationSource, /new\.registration_open is true[\s\S]*from public\.tournament_matches/);
  assert.match(
    migrationSource,
    /create trigger guard_tournament_category_registration_reopen\s+before update of registration_open/,
  );
});

test('single-elimination replacement checks pending rows and closes registration', () => {
  const wrapper = migrationSource.slice(
    migrationSource.indexOf('create or replace function public.tournament_replace_single_elimination_atomic'),
    migrationSource.indexOf('-- Retrofit the rule'),
  );

  assert.ok(wrapper.indexOf('from public.tournament_registrations') < wrapper.indexOf('from public.tournament_categories'));
  assert.match(wrapper, /registration\.status = 'PENDING'/);
  assert.match(wrapper, /public\.tournament_replace_bracket_atomic/);
  assert.match(wrapper, /registration_open = false/);
  assert.match(wrapper, /'registration_open', false/);
});

test('existing generated categories are closed by the migration', () => {
  assert.match(
    migrationSource,
    /update public\.tournament_categories[\s\S]*registration_open = false[\s\S]*exists \([\s\S]*public\.tournament_matches/,
  );
});

test('admin confirms that registration was closed after generating either format', () => {
  assert.match(adminSource, /Chave criada em modo privado e inscrições desta classe encerradas/);
  assert.match(adminSource, /Grupo criado em modo privado:[\s\S]*As inscrições desta classe foram encerradas/);
});

test('public registration availability continues to honor registration_open', () => {
  const helperStart = publicSource.indexOf('function categoryAcceptsRegistration');
  assert.notEqual(helperStart, -1);
  const helper = publicSource.slice(helperStart, helperStart + 800);
  assert.match(helper, /registration_open/);
  assert.match(helper, /return false/);
});
