import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {QUICK_VENUES,QUICK_CHARACTERS,quickCharacter,quickMatchOptions,quickPlayer,trainingInvite} from '../games/quick-play.js';
import {NPCS,readAdventure,RIVALS} from '../games/adventure.js';
import {AMBIENT_NPCS,ambientConversation,readAmbientChats,AMBIENT_CHAT_KEY} from '../games/ambient-npcs.js';
import {conversation} from '../games/campaign-story.js';
import {racketWorld,racketPoint,oldCourtCamera,heldBallOffset} from '../games/racket-renderer.js';
import {ABANDONED_COURT} from '../games/scenery-data.js';
import {gestureShot} from '../games/assisted-input.js';
import {createRacketMatch,stepRacketMatch} from '../games/racket-match.js';
import {drawAbandonedNet} from '../games/abandoned-court.js';

test('adventure avatars keep the entered name in free play; named cast selections stay themselves',()=>{
 const profile={begun:true,name:'Leandro',champion:true};
 for(const id of ['player-m','player-f']){assert.equal(quickPlayer(id,profile).name,'Leandro');assert.equal(quickPlayer(id,profile).champion,true);}
 for(const person of [...NPCS,...AMBIENT_NPCS])assert.equal(quickPlayer(person.id,profile).name,person.name);
 assert.equal(QUICK_CHARACTERS[0].name,'Atleta do Ilha');
});
test('every NPC offers a direct post-champion invitation, preserving the player and chosen court',()=>{
 const app=readFileSync(new URL('../games/app.js',import.meta.url),'utf8');let panel,config;
 const scope={campaign:readAdventure({version:6,begun:true,welcomed:true,history:true,met:true,trained:true,cup:true,barVisited:true,name:'Leandro',avatar:'player-f',wins:RIVALS,champion:true}),conversation,ambientConversation,readAmbientChats,AMBIENT_CHAT_KEY,QUICK_VENUES,trainingInvite,
  storage:{get:(_,fallback)=>fallback,set(){}},story:value=>{panel=value;},progress(){},closeWorldPanel(){},isRaining:()=>false,openQuickPlay(){},startQuickMatch:value=>{config=value;},runStoryAction(){}};
 runInNewContext(app.slice(app.indexOf('function offerTraining('),app.indexOf('function updateMission(')),scope);
 runInNewContext(app.slice(app.indexOf('function talkToNpc('),app.indexOf('function runStoryAction(')),scope);
 for(const person of [...NPCS,...AMBIENT_NPCS]){
  (person.ambient?scope.talkToAmbient:scope.talkToNpc)(person);assert.match(panel.actions[0].label,/Jogar com/);assert.equal(panel.actions[0].primary,true);
  panel.actions[0].run();const venues=panel.actions.slice(0,4);assert.equal(venues.length,4);
  for(const action of venues){action.run();assert.equal(config.player,'player-f');assert.equal(config.opponent,person.id);assert.equal(config.sport,QUICK_VENUES.find(v=>v.id===config.venue).sport);}
 }
});

test('old tennis camera, painted singles and inverse input agree in both orientations',()=>{
 const a=ABANDONED_COURT;
 assert.deepEqual(racketWorld(0,1,'tennis','old'),{x:a.x+22,y:a.y+53});
 assert.deepEqual(racketWorld(1,0,'tennis','old'),{x:a.x+a.w-22,y:a.y+a.h-53});
 for(const x of [0,.25,.5,1])for(const y of [0,.27,.5,.73,1]){const p=racketPoint(racketWorld(x,y,'tennis','old'),'tennis','old');assert.ok(Math.abs(p.x-x)<1e-8&&Math.abs(p.y-y)<1e-8);}
 for(const [w,h] of [[390,635],[844,300]]){const c=oldCourtCamera(w,h);assert.ok(Math.abs(c.w/c.h-w/h)<1e-8);assert.ok(c.x<a.x&&c.x+c.w>a.x+a.w);assert.ok(c.y<a.y&&c.y+c.h>a.y+a.h);}
 const calls=[],ctx=new Proxy({},{get:(_,key)=>(...args)=>calls.push([key,...args]),set:()=>true});drawAbandonedNet(ctx);
 assert.ok(calls.filter(c=>c[0]==='fillRect').length>80);
 assert.ok(calls.filter(c=>c[0]==='fillRect').every(([,x,y])=>x>=a.x&&x<a.x+a.w&&y>=a.y&&y<a.y+a.h));
});
test('horizontal tennis gestures rotate without changing tennis rules',()=>{
 const rect={left:0,top:0,width:390,height:650},start={x:150,y:300};
 assert.equal(gestureShot(start,{x:250,y:315},rect,'horizontal',null,true).validServe,true);
 assert.equal(gestureShot(start,{x:150,y:200},rect,'horizontal',null,true).validServe,false);
 assert.equal(gestureShot(start,{x:30,y:320},rect,'horizontal').shot,'normal');
 assert.equal(gestureShot(start,{x:170,y:420},rect,'horizontal').shot,'slice');
 for(const venue of QUICK_VENUES){
  const s=createRacketMatch({...quickMatchOptions({player:'michele',opponent:'malu',sport:venue.sport,venue:venue.id}),seed:99});
  assert.equal(s.sport,venue.sport);assert.equal(s.horizontal,venue.horizontal);assert.equal(s.points,venue.sport==='tennis'?7:5);
  for(let i=0;i<15000&&!s.done;i++)stepRacketMatch(s,s.awaitingServe?{serve:true}:{});
  assert.equal(s.done,true,venue.id);assert.ok(s.cpuPoints>s.playerPoints,venue.id);
 }
});
test('held ball stays on the side of the hand for every facing, with scale-aware offsets',()=>{
 for(const facing of ['up','down','left','right']){const p=heldBallOffset(facing,40),large=heldBallOffset(facing,40,2);assert.ok(Math.abs(p.x)>=9);assert.ok(p.y<0);assert.deepEqual(large,{x:p.x*2,y:p.y*2});}
});
test('finishing a quick game preserves campaign and shows both selected names and venue',async()=>{
 const app=readFileSync(new URL('../games/app.js',import.meta.url),'utf8');
 const source=app.slice(app.indexOf('async function finish(){'),app.indexOf('let dragPointer=null;'));
 const nodes=new Map(),element=()=>({textContent:'',hidden:false,classList:{toggle(){},remove(){}},dataset:{},before(){},focus(){}}),$=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const config={player:'michele',opponent:'malu',sport:'tennis',venue:'old'},game={playerPoints:7,cpuPoints:3,score:900,returns:8,bestRally:5};
 const scope={lesson:null,stop(){},showSection(id){assert.equal(id,'results');},game,run:null,$,fmt:String,quickRematchSetup:element(),localMatch:{kind:'quick',config},matchPlayer:()=>quickCharacter('michele'),opponent:quickCharacter('malu'),QUICK_VENUES,telemetry:{track(){}},progress(){throw Error('Quick play must not change campaign');},api(){throw Error('Quick play must not submit rankings');}};
 await runInNewContext(`${source};finish()`,scope);
 assert.equal($('resultTitle').textContent,'Michele venceu!');assert.match($('finalDetails').textContent,/Michele 7 × 3 Malu/);assert.match($('finalDetails').textContent,/Quadra velha/);assert.equal(scope.quickRematchSetup.hidden,false);
});
