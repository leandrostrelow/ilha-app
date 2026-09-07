import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const projectRoot = path.resolve(import.meta.dirname, '..');
const [publicPageSource, adminPageSource, capacityMigrationSource] = await Promise.all([
  readFile(path.join(projectRoot, 'torneios', 'index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'adm', 'index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'supabase', 'migrations', '20260907161030_block_full_tournament_classes_and_warn_admins.sql'), 'utf8'),
]);

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `função ausente: ${name}`);
  const next = source.indexOf('\n    function ', start + 1);
  return source.slice(start, next >= 0 ? next : undefined);
}

test('página pública entende a capacidade sanitizada de cada classe', () => {
  const capacity = functionSource(publicPageSource, 'categoryCapacity');
  assert.match(capacity, /max_entries/);
  assert.match(capacity, /occupied_count/);
  assert.match(capacity, /remaining_entries/);
  assert.match(capacity, /is_full/);
  assert.match(capacity, /remainingEntries === 0/);

  const label = functionSource(publicPageSource, 'categoryCapacityLabel');
  assert.match(label, /Lotada/);
  assert.match(label, /Última vaga/);
  assert.match(label, /'Restam ' \+ capacity\.remainingEntries \+ ' vagas'/);
  assert.match(functionSource(publicPageSource, 'categoriesHtml'), /category-capacity/);

  const sandbox = {};
  vm.runInNewContext(`
    const field = (row, ...names) => {
      for (const name of names) if (row && row[name] !== null && row[name] !== undefined && row[name] !== '') return row[name];
      return '';
    };
    ${capacity}
    ${label}
    result = [
      categoryCapacityLabel({ max_entries: 8, occupied_count: 8 }),
      categoryCapacityLabel({ max_entries: 8, remaining_entries: 1 }),
      categoryCapacityLabel({ max_entries: 8, remaining_entries: 2 }),
      categoryCapacity({ max_entries: 8, remaining_entries: 4, is_full: true }).isFull,
    ];
  `, sandbox);
  assert.deepEqual(Array.from(sandbox.result), ['Lotada', 'Última vaga', 'Restam 2 vagas', true]);
});

test('banco serializa a última vaga e recusa novas listas de espera', () => {
  assert.match(capacityMigrationSource, /create or replace function private\.enforce_tournament_registration_capacity\(\)[\s\S]*security definer[\s\S]*set search_path = ''/);
  assert.match(capacityMigrationSource, /select category\.max_entries[\s\S]*for update;/);
  assert.match(capacityMigrationSource, /registration\.status in \('PENDING', 'CONFIRMED'\)/);
  assert.match(capacityMigrationSource, /if occupied_entries >= category_max_entries then[\s\S]*errcode = 'P0001'/);
  assert.match(capacityMigrationSource, /new\.status = 'WAITLIST'[\s\S]*tg_op = 'INSERT' or old\.status is distinct from new\.status/);
  assert.match(capacityMigrationSource, /before insert on public\.tournament_registrations/);
  assert.match(capacityMigrationSource, /before update[\s\S]*on public\.tournament_registrations/);
  assert.match(capacityMigrationSource, /primary_status := ''WAITLIST''[\s\S]*Esta classe atingiu o limite de vagas/);
});

test('snapshot e alertas usam a mesma ocupação e notificam apenas administradores aptos', () => {
  assert.match(capacityMigrationSource, /'occupied_count', capacity\.occupied_count/);
  assert.match(capacityMigrationSource, /'registration_count', capacity\.confirmed_count/);
  assert.match(capacityMigrationSource, /count\(\*\) filter \(where registration\.status = 'CONFIRMED'\)::integer as confirmed_count/);
  assert.match(capacityMigrationSource, /'remaining_entries',[\s\S]*greatest\(category\.max_entries - capacity\.occupied_count, 0\)/);
  assert.match(capacityMigrationSource, /'is_full',[\s\S]*capacity\.occupied_count >= category\.max_entries/);
  assert.match(capacityMigrationSource, /registration\.published = true\s+and registration\.status = 'CONFIRMED'/);
  assert.match(capacityMigrationSource, /if remaining_entries > 2 then/);
  assert.match(capacityMigrationSource, /':remaining:' \|\| remaining_entries::text/);
  assert.ok((capacityMigrationSource.match(/\? 'communication'/g) || []).length >= 4);
  assert.match(capacityMigrationSource, /where tournament\.status = 'REGISTRATION_OPEN'[\s\S]*tournament\.registration_open is true[\s\S]*tournament\.is_published is true[\s\S]*category\.is_published is true[\s\S]*category\.registration_open is true/);
});

