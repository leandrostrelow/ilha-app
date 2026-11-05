import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const publicPage = readFileSync(new URL('../torneios/index.html',import.meta.url),'utf8');
const adminPage = readFileSync(new URL('../adm/index.html',import.meta.url),'utf8');
const registration = readFileSync(new URL('../pickleball-registration.js',import.meta.url),'utf8');
const fixture=JSON.parse(readFileSync(new URL('./fixtures/pickleball-snapshot.json',import.meta.url),'utf8'));
function section(source,start,end){const i=source.indexOf(start);assert.ok(i>=0);const j=source.indexOf(end,i+start.length);assert.ok(j>i);return source.slice(i,j);}

test('pickleball standings use every point of all 3 super tiebreaks; tennis is unchanged',()=>{
  const context={clean:(v)=>String(v??'').trim(),field:(r,...keys)=>keys.map((k)=>r[k]).find((v)=>v!==undefined)||'',tournament:()=>({settings:{sport:'PICKLEBALL'}})};
  vm.runInNewContext(section(publicPage,'function groupScoreNumber','function groupBalanceSort'),context);
  assert.deepEqual({...context.groupMatchBalance({score:'10x8 9x11 ST12x10'})},{sets1:2,sets2:1,games1:31,games2:29});
  assert.deepEqual({...context.groupMatchBalance({score:'60x58 10x8'})},{sets1:2,sets2:0,games1:70,games2:66});
  context.tournament=()=>({settings:{}});
  assert.deepEqual({...context.groupMatchBalance({score:'6x4 4x6 ST10x8'})},{sets1:2,sets2:1,games1:10,games2:10});
});

test('admin standings match public point differential and preserve both team names',()=>{
  const context={categoryScoreFormat:()=> 'BEST_OF_3_ST10',scoreTokens:(v)=>String(v).split(/\s+/)};
  vm.runInNewContext([
    section(adminPage,'function parseScoreDetailed','function buildScoreFromEditorFields'),
    section(adminPage,'function scoreCellParts','function compareScoreCells'),
    section(adminPage,'function groupScoreMetrics','function calculateTournamentGroupStandings'),
  ].join('\n'),context);
  assert.deepEqual({...context.groupScoreMetrics({placar:'10x8 9x11 ST12x10'},1)}, {setsFor:2,setsAgainst:1,gamesFor:31,gamesAgainst:29});
  assert.match(adminPage,/name: match\[nameField\] \|\| getPlayerName/);
});

test('signup accepts open-gender children and rejects wrong age or mixed pair',()=>{
  const context={categories:fixture.categories,startsOn:'2026-09-22'};
  vm.runInNewContext(section(registration,'function validateSelection','async function initCaptcha'),context);
  const category=(code)=>fixture.categories.find((c)=>c.code===code).id;
  const girl={key:'girl',full_name:'Menina',gender:'FEMALE',birth_date:'2017-01-01'};
  const boy={key:'boy',full_name:'Menino',gender:'MALE',birth_date:'2018-01-01'};
  const entries=[{category_id:category('PB-DI'),members:['girl','boy']}];
  assert.doesNotThrow(()=>context.validateSelection([girl,boy],entries));
  assert.throws(()=>context.validateSelection([girl,boy],[{category_id:category('PB-DJ'),members:['girl','boy']}]),/idade fora/);
  assert.throws(()=>context.validateSelection([girl,{...boy,gender:'FEMALE'}],[{category_id:category('PB-DX'),members:['girl','boy']}]),/homem e uma mulher/);
});

