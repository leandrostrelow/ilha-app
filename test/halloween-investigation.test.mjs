import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NPCS,RIVALS,POST_QUESTS,readAdventure,advanceAdventure,objective,stageOf,questItems,pendingDelivery,canChallenge,rewards} from '../game2/adventure.js';
import {NPCS as ORIGINAL_NPCS} from '../games/adventure.js';
import {AMBIENT_NPCS} from '../game2/ambient-npcs.js';
import {AMBIENT_NPCS as ORIGINAL_AMBIENT} from '../games/ambient-npcs.js';
import {conversation,OPENING} from '../game2/campaign-story.js';
import {nextWitness,witnessPages,AFTER_PARTY} from '../game2/investigation.js';
import {CASES,compareSuspects,reconstruction,accusationFeedback} from '../game2/mystery.js';
import {parseSave,exportSave} from '../game2/campaign-save.js';

const act=(s,type,extra={})=>advanceAdventure(s,{type,...extra});
const roster=[...NPCS,...AMBIENT_NPCS];
const old=caseId=>({edition:'misterio-ilha',version:9,caseId,name:'Detetive',begun:true,welcomed:true,felipeIntro:true,history:true,met:true,trained:true,barVisited:true,cup:true,clues:['purple-vial','prop-leg'],wins:RIVALS,requests:RIVALS,dosed:RIVALS,deliveries:RIVALS});

test('The actual dialogue actions carry every case through all 25 characters with no ground errands',()=>{
 for(const caseId of Object.keys(CASES)){
  let s={...act(null,'profile',{name:'Turma',avatar:'player-f'}),caseId},steps=0;
  while(!s.champion&&steps++<110){
   assert.deepEqual(questItems(s),[]);
   const stage=stageOf(s),id=objective(s).target;
   if(stage==='celebrate'){s=act(s,'crowned');continue;}
   assert.ok(roster.some(p=>p.id===id),`Not a person: ${id}`);
   s=act(s,'visit',{id});const dialogue=conversation(s,id);
   assert.ok(dialogue.pages.length>0,id);
   const action=dialogue.actions.find(a=>a.event||a.duel||a.final||a.accuse===caseId);
   assert.ok(action,`${caseId} ${stage} ${id}: no mission action`);
   const before=JSON.stringify(s);
   if(action.event)s=advanceAdventure(s,action.event);
   else if(action.duel){assert.ok(canChallenge(s,id));s=act(s,'challenge-completed',{id,success:true});}
   else if(action.accuse)s=act(s,'accuse',{id:action.accuse});
   else if(action.final)s=act(s,'final-won',{id,success:true});
   assert.notEqual(JSON.stringify(s),before,`Blocked at ${stage}/${id}`);
   assert.deepEqual(readAdventure(JSON.parse(JSON.stringify(s))),s);
  }
  assert.ok(s.champion,`${caseId}: exceeded ${steps} steps`);
  assert.deepEqual([...s.visited].sort(),roster.map(p=>p.id).sort());
  assert.equal(new Set(s.conversations).size,17);
  assert.equal(rewards(s).attributes.find(([name])=>name==='Investigação')[1],5);
  const matched=compareSuspects(s).filter(p=>p.matches===2);assert.deepEqual(matched.map(p=>p.id),[caseId]);
  const solved=reconstruction(s);assert.ok(solved.includes(CASES[caseId].object));assert.ok(solved.includes(CASES[caseId].container));assert.ok(solved.includes('Higor'));assert.ok(solved.includes('Michele e Gael'));
  assert.deepEqual(parseSave(exportSave(s)).campaign,s);
 }
});

test('All original people remain, Leandro is brief, and each has a unique postgame conversation',()=>{
 assert.equal(OPENING.length,2);
 for(const p of [...ORIGINAL_NPCS,...ORIGINAL_AMBIENT])assert.ok(roster.some(n=>n.id===p.id),p.id);
 assert.equal(roster.length,25);assert.equal(new Set(Object.values(AFTER_PARTY)).size,25);
 for(const p of roster)assert.ok(AFTER_PARTY[p.id],p.id);
});