test('estado aberto da classe preserva compatibilidade e respeita fechamentos explícitos', () => {
  const acceptsRegistration = functionSource(publicPageSource, 'categoryAcceptsRegistration');
  const sandbox = {};
  vm.runInNewContext(`
    const field = (row, ...names) => {
      for (const name of names) if (row && row[name] !== null && row[name] !== undefined && row[name] !== '') return row[name];
      return '';
    };
    const clean = (value) => value === null || value === undefined ? '' : String(value).trim();
    ${acceptsRegistration}
    result = [
      categoryAcceptsRegistration({}),
      categoryAcceptsRegistration({ registration_open: true, active: true }),
      categoryAcceptsRegistration({ registration_open: false }),
      categoryAcceptsRegistration({ active: false }),
      categoryAcceptsRegistration({ status: 'CLOSED' }),
    ];
  `, sandbox);
  assert.deepEqual(Array.from(sandbox.result), [true, true, false, false, false]);
});

test('classe lotada fica indisponível nos formulários individual, interno e familiar', () => {
  const categories = functionSource(publicPageSource, 'renderRegistrationCategories');
  assert.equal((categories.match(/categoryIsFull\(row\)/g) || []).length, 2);
  assert.equal((categories.match(/disabled aria-disabled="true"/g) || []).length, 2);

  const familyCard = functionSource(publicPageSource, 'familyAthleteCardHtml');
  assert.match(familyCard, /categoryIsFull\(row\)/);
  assert.match(familyCard, /disabled/);
  assert.match(familyCard, /— Lotada/);
  assert.match(publicPageSource, /\.category-check:has\(input:disabled\)/);
});

test('Classe Espacial lotada não pode ser marcada e informa o motivo', () => {
  const individualAddon = functionSource(publicPageSource, 'updateSpatialAddonField');
  assert.match(individualAddon, /categoryIsFull\(additional\)/);
  assert.match(individualAddon, /categoryAcceptsRegistration\(additional\)/);
  assert.match(individualAddon, /spatialAddon'\)\.disabled = blocked/);
  assert.match(individualAddon, /Lotada no momento/);
  assert.match(individualAddon, /Inscrições encerradas no momento/);

  const familyCard = functionSource(publicPageSource, 'familyAthleteCardHtml');
  assert.match(familyCard, /addonFull/);
  assert.match(familyCard, /addonClosed/);
  assert.match(familyCard, /addonBlocked \? 'disabled '/);
  assert.match(familyCard, /Lotada no momento/);
});

test('submit revalida lotação principal, familiar e Espacial antes da chamada remota', () => {
  const individual = functionSource(publicPageSource, 'submitRegistration');
  assert.match(individual, /categoryAcceptsRegistration/);
  assert.match(individual, /selectedCategories[\s\S]*categoryIsFull/);
  assert.match(individual, /additional_category_id[\s\S]*categoryIsFull\(additionalCategory\)/);

  const family = functionSource(publicPageSource, 'submitFamilyRegistration');
  assert.match(family, /requestedCategoryCounts/);
  assert.match(family, /categoryAcceptsRegistration\(category\)/);
  assert.match(family, /categoryAcceptsRegistration\(additional\)/);
  assert.match(family, /primaryCapacity\.isFull[\s\S]*categoryFullMessage\(category\)/);
  assert.match(family, /additionalCapacity\.isFull[\s\S]*categoryFullMessage\(additional\)/);
  assert.match(family, /não possui vagas suficientes para todos os atletas desta inscrição/);
});

test('histórico do ADM diferencia lista de espera de isenção e identifica origem pública', () => {
  const paymentLabel = functionSource(adminPageSource, 'tournamentHistoryPaymentLabel');
  assert.match(paymentLabel, /WAITLIST: 'Lista de espera'/);
  assert.match(paymentLabel, /NOT_REQUIRED: 'Isento'/);

  const historyRows = functionSource(adminPageSource, 'tournamentRegistrationHistoryRows');
  assert.match(historyRows, /\['WAITLIST', 'LISTA_ESPERA'\]/);
  assert.match(historyRows, /registrationSource === 'PUBLIC' \|\| payment\.id \|\| waitlist \? 'Site' : 'ADM'/);
  assert.match(historyRows, /paymentStatus = waitlist[\s\S]*\? 'WAITLIST'/);

  const history = functionSource(adminPageSource, 'renderTournamentRegistrationHistory');
  assert.match(history, /statusFilter === 'LISTA_ESPERA'/);
  assert.match(history, /Aguardando abertura de vaga · nenhuma cobrança foi gerada/);
  assert.match(adminPageSource, /<option value="LISTA_ESPERA">Lista de espera<\/option>/);
});