test('class-first signup reuses names, infers mixed slots and allows four classes without athlete CPF',()=>{
  const context={categories:fixture.categories,startsOn:'2026-09-22'};
  vm.runInNewContext(section(registration,'function nameKey','function collectBirths')+'\n'+section(registration,'function validateSelection','async function initCaptcha'),context);
  const category=(code)=>fixture.categories.find((c)=>c.code===code);
  const rows=[{category:category('PB-DM'),names:['Rômulo Teste','Parceiro Teste']},
    {category:category('PB-DX'),names:['romulo  teste','Parceira Teste']},
    {category:category('PB-SM'),names:['Rômulo Teste']},
    {category:category('PB-SI'),names:['Rômulo Teste']}];
  const signup=context.buildSignup(rows,{'romulo teste':'2017-01-01'});
  assert.equal(signup.athletes.length,3);
  assert.equal(signup.entries.length,4);
  assert.equal(signup.athletes[0].gender,'MALE');
  assert.equal(signup.athletes[2].gender,'FEMALE');
  assert.ok(signup.athletes.every((p)=>!p.cpf));
  assert.doesNotThrow(()=>context.validateSelection(signup.athletes,signup.entries));
  const noBirth=context.buildSignup(rows);
  assert.throws(()=>context.validateSelection(noBirth.athletes,noBirth.entries),/nascimento/);
  const repeated=context.buildSignup([...rows,{category:category('PB-DI'),names:['Rômulo Teste','Parceiro Teste']}],{'romulo teste':'2017-01-01'});
  assert.throws(()=>context.validateSelection(repeated.athletes,repeated.entries),/1 a 4/);
  assert.throws(()=>context.buildSignup([...rows,{category:category('PB-SF'),names:['Rômulo Teste']}]),/confira os nomes/);
  const doubled=context.buildSignup([rows[0],rows[0]]);
  assert.throws(()=>context.validateSelection(doubled.athletes,doubled.entries),/mesma classe/);
  assert.match(registration,/packagePrices=\[0,50,80,90,100\]/);
});

test('package API validates CAPTCHA before consuming identity limit or creating a charge',()=>{
  const edge=readFileSync(new URL('../supabase/functions/tournament-register/index.ts',import.meta.url),'utf8');
  const fn=section(edge,'async function handlePackageRegistration','async function handleFamilyRegistration');
  assert.ok(fn.indexOf('consumeSpatialNetworkLimit')<fn.indexOf('verifyTurnstile'));
  assert.ok(fn.indexOf('verifyTurnstile')<fn.indexOf('consume_tournament_registration_identity_rate_limit'));
  assert.ok(fn.indexOf('consume_tournament_registration_identity_rate_limit')<fn.indexOf('claim_tournament_package_checkout'));
  assert.match(fn,/isValidCpf/);
  assert.match(fn,/finishFamilyCheckout/);
});

test('package polling preserves names but never retains stale payment instructions',()=>{
  const context={};
  vm.runInNewContext(section(registration,'function mergePackagePayment','function renderPayment'),context);
  const previous={payment:{status:'PENDING',pix_payload:'pix-old'},registrations:[{category_id:'one',public_name:'Dupla A / B'}]};
  const update={payment:{status:'PENDING',pix_payload:'pix-current'},registrations:[{category_id:'one',status:'PENDING'}]};
  const merged=context.mergePackagePayment(previous,update);
  assert.equal(merged.registrations[0].public_name,'Dupla A / B');
  assert.equal(merged.payment.pix_payload,'pix-current');
  assert.equal(context.mergePackagePayment(previous,{payment:{status:'RECEIVED'},registrations:[]}).payment.pix_payload,undefined);
  assert.match(registration,/action:'package_payment_status'/);
  assert.match(registration,/const payable=!terminal&&status==='PENDING'&&Date.parse\(p.expires_at\)>Date.now\(\)/);
  const edge=readFileSync(new URL('../supabase/functions/tournament-register/index.ts',import.meta.url),'utf8');
  const fn=section(edge,'async function handlePaymentStatus','async function resumeTrackedSpatialAddon');
  assert.match(fn,/trackedCheckoutFromPayload/);
  assert.match(fn,/registration_mode !== "ATHLETE_PACKAGES"/);
  assert.match(fn,/trackingCheckoutResponse\(tracked.checkout, tracked.checkout.payment, true\)/);
});
