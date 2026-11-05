import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HALLOWEEN_SPRITES,HALLOWEEN_ATLAS_URL,atlasCell,alphaBounds,fitDecoration,halloweenSpritesReady,drawHalloweenSprite} from '../game2/halloween-sprites.js';
import {DECORATIONS,HALLOWEEN_LIGHTS,WEB_ANCHORS,decorationObscured,decorationsTooClose,decorationTouchesCourt,halloweenProps,drawHalloweenAtmosphere} from '../game2/halloween-art.js';
import {COURTS,BUILDINGS,RECT_SOLIDS} from '../game2/scenery-data.js';

test('Halloween art uses a versioned transparent 4×2 atlas and a smaller lossless delivery',()=>{
 const png=readFileSync(new URL('../game2/assets/halloween-props-v1.png',import.meta.url)),webp=readFileSync(new URL('..'+HALLOWEEN_ATLAS_URL,import.meta.url));
 assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png[25],6);
 assert.equal(png.readUInt32BE(16),1536);assert.equal(png.readUInt32BE(20),1024);
 assert.equal(webp.subarray(8,12).toString(),'WEBP');assert.ok(webp.length<png.length);
 assert.equal(Object.keys(HALLOWEEN_SPRITES).length,8);
 for(const [i,def]of Object.values(HALLOWEEN_SPRITES).entries()){assert.equal(def.cell,i);assert.deepEqual(atlasCell(1536,1024,i),{x:i%4*384,y:Math.floor(i/4)*512,w:384,h:512});}
});
test('Atlas trim preserves transparent edges and fit never stretches a decoration',()=>{
 const pixels=new Uint8ClampedArray(10*12*4);for(let y=2;y<10;y++)for(let x=3;x<7;x++)pixels[(y*10+x)*4+3]=254;
 const trim=alphaBounds(pixels,10,12);assert.deepEqual(trim,{x:3,y:2,w:4,h:8});
 assert.deepEqual(fitDecoration(trim,{w:30,h:40}),{w:20,h:40});assert.equal(fitDecoration(null,{w:30,h:40}),null);
 assert.equal(alphaBounds(new Uint8ClampedArray(8*8*4),8,8),null);
});
test('Art missing in a headless/offline environment leaves native decorations available',async()=>{
 assert.equal(await halloweenSpritesReady,false);assert.equal(drawHalloweenSprite({},'pumpkin',10,10),false);
});
test('New props stay outside playing areas, cull off camera and never add collisions',()=>{
 const original=JSON.stringify({COURTS,BUILDINGS,RECT_SOLIDS});
 assert.ok(DECORATIONS.length>=25&&DECORATIONS.length<60);assert.ok(DECORATIONS.every(o=>!decorationTouchesCourt(o)));
 assert.ok(DECORATIONS.some(o=>o.propType==='lantern'));assert.ok(DECORATIONS.some(o=>o.propType==='gourd'));
 assert.equal(halloweenProps({x:-400,y:-400,w:100,h:100}).length,0);
 const nearby=halloweenProps({x:210,y:495,w:340,h:454});assert.ok(nearby.length>5&&nearby.length<DECORATIONS.length);
 assert.ok(nearby.every(p=>p.halloweenDecor));assert.equal(JSON.stringify({COURTS,BUILDINGS,RECT_SOLIDS}),original);
 assert.ok(HALLOWEEN_LIGHTS.every(l=>l.rx<=60&&l.ry<=50&&l.power<1));
});
test('Decorations have breathing room and webs stay inside supported facades',()=>{
 for(const [i,o]of DECORATIONS.entries()){
  assert.equal(decorationObscured(o),false,JSON.stringify(o));
  assert.ok(DECORATIONS.slice(i+1).every(p=>!decorationsTooClose(o,p)));
 }
 assert.equal(WEB_ANCHORS.length,6);
 for(const a of WEB_ANCHORS){
  assert.ok(a.size<=25);
  assert.ok(BUILDINGS.some(b=>a.x>b.x&&a.x<b.x+b.w&&a.y>b.y+35&&a.y+a.size<b.y+b.h));
 }
});
test('Light sprites are cached across frames; matches do not animate decorative flying bats',()=>{
 const previous=globalThis.document,calls=[];let allocations=0;
 const ctx=new Proxy({createRadialGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]||((...args)=>calls.push([k,...args])),set:()=>true});
 globalThis.document={createElement(){allocations++;return {getContext:()=>ctx};}};
 try{
  const camera={x:210,y:495,w:340,h:454};drawHalloweenAtmosphere(ctx,camera,1,true);const first=allocations;assert.ok(first>0&&first<=12);
  drawHalloweenAtmosphere(ctx,camera,2,true);assert.equal(allocations,first);
  const source=readFileSync(new URL('../game2/halloween-art.js',import.meta.url),'utf8');assert.match(source,/if\(!match\)for\(let i=0;i<6/);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
