import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NPCS,RIVALS,VENUES,readAdventure} from '../games/adventure.js';
import {BIOS,ROSTER_BIOS,CHAT,BOSS_LINES,FINALE} from '../games/legado-story.js';
import {AMBIENT_NPCS} from '../games/ambient-npcs.js';

test('all twelve supplied personas reach biographies and in-world conversations',()=>{
 const themes={gael:/autorização/,lourenco:/5 a 0/,gabriel:/bigode/,emerson:/só mais uma/,davi:/edição anterior/,evandro:/novo treinamento físico/,andre:/paciência/,romulo:/Foice Lendária/,renato:/atrasar/,beto:/Lua/,felipe:/porções e as bebidas mágicas/,leandro:/ChatGPT/};
 assert.equal(NPCS.length,12);
 for(const person of NPCS){assert.match(BIOS[person.id],themes[person.id]);assert.ok(CHAT[person.id].length>50);}
 assert.equal(NPCS.find(n=>n.id==='gabriel').title,'Chefe 2 · El Bigodón');
 assert.equal(NPCS.find(n=>n.id==='evandro').title,'Chefe 4 · O Incansavelmente Cansado');
 assert.equal(NPCS.find(n=>n.id==='davi').title,'Chefe 3 · Next Gen');
 for(const id of RIVALS)for(const phase of ['before','win','lose'])assert.ok(BOSS_LINES[id][phase].length>50);
 assert.match(FINALE,/ChatGPT/);assert.match(FINALE,/aura dourada/);
});
test('Conheça a galera lists all 21 people with short current summaries',()=>{
 const cast=[...NPCS,...AMBIENT_NPCS];assert.equal(cast.length,21);
 assert.deepEqual(new Set(Object.keys(ROSTER_BIOS)),new Set(cast.map(person=>person.id)));
 for(const person of cast){assert.ok(ROSTER_BIOS[person.id].length>=45,person.id);assert.ok(ROSTER_BIOS[person.id].length<=150,person.id);}
 const html=readFileSync(new URL('../games/index.html',import.meta.url),'utf8');assert.match(html,/Conheça a galera <span>21<\/span>/);
});
test('story refresh preserves the two tennis courts and existing campaign saves',()=>{
 assert.deepEqual(VENUES,['court1','court2','pickleball']);
 const saved={version:2,begun:true,name:'Teste',avatar:'player-f',welcomed:true,places:VENUES,barVisited:true,met:true,trained:true,wins:RIVALS.slice(0,3)};
 const restored=readAdventure(saved);assert.deepEqual(restored.wins,saved.wins);assert.equal(restored.name,'Teste');assert.equal(restored.trained,true);
});
