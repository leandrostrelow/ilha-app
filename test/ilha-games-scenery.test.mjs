import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WORLD_SIZE,SPAWN,ENTRY,ENTRY_ROUTE,entryPosition,COURTS,BUILDINGS,SAND_COURTS,BAR_STAIRS,TERRACE,buildingBounds,buildingCollision,PICKLEBALL,PICKLEBALL_CAMERA,PARKING,CARS,LANDMARK_TREES,gravelAt,TREES,RECT_SOLIDS,PLACES,terrainAt,waterAt,treeCollision,walkSurface,locationAt} from '../games/scenery-data.js';
import {sceneObjectsIn} from '../games/scenery-renderer.js';
import {courtPoint} from '../games/club-scene.js';
import {indexPlantFrames,plantIndex,plantsReady,PLANT_HEIGHTS,FOLIAGE_ATLAS_URL} from '../games/scenery-plants.js';

test('new environment has two playable courts and consistent terrain and collision data',()=>{
 assert.equal(COURTS.length,2);assert.ok(TREES.length>250);
 for(const c of COURTS){assert.equal(walkSurface(c.x+50,c.y+50),false);assert.ok(RECT_SOLIDS.some(([x,y,w,h])=>c.x>x&&c.x+c.width<x+w&&c.y>y&&c.y+c.height<y+h));}
 for(const tree of TREES){assert.ok(treeCollision(tree.x,tree.y));assert.equal(walkSurface(tree.x,tree.y),false);assert.equal(waterAt(tree.x,tree.y),false);}
 for(const place of PLACES)assert.ok(['path','lawn','deck','gravel'].includes(terrainAt(place.x,place.y)),place.id);
 assert.equal(terrainAt(1450,1400),'water');assert.equal(waterAt(1450,900),false);assert.equal(terrainAt(SPAWN.x,SPAWN.y),'cobbles');
});
test('club plan keeps bar west, sand courts north, blue court south and side entrance east',()=>{
 const bar=BUILDINGS.find(b=>b.id==='bar-wing'),first=COURTS[0].grounds,second=COURTS[1].grounds;
 assert.ok(bar.x+bar.w<first.x);assert.equal(first.y,second.y);assert.equal(first.x+first.w,second.x);
 for(const sand of SAND_COURTS)assert.ok(sand.y+sand.h<first.y);assert.ok(PICKLEBALL.y>first.y+first.h);
 assert.equal(BUILDINGS.some(b=>b.kind==='longbar'),false);assert.ok(TERRACE[0]+TERRACE[2]<first.x);
 assert.ok(ENTRY.y>SPAWN.y);assert.ok(ENTRY.x<SPAWN.x);assert.equal(locationAt(ENTRY),'Entrada do clube');
 for(const place of PLACES){assert.equal(waterAt(place.x,place.y),false);assert.equal(walkSurface(place.x,place.y),true,place.id);}
 // Every shared court footprint has run-off space around all four baseline edges.
 for(const c of COURTS){const g=c.grounds;assert.ok(c.x-g.x>=30);assert.ok(c.y-g.y>=40);assert.ok(g.x+g.w-c.x-c.width>=30);assert.ok(g.y+g.h-c.y-c.height>=40);}
});
test('latest annotated plan restores beach tennis and footvolley without trees inside them',()=>{
 assert.deepEqual(SAND_COURTS.map(c=>c.id),['beach','footvolley']);
 for(const c of SAND_COURTS){assert.equal(walkSurface(c.x+c.w/2,c.y+c.h/2),false);assert.equal(TREES.filter(t=>t.x>c.x&&t.x<c.x+c.w&&t.y>c.y&&t.y<c.y+c.h).length,0);}
 const objects=sceneObjectsIn({x:480,y:440,w:550,h:225});assert.equal(objects.filter(o=>o.kind==='sandnet').length,2);
 assert.ok(BUILDINGS.some(b=>b.kind==='entryhouse'));assert.ok(BUILDINGS.some(b=>b.kind==='entrycabin'));
 // The introduction must follow the street and turn into the side opening.
 assert.ok(ENTRY_ROUTE.length>=3);
 for(let n=0;n<=200;n++){const p=entryPosition(n/200);assert.ok(walkSurface(p.x,p.y),`intro ${n}`);}
});
test('bar is straight and has walkable stairs joining its deck',()=>{
 const bar=BUILDINGS.find(b=>b.id==='bar-wing'),bounds=buildingBounds(bar);
 assert.equal(bar.rotation||0,0);assert.deepEqual(bounds,{x:229,y:509,w:262,h:162});assert.ok(bounds.x+bounds.w<BAR_STAIRS.x+BAR_STAIRS.w/2-5);
 assert.equal(BAR_STAIRS.y+BAR_STAIRS.h,TERRACE[1]);
 assert.ok(buildingCollision(380,580,bar));assert.equal(walkSurface(380,580),false);
 // Courtyard remains open in front of the straight building.
 assert.equal(buildingCollision(516,930,bar,5),false);assert.equal(walkSurface(516,930),true);
 for(let y=BAR_STAIRS.y+6;y<BAR_STAIRS.y+BAR_STAIRS.h;y+=8){
  assert.equal(walkSurface(BAR_STAIRS.x+BAR_STAIRS.w/2,y),true,`stair tread ${y}`);
  assert.equal(locationAt({x:BAR_STAIRS.x+BAR_STAIRS.w/2,y}),'Bar e deck do Ilha');
 }
});
test('landscaped sketch fixes landmark trees, gravel, northwest parking and eastern cabin',()=>{
 const coconuts=LANDMARK_TREES.filter(t=>t.id.startsWith('sketch-coconut'));
 assert.equal(coconuts.length,6);assert.deepEqual(coconuts.slice(0,3).map(t=>[t.x,t.y]),[[748,482],[748,546],[748,629]]);
 for(const tree of LANDMARK_TREES)assert.ok(TREES.some(t=>t.id===tree.id&&t.x===tree.x&&t.y===tree.y));
 assert.ok(BUILDINGS.find(b=>b.id==='bar-wing').y<SAND_COURTS[0].y+60);
 const cabin=BUILDINGS.find(b=>b.id==='wood-cabin');assert.equal(cabin.kind,'woodcabin');assert.ok(cabin.x>COURTS[1].grounds.x+COURTS[1].grounds.w);
 assert.ok(PARKING[0]<BUILDINGS.find(b=>b.id==='entry-house').x);assert.equal(CARS.filter(([x])=>x<600).length,6);
 for(const p of [[530,1190],[864,1180],[760,1300]]){assert.ok(gravelAt(...p));assert.equal(terrainAt(...p),'gravel');assert.ok(walkSurface(...p));}
 assert.ok(PICKLEBALL_CAMERA.x<PICKLEBALL.x&&PICKLEBALL_CAMERA.y<PICKLEBALL.y);
 assert.ok(PICKLEBALL_CAMERA.x+PICKLEBALL_CAMERA.w>PICKLEBALL.x+PICKLEBALL.w);
 assert.ok(PICKLEBALL_CAMERA.y+PICKLEBALL_CAMERA.h>PICKLEBALL.y+PICKLEBALL.h);
});
test('court cameras include their real net and foreground fence in stable depth order',()=>{
 for(const court of COURTS){const objects=sceneObjectsIn(court.focus);const net=objects.find(o=>o.kind==='net'&&o.court.id===court.id);assert.ok(net);assert.equal(net.depth,courtPoint(240,249,court.id).y);assert.ok(objects.some(o=>o.kind==='fence'&&o.depth>net.depth));for(let i=1;i<objects.length;i++)assert.ok(objects[i].depth>=objects[i-1].depth);}
 const all=sceneObjectsIn({x:0,y:0,w:WORLD_SIZE,h:WORLD_SIZE});assert.equal(all.filter(o=>o.kind==='net').length,2);
 assert.equal(sceneObjectsIn({x:-500,y:-500,w:10,h:10}).length,0);
});
test('exploration, tennis, minimap and previews share the native scene, no old background image',async()=>{
 for(const file of ['world.js','render.js']){const s=await readFile(new URL(`../games/${file}`,import.meta.url),'utf8');assert.match(s,/renderClub/);assert.doesNotMatch(s,/mapAsset|MAP_URL|club-rpg-map-v3/);}
 const renderer=await readFile(new URL('../games/scenery-renderer.js',import.meta.url),'utf8');assert.match(renderer,/drawActor/);assert.match(renderer,/water\(ctx,camera,time\)/);assert.doesNotMatch(renderer,/new Image|\.png|\.jpg/);
 const build=await readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8');for(const file of ['scenery-data.js','scenery-plants.js','scenery-renderer.js'])assert.ok(build.includes(file));
});
test('transparent foliage indexing preserves all eight sprites and their trunk anchors',()=>{
 const width=400,height=240,data=new Uint8ClampedArray(width*height*4);
 for(let row=0;row<2;row++)for(let col=0;col<4;col++){
  const left=col*100+8,top=row*120+8;
  // Wide crown then a narrow off-center trunk: padding must not shift the feet.
  for(let y=top;y<top+72;y++)for(let x=left;x<left+83;x++)data[(y*width+x)*4+3]=253;
  for(let y=top+72;y<top+103;y++)for(let x=left+49;x<left+56;x++)data[(y*width+x)*4+3]=253;
 }
 const frames=indexPlantFrames({data,width,height});assert.equal(frames.length,8);
 for(let i=0;i<frames.length;i++){
  const frame=frames[i];assert.equal(frame.x,(i%4)*100+8);assert.equal(frame.y,Math.floor(i/4)*120+8);
  assert.equal(frame.w,83);assert.equal(frame.h,103);assert.equal(frame.anchor,52);
 }
 assert.ok(indexPlantFrames({data:new Uint8ClampedArray(width*height*4),width,height}).every(frame=>frame===null));
});
test('foliage props have distinct palms, versioned art and a server-safe native fallback',async()=>{
 assert.equal(await plantsReady,false);assert.equal(PLANT_HEIGHTS.length,8);
 assert.equal(plantIndex({kind:'palm',variant:0}),4);assert.equal(plantIndex({kind:'palm',variant:1}),5);
 for(let v=0;v<8;v++)assert.ok(plantIndex({kind:'tree',variant:v})<4);
 const bytes=await readFile(new URL(`..${FOLIAGE_ATLAS_URL}`,import.meta.url));assert.equal(bytes.toString('ascii',8,12),'WEBP');assert.equal(bytes.toString('ascii',12,16),'VP8L','lossless transparent foliage');
 const world=await readFile(new URL('../games/world.js',import.meta.url),'utf8');assert.match(world,/Promise\.all\(\[heroesReady,sceneryReady\]\)/);
 const renderer=await readFile(new URL('../games/scenery-renderer.js',import.meta.url),'utf8');assert.match(renderer,/if\(!drawPlant/);assert.match(renderer,/minimap=null/);assert.match(renderer,/obscures/);
});
