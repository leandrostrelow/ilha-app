import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {readAdventure,advanceAdventure,EXPLORE,RIVALS,NPCS,FOICE,GABRIEL_BALLS,questItems,canChallenge,objective,stageOf,duelRules,rewards} from '../games/adventure.js';
import {ETIQUETTE_LESSONS,createEtiquetteQuiz,answerEtiquetteQuiz,gradeEtiquetteQuiz} from '../games/club-etiquette.js';
import {medalCollection} from '../games/medals.js';
import {conversation,PARTY,CREDITS,POSTGAME,BOSS_WIN} from '../games/campaign-story.js';
import {createLesson,lessonTasks,stepLesson,stepDuel,tiebreakFinished,tiebreakServer} from '../games/lesson.js';
import {createGame,stepGame,INPUT,clamp,MAX_FRAMES} from '../supabase/functions/_shared/ilha-tennis-engine.js';
import {createPickleball,stepPickleball} from '../games/pickleball-model.js';
import {SPAWN,PLACES,isWalkable,routeTo,followRoute,distance,nearbyTarget} from '../games/world-model.js';

const event=(s,type,id)=>advanceAdventure(s,{type,id});
function lessonRun(extra=false){
 const game=createGame(88),lesson=createLesson(game,extra);
 for(let i=0;i<5000&&!lesson.completed;i++){
  const task=lessonTasks(lesson)[lesson.index];
  const input=(task.id==='move'?0:128)|({serve:INPUT.SERVE,slice:INPUT.SLICE,drop:INPUT.DROP}[task.id]||0);
  stepLesson(lesson,game,input,stepGame);
 }
 assert.ok(lesson.completed);return game;
}
function duelRun(id){
 const game=createGame(4298);
 for(let frame=0;frame<36000&&!game.done;frame++){
  const landing=game.ball.active&&game.ball.vy>0?game.ball.endX:240;
  const input=Math.round(clamp((landing+(game.playerPoints%2?-18:18)-94)/292*255,0,255))|[0,INPUT.SLICE,INPUT.LOB,INPUT.DROP][game.returns%4]|(game.awaitingServe?INPUT.SERVE:0)|(game.charge>=3?INPUT.POWER:0);
  stepDuel(game,input,stepGame,duelRules(id));
 }
 assert.ok(game.done);assert.ok(game.playerPoints>game.cpuPoints);return game;
}
function startCup(){
 let s=event(readAdventure(null),'welcome');for(const id of EXPLORE)s=event(s,'visit-place',id);
 for(const type of ['club-history','meet-coach','lesson-passed','bar-visited','cup-introduced'])s=event(s,type);
 return s;
}
test('complete approved story uses real lessons, pickleball and six real tie-breaks, then party and credits',()=>{
 let s=readAdventure(null);
 const choose=id=>{const dialogue=conversation(s,id),action=dialogue.actions[0];assert.ok(dialogue.pages.every(p=>p.length>20));if(action.event)s=advanceAdventure(s,action.event);return action;};
 assert.equal(choose('leandro').mission,true);assert.equal(stageOf(s),'explore');
 for(const id of EXPLORE)s=event(s,'visit-place',id);
 assert.equal(choose('leandro').route,'renato');assert.equal(choose('renato').lesson,'renato');
 lessonRun();s=event(s,'lesson-passed');assert.equal(choose('felipe').route,'leandro');assert.equal(choose('leandro').route,'lourenco');
 for(const id of RIVALS){
  assert.equal(canChallenge(s,id),false,id);
  if(id==='romulo'){
   assert.deepEqual(questItems(s),[]);assert.equal(choose('leandro').route,'foice');assert.equal(questItems(s).length,1);
   s=event(s,'foice-collected');assert.deepEqual(questItems(s),[]);
  }else{
   choose(id);assert.ok(s.requests.includes(id));
   if(id==='lourenco'){
    const p=createPickleball();for(let frame=0;frame<10801&&!p.done;frame++)stepPickleball(p,{target:p.ball.y-.08,serve:true});assert.equal(p.playerPoints,5);s=event(s,'pickleball-won');
   }else if(id==='gabriel'){
    assert.equal(questItems(s).length,3);assert.equal(conversation(s,'felipe').actions[0].event,undefined);
    for(const ball of GABRIEL_BALLS){s=event(s,'ball-collected',ball.id);assert.equal(questItems(s).length,3-s.balls.length);assert.equal(canChallenge(s,id),false);s=readAdventure(JSON.parse(JSON.stringify(s)));}
    assert.equal(objective(s).target,'gabriel');assert.equal(choose(id).again,true);assert.equal(s.delivered.includes('gabriel'),true);
   }else if(id==='evandro'){
    assert.equal(choose('felipe').route,id);assert.equal(s.delivery,id);assert.equal(canChallenge(s,id),false);assert.equal(choose(id).again,true);assert.equal(s.delivery,null);
   }else if(id==='davi'){
    assert.equal(choose('emerson').theory,true);const answers=ETIQUETTE_LESSONS.slice(0,4).map(q=>({id:q.id,choice:q.answer}));s=advanceAdventure(s,{type:'etiquette-passed',answers});
   }else if(id==='andre'){
    assert.equal(conversation(s,'beto').pages.length,5);assert.equal(choose('beto').route,'andre');assert.ok(s.betoStory);
    assert.equal(canChallenge(s,id),false);assert.equal(choose('andre').event.type,'rain-wait');
    for(const person of ['felipe','malu','vanessa','kalinca'])s=event(s,'rain-chat',person);
   }
  }
  assert.equal(canChallenge(s,id),true);assert.equal(choose(id).duel,id);duelRun(id);s=event(s,'match-won',id);
  assert.deepEqual(readAdventure(JSON.parse(JSON.stringify(s))),s,'save/reload between every boss');
 }
 assert.equal(stageOf(s),'final-guide');assert.equal(objective(s).target,'leandro');
 assert.equal(conversation(s,'felipe').actions.some(action=>action.party),false);
 const ceremony=choose('leandro');assert.equal(ceremony.route,'bar');assert.equal(ceremony.event.type,'final-briefing');
 assert.equal(stageOf(s),'celebrate');assert.equal(objective(s).target,'bar');assert.equal(choose('felipe').party,true);
 s=event(s,'crowned');assert.equal(s.champion,true);assert.equal(s.creditsSeen,false);
 const wonXP=rewards(s).xp;s=event(s,'credits-seen');s=event(s,'crowned');assert.equal(rewards(s).xp,wonXP);assert.equal(s.creditsSeen,true);
 for(const id of RIVALS){assert.ok(canChallenge(s,id));assert.equal(conversation(s,id).actions[0].duel,id);}
 assert.equal(conversation(s,'leandro').actions[0].party,true);
 assert.equal(medalCollection(s).filter(m=>m.earned&&!m.extra).length,6);assert.equal(medalCollection(s).filter(m=>m.earned&&m.extra).length,2);
});
test('completed old saves skip the new briefing without losing the trophy',()=>{
 const s=readAdventure({version:6,welcomed:true,history:true,met:true,trained:true,barVisited:true,cup:true,wins:RIVALS,champion:true,creditsSeen:true});
 assert.equal(s.finalBriefing,true);assert.equal(stageOf(s),'champion');assert.equal(s.champion,true);assert.equal(s.creditsSeen,true);
});
test('early visits, uncollected drinks, Beto and foice cannot bypass story gates',()=>{
 let s=startCup();
 for(const [type,id] of [['beto-story-heard'],['foice-revealed'],['foice-collected'],['extra-lesson-passed'],['drink-collected','gabriel'],['drink-delivered','gabriel'],['boss-request','andre'],['crowned'],['credits-seen']])s=event(s,type,id);
 assert.equal(s.betoStory,false);assert.equal(s.extraTrained,false);assert.equal(s.foice,false);assert.equal(s.foiceQuest,false);assert.equal(s.champion,false);assert.equal(s.delivery,null);assert.equal(s.delivered.length,0);assert.equal(s.requests.length,0);
 for(const id of RIVALS)s=event(s,'match-won',id);assert.equal(s.wins.length,0);
});
test('tie-break requires two-point lead, caps at 11 and follows 1-2-2 serve order',()=>{
 for(const [a,b,end] of [[6,0,false],[7,0,true],[7,6,false],[8,6,true],[9,8,false],[10,10,false],[11,10,true],[10,11,true]])assert.equal(tiebreakFinished(a,b),end,`${a}-${b}`);
 assert.deepEqual(Array.from({length:9},(_,i)=>tiebreakServer(i)),['player','cpu','cpu','player','player','cpu','cpu','player','player']);
 const g=createGame(1);g.delay=1;
 for(let i=0;i<MAX_FRAMES*2;i++)stepDuel(g,128,stepGame,duelRules('romulo'));
 assert.equal(g.done,false);assert.equal(g.awaitingServe,true);assert.equal(g.playerPoints,0);assert.equal(g.cpuPoints,0);assert.ok(g.campaignFrames>MAX_FRAMES);
 for(const [a,b,end] of [[7,6,false],[8,6,true],[10,10,false],[11,10,true]]){const g=createGame(1);g.playerPoints=a;g.cpuPoints=b;stepDuel(g,128,stepGame,duelRules('lourenco'));assert.equal(g.done,end);}
});
test('conditional foice is reachable, interactable and disappears after collection',()=>{
 assert.ok(isWalkable(FOICE.x,FOICE.y));const player={...SPAWN},route=routeTo(player,FOICE);assert.ok(route.length);
 for(let i=0;i<12000&&route.length;i++)followRoute(player,route,1/60);
 assert.ok(distance(player,FOICE)<FOICE.radius);assert.equal(nearbyTarget(player,NPCS,[FOICE]).id,'foice');assert.notEqual(nearbyTarget(player,NPCS,[])?.id,'foice');
});
test('every existing v3 progress point preserves wins and reaches an actionable mission',()=>{
 for(let wins=0;wins<=6;wins++){
  const s=readAdventure({version:3,name:'Kiko',welcomed:true,met:true,trained:true,barVisited:true,wins:RIVALS.slice(0,wins),champion:wins===6});
  assert.equal(s.version,6);assert.equal(s.wins.length,wins);assert.equal(s.name,'Kiko');assert.ok(s.cup);assert.ok(objective(s).target);assert.deepEqual(readAdventure(s),s);
  if(wins===5){assert.equal(objective(s).target,'leandro');assert.equal(questItems(s).length,0);}
 }
});
test('balls are individually reachable, cannot be duplicated or traded for the foice',()=>{
 let s=startCup();assert.deepEqual(questItems(s),[]);
 s=event(s,'ball-collected',GABRIEL_BALLS[0].id);assert.deepEqual(s.balls,[]);
 s=event(s,'boss-request','lourenco');s=event(s,'pickleball-won');s=event(s,'match-won','lourenco');s=event(s,'boss-request','gabriel');
 s=event(s,'drink-collected','gabriel');assert.equal(s.delivery,null);
 for(const b of GABRIEL_BALLS){
  const p={...SPAWN},route=routeTo(p,b);assert.ok(route.length);
  for(let i=0;i<12000&&route.length;i++)followRoute(p,route,1/60);
  assert.ok(distance(p,b)<b.radius);assert.equal(nearbyTarget(p,NPCS,questItems(s),b.id)?.id,b.id);
  const count=s.balls.length;s=event(s,'ball-collected',b.id);s=event(s,'ball-collected',b.id);assert.equal(s.balls.length,count+1);
  s=event(s,'foice-collected');assert.equal(s.foice,false);
 }
 assert.equal(canChallenge(s,'gabriel'),false);s=event(s,'balls-delivered');assert.equal(canChallenge(s,'gabriel'),true);assert.deepEqual(questItems(s),[]);
});
test('ball collection continuation closes the panel, and the third ball routes to Gabriel',()=>{
 const source=readFileSync(new URL('../games/app.js',import.meta.url),'utf8');
 const handler=source.slice(source.indexOf('function interactWith(target){'),source.indexOf('function openWorldMap(){'));
 let panel,closed=0,destination=null;
 const scope={campaign:readAdventure({...startCup(),wins:['lourenco'],requests:['lourenco','gabriel']}),questItems,
  story:value=>{panel=value;},progress:e=>{scope.campaign=advanceAdventure(scope.campaign,e);},initAudio:()=>{},beep:()=>{},
  closeWorldPanel:()=>{closed++;},goTo:target=>{destination=target;},npc:id=>NPCS.find(n=>n.id===id),visitExplorePlace:()=>false};
 const interact=runInNewContext(`${handler}; interactWith`,scope);
 for(const [i,ball]of GABRIEL_BALLS.entries()){
  interact(ball);assert.equal(panel.actions[0].label,'Pegar bolinha');panel.actions[0].run();
  assert.equal(scope.campaign.balls.length,i+1);assert.equal(panel.title,`${i+1}/3 bolinhas encontradas!`);
  panel.actions[0].run();assert.equal(closed,Math.min(i+1,2));
 }
 assert.equal(destination.id,'gabriel');
});
test('quiz draws four distinct taught questions, requires three correct and never counts an answer twice',()=>{
 for(const seed of [0,.2,.6,.99]){
  let quiz=createEtiquetteQuiz(()=>seed);assert.equal(new Set(quiz.questions.map(q=>q.id)).size,4);
  const first=quiz.questions[0];quiz=answerEtiquetteQuiz(quiz,first.id,first.answer);assert.equal(answerEtiquetteQuiz(quiz,first.id,first.answer),quiz);
 }
 for(let correct=0;correct<=4;correct++){
  const answers=ETIQUETTE_LESSONS.slice(0,4).map((q,i)=>({id:q.id,choice:i<correct?q.answer:(q.answer+1)%3}));
  const grade=gradeEtiquetteQuiz(answers);assert.equal(grade.score,correct);assert.equal(grade.passed,correct>=3);
  let s=readAdventure({...startCup(),wins:['lourenco','gabriel'],requests:['davi']});s=advanceAdventure(s,{type:'etiquette-passed',answers});assert.equal(canChallenge(s,'davi'),correct>=3);
 }
 for(const answers of [[],Array(4).fill({id:'quiet',choice:1}),[{id:'fake',choice:0}]])assert.equal(gradeEtiquetteQuiz(answers).passed,false);
});
test('v4 saves migrate collected and delivered Gabriel quests and preserve completed lessons and trophies',()=>{
 const base={...startCup(),version:4,wins:['lourenco'],requests:['lourenco','gabriel']};
 for(const v of [{...base},{...base,delivery:'gabriel'},{...base,delivered:['gabriel']},{...base,wins:['lourenco','gabriel'],requests:['lourenco','gabriel','davi'],extraTrained:true},{...base,wins:[...RIVALS],champion:true,creditsSeen:true}]){
  const s=readAdventure(v);assert.deepEqual(s.wins,v.wins);assert.deepEqual(readAdventure(s),s);assert.ok(objective(s).target);
  if(v.delivery==='gabriel'){assert.equal(s.balls.length,3);assert.equal(objective(s).target,'gabriel');}
  if(v.delivered?.includes('gabriel'))assert.equal(canChallenge(s,'gabriel'),true);
  if(v.extraTrained)assert.equal(canChallenge(s,'davi'),true);
  if(v.champion)assert.equal(s.champion,true);
 }
});
test('party gives all 12 people a line and endgame has replayable comic credits',()=>{
 assert.equal(nearbyTarget(PLACES.find(p=>p.id==='bar'),NPCS,[],'bar').id,'bar','party action must take priority over Felipe at the bar');
 assert.deepEqual(new Set(PARTY.map(p=>p[0])),new Set(NPCS.map(n=>n.id)));
 assert.equal(CREDITS.length,21);for(const n of NPCS)assert.ok(POSTGAME[n.id].length>25);
 for(const id of RIVALS)assert.ok(BOSS_WIN[id].length>45);
});
