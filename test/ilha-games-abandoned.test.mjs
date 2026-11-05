import test from 'node:test';
import assert from 'node:assert/strict';
import {ABANDONED_COURT,ENTRY,PLACES,COURTS,walkSurface,locationAt} from '../games/scenery-data.js';
import {routeTo,followRoute,distance} from '../games/world-model.js';
test('abandoned court remains freely explorable outside optional quick matches',()=>{
 const place=PLACES.find(p=>p.id==='abandoned-court');assert.equal(place.kind,'scenery');assert.equal(COURTS.length,2);
 const {x,y,w,h}=ABANDONED_COURT;
 for(const goal of [place,{x:x+35,y:y+35},{x:x+w-30,y:y+h-30},{x:x+40,y:y+h-35}]){
  assert.ok(walkSurface(goal.x,goal.y));assert.equal(locationAt(goal),'Quadra abandonada');
  const player={...ENTRY},route=routeTo(player,goal);assert.ok(route.length);
  for(let frame=0;frame<18000&&route.length;frame++)followRoute(player,route,1/60);
  assert.ok(distance(player,goal)<6,JSON.stringify({player,goal}));
  const back=routeTo(player,ENTRY);assert.ok(back.length);
  for(let frame=0;frame<18000&&back.length;frame++)followRoute(player,back,1/60);
  assert.ok(distance(player,ENTRY)<6);
 }
});
