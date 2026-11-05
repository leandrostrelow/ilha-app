import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { releasedPredictionWindow } from '../supabase/functions/_shared/prediction-release-window.ts';

const api = await readFile(new URL('../supabase/functions/bet-public-api/index.ts', import.meta.url), 'utf8');
const app = await readFile(new URL('../bet/app.js', import.meta.url), 'utf8');
test('access code stays in Meus dados, not in history, and builds version Bet assets', async () => {
  const html = await readFile(new URL('../bet/index.html', import.meta.url), 'utf8');
  const history = html.split('id="minePanel"')[1].split('</section>')[0];
  const profile = html.split('id="profilePanel"')[1].split('</section>')[0];
  assert.ok(history.includes('id="myPicksList"'));
  assert.ok(!history.includes('savedAccessCode'));
  assert.ok(profile.includes('savedAccessCode'));
  assert.ok(profile.includes('leaveDeviceButton'));
  const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.ok(build.includes("createHash('sha256')"));
  assert.ok(build.includes("['app.js', 'styles.css']"));
});
const source = api.slice(api.indexOf('function asIsoFromMatch'), api.indexOf('function databaseMessage'));
const context = vm.createContext({ Date, Intl, Map, Set, releasedPredictionWindow });
vm.runInContext(stripTypeScriptTypes(source), context);

function fixture() {
  const base = { category_id: 'c', side1_athlete_id: 'a', side2_athlete_id: 'b', published: true, match_date: '2026-09-15', match_time: '15:00:00', phase: 'QF' };
  const tables = {
    tournaments: [{ id: 't', slug: 'test', is_published: true, status: 'OPEN', timezone: 'America/Sao_Paulo' }],
    tournament_prediction_campaigns: [{ id: 'campaign', tournament_id: 't', published: true, status: 'OPEN', initial_round_points: 1 }],
    tournament_categories: [{ id: 'c', tournament_id: 't', active: true, is_published: true, name: 'Classe teste' }],
    tournament_matches: [
      { ...base, id: 'done', status: 'FINISHED', winner_athlete_id: 'a' },
      { ...base, id: 'cancel', status: 'CANCELLED', winner_athlete_id: 'a' },
      { ...base, id: 'next', status: 'PENDING' },
      { ...base, id: 'hidden', status: 'PENDING', published: false },
    ].map(m => ({ ...m, tournament_id: 't' })),
    tournament_prediction_entries: [{ id: 'me', campaign_id: 'campaign', status: 'ACTIVE', public_name: 'Teste' }],
    tournament_predictions: ['done', 'cancel', 'next', 'hidden'].map(match_id => ({ campaign_id: 'campaign', entry_id: 'me', match_id, predicted_winner_athlete_id: 'a' })),
    tournament_athletes: [{ id: 'a', full_name: 'Atleta A' }, { id: 'b', full_name: 'Atleta B' }],
  };
  return { from(table) {
    let rows = tables[table];
    const q = { select() { return q; }, order() { return q; }, limit() { return q; },
      eq(k,v) { rows=rows.filter(r=>r[k]===v); return q; },
      neq(k,v) { rows=rows.filter(r=>r[k]!==v); return q; },
      in(k,v) { rows=rows.filter(r=>v.includes(r[k])); return q; },
      maybeSingle() { return Promise.resolve({ data: rows[0], error: null }); },
      then(resolve,reject) { return Promise.resolve({ data: rows, error: null }).then(resolve,reject); },
    }; return q;
  } };
}

test('history retains finished, cancelled and unpublished picks without exposing a private draw', async () => {
  const data = await context.loadSnapshot(fixture(), 'test', { entry: { id: 'me', full_name: 'Teste' } });
  assert.deepEqual(Array.from(data.matches,m=>m.id), ['next']);
  assert.equal(data.participant.predictions.length, 4);
  const byId = new Map(data.participant.predictions.map(p=>[p.match_id,p]));
  assert.equal(byId.get('done').match.winner_athlete_id, 'a');
  assert.equal(byId.get('cancel').match.winner_athlete_id, null);
  assert.equal(byId.get('hidden').match, null);
  assert.equal(byId.get('hidden').winner_name, 'Atleta A');
  assert.equal(data.ranking[0].score, 1);
  const publicData = await context.loadSnapshot(fixture(), 'test');
  assert.equal(publicData.participant, null);
  assert.equal(JSON.stringify(publicData).includes('winner_name'), false);
});

