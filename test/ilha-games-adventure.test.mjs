import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NPCS,RIVALS,VENUES,EXPLORE,rewards,readAdventure,stageOf,advanceAdventure,canChallenge,objective,duelRules} from '../games/adventure.js';
import {LESSONS,createLesson,stepLesson,stepDuel} from '../games/lesson.js';
import {createPickleball,stepPickleball} from '../games/pickleball-model.js';
import {createGame,stepGame,INPUT,clamp,MAX_FRAMES} from '../supabase/functions/_shared/ilha-tennis-engine.js';
import {SPAWN,isWalkable,routeTo,nearestWalkable,followRoute,distance} from '../games/world-model.js';
import {BUILDINGS,DECOR,PICKLEBALL,PARKING,inRect} from '../games/scenery-data.js';

test('the cast keeps the requested fixed social locations',()=>{
 const npc=id=>NPCS.find(n=>n.id===id),bar=BUILDINGS.find(b=>b.id==='bar-wing');
 const felipe=npc('felipe');assert.ok(felipe.x>bar.x&&felipe.x<bar.x+bar.w&&felipe.y>bar.y+bar.h&&felipe.y<bar.y+bar.h+40);
 assert.ok(distance(felipe,npc('romulo'))<100);
 assert.ok(inRect(npc('gabriel').x,npc('gabriel').y,PARKING));
 for(const id of ['davi','lourenco']){const n=npc(id),x=Math.max(PICKLEBALL.x,Math.min(PICKLEBALL.x+PICKLEBALL.w,n.x)),y=Math.max(PICKLEBALL.y,Math.min(PICKLEBALL.y+PICKLEBALL.h,n.y));assert.ok(distance(n,{x,y})<50,id);}
 const evandro=npc('evandro');assert.equal(evandro.seated,true);assert.ok(DECOR.some(o=>o.kind==='bench'&&o.x===evandro.x&&evandro.y-o.y===16));
});

