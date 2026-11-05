import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {barSpriteBounds,buildingsReady,drawBar} from '../games/scenery-buildings.js';
import {BUILDINGS} from '../games/scenery-data.js';
import {PRACTICAL_LIGHTS} from '../games/scenery-lighting.js';

const bar=BUILDINGS.find(b=>b.id==='bar-wing');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('bar keeps its native proportions, horizontal center and front step',()=>{
 const before=JSON.stringify(bar),source={w:1600,h:770},box=barSpriteBounds(bar,source);
 near(box.w/box.h,source.w/source.h);
 near(box.x+box.w/2,bar.x+bar.w/2);near(box.y+box.h,bar.y+bar.h);
 near(box.w,278);near(box.h,133.7875);assert.ok(box.h<bar.h);
 assert.equal(JSON.stringify(bar),before);
});
test('fit is uniform for landscape, portrait and scaled footprints without overflow',()=>{
 for(const source of [{w:1600,h:770},{w:200,h:300},{w:100,h:100}])for(const factor of [.5,1,2]){
  const footprint={...bar,w:bar.w*factor,h:bar.h*factor},box=barSpriteBounds(footprint,source);
  near(box.w/source.w,box.h/source.h);near(box.y+box.h,footprint.y+footprint.h);
  assert.ok(box.w<=footprint.w+16+1e-9&&box.h<=footprint.h+1e-9);
 }
 assert.equal(barSpriteBounds(bar,{w:0,h:100}),null);
});
test('loader crops transparent padding but never stretches the source into an intermediate rectangle',async()=>{
 const width=170,height=90,data=new Uint8ClampedArray(width*height*4),canvases=[];
 for(let y=5;y<82;y++)for(let x=5;x<165;x++)data[(y*width+x)*4+3]=255;
 const source=readFileSync(new URL('../games/scenery-buildings.js',import.meta.url),'utf8').replaceAll('export ','');
 const module=runInNewContext(source+';({buildingsReady,drawBar})',{
  Image:class{naturalWidth=width;naturalHeight=height;decode(){return Promise.resolve();}},
  document:{createElement(){const canvas={getContext:()=>({drawImage(){},getImageData:()=>({data,width,height})})};canvases.push(canvas);return canvas;}}
 });
 assert.equal(await module.buildingsReady,true);assert.equal(canvases.length,1,'only alpha inspection canvas, no stretching cache');
 let draw;assert.equal(module.drawBar({drawImage(...args){draw=args;}},bar),true);
 assert.deepEqual(Array.from(draw.slice(1,5)),[5,5,160,77]);
 near(draw[7]/draw[3],draw[8]/draw[4]);near(draw[6]+draw[8],bar.y+bar.h);
});
test('server-side import keeps the native building fallback available',async()=>{
 assert.equal(await buildingsReady,false);assert.equal(drawBar({},bar),false);
});
test('night emitters follow the fitted facade instead of floating on the roof',()=>{
 const box=barSpriteBounds(bar,{w:1600,h:770});
 for(const lamp of PRACTICAL_LIGHTS.filter(l=>l.kind==='bar'))assert.ok(lamp.y>box.y+box.h*.28&&lamp.y<box.y+box.h*.34);
 const counter=PRACTICAL_LIGHTS.find(l=>l.kind==='counter');assert.ok(counter.y>box.y+box.h*.60&&counter.y<box.y+box.h*.68);
});
