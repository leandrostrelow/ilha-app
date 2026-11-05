import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {readAdventure,advanceAdventure,canChallenge,isRaining,objective,NPCS,RIVALS,EXPLORE,RAIN_CHAT_IDS,RAIN_CHAT_ROUTE} from '../games/adventure.js';
import {conversation} from '../games/campaign-story.js';
import {AMBIENT_NPCS,ambientConversation,readAmbientChats,AMBIENT_CHAT_KEY} from '../games/ambient-npcs.js';
import {ENDING_SHOTS,ENDING_CAST,ENDING_STAGE,ENDING_FILM_DURATION,endingShotAt,endingComposition} from '../games/ending-film.js';
import {drawClubRain} from '../games/club-rain.js';

const beforeBeto=()=>readAdventure({version:6,welcomed:true,met:true,trained:true,history:true,barVisited:true,cup:true,places:EXPLORE,wins:RIVALS.slice(0,4),requests:RIVALS.slice(0,5)});
const act=(s,type,id)=>advanceAdventure(s,{type,id});
test('ending close-ups stay on one physical stage and credits include every NPC exactly once',async()=>{
 const {CREDITS}=await import('../games/campaign-story.js');
 assert.equal(new Set(CREDITS.map(r=>r[0])).size,ENDING_CAST.length);assert.deepEqual(new Set(CREDITS.map(r=>r[0])),new Set(ENDING_CAST.map(n=>n.id)));
 const player={id:'player-f',name:'Campeã'};let time=0;
 for(const shot of ENDING_SHOTS){
  const scene=endingComposition(time+shot.duration*.9,player);time+=shot.duration;
  assert.ok(scene.hero.x>=ENDING_STAGE.x&&scene.hero.x<=512);assert.ok(scene.hero.y<=744);
  assert.ok(scene.hero.x>scene.camera.x&&scene.hero.x<scene.camera.x+scene.camera.w);
  assert.ok(scene.hero.y>scene.camera.y&&scene.hero.y<scene.camera.y+scene.camera.h);
 }
 for(const focus of ENDING_CAST){const scene=endingComposition(50,player,{focus});assert.equal(scene.actors.filter(a=>a.id===focus.id).length,1);assert.ok(scene.actors.find(a=>a.featured));assert.equal(scene.hero.y,ENDING_STAGE.y);}
 const final=endingComposition(999,player,{final:true});assert.equal(final.hero.x,ENDING_STAGE.x);assert.equal(final.hero.y,ENDING_STAGE.y);assert.ok(final.camera.y+final.camera.h<900);
});
const waiting=()=>act(act(act(beforeBeto(),'rain-start'),'beto-story-heard'),'rain-wait');
test('rain begins during Beto, André defers the match, and four distinct visitors unlock it',()=>{
 let s=beforeBeto();assert.equal(isRaining(s),false);
 s=act(s,'rain-start');assert.equal(isRaining(s),true);assert.equal(s.betoStory,false);
 s=act(s,'rain-chat','felipe');assert.equal(s.rainChats.length,0);
 s=act(s,'beto-story-heard');assert.equal(objective(s).target,'andre');assert.equal(canChallenge(s,'andre'),false);
 const action=conversation(s,'andre').actions[0];assert.equal(action.event.type,'rain-wait');s=advanceAdventure(s,action.event);
 for(const [i,id]of ['felipe','malu','kalinca','betinho'].entries()){
  s=act(s,'rain-chat',id);s=act(s,'rain-chat',id);s=act(s,'rain-chat','unknown');
  s=readAdventure(JSON.parse(JSON.stringify(s)));assert.equal(s.rainChats.length,i+1);assert.equal(canChallenge(s,'andre'),i===3);
  assert.equal(isRaining(s),i<3);
 }
 assert.equal(objective(s).target,'andre');assert.equal(conversation(s,'andre').actions[0].duel,'andre');
 assert.match(conversation(s,'andre').pages[0],/chuva passou/);
});
test('André routes the rain mission to optional new faces before Gael',()=>{
 let s=waiting();
 assert.equal(objective(s).target,'kalinca');
 assert.notEqual(objective(s).target,'gael');
 for(const id of RAIN_CHAT_ROUTE.slice(0,3)){
  s=act(s,'rain-chat',id);
  assert.equal(objective(s).target,RAIN_CHAT_ROUTE[s.rainChats.length]);
  assert.notEqual(objective(s).target,'gael');
 }
});
test('all extras count during the rain quest, never before it, and old achievements survive',()=>{
 for(const id of RAIN_CHAT_IDS){const s=act(waiting(),'rain-chat',id);assert.deepEqual(s.rainChats,[id]);}
 for(const type of ['rain-start','rain-wait','rain-chat'])assert.deepEqual(act(readAdventure(null),type,'felipe'),readAdventure(null));
 const old=readAdventure({...beforeBeto(),version:5,betoStory:true});assert.equal(canChallenge(old,'andre'),true);assert.equal(isRaining(old),false);
 const champion=readAdventure({...beforeBeto(),version:5,wins:RIVALS,champion:true,creditsSeen:true});
 assert.equal(champion.champion,true);assert.equal(champion.creditsSeen,true);assert.deepEqual(champion.wins,RIVALS);assert.equal(isRaining(champion),false);
 const resumed=readAdventure({...beforeBeto(),betoStory:true,rainStage:undefined});assert.equal(isRaining(resumed),true);assert.equal(objective(resumed).target,'andre');
});
test('real dialogue callbacks start rain on Beto page two and finish after four optional chats',()=>{
 const app=readFileSync(new URL('../games/app.js',import.meta.url),'utf8');let panel;
 const scope={campaign:beforeBeto(),conversation,isRaining,readAmbientChats,ambientConversation,AMBIENT_CHAT_KEY,
  storage:{get:(_,fallback)=>fallback,set:()=>{}},story:value=>{panel=value;},closeWorldPanel:()=>{},
  progress:event=>{scope.campaign=advanceAdventure(scope.campaign,event);},runStoryAction:action=>{scope.campaign=advanceAdventure(scope.campaign,action.event);}};
 const talk=runInNewContext(app.slice(app.indexOf('function talkToNpc('),app.indexOf('function talkToAmbient('))+';talkToNpc',scope);
 talk(NPCS.find(n=>n.id==='beto'));assert.equal(isRaining(scope.campaign),false);
 panel.actions[0].run();assert.equal(isRaining(scope.campaign),true);assert.equal(scope.campaign.betoStory,false);
 for(let i=0;i<3;i++)panel.actions[0].run();panel.actions[0].run();assert.equal(scope.campaign.betoStory,true);
 talk(NPCS.find(n=>n.id==='andre'));panel.actions[0].run();assert.equal(scope.campaign.rainStage,'waiting');
 const extra=runInNewContext(app.slice(app.indexOf('function talkToAmbient('),app.indexOf('function runStoryAction('))+';talkToAmbient',scope);
 for(const id of ['kalinca','malu','betinho','vanessa'])extra(AMBIENT_NPCS.find(n=>n.id===id));
 assert.equal(scope.campaign.rainChats.length,4);assert.equal(isRaining(scope.campaign),false);assert.match(panel.text,/chuva passou/);
});
test('rain has a bounded pixel cost and reduced motion stays static',()=>{
 const capture=(time,reduced)=>{const marks=[];const c={canvas:{width:1200,height:1600},save(){},restore(){},fillRect(){},beginPath(){},stroke(){},moveTo(...v){marks.push(v);},lineTo(){},ellipse(...v){marks.push(v);}};drawClubRain(c,time,{reduced});return marks;};
 assert.equal(capture(0,false).length,160);assert.notDeepEqual(capture(0,false),capture(1,false));
 assert.equal(capture(0,true).length,42);assert.deepEqual(capture(0,true),capture(10,true));
});
test('six timed film scenes end cleanly and every speaker has art',()=>{
 assert.equal(ENDING_SHOTS.length,6);assert.equal(ENDING_FILM_DURATION,43);let time=0;
 for(const [index,shot]of ENDING_SHOTS.entries()){
  assert.equal(endingShotAt(time).index,index);assert.ok(NPCS.some(n=>n.id===shot.speaker));assert.ok(shot.text.length>40);
  time+=shot.duration;assert.equal(endingShotAt(time-.001).id,shot.id);
 }
 assert.equal(endingShotAt(time),null);
});
test('the active ending uses still photos instead of the old map-stage animation',()=>{
 const source=readFileSync(new URL('../games/campaign-ending.js',import.meta.url),'utf8');
 assert.match(source,/ending-album/);assert.doesNotMatch(source,/paintEndingFilm|sceneryReady|characterPortrait/);
});
test('victory portrait precedes the text and is filled with the defeated opponent',()=>{
 const html=readFileSync(new URL('../games/index.html',import.meta.url),'utf8'),app=readFileSync(new URL('../games/app.js',import.meta.url),'utf8');
 assert.ok(html.indexOf('id="resultPortrait"')<html.indexOf('id="finalDetails"'));
 assert.match(app,/characterPortrait\(\$\('resultPortrait'\),opponent\)/);
});
