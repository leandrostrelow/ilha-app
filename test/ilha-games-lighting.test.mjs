import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WORLD_SIZE,COURTS,SAND_COURTS,PICKLEBALL,DECOR,inRect} from '../games/scenery-data.js';
import {fireflyPosition} from '../games/scenery-life.js';
import {LIGHTMAP_SIZE,NIGHT_DARKNESS,LIGHT_POOLS,FLOODLIGHTS,PRACTICAL_LIGHTS,lightFalloff,darknessAt,drawSceneLighting,drawLightFixture} from '../games/scenery-lighting.js';

test('night floodlights share actual map posts and native pixel-scale emitters',()=>{
 assert.deepEqual(FLOODLIGHTS,DECOR.filter(o=>o.kind==='lamp'));
 assert.equal(LIGHTMAP_SIZE,WORLD_SIZE/2);assert.ok(LIGHTMAP_SIZE<=768);
 assert.equal(COURTS.length,2);
 for(const light of LIGHT_POOLS){assert.ok(light.rx>0&&light.ry>0);assert.ok(light.power>0&&light.power<1);assert.ok(light.warm>=0&&light.warm<.5);}
 const painted=[];const context={fillRect(...args){painted.push(args);}};
 for(const light of PRACTICAL_LIGHTS)drawLightFixture(context,light);
 assert.ok(painted.length>40);
});
test('light falloff is smooth, bounded and zero outside its footprint',()=>{
 const light={x:20,y:30,rx:100,ry:50};
 assert.equal(lightFalloff(light,20,30),1);
 assert.equal(lightFalloff(light,120,30),0);
 assert.equal(lightFalloff(light,20,81),0);
 let previous=1;
 for(let x=20;x<150;x+=.2){const value=lightFalloff(light,x,30);assert.ok(value<=previous+.000001&&value>=0);assert.ok(previous-value<.004);previous=value;}
});
test('both tennis courts and blue court stay readable while forest and roofs remain dark',()=>{
 for(const court of COURTS){
  for(let y=court.y;y<=court.y+court.height;y+=24)for(let x=court.x;x<=court.x+court.width;x+=18){
   assert.ok(darknessAt(x,y)<.54,`court ${court.id} at ${x},${y}`);
  }
  assert.ok(darknessAt(court.x+court.width/2,court.y+court.height/2)<.18);
 }
 assert.ok(darknessAt(PICKLEBALL.x+PICKLEBALL.w/2,PICKLEBALL.y+PICKLEBALL.h/2)<.18);
 assert.equal(darknessAt(200,950),NIGHT_DARKNESS);
 assert.equal(darknessAt(400,1000),.64);
 for(const [x,y]of [[520,872],[520,999],[501,600],[945,393],[1040,740]])assert.ok(darknessAt(x,y)<.54);
});
test('static darkness and warm bounce maps are cached across frames; daytime allocates nothing',()=>{
 const original=globalThis.document;let allocations=0,gradients=0;
 const makeContext=()=>({save(){},restore(){},scale(){},translate(){},fillRect(){},clearRect(){},drawImage(){},createRadialGradient(){gradients++;return {addColorStop(){}};}});
 globalThis.document={createElement(tag){assert.equal(tag,'canvas');allocations++;return {getContext:makeContext};}};
 try{
  const c=makeContext(),camera={x:200,y:500,w:800,h:600};
  drawSceneLighting(c,camera,0,0);assert.equal(allocations,0);
  drawSceneLighting(c,camera,1,220);assert.equal(allocations,3);
  const generated=gradients;assert.ok(generated>40);
  for(let i=0;i<120;i++)drawSceneLighting(c,camera,.5,174+i/60);
  assert.equal(allocations,3);assert.equal(gradients,generated);
 }finally{globalThis.document=original;}
});
test('lighting is shared by all scene consumers and gets versioned by the build',()=>{
 const read=file=>readFileSync(new URL(file,import.meta.url),'utf8');
 assert.match(read('../games/scenery-life.js'),/drawSceneLighting\(c,camera,night,time\)/);
 assert.match(read('../games/scenery-renderer.js'),/PRACTICAL_LIGHTS\.map/);
 assert.doesNotMatch(read('../games/scenery-lighting.js'),/getImageData|\.filter\s*=|setInterval|requestAnimationFrame/);
 assert.equal((read('../scripts/build.mjs').match(/'scenery-lighting.js'/g)||[]).length,2);
});
test('night fireflies stay away from the ball and all playable surfaces',()=>{
 const areas=[...COURTS.map(c=>c.grounds),...SAND_COURTS,PICKLEBALL];let count=0;
 for(let t=180;t<360;t+=.5)for(let i=0;i<16;i++){
  const p=fireflyPosition(t,i);if(!p)continue;count++;
  assert.ok(areas.every(a=>!inRect(p.x,p.y,[a.x,a.y,a.w,a.h],14)));
 }
 assert.ok(count>100);
});
