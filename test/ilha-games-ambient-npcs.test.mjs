import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {AMBIENT_NPCS,AMBIENT_CHAT_KEY,ambientConversation,readAmbientChats} from '../games/ambient-npcs.js';
import {NPCS,RIVALS,readAdventure,advanceAdventure,objective,rewards} from '../games/adventure.js';
import {TREES} from '../games/scenery-data.js';
import {plantBounds} from '../games/scenery-plants.js';
import {SPAWN,nearestWalkable,isWalkable,routeTo,followRoute,distance,nearbyTarget} from '../games/world-model.js';

test('nine ambient visitors remain separate from the twelve campaign characters',()=>{
 assert.equal(AMBIENT_NPCS.length,9);assert.equal(NPCS.length,12);assert.equal(RIVALS.length,6);
 assert.equal(new Set([...NPCS,...AMBIENT_NPCS].map(n=>n.id)).size,21);
 for(const n of AMBIENT_NPCS){assert.equal(n.ambient,true);assert.equal(n.role,'ambient');assert.equal(n.court,undefined);assert.ok(!NPCS.some(p=>p.id===n.id));}
 assert.ok(distance(AMBIENT_NPCS.find(n=>n.id==='michele'),AMBIENT_NPCS.find(n=>n.id==='larissa'))>700);
});
test('each extra is visible, walkable and reachable without blocking a campaign interaction',()=>{
 const cast=[...NPCS,...AMBIENT_NPCS];
 for(const n of AMBIENT_NPCS){
  assert.ok(isWalkable(n.x,n.y),n.id);const arrival=nearestWalkable({x:n.x,y:n.y+32});assert.ok(arrival,n.id);
  const player={...SPAWN},route=routeTo(player,arrival);assert.ok(route.length,n.id);
  for(let i=0;i<12000&&route.length;i++)followRoute(player,route,1/60);
  assert.equal(route.length,0,n.id);assert.equal(nearbyTarget(player,cast)?.id,n.id);
  for(const tree of TREES){const b=plantBounds(tree);assert.ok(!(tree.y>n.y&&n.x>b.x-10&&n.x<b.x+b.w+10&&n.y-22>b.y&&n.y-22<b.y+b.h),`${n.id} hidden by ${tree.id}`);}
 }
 for(const n of NPCS){const arrival=nearestWalkable({x:n.x,y:n.y+12});assert.equal(nearbyTarget(arrival,cast,[],n.id)?.id,n.id);}
});
test('optional chat rotation keeps the supplied jokes and never changes campaign progress',()=>{
 let campaign=readAdventure(null);const original=structuredClone(campaign),before=rewards(campaign);
 const counts=readAmbientChats({kalinca:-1,malu:Infinity,higor:1,unrelated:1});assert.equal(counts.kalinca,0);assert.equal(counts.malu,0);assert.equal(counts.higor,1);assert.equal(counts.unrelated,undefined);
 for(const n of AMBIENT_NPCS){for(let i=0;i<4;i++){assert.ok(ambientConversation(n.id,i,'Kiko').pages.every(p=>p.length>10));campaign=advanceAdventure(campaign,{type:'visit',id:n.id});}}
 assert.deepEqual(campaign,original);assert.deepEqual(rewards(campaign),before);assert.deepEqual(objective(campaign),objective(original));
 assert.match(ambientConversation('bernar').pages[0],/bpsport\.com\.br/);
 assert.match(ambientConversation('vanessa',0,'Kiko').pages[0],/Kiko:.*Ô tia/);assert.match(ambientConversation('vanessa').pages[0],/NÃO SOU SUA TIA/);
 assert.equal(ambientConversation('higor').pages.length,3);assert.deepEqual(ambientConversation('higor',1).pages,['É desesperador.']);
 assert.deepEqual(ambientConversation('malu',2),ambientConversation('malu',0));assert.equal(ambientConversation('unknown'),null);
});
test('actual extra conversation callbacks persist only optional chat, including Higor interruption',()=>{
 const app=readFileSync(new URL('../games/app.js',import.meta.url),'utf8');
 const handler=app.slice(app.indexOf('function talkToAmbient(person){'),app.indexOf('function runStoryAction('));
 const writes=[],data={};let panel,closed=0;
 const campaign=readAdventure(null),scope={readAmbientChats,ambientConversation,AMBIENT_CHAT_KEY,campaign,
  storage:{get:(key,fallback)=>data[key]||fallback,set:(key,value)=>{writes.push(key);data[key]=structuredClone(value);}},
  story:value=>{panel=value;},closeWorldPanel:()=>{closed++;},progress:()=>{throw new Error('Extra changed the campaign');}};
 const talk=runInNewContext(`${handler};talkToAmbient`,scope),higor=AMBIENT_NPCS.find(n=>n.id==='higor');
 talk(higor);assert.equal(writes.length,0);panel.actions.at(-1).run();assert.equal(closed,1);
 talk(higor);assert.match(panel.text,/Meu apelido/);panel.actions[0].run();panel.actions[0].run();
 assert.equal(panel.text,'É desesperador.');assert.deepEqual(writes,[AMBIENT_CHAT_KEY]);
 panel.actions[0].run();assert.equal(panel.text,'É desesperador.');assert.equal(data[AMBIENT_CHAT_KEY].higor,2);
 assert.deepEqual(campaign,readAdventure(null));assert.match(app,/if\(target.kind==='npc'&&target.ambient\)return talkToAmbient\(target\)/);
});
test('all extra art ships as its own transparent PNG and build versions its module',()=>{
 for(const n of AMBIENT_NPCS){const file=new URL(`..${n.art}`,import.meta.url);assert.ok(existsSync(file),n.id);const data=readFileSync(file);assert.equal(data.toString('ascii',1,4),'PNG');assert.equal(data[25],6,'RGBA PNG required');}
 const build=readFileSync(new URL('../scripts/build.mjs',import.meta.url),'utf8');assert.match(build,/'ambient-npcs\.js'/);
 const roster=readFileSync(new URL('../games/legado-ui.js',import.meta.url),'utf8');assert.match(roster,/\.\.\.NPCS,\.\.\.AMBIENT_NPCS/);
});