function readyForLesson(){let s=readAdventure(null);s=advanceAdventure(s,{type:'welcome'});for(const id of EXPLORE)s=advanceAdventure(s,{type:'visit-place',id});s=advanceAdventure(s,{type:'club-history'});return advanceAdventure(s,{type:'meet-coach'});}
test('Legado follows exploration, history, lesson, juice and Copa introduction',()=>{
 let s=readAdventure(null);assert.equal(stageOf(s),'welcome');assert.equal(objective(s).target,'leandro');
 s=advanceAdventure(s,{type:'lesson-passed'});assert.equal(s.trained,false);
 for(const id of RIVALS){assert.equal(canChallenge(s,id),false);s=advanceAdventure(s,{type:'match-won',id});}assert.equal(s.wins.length,0);
 s=advanceAdventure(s,{type:'welcome'});assert.equal(stageOf(s),'explore');
 s=advanceAdventure(s,{type:'meet-coach'});assert.equal(s.met,false);
 for(const id of EXPLORE)s=advanceAdventure(s,{type:'visit-place',id});
 assert.equal(stageOf(s),'history');s=advanceAdventure(s,{type:'club-history'});assert.equal(stageOf(s),'find_coach');
 s=advanceAdventure(s,{type:'meet-coach'});assert.equal(stageOf(s),'lesson');s=advanceAdventure(s,{type:'lesson-passed'});assert.equal(stageOf(s),'bar');
 assert.equal(canChallenge(s,'lourenco'),false);
 s=advanceAdventure(s,{type:'bar-visited'});assert.equal(stageOf(s),'cup');
 s=advanceAdventure(s,{type:'cup-introduced'});assert.equal(stageOf(s),'circuit');
 assert.equal(canChallenge(s,'lourenco'),false);
 assert.deepEqual(readAdventure(JSON.parse(JSON.stringify(s))),s);
});
test('opening tour only accepts the marked stop and exposes the next destination',()=>{
 let s=advanceAdventure(readAdventure(null),{type:'welcome'});
 assert.equal(objective(s).target,EXPLORE[0]);
 s=advanceAdventure(s,{type:'visit-place',id:EXPLORE[1]});
 assert.deepEqual(s.places,[]);
 for(const [index,id] of EXPLORE.entries()){
  s=advanceAdventure(s,{type:'visit-place',id});
  assert.deepEqual(s.places,EXPLORE.slice(0,index+1));
  if(index<EXPLORE.length-1)assert.equal(objective(s).target,EXPLORE[index+1]);
 }
 assert.equal(stageOf(s),'history');
 assert.equal(objective(s).target,'leandro');
});
test('bad saves reset safely, sidequests do not skip main missions, visits are unique',()=>{
 for(const value of [null,[],42,'bad',{version:2,champion:true,wins:['andre']},{version:2,met:true,trained:true}])assert.equal(stageOf(readAdventure(value)),'welcome');
 let s=advanceAdventure(readAdventure(null),{type:'pickleball-won'});assert.equal(stageOf(s),'welcome');assert.equal(s.pickleball,true);
 s=advanceAdventure(s,{type:'visit',id:'davi'});s=advanceAdventure(s,{type:'visit',id:'davi'});s=advanceAdventure(s,{type:'visit',id:'unknown'});assert.deepEqual(s.visited,['davi']);
});
test('old campaign migrates lesson and sidequest, keeping the prior trophy as a badge',()=>{
 const old={version:1,met:true,trained:true,champion:true,wins:['romulo','evandro','alexandre','leandro'],pickleball:true,visited:['renato','lia']};
 const s=readAdventure(old);assert.equal(s.begun,true);assert.equal(s.trained,true);assert.equal(s.pickleball,true);assert.equal(s.legacyChampion,true);assert.deepEqual(s.wins,[]);assert.equal(s.champion,false);assert.deepEqual(s.visited,['renato']);assert.ok(rewards(s).badges.includes('Taça da primeira temporada'));
});
test('unique rewards cannot be farmed and profile edits preserve progress',()=>{
 let s=advanceAdventure(readyForLesson(),{type:'lesson-passed'});s=advanceAdventure(s,{type:'bar-visited'});s=advanceAdventure(s,{type:'match-won',id:'lourenco'});s=advanceAdventure(s,{type:'rested'});s=advanceAdventure(s,{type:'pickleball-won'});s=advanceAdventure(s,{type:'visit',id:'beto'});
 const before=rewards(s);for(let i=0;i<5;i++)for(const event of [{type:'rested'},{type:'pickleball-won'},{type:'lesson-passed'},{type:'match-won',id:'lourenco'},{type:'visit',id:'beto'}])s=advanceAdventure(s,event);
 assert.deepEqual(rewards(s),before);s=advanceAdventure(s,{type:'profile',name:'  Ana  ',avatar:'player-f'});assert.equal(s.name,'Ana');assert.equal(s.avatar,'player-f');assert.deepEqual(rewards(s),before);
 assert.ok(before.attributes.every(([,value])=>value>=1&&value<=5));assert.ok(before.xp>0);
});
test('all twelve story NPCs have reachable arrival points and do not stand in obstacles',()=>{
 assert.equal(NPCS.length,12);assert.equal(new Set(NPCS.map(n=>n.color)).size,12);
 for(const n of NPCS){
  assert.ok(isWalkable(n.x,n.y),n.id);
  const arrival=nearestWalkable({x:n.x,y:n.y+32});assert.ok(arrival,n.id);
  const player={...SPAWN},route=routeTo(player,arrival);assert.ok(route.length,n.id);
  for(let frame=0;route.length&&frame<12000;frame++){followRoute(player,route,1/60);assert.ok(isWalkable(player.x,player.y));}
  assert.equal(route.length,0,n.id);assert.ok(distance(player,n)<n.radius,n.id);
 }
});
test('lesson waits for movement and manual serve, then teaches every shot with real returns',()=>{
 const game=createGame(88),lesson=createLesson(game);
 for(let i=0;i<600;i++)stepLesson(lesson,game,128,stepGame);assert.equal(lesson.index,0);
 for(let i=0;i<30;i++)stepLesson(lesson,game,0,stepGame);
 for(let i=0;i<70&&lesson.index===0;i++)stepLesson(lesson,game,255,stepGame);assert.equal(lesson.index,1);
 for(let i=0;i<600;i++)stepLesson(lesson,game,128,stepGame);assert.equal(lesson.index,1);assert.equal(game.shotCounts.serve,0);
 const visited=new Set([0,1]);
 for(let frame=0;frame<3000&&!lesson.completed;frame++){
  visited.add(lesson.index);const task=LESSONS[lesson.index];
  const target=game.ball.active&&game.ball.vy>0?game.ball.endX:game.player.x;
  let input=Math.round(clamp((target-94)/292*255,0,255));
  if(task.id==='serve')input|=INPUT.SERVE;
  input|={slice:INPUT.SLICE,lob:INPUT.LOB,drop:INPUT.DROP,special:INPUT.POWER}[task.id]||0;
  stepLesson(lesson,game,input,stepGame);
 }
 assert.ok(lesson.completed);assert.ok(game.done);assert.equal(visited.size,5);
 for(const shot of ['serve','normal','slice','drop'])assert.ok(game.shotCounts[shot]>0,shot);
 assert.ok(game.frame<MAX_FRAMES);
});
test('version 2 saves retain existing seals, optional visits and profile after the story reorder',()=>{
 const old={version:2,begun:true,name:'Kiko',avatar:'player-f',welcomed:true,places:VENUES,barVisited:true,met:true,trained:true,wins:['lourenco','gabriel'],pickleball:true};
 const s=readAdventure(old);assert.equal(s.version,6);assert.equal(s.name,'Kiko');assert.equal(s.avatar,'player-f');assert.deepEqual(s.wins,old.wins);assert.deepEqual(s.places,EXPLORE);assert.equal(s.pickleball,true);assert.equal(objective(s).target,'davi');
});
test('lesson tolerates misses and wrong shot selection, advancing only after the requested return',()=>{
 const game=createGame(47),lesson=createLesson(game);lesson.index=3;game.ball.active=false;
 for(let frame=0;frame<350;frame++)stepLesson(lesson,game,128,stepGame);
 assert.equal(lesson.index,3);assert.equal(lesson.completed,false);
 for(let frame=0;frame<400&&lesson.index===3;frame++)stepLesson(lesson,game,128|INPUT.SLICE,stepGame);
 assert.equal(lesson.index,4);
});
test('campaign tie-breaks can all be won by playing real inputs without timeout',()=>{
 for(const id of RIVALS){
  const game=createGame(4298),rules=duelRules(id);
  for(let frame=0;frame<36000&&!game.done;frame++){
   const landing=game.ball.active&&game.ball.vy>0?game.ball.endX:240;
   const input=Math.round(clamp((landing+(game.playerPoints%2?-18:18)-94)/292*255,0,255))|[0,INPUT.SLICE,INPUT.LOB,INPUT.DROP][game.returns%4]|(game.awaitingServe?INPUT.SERVE:0)|(game.charge>=3?INPUT.POWER:0);
   stepDuel(game,input,stepGame,rules);
  }
  assert.ok(game.done,id);assert.ok(game.playerPoints>game.cpuPoints,id);
  assert.ok(Math.max(game.playerPoints,game.cpuPoints)>=rules.points);assert.ok(Math.max(game.playerPoints,game.cpuPoints)<=rules.cap);assert.ok(game.frame<MAX_FRAMES);
  const after=structuredClone(game);stepDuel(game,128,stepGame,rules);assert.deepEqual(game,after);
 }
});
test('pickleball serves, moves, returns, scores and stops after five points',()=>{
 const s=createPickleball();stepPickleball(s,{axis:-1});assert.ok(s.player<.5);assert.ok(s.waiting);
 stepPickleball(s,{serve:true});assert.ok(s.ball.active);assert.equal(s.waiting,false);
 s.ball={x:.151,y:s.player,vx:-.5,vy:0,active:true};stepPickleball(s);assert.equal(s.returns,1);assert.ok(s.ball.vx>0);
 for(let i=0;i<5;i++){s.waiting=false;s.ball={x:.85,y:.11,vx:.5,vy:0,active:true};s.cpu=.8;stepPickleball(s);}
 assert.equal(s.playerPoints,5);assert.ok(s.done);const end=structuredClone(s);stepPickleball(s,{serve:true});assert.deepEqual(s,end);
});
test('pickleball can be won through ordinary movement and serve inputs without altering match state',()=>{
 const s=createPickleball();
 for(let frame=0;frame<10801&&!s.done;frame++)stepPickleball(s,{target:s.ball.y-.08,serve:true});
 assert.ok(s.done);assert.equal(s.playerPoints,5);assert.ok(s.returns>0);assert.ok(s.elapsed<180);
});
test('campaign and pickleball are local-only and do not write or version online ranking data',async()=>{
 for(const file of ['adventure.js','lesson.js','pickleball-model.js','pickleball.js']){
  const source=await readFile(new URL(`../games/${file}`,import.meta.url),'utf8');assert.doesNotMatch(source,/fetch\(|supabase|arcade-api|localStorage/);
 }
 const app=await readFile(new URL('../games/app.js',import.meta.url),'utf8');assert.match(app,/start\(true,\{kind:'duel'/);assert.match(app,/start\(true,\{kind:'lesson'/);assert.match(app,/else\{replay.push\(input\);stepGame\(game,input\);\}/);
 const build=await readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8');for(const module of ['adventure.js','lesson.js','pickleball-model.js','pickleball.js','adventure.css'])assert.ok(build.includes(module));
});
