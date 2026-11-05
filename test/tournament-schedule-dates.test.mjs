import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { releasedPredictionWindow } from '../supabase/functions/_shared/prediction-release-window.ts';

const admin = readFileSync(new URL('../supabase/functions/tournament-admin-api/index.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const bet = readFileSync(new URL('../supabase/functions/bet-public-api/index.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../bet/app.js', import.meta.url), 'utf8');
let now = Date.parse('2026-09-18T12:00:00-03:00');
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const ctx = vm.createContext({ Date: Clock, Intl, Map, Set, ApiError: Error, releasedPredictionWindow,
  text: (value, max = 500) => String(value ?? '').trim().slice(0, max) });
vm.runInContext(stripTypeScriptTypes(admin.slice(admin.indexOf('function validDate('), admin.indexOf('function optionalDateField(')) +
  admin.slice(admin.indexOf('function saoPauloToday('), admin.indexOf('function phaseForSize('))), ctx);
vm.runInContext(stripTypeScriptTypes(bet.slice(bet.indexOf('function asIsoFromMatch('), bet.indexOf('function campaignAcceptsPredictions('))), ctx);
const tournament = { starts_on: '2026-09-11', ends_on: '2026-09-27', timezone: 'America/Sao_Paulo' };

test('legacy weekday uses the current week, explicit dates keep the chosen week', () => {
  assert.equal(ctx.resolveLegacyDate('Sexta', tournament), '2026-09-18');
  assert.equal(ctx.resolveLegacyDate('Sábado', tournament), '2026-09-19');
  assert.equal(ctx.resolveLegacyDate('2026-09-25', tournament), '2026-09-25');
  assert.equal(ctx.resolveLegacyDate('2026-09-11', tournament), '2026-09-11');
  assert.equal(ctx.resolveLegacyDate('Segunda', { ...tournament, starts_on: '2026-09-21' }), '2026-09-21');
});

test('saving an old result or reordering does not reschedule its date', () => {
  assert.equal(ctx.resolveLegacyDate('Sexta', tournament, '2026-09-11'), '2026-09-11');
  assert.equal(ctx.resolveLegacyDate('Sexta', tournament, '2026-09-25'), '2026-09-25');
  assert.throws(() => ctx.resolveLegacyDate('Segunda', { ...tournament, ends_on: '2026-09-20' }));
});

test('ADM retains separate Fridays in options, grouping and save payloads', () => {
  const ui = vm.createContext({ Date, Set, state: { data: { torneio: { data_inicio: '2026-09-11', data_fim: '2026-09-27' }, jogos: [], agenda: [] } }, agendaDays: [], escapeHtml: String });
  vm.runInContext(page.slice(page.indexOf('    function normalizeTournamentAgendaDates('), page.indexOf('    function courtOptions(')) +
    page.slice(page.indexOf('    function displayAgendaDay('), page.indexOf('    function agendaOrderValue(')), ui);
  const data = ui.normalizeTournamentAgendaDates({ jogos: [{ data: 'Sexta', data_iso: '2026-09-18' }], agenda: [] });
  assert.equal(data.jogos[0].data, '2026-09-18');
  const dates = Array.from(ui.tournamentAgendaDates());
  assert.equal(dates.length, 17);
  for (const day of ['2026-09-11', '2026-09-18', '2026-09-25']) assert.ok(dates.includes(day));
  assert.match(ui.dayOptions('2026-09-18'), /value="2026-09-18" selected>Sexta, 18\/09/);
  assert.match(page, /match\.data_iso = payload\.data/);
});

test('all matches including Após close at 18:00, never before or from last week', () => {
  const match = { status: 'PENDING', match_date: '2026-09-18', match_time: '18:00:00' };
  const after = { ...match, match_time: null };
  const later = { ...match, match_time: '20:00:00' };
  const past = { ...match, match_date: '2026-09-11', status: 'FINISHED', match_time: '08:00:00' };
  const cancelled = { ...match, match_time: '09:00:00', status: 'CANCELLED' };
  const cutoffs = ctx.predictionDayCutoffs([match, after, later, past, cancelled], tournament);
  assert.equal(cutoffs.get('2026-09-18'), '2026-09-18T21:00:00.000Z');
  for (const clock of ['2026-09-18T12:00:00-03:00', '2026-09-18T17:59:59-03:00']) {
    now = Date.parse(clock);
    for (const item of [match, after, later]) assert.equal(ctx.isMatchLocked(item, tournament, cutoffs), false);
  }
  for (const clock of ['2026-09-18T18:00:00-03:00', '2026-09-18T18:01:00-03:00']) {
    now = Date.parse(clock);
    for (const item of [match, after, later]) assert.equal(ctx.isMatchLocked(item, tournament, cutoffs), true);
  }
});

test('open phone screen closes choices using server time even if device clock is wrong', () => {
  let elapsed = 0;
  const ui = vm.createContext({ Date, performance: { now: () => elapsed }, state: {
    serverTime: Date.parse('2026-09-18T17:59:59-03:00'), serverTimeReceivedAt: 0,
  } });
  vm.runInContext(app.slice(app.indexOf('  function predictionDeadlineReached('), app.indexOf('  function renderMatchCard(')), ui);
  const match = { prediction_closes_at: '2026-09-18T21:00:00Z' };
  assert.equal(ui.predictionDeadlineReached(match), false);
  elapsed = 1000;
  assert.equal(ui.predictionDeadlineReached(match), true);
  assert.match(app, /visibilitychange/);
});
