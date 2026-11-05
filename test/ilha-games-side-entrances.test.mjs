import test from 'node:test';
import assert from 'node:assert/strict';
import {COURTS,PLACES,ENTRY,terrainAt,walkSurface} from '../games/scenery-data.js';
import {NPCS} from '../games/adventure.js';
import {routeTo,nearestWalkable,followRoute,distance,nearbyTarget} from '../games/world-model.js';
test('outside gates and relocated coaches remain reachable from the entrance',()=>{
 for(const target of [...PLACES.filter(p=>p.kind==='court'),...NPCS.filter(p=>p.role==='coach')]){
  const arrival=target.kind==='npc'?nearestWalkable({x:target.x,y:target.y+32}):target;
  assert.ok(arrival);assert.ok(walkSurface(arrival.x,arrival.y));
  const player={...ENTRY},route=routeTo(player,arrival);assert.ok(route.length,target.id);
  for(let i=0;i<12000&&route.length;i++)followRoute(player,route,1/60);
  assert.ok(distance(player,arrival)<5,target.id);
  assert.equal(nearbyTarget(player,NPCS,[],target.id)?.id,target.id);
 }
 const left=PLACES.find(p=>p.id==='court1'),right=PLACES.find(p=>p.id==='court2');
 assert.ok(left.x<COURTS[0].grounds.x);assert.ok(right.x>COURTS[1].grounds.x+COURTS[1].grounds.w);
 assert.ok(Math.abs(left.y-907)<2&&Math.abs(right.y-907)<2);
 for(const x of [570,672,760,892,980])assert.equal(terrainAt(x,697),'lawn');
});
