import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {EXPLORE,NPCS,advanceAdventure,objective,readAdventure,stageOf} from '../games/adventure.js';
import {PLACES} from '../games/scenery-data.js';

const app=readFileSync(new URL('../games/app.js',import.meta.url),'utf8');
const worldSource=readFileSync(new URL('../games/world.js',import.meta.url),'utf8');

function tourScope(){
 let panel,destination;
 const scope={EXPLORE,stageOf,objective,world:{places:PLACES},campaign:advanceAdventure(readAdventure(null),{type:'welcome'}),
  npc:id=>NPCS.find(person=>person.id===id),story:value=>{panel=value;},goTo:value=>{destination=value;},
  progress:event=>{scope.campaign=advanceAdventure(scope.campaign,event);},initAudio(){},beep(){},closeWorldPanel(){}};
 const source=app.slice(app.indexOf('function visitExplorePlace('),app.indexOf('function interactWith('));
 scope.visitExplorePlace=runInNewContext(`${source};visitExplorePlace`,scope);
 return {scope,get panel(){return panel;},get destination(){return destination;}};
}

test('visiting a marked place offers one-tap navigation to the next stop',()=>{
 const flow=tourScope();
 for(const [index,id] of EXPLORE.entries()){
  const place=PLACES.find(item=>item.id===id);
  assert.equal(flow.scope.visitExplorePlace(place),true);
  assert.equal(flow.panel.title,`Local visitado · ${place.label}`);
  assert.equal(flow.panel.actions[0].primary,true);
  assert.equal(flow.panel.actions[0].label,index===EXPLORE.length-1?'Voltar ao Leandro':`Ir para ${PLACES.find(item=>item.id===EXPLORE[index+1]).label}`);
  flow.panel.actions[0].run();
  assert.equal(flow.destination.id,index===EXPLORE.length-1?'leandro':EXPLORE[index+1]);
 }
});

test('an out-of-order stop does not count and routes back to the yellow marker',()=>{
 const flow=tourScope(),later=PLACES.find(item=>item.id===EXPLORE[2]);
 flow.scope.visitExplorePlace(later);
 assert.deepEqual(flow.scope.campaign.places,[]);
 assert.equal(flow.panel.title,'Siga a marca da missão');
 assert.equal(flow.panel.actions[0].label,`Ir para ${PLACES.find(item=>item.id===EXPLORE[0]).label}`);
});

test('walking near a place never auto-completes it and free court play is lesson-gated',()=>{
 assert.doesNotMatch(worldSource,/onVisitPlace/);
 assert.match(worldSource,/fillText\('INTERAJA'/);
 assert.doesNotMatch(worldSource,/visit-place/);
 assert.match(app,/function requestMatch\(character=null\)\{if\(!campaign\.trained\)return lessonRequired\(\)/);
 assert.match(app,/if\(target\.kind==='pickleball'\)\{if\(!campaign\.trained\)return lessonRequired\(\)/);
 assert.match(app,/campaign\.trained\?\[\{label:'Jogar na quadra velha'/);
});

test('old court hotspot stays disabled so Gabriel balls own the interaction',()=>{
 assert.match(readFileSync(new URL('../games/world-model.js',import.meta.url),'utf8'),/place\.id!=='abandoned-court'/);
});
