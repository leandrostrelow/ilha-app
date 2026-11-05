import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NPCS,RIVALS,CLUES,QUESTS,POST_QUESTS,HEALTHY_IDS,readAdventure,advanceAdventure,stageOf,canChallenge,questItems,objective,taskComplete,pendingDelivery} from '../game2/adventure.js';
import {AMBIENT_NPCS} from '../game2/ambient-npcs.js';
import {conversation,OPENING,BOSS_WIN} from '../game2/campaign-story.js';
import {syncHalloween,isZombie} from '../game2/halloween-state.js';
import {medalCollection} from '../game2/medals.js';
import {ENTRY,isWalkable,routeTo,nearestWalkable,followRoute,distance} from '../game2/world-model.js';
import {SAVE_KEY,HISTORY_KEY,createCampaignSaves,exportSave,parseSave} from '../game2/campaign-save.js';
import {createRacketMatch,canPrepare} from '../game2/racket-match.js';
import {CHALLENGES,createChallenge,evaluateChallenge,stepChallenge,challengeStatus} from '../game2/halloween-challenges.js';
import {AVATAR_OPTIONS,defaultAppearance,normalizeAppearance} from '../game2/avatar-customizer.js';
const act=(s,type,extra={})=>advanceAdventure(s,{type,...extra});
function ready(skip=true){let s=act(null,'profile',{name:'Teste',avatar:'player-f'});for(const [type,extra]of [['welcome'],['felipe-clue'],['clue-received',{id:'purple-vial',from:'carolina'}],['club-history'],['meet-coach'],[skip?'lesson-skipped':'lesson-passed'],['bar-visited'],['cup-introduced']])s=act(s,type,extra);return s;}
function dose(s,id){s=act(s,'boss-request',{id});for(const item of QUESTS[id].items)s=act(s,'clue-received',{id:item,from:QUESTS[id].helper});s=act(s,'juice-collected',{id});return act(s,'juice-given',{id});}
function cure(s,id){return act(dose(s,id),'challenge-completed',{id,success:true});}
function deliver(s,id){for(const person of POST_QUESTS[id].route)s=act(s,'witness-heard',{id,person});return s;}
function simulation(id){const game=createRacketMatch({assisted:true,difficulty:CHALLENGES[id].difficulty}),challenge=createChallenge(id,game);return {game,challenge};}
function score(pair,side){const {game:s,challenge:c}=pair,before={playerPoints:s.playerPoints,cpuPoints:s.cpuPoints,elapsed:s.elapsed};s[side+'Points']++;s.ball.active=false;s.rally=0;evaluateChallenge(c,s,before);}
test('Original tennis physics, tutorial and gesture modules are unchanged',async()=>{
 for(const file of ['racket-match.js','racket-renderer.js','racket-lesson.js','match-input.js','assisted-input.js','lesson.js','pickleball-model.js','court-view.js'])assert.equal(await readFile(new URL('../game2/'+file,import.meta.url),'utf8'),await readFile(new URL('../games/'+file,import.meta.url),'utf8'),file);
});
test('Opening explains conscious infection and healthy helpers; Renato offers both routes',()=>{
 assert.ok(OPENING.some(p=>p[1].includes('ainda')||p[1].includes('Ainda')));assert.ok(OPENING.some(p=>p[1].includes('NÃO COME NADA')));
 const s=ready();assert.ok(s.lessonSkipped);assert.ok(s.trained);assert.equal(ready(false).lessonSkipped,false);
 assert.equal(act(null,'lesson-skipped').trained,false);
 let pre=act(null,'welcome');pre=act(pre,'felipe-clue');pre=act(pre,'clue-received',{id:'purple-vial',from:'carolina'});pre=act(pre,'club-history');
 const options=conversation(pre,'renato').actions;assert.ok(options.some(a=>a.event?.type==='lesson-skipped'));assert.ok(options.some(a=>a.lesson==='renato'));
 assert.equal(objective(act(pre,'lesson-skipped')).target,'felipe');
});
test('Six new treatment opponents include five who were not Legado campaign bosses',()=>{
 assert.deepEqual(RIVALS,['gabriel','vanessa','higor','michele','larissa','scarlt']);assert.equal(NPCS.length+AMBIENT_NPCS.length,25);
 assert.deepEqual(QUESTS.gabriel.items,['prop-leg']);assert.ok(CLUES.find(c=>c.id==='prop-leg').description.includes('NÃO COMESTÍVEL'));
 for(const id of ['carolina','bernado','benicio','maisa','betinho'])assert.ok(HEALTHY_IDS.includes(id));
});
test('All people and mission objects are reachable without wall clipping',()=>{
 for(const target of [...NPCS,...AMBIENT_NPCS,...CLUES]){
  assert.ok(isWalkable(target.x,target.y),target.id+' off path');const goal=target.kind==='npc'?nearestWalkable({x:target.x,y:target.y+24}):target,p={...ENTRY},route=routeTo(p,goal);
  assert.ok(route.length,target.id+' missing route');for(let n=0;n<9000&&route.length;n++){followRoute(p,route,1/60);assert.ok(isWalkable(p.x,p.y),target.id+' wall');}
  assert.equal(route.length,0,target.id+' stuck');assert.ok(distance(p,target)<38,target.id+' outside reach');
 }
});
test('Full chain: conversation, juice, challenge, witnesses and child referral',()=>{
 let s=ready();
 for(const id of RIVALS){
  assert.equal(canChallenge(s,id),false);assert.deepEqual(act(s,'challenge-completed',{id,success:true}).wins,s.wins);
  s=act(s,'boss-request',{id});for(const item of QUESTS[id].items)s=act(s,'clue-received',{id:item,from:QUESTS[id].helper});
  assert.ok(taskComplete(s,id));assert.equal(objective(s).target,'felipe');s=act(s,'juice-collected',{id});assert.equal(s.juiceFor,id);assert.equal(canChallenge(s,id),false);
  assert.ok(conversation(s,id).actions.some(a=>a.event?.type==='juice-given'));
  s=act(s,'juice-given',{id});assert.equal(s.juiceFor,null);assert.ok(canChallenge(s,id));assert.ok(conversation(s,id).actions.some(a=>a.duel===id));assert.deepEqual(act(s,'challenge-completed',{id,success:false}).wins,s.wins);
  s=act(s,'challenge-completed',{id,success:true});assert.equal(pendingDelivery(s),id);assert.ok(BOSS_WIN[id]);assert.deepEqual(readAdventure(JSON.parse(JSON.stringify(s))),s);
  const next=RIVALS[s.wins.length];assert.deepEqual(act(s,'boss-request',{id:next}).requests,s.requests);
  assert.deepEqual(act(s,'witness-heard',{id,person:'wrong-person'}).deliveries,s.deliveries);
  s=deliver(s,id);assert.equal(pendingDelivery(s),null);
  if(next){assert.equal(objective(s).target,POST_QUESTS[id].recipient);assert.ok(conversation(s,POST_QUESTS[id].recipient).actions.some(a=>a.event?.type==='boss-request'&&a.event.id===next));}
 }
 assert.equal(medalCollection(s).filter(m=>m.earned).length,6);assert.equal(stageOf(s),'final-guide');assert.equal(act(s,'crowned').champion,false);
 s=act(s,'accuse',{id:s.caseId});assert.equal(stageOf(s),'final-match');s=act(s,'final-won',{id:s.caseId,success:true});assert.equal(stageOf(s),'final-thanks');s=act(s,'final-briefing');assert.equal(objective(s).target,'bar');s=act(s,'crowned');assert.ok(s.champion);assert.ok(act(s,'credits-seen').creditsSeen);
});
test('Juice is target-bound, survives failures and cannot be collected or delivered early',()=>{
 let s=ready();assert.equal(act(s,'juice-collected',{id:'gabriel'}).juiceFor,null);s=act(s,'boss-request',{id:'gabriel'});assert.equal(act(s,'juice-collected',{id:'gabriel'}).juiceFor,null);
 s=act(s,'clue-received',{id:'prop-leg',from:'lourenco'});s=act(s,'juice-collected',{id:'gabriel'});assert.equal(act(s,'juice-given',{id:'vanessa'}).juiceFor,'gabriel');
 s=act(s,'juice-given',{id:'gabriel'});assert.deepEqual(act(s,'juice-given',{id:'gabriel'}).dosed,['gabriel']);assert.equal(act(s,'juice-collected',{id:'gabriel'}).juiceFor,null);
 s=act(s,'challenge-completed',{id:'gabriel',success:false});assert.ok(canChallenge(s,'gabriel'));assert.equal(s.dosed.length,1);
 assert.equal(act(s,'match-won',{id:'gabriel'}).wins.length,0);assert.equal(act(s,'pickleball-won').wins.length,0);
 assert.equal(act(s,'clue-collected',{id:'old-ledger'}).clues.includes('old-ledger'),false);
});
test('Only infected people are green; each actual cure restores that person',()=>{
 let s=ready();syncHalloween(s);for(const id of HEALTHY_IDS)assert.equal(isZombie({id}),false,id);
 for(const id of RIVALS)assert.equal(isZombie({id}),true,id);
 for(const id of RIVALS){s=cure(s,id);syncHalloween(s);assert.equal(isZombie({id}),false);s=deliver(s,id);}
 assert.equal(isZombie({id:'beto'}),true);s=act(s,'accuse',{id:s.caseId});s=act(s,'final-won',{id:s.caseId,success:true});s=act(act(s,'final-briefing'),'crowned');syncHalloween(s);assert.ok([...NPCS,...AMBIENT_NPCS].every(n=>!isZombie(n)));syncHalloween(readAdventure(null));
});
test('Four-point win and 4-0 objectives do not inherit tennis win-by-two or ignore conceded points',()=>{
 let p=simulation('gabriel');score(p,'cpu');score(p,'player');score(p,'cpu');score(p,'player');score(p,'cpu');score(p,'player');assert.equal(p.game.done,false);score(p,'player');assert.equal(p.challenge.succeeded,true);
 p=simulation('vanessa');for(let i=0;i<3;i++)score(p,'player');score(p,'cpu');assert.equal(p.game.done,true);assert.equal(p.challenge.succeeded,false);
 p=simulation('vanessa');for(let i=0;i<4;i++)score(p,'player');assert.equal(p.challenge.succeeded,true);
});
test('Losing intentionally succeeds only at 0-3; a player point fails instead of curing',()=>{
 let p=simulation('larissa');for(let i=0;i<3;i++)score(p,'cpu');assert.equal(p.challenge.succeeded,true);assert.ok(p.game.playerPoints<p.game.cpuPoints);
 p=simulation('larissa');score(p,'player');assert.equal(p.challenge.finished,true);assert.equal(p.challenge.succeeded,false);
});
test('Streak resets on opponent point; comeback starts behind and requires six',()=>{
 let p=simulation('michele');score(p,'player');score(p,'player');score(p,'cpu');assert.equal(p.challenge.streak,0);for(let i=0;i<3;i++)score(p,'player');assert.equal(p.challenge.succeeded,true);
 p=simulation('michele');for(let i=0;i<5;i++)score(p,'cpu');assert.equal(p.challenge.succeeded,false);assert.equal(p.game.done,true);
 p=simulation('scarlt');assert.equal(p.game.cpuPoints,3);for(let i=0;i<6;i++)score(p,'player');assert.equal(p.challenge.succeeded,true);
 p=simulation('scarlt');for(let i=0;i<3;i++)score(p,'cpu');assert.equal(p.challenge.succeeded,false);
});
test('Rally timer ignores serve/wait, resets on a point, and requires one continuous exchange',()=>{
 const p=simulation('higor'),s=p.game,c=p.challenge;
 function tick({active=true,serve=false,rally=2,seconds=1/60}={}){const before={playerPoints:s.playerPoints,cpuPoints:s.cpuPoints,elapsed:s.elapsed};s.elapsed+=seconds;s.ball.active=active;s.ball.serve=serve;s.rally=rally;evaluateChallenge(c,s,before);}
 for(let i=0;i<900;i++)tick({active:false});assert.equal(c.seconds,0);
 for(let i=0;i<900;i++)tick({serve:true});assert.equal(c.seconds,0);
 for(let i=0;i<360;i++)tick();assert.ok(c.seconds>5.9&&c.seconds<6.1);
 score(p,'cpu');assert.equal(c.seconds,0);assert.equal(c.finished,false);
 for(let i=0;i<720;i++)tick();assert.equal(c.succeeded,true);assert.ok(challengeStatus(c,s).includes('Doze'));
});
test('Actual engine can give Larissa a clean win without special-case score fabrication',()=>{
 const p=simulation('larissa');
 for(let f=0;f<15000&&!p.game.done;f++)stepChallenge(p.challenge,p.game,{serve:p.game.awaitingServe,serveGesture:{aim:0,power:.45}});
 assert.equal(p.game.done,true);assert.equal(p.game.playerPoints,0);assert.equal(p.game.cpuPoints,3);assert.equal(p.challenge.succeeded,true);
});
test('Higor cooperative returns allow a real twelve-second rally with player-prepared strokes',()=>{
 const p=simulation('higor');
 for(let f=0;f<6000&&!p.game.done;f++)stepChallenge(p.challenge,p.game,{serve:p.game.awaitingServe,serveGesture:{aim:0,power:.45},...(canPrepare(p.game)?{stroke:{shot:'normal',aim:0,power:.4}}:{})});
 assert.equal(p.challenge.succeeded,true);assert.ok(p.challenge.bestSeconds>=12);assert.equal(p.game.cpuPoints,0);assert.ok(p.game.returns>3);
});
test('v6 saves migrate chapter progress, profile and completed ending without touching Legado',async()=>{
 const legacy={edition:'misterio-ilha',version:6,begun:true,name:'Veterana',avatar:'player-f',welcomed:true,felipeIntro:true,clues:['purple-vial','ball-1'],history:true,met:true,trained:true,barVisited:true,cup:true,wins:['gabriel','neco','davi'],requests:['gabriel','neco','davi','beto']};
 let s=readAdventure(legacy);assert.equal(s.version,10);assert.equal(s.name,'Veterana');assert.equal(s.avatar,'player-f');assert.equal(s.appearance.gender,'female');assert.deepEqual(s.wins,RIVALS.slice(0,3));assert.deepEqual(s.deliveries,s.wins);assert.equal(objective(s).target,'bernado');assert.ok(s.migratedFrom6);
 s=readAdventure({...legacy,wins:['gabriel','neco','davi','beto','andre','romulo'],finalBriefing:true,champion:true,creditsSeen:true});assert.ok(s.champion);assert.ok(s.creditsSeen);
 const records=new Map([[SAVE_KEY,JSON.stringify(legacy)],['ilha-games:adventure:v1','ORIGINAL']]),local={getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v)},mirror={read:async()=>[],write:async()=>true},saves=createCampaignSaves({local,mirror});const restored=await saves.ready();assert.equal(restored.version,10);assert.ok(saves.save(restored));await saves.flush();assert.equal(records.get('ilha-games:adventure:v1'),'ORIGINAL');assert.ok(records.has(HISTORY_KEY));assert.deepEqual(parseSave(exportSave(restored)).campaign,restored);
 const broken=JSON.parse(exportSave(restored));broken.campaign.name='Tampered';assert.throws(()=>parseSave(JSON.stringify(broken)));
});
test('retired creator saves retain progress and the fixed duo can switch gender',async()=>{
 const custom=normalizeAppearance({gender:'female',skin:AVATAR_OPTIONS.skins[3],hair:'long',hairColor:'#d6a55d',beard:'none',top:'stripe',shirt:AVATAR_OPTIONS.shirts[2],cap:'back',racket:AVATAR_OPTIONS.rackets[3]},'player-f');
 let s=act(null,'profile',{name:'Lia',avatar:'player-f',appearance:custom});assert.equal(s.avatar,'player-f');assert.deepEqual(s.appearance,custom);
 const invalid=normalizeAppearance({gender:'robot',skin:'red',hair:'fire',shirt:'none',racket:'laser'},'player-m');assert.deepEqual(invalid,defaultAppearance('male'));
 s=act(s,'profile',{name:'Lia',avatar:'player-m'});assert.equal(readAdventure(s).avatar,'player-m');assert.equal(readAdventure(s).name,'Lia');
 const [html,characters]=await Promise.all(['index.html','characters.js'].map(f=>readFile(new URL('../game2/'+f,import.meta.url),'utf8')));
 assert.match(html,/data-gender="player-m"/);assert.match(html,/data-gender="player-f"/);assert.doesNotMatch(html,/avatarPreview/);assert.doesNotMatch(characters,/drawCustomAvatar/);
 for(const avatar of ['player-m','player-f'])for(const variant of [0,1,2]){const profile=act(s,'profile',{name:'Teste',avatar,variant});const restored=readAdventure(parseSave(exportSave(profile)).campaign);assert.equal(restored.variant,variant);assert.equal(restored.avatar,avatar);assert.equal(restored.name,'Teste');}
 assert.equal(readAdventure({...s,variant:99}).variant,0);
});
test('Malformed storage cannot crash or skip required preparation',()=>{
 for(const v of [null,[],{},'bad',{edition:'misterio-ilha',version:7,wins:{},requests:'scarlt',dosed:6,clues:[]}])assert.doesNotThrow(()=>readAdventure(v));
 assert.equal(readAdventure({edition:'misterio-ilha',version:7,champion:true,wins:RIVALS}).champion,false);
 assert.equal(readAdventure({version:7,champion:true}).champion,false);
});
test('App routes ambient patients into missions and evaluates challenge success, not highest score',async()=>{
 const app=await readFile(new URL('../game2/app.js',import.meta.url),'utf8');
 assert.match(app,/function talkToAmbient\(person\)\{[^}]+return talkToNpc\(person\)/);assert.ok(app.includes("challenge?.succeeded===true"));assert.ok(app.includes("stepChallenge(challenge,game,manual)"));
 assert.ok(app.includes("type:'challenge-completed'"));assert.ok(!app.includes('fetch(API'));
 const html=await readFile(new URL('../game2/index.html',import.meta.url),'utf8');assert.ok(html.includes('halloweenChallengeHud'));
});
