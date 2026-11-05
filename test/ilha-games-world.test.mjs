import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SPAWN,NODES,PLACES,NPC_SPOTS,distance,isWalkable,moveWalker,steerWalker,followRoute,joystickVector,clearPath,routeTo,nearbyTarget } from '../games/world-model.js';

function walkRoute(from,target){
  const player={...from},route=routeTo(from,target);
  assert.ok(route.length,'destination has a route');
  for(let frame=0;route.length&&frame<12000;frame++){
    followRoute(player,route,1/60);
    assert.ok(isWalkable(player.x,player.y));
  }
  assert.equal(route.length,0,`route to ${JSON.stringify(target)} must complete from ${JSON.stringify(from)}`);
  return player;
}
test('every destination and NPC is reachable from the gate and every other destination',()=>{
  const destinations=[SPAWN,...PLACES,...NPC_SPOTS];
  for(const from of destinations)for(const to of destinations){const end=walkRoute(from,to);assert.ok(distance(end,to)<50);}
  for(const [x,y] of NODES)assert.ok(isWalkable(x,y));
});
test('walking cannot enter roofs, courts, river or forest, or move faster diagonally',()=>{
  for(const [x,y] of [[1450,800],[660,900],[380,900],[690,1250],[850,160],[-1,100]])assert.equal(isWalkable(x,y),false);
  const origin={x:766,y:420};const straight={...origin},diagonal={...origin};
  moveWalker(straight,1,0,.02);moveWalker(diagonal,1,1,.02);
  assert.ok(Math.abs(distance(origin,straight)-distance(origin,diagonal))<.0001);
  const player={...SPAWN};for(let i=0;i<200;i++)moveWalker(player,1,0,1/60);
  assert.ok(player.x<=SPAWN.x+35);assert.ok(isWalkable(player.x,player.y));
});
test('entrance passage connects the side gate to the two northern sports areas',()=>{
  const top={x:946,y:393},bottom={x:494,y:447};
  for(const target of [top,bottom]){
    assert.ok(isWalkable(target.x,target.y));
    assert.ok(distance(walkRoute(SPAWN,target),target)<5);
  }
  assert.ok(distance(walkRoute(top,bottom),bottom)<5);
});
test('bar stairway can be walked continuously from promenade to social deck',()=>{
 const top={x:516,y:660},bottom={x:516,y:1080};
 assert.ok(clearPath(top,bottom));
 assert.ok(distance(walkRoute(SPAWN,top),top)<5);
 assert.ok(distance(walkRoute(top,bottom),bottom)<5);
 for(const npc of NPC_SPOTS)assert.ok(distance(walkRoute(bottom,npc),npc)<5);
});
test('tap-to-walk does not cut blocked corners and arrives at the exact requested path point',()=>{
  for(const from of [{x:766,y:420},{x:516,y:930},{x:892,y:680}]){
    assert.ok(isWalkable(from.x,from.y));
    for(const target of PLACES)assert.ok(distance(walkRoute(from,target),target)<5);
  }
  const target={x:1030,y:1030};assert.ok(distance(walkRoute(SPAWN,target),target)<5);
});
test('analog has a dead zone, normalized diagonals, smooth start and quick release',()=>{
  assert.deepEqual(joystickVector(3,4),{x:0,y:0});assert.equal(joystickVector(100,0).x,1);
  const diagonal=joystickVector(100,100);assert.ok(Math.abs(Math.hypot(diagonal.x,diagonal.y)-1)<1e-9);
  assert.ok(joystickVector(15,0).x<joystickVector(25,0).x);
  const player={x:766,y:420};steerWalker(player,1,0,1/60);assert.ok(player.vx>0&&player.vx<1);
  for(let i=0;i<30;i++)steerWalker(player,0,0,1/60);
  assert.equal(player.vx,0);assert.ok(isWalkable(player.x,player.y));
});
test('route smoothing never crosses a collision and every clicked lawn point is reachable',()=>{
  let checked=0;
  for(let x=390;x<1040;x+=20)for(let y=620;y<699;y+=16){if(!isWalkable(x,y))continue;
    const route=routeTo(SPAWN,{x,y});assert.ok(route.length,JSON.stringify({x,y}));let previous=SPAWN;
    for(const point of route){assert.ok(clearPath(previous,point));previous=point;}checked++;
  }
  assert.ok(checked>40);
});
test('only nearby characters and court entrances are interactive',()=>{
  assert.equal(nearbyTarget(SPAWN),null);
  const court=PLACES.find(p=>p.id==='court1');assert.equal(nearbyTarget(court).id,'court1');
  const abandoned=PLACES.find(p=>p.id==='abandoned-court');assert.equal(nearbyTarget(abandoned),null);
  const npc={...NPC_SPOTS[0],id:'romulo',name:'Rômulo'};
  assert.equal(nearbyTarget(npc,[npc]).kind,'npc');
});
test('RPG flow keeps Games off the home page and preserves tennis score verification',async()=>{
  const home=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.doesNotMatch(home,/href=["']\/games\/?["']/);
  const html=await readFile(new URL('../games/index.html',import.meta.url),'utf8');
  for(const id of ['worldArea','worldCanvas','walkPad','worldMap','worldStory','interactButton'])assert.ok(html.includes(`id="${id}"`));
  const app=await readFile(new URL('../games/app.js',import.meta.url),'utf8');
  assert.match(app,/createGame\(seed,selected\)/);assert.match(app,/stepGame\(game,input\)/);
  const build=await readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8');
  for(const asset of ['world-model.js','world.js','world.css'])assert.ok(build.includes(asset));
  for(const asset of ['club-scene.js','characters.js','court-view.js'])assert.ok(build.includes(asset));
  assert.match(html,/32-BIT/);assert.doesNotMatch(html,/club-rpg-map-v1/);
  const renderer=await readFile(new URL('../games/render.js',import.meta.url),'utf8');
  assert.match(renderer,/renderClub/);assert.doesNotMatch(renderer,/mapAsset|tennis-courts-rpg-v2/);
  assert.doesNotMatch(html,/club-rpg-map-v3/);
});

test('Games landing uses the real map and compact play button; ranking stays in its navigation dialog',async()=>{
 const html=await readFile(new URL('../games/index.html',import.meta.url),'utf8');
 assert.match(html,/<main class="game-home">/);assert.match(html,/id="openGame"[^>]*><svg[\s\S]*?<span>Jogar<\/span>/);
 assert.match(html,/class="game-cover" data-club-preview="cover"/);
 assert.match(html,/class="launch-copy"[\s\S]*?data-game-logo/);assert.doesNotMatch(html,/class="launch-heroes"/);
 assert.match(html,/id="openRanking"/);assert.match(html,/id="rankingDialog"/);
 assert.doesNotMatch(html,/class="intro"|class="lower-row"|class="next-card"|class="how-card"/);
 const app=await readFile(new URL('../games/app.js',import.meta.url),'utf8');
 assert.match(app,/function openRanking\(\)/);assert.match(app,/id!=='worldArea'/);
});
