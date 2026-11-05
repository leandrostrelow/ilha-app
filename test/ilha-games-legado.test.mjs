import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {indexAtlasFrames} from '../games/sprite-frames.js';
import {NPCS,RIVALS,readAdventure,advanceAdventure,rewards} from '../games/adventure.js';
import {BIOS,CHAT,BOSS_LINES,STORY_INTRO,FINALE} from '../games/legado-story.js';

test('all twelve personalities have unique stories, conversation and color; only six are bosses',()=>{
 assert.equal(NPCS.length,12);assert.equal(RIVALS.length,6);assert.equal(new Set(NPCS.map(n=>n.avatar)).size,12);
 for(const n of NPCS){assert.ok(BIOS[n.id]?.length>100);assert.ok(CHAT[n.id]?.length>30);if(RIVALS.includes(n.id))for(const kind of ['before','win','lose'])assert.ok(BOSS_LINES[n.id][kind]);}
 assert.equal(NPCS.find(n=>n.id==='renato').court,1);assert.equal(NPCS.find(n=>n.id==='emerson').court,2);assert.equal(RIVALS.at(-1),'romulo');
 assert.match(STORY_INTRO,/Duas quadras/);assert.match(FINALE,/aura dourada/);
});
test('transparent atlas gutters retain complete directional frames',()=>{
 for(const [columns,rows] of [[2,4],[4,3]]){
  const width=columns*30,height=rows*40,data=new Uint8ClampedArray(width*height*4);
  for(let r=0;r<rows;r++)for(let c=0;c<columns;c++)for(let y=r*40+4;y<r*40+37;y++)for(let x=c*30+7;x<c*30+24;x++)data[(y*width+x)*4+3]=255;
  const frames=indexAtlasFrames({data,width,height},columns,rows);assert.equal(frames.length,columns*rows);assert.ok(frames.every(f=>f.w===17&&f.h===33));
 }
});
test('profile normalization is bounded and corrupt progress cannot skip ordered wins',()=>{
 let s=readAdventure({version:2,name:'A'.repeat(40),avatar:'unknown',welcomed:true,places:'court1,court2,pickleball',met:true,trained:true,wins:RIVALS,champion:true});
 assert.equal(s.name.length,18);assert.equal(s.avatar,'player-m');assert.deepEqual(s.places,[]);assert.equal(s.trained,false);assert.equal(s.champion,false);
 s=advanceAdventure(s,{type:'profile',name:'\u0000 Ana \n',avatar:'player-f'});assert.equal(s.name,'Ana');assert.equal(s.avatar,'player-f');assert.ok(rewards(s).attributes.every(([,n])=>n<=5));
});
test('campaign avatars are visual only; ranked engine and original IDs remain isolated',async()=>{
 const app=await readFile(new URL('../games/app.js',import.meta.url),'utf8');
 assert.match(app,/game=local\?createRacketMatch\(/);
 assert.match(app,/:createGame\(seed,selected\)/);
 assert.match(app,/run=practice\?null:await api\('start'/);assert.match(app,/getCharacter:playerProfile/);
 const ui=await readFile(new URL('../games/legado-ui.js',import.meta.url),'utf8');assert.doesNotMatch(ui,/innerHTML|fetch\(/);assert.match(ui,/substituída ao confirmar/);
 const build=await readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8');for(const name of ['sprite-frames.js','legado-story.js','legado-ui.js','legado.css'])assert.ok(build.includes(name));
});
