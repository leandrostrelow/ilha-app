import test from 'node:test';
import assert from 'node:assert/strict';
import {nightAmount,boatPosition,fishPosition,sceneClock,ambientCue,windStrength,treeSway,cloudPosition,drawWeather,clayDust} from '../games/scenery-life.js';
import {waterAt,COURTS,walkSurface} from '../games/scenery-data.js';
import {routeTo,clearPath} from '../games/world-model.js';
import {readFileSync} from 'node:fs';
test('weather has quiet intervals, bounded tree sway and smoothly moving clouds',()=>{
 assert.equal(windStrength(0),0);assert.equal(windStrength(25),0);assert.equal(windStrength(12),1);
 const tree={x:300,y:600,kind:'palm'};assert.equal(treeSway(25,tree),0);
 for(let t=0;t<760;t+=.2){assert.ok(windStrength(t)>=0&&windStrength(t)<=1);assert.ok(Math.abs(treeSway(t,tree))<=.035);for(let i=0;i<4;i++){const p=cloudPosition(t,i);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));}}
 assert.ok(cloudPosition(11,0).x>cloudPosition(10,0).x);
});
test('clay dust appears only in strong gusts and stays off the singles courts',()=>{
 assert.deepEqual(clayDust(0),[]);assert.deepEqual(clayDust(25),[]);assert.equal(clayDust(12).length,48);
 for(let t=0;t<76;t+=.2)for(const p of clayDust(t)){
  assert.ok(p.alpha>=0&&p.alpha<=.20);
  assert.ok(COURTS.every(c=>p.x<c.x||p.x>c.x+c.width||p.y<c.y||p.y>c.y+c.height));
 }
});
test('weather rendering is bounded and restores canvas state',()=>{
 let depth=0,paths=0;const alphas=[];const c={save(){depth++;},restore(){depth--;},set globalAlpha(v){alphas.push(v);},beginPath(){paths++;},moveTo(){},bezierCurveTo(){},quadraticCurveTo(){},fill(){},fillRect(){},stroke(){}};
 drawWeather(c,{x:0,y:0,w:1536,h:1536},12);assert.equal(depth,0);assert.ok(paths<=16);assert.ok(alphas.every(a=>a>=0&&a<=.24));
 const renderer=readFileSync(new URL('../games/scenery-renderer.js',import.meta.url),'utf8');assert.match(renderer,/if\(animate\)drawWeather/);assert.match(renderer,/animate\?lifeTime:null/);
});
test('day and night alternate every three minutes with smooth transitions',()=>{
 assert.equal(nightAmount(0),0);assert.equal(nightAmount(168),0);assert.equal(nightAmount(174),.5);assert.equal(nightAmount(180),1);assert.equal(nightAmount(348),1);assert.equal(nightAmount(354),.5);assert.equal(nightAmount(360),0);assert.equal(nightAmount(540),1);
 for(let t=0;t<900;t+=.1){assert.ok(nightAmount(t)>=0&&nightAmount(t)<=1);assert.ok(Math.abs(nightAmount(t)-nightAmount(t+.1))<.02);}
});
test('scene clock ignores tab suspension and shares elapsed time between game views',()=>{
 assert.equal(sceneClock(1000),0);assert.equal(sceneClock(1100),.1);assert.equal(sceneClock(1200),.2);assert.equal(sceneClock(200000),.2);assert.equal(sceneClock(200100),.30000000000000004);
});
test('boat and jumping fish remain in the river, with quiet intervals',()=>{
 assert.equal(boatPosition(50),null);assert.equal(fishPosition(5),null);
 for(let t=0;t<190;t+=.2){const boat=boatPosition(t);if(boat)assert.ok(waterAt(boat.x,boat.y));for(let i=0;i<3;i++){const fish=fishPosition(t,i);if(fish)assert.ok(waterAt(fish.x,fish.y));}}
 assert.equal(ambientCue(19,{x:0,y:0,w:10,h:10}),null);
});
test('pickleball promenade is reachable from both sides without entering the court',()=>{
 const stops=[{x:520,y:1200},{x:520,y:1326},{x:842,y:1300},{x:946,y:1240},{x:960,y:1122}];
 for(const a of stops){assert.ok(walkSurface(a.x,a.y),JSON.stringify(a));for(const b of stops){const route=routeTo(a,b);assert.ok(route.length);let prev=a;for(const p of route){assert.ok(clearPath(prev,p));prev=p;}}}
 assert.equal(COURTS.length,2);
});
test('opening is decluttered and the entrance reuses the native game logo',()=>{
 const html=readFileSync(new URL('../games/index.html',import.meta.url),'utf8');assert.equal((html.match(/data-club-preview="cover"/g)||[]).length,3);assert.match(html,/<h2>Bem-vindo ao Ilha Tênis<\/h2>/);assert.doesNotMatch(html,/UMA AVENTURA DA NOSSA TURMA|Mais que um clube\. Uma jornada\.|Um lugar para/);
 const renderer=readFileSync(new URL('../games/scenery-renderer.js',import.meta.url),'utf8');assert.match(renderer,/drawGameLogo\(ctx,gx/);assert.doesNotMatch(renderer,/fillText\('BAR',x\+w\/2-14/);assert.match(renderer,/drawNight\(ctx/);
});
