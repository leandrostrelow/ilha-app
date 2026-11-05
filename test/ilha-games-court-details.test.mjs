import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COURTS,STANDS,walkSurface} from '../games/scenery-data.js';
import {NPCS} from '../games/adventure.js';
test('one centered stand per clay court keeps the cross path accessible',()=>{
 assert.equal(STANDS.length,2);
 COURTS.forEach((court,i)=>{assert.equal(STANDS[i].x+STANDS[i].w/2,court.x+court.width/2);assert.ok(walkSurface(court.x+court.width/2,680));});
 const r=NPCS.find(n=>n.id==='romulo');assert.ok(walkSurface(r.x,r.y));assert.ok(r.x<400);
});
test('stationary NPCs cannot permanently fade trees and baseline ticks point inward',()=>{
 const s=readFileSync(new URL('../games/scenery-renderer.js',import.meta.url),'utf8');
 assert.match(s,/actors.some\(a=>a.isPlayer&&/);
 assert.match(s,/y\+h-4,2,4/);assert.match(s,/y\+2,2,4/);
});