test('Meus palpites renders every saved choice, including a missing or changed match', () => {
  const elements = new Map();
  const $ = id => { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); };
  const m = { id:'done', status:'FINISHED', points:1, winner_athlete_id:'a', side1:{id:'a',name:'A'}, side2:{id:'b',name:'B'} };
  const state = { data: { campaign:{}, categories:[], matches:[], participant:{ name:'Teste', predictions:[
    {match_id:'done',winner_athlete_id:'a',winner_name:'A',match:m},
    {match_id:'missing',winner_athlete_id:'x',winner_name:'Meu atleta'},
    {match_id:'changed',winner_athlete_id:'old',winner_name:'Original',match:{...m,id:'changed'}},
  ]} } };
  const run = new Function('state','$','escapeHtml','phaseLabel','matchSchedule',
    app.slice(app.indexOf('function ownPickMap'),app.indexOf('function renderHeader')) +
    app.slice(app.indexOf('function renderMine'),app.indexOf('function renderRanking')) + 'renderMine();');
  run(state,$,String,()=>'',()=>'');
  assert.equal($('myPickCount').textContent,'3');
  const html=$('myPicksList').innerHTML;
  assert.equal((html.match(/class="my-pick"/g)||[]).length,3);
  assert.match(html,/\+1 ponto/);
  assert.match(html,/Jogo indisponível para consulta/);
  assert.match(html,/Confronto alterado · sem pontuação/);
  assert.match($('historySummary').innerHTML, /Palpites<\/span><strong>3/);
  assert.match($('historySummary').innerHTML, /Acertos<\/span><strong>1/);
  assert.match($('historySummary').innerHTML, /Sem apuração<\/span><strong>2/);
});

test('ranking groups metrics separately and handles singular picks', () => {
  const rankingList = {};
  const state = { data: { ranking: [{ position: 1, name: 'Atleta <teste>', predictions: 1, score: 3, correct: 1, settled: 1 }] } };
  const run = new Function('state', '$', 'escapeHtml', app.slice(app.indexOf('function renderRanking'), app.indexOf('function render()')) + 'renderRanking();');
  run(state,()=>rankingList,v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;'));
  assert.match(rankingList.innerHTML, /class="ranking-metrics"/);
  assert.match(rankingList.innerHTML, /1 palpite<\/small>/);
  assert.match(rankingList.innerHTML, /Atleta &lt;teste&gt;/);
  assert.equal((rankingList.innerHTML.match(/class="ranking-stat/g)||[]).length,3);
});

test('temporary session errors preserve access and expose retry instead of silently logging out', () => {
  assert.match(app,/AbortSignal.timeout\(20000\)/);
  assert.match(app,/sessionError = 'Não foi possível carregar seus palpites/);
  assert.doesNotMatch(app,/error.status === 401 \|\| error.status === 403/);
  assert.match(app,/if \(shouldRefresh\) refreshSnapshot\(\)/);
});

test('ties prefer fewer settled picks, ignore pending picks, then prefer older registration', async () => {
  const entries = [
    {id:'many',status:'ACTIVE',created_at:'2026-01-01'},
    {id:'few-new',status:'ACTIVE',created_at:'2026-01-03'},
    {id:'few-old',status:'ACTIVE',created_at:'2026-01-02'},
  ];
  const matches = new Map([
    ['win',{status:'FINISHED',winner_athlete_id:'a',side1_athlete_id:'a',side2_athlete_id:'b'}],
    ['lose',{status:'FINISHED',winner_athlete_id:'b',side1_athlete_id:'a',side2_athlete_id:'b'}],
    ['pending',{status:'PENDING',side1_athlete_id:'a',side2_athlete_id:'b'}],
  ]);
  const predictions = entries.map(e=>({entry_id:e.id,match_id:'win',predicted_winner_athlete_id:'a'}));
  predictions.push({entry_id:'many',match_id:'lose',predicted_winner_athlete_id:'a'},
    {entry_id:'few-old',match_id:'pending',predicted_winner_athlete_id:'a'});
  const expected=['few-old','few-new','many'];
  assert.deepEqual(Array.from(context.calculateRanking(entries,predictions,matches,{}),r=>r.entry_id),expected);
  const admin=await readFile(new URL('../supabase/functions/bet-admin-api/index.ts',import.meta.url),'utf8');
  const ctx=vm.createContext({Map});
  vm.runInContext(stripTypeScriptTypes(admin.slice(admin.indexOf('function pointsForMatch'),admin.indexOf('function rpcRow'))),ctx);
  assert.deepEqual(Array.from(ctx.calculateRanking(entries,predictions,matches,{}),r=>r.id),expected);
  const migration=await readFile(new URL('../supabase/migrations/20260916013807_prediction_fewer_settled_tiebreak.sql',import.meta.url),'utf8');
  assert.match(migration,/order by score desc,\s+count\(prediction.id\) filter \(where match.id is not null\) asc,/);
  assert.match(migration,/enable trigger guard_tournament_prediction_campaign_update/);
  assert.match(migration,/OWNER_AUTHORIZED_TIEBREAK_CHANGE/);
});