test('Reports cannot be skipped, forged out of order, duplicated or recorded before curing',()=>{
 const base=old('evandro');let s=readAdventure({...base,wins:['gabriel'],requests:['gabriel'],dosed:['gabriel'],deliveries:[]});
 assert.equal(nextWitness(s,'gabriel'),'davi');
 for(const event of [{type:'witness-heard',id:'gabriel',person:'carolina'},{type:'witness-heard',id:'higor',person:'bernar'},{type:'delivery-completed',id:'gabriel',recipient:'carolina'}])assert.deepEqual(advanceAdventure(s,event),s);
 s=act(s,'witness-heard',{id:'gabriel',person:'davi'});assert.equal(objective(s).target,'carolina');assert.equal(pendingDelivery(s),'gabriel');
 assert.deepEqual(act(s,'witness-heard',{id:'gabriel',person:'davi'}),s);
 s=act(s,'witness-heard',{id:'gabriel',person:'carolina'});assert.equal(pendingDelivery(s),null);assert.deepEqual(s.deliveries,['gabriel']);
 for(const [chapter,q]of Object.entries(POST_QUESTS))for(const id of q.route)assert.ok(witnessPages(chapter,id,s).length,id);
});

test('Unknown evidence or unconfirmed profiles cannot reveal the answer',()=>{
 let s=readAdventure({...old('evandro'),wins:[],requests:[],dosed:[],deliveries:[]});
 assert.ok(compareSuspects(s).every(p=>p.matches===null));assert.equal(reconstruction(s),'');
 s=readAdventure({...old('evandro'),wins:RIVALS.slice(0,3),deliveries:RIVALS.slice(0,3)});
 assert.ok(compareSuspects(s).every(p=>p.matches===null));
 const complete=readAdventure(old('evandro'));assert.deepEqual(compareSuspects(complete).map(p=>[p.id,p.matches]),[['beto',0],['evandro',2],['romulo',0]]);
 assert.match(accusationFeedback(complete,'beto'),/garrafa prateada/);assert.match(accusationFeedback(complete,'beto'),/caneca azul/);
});

test('v9 completed saves and partially finished chapters migrate without resetting progress or case',()=>{
 for(const id of Object.keys(CASES)){
  const s=readAdventure({...old(id),accused:id,finalWon:true,finalBriefing:true,champion:true,creditsSeen:true});
  assert.ok(s.champion&&s.creditsSeen);assert.equal(s.caseId,id);assert.equal(s.version,10);assert.equal(stageOf(s),'champion');
  assert.equal(s.conversations.length,17);assert.ok(s.witnesses.includes('evandro'));assert.match(conversation(s,'leandro').actions[0].label,/pistas/);
 }
 const midway=readAdventure({...old('evandro'),wins:RIVALS.slice(0,3),deliveries:RIVALS.slice(0,2)});
 assert.equal(objective(midway).target,'bernar');assert.equal(midway.wins.length,3);assert.equal(midway.caseId,'evandro');
 const doneHalf=act(midway,'witness-heard',{id:'higor',person:'bernar'});assert.equal(objective(parseSave(exportSave(doneHalf)).campaign).target,'evandro');
});

test('The map includes former ambient people and the notebook uses semantic, escaped content',async()=>{
 const app=await readFile(new URL('../game2/app.js',import.meta.url),'utf8');assert.match(app,/\.\.\.NPCS\.filter\(n=>n\.id!=='leandro'\),\.\.\.AMBIENT_NPCS/);
 const book=await readFile(new URL('../game2/mystery-notebook.js',import.meta.url),'utf8');assert.doesNotMatch(book,/innerHTML/);assert.match(book,/Compare os três perfis/);assert.match(book,/Como as pistas se encaixaram/);
});
