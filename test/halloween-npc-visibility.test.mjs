import test from 'node:test';
import assert from 'node:assert/strict';
import {NPCS} from '../game2/adventure.js';
import {AMBIENT_NPCS} from '../game2/ambient-npcs.js';
import {TREES} from '../game2/scenery-data.js';
import {isWalkable} from '../game2/world-model.js';

test('all Halloween NPCs stand outside foreground canopies with room to approach',()=>{
 for(const p of [...NPCS,...AMBIENT_NPCS]){
  assert.ok(isWalkable(p.x,p.y),p.id);
  assert.ok(isWalkable(p.x,p.y+24),p.id+' approach');
  for(const t of TREES){
   const s=t.scale||1;
   // Conservative envelope includes wide palms, haunted branches and actor width.
   const hidden=t.y>p.y&&p.y>t.y-155*s&&Math.abs(p.x-t.x)<70*s+16;
   assert.equal(hidden,false,`${p.id} behind ${t.id}`);
  }
 }
});
