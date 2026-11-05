import test from 'node:test';
import assert from 'node:assert/strict';
import {createRacketMatch,shotPlan,shotContact,preparationTime,canPrepare,launchBall,stepRacketMatch} from '../games/racket-match.js';

test('identical full-power shots land in from the back and long from midfield',()=>{
 for(const sport of ['tennis','pickleball'])for(const horizontal of [false,true]){
  const s=createRacketMatch({sport,horizontal,assisted:true});
  const deep=shotPlan(s,{aim:0,power:1},{x:.5,y:1.08}),short=shotPlan(s,{aim:0,power:1},{x:.5,y:.72});
  assert.equal(deep.outside,false);assert.equal(short.outside,true);assert.ok(short.y<0);
  assert.equal(deep.color,'#ff7970');assert.equal(short.color,'#ff7970');
 }
});
test('cross-court has real extra room; the same-side line cannot absorb full power',()=>{
 const s=createRacketMatch({assisted:true});
 for(const [x,sign] of [[.1,1],[.9,-1]]){
  const contact={x,y:.8},straight=shotPlan(s,{aim:0,power:1},contact),cross=shotPlan(s,{aim:sign*.7,power:1},contact);
  assert.equal(straight.outside,true);assert.equal(cross.outside,false);assert.ok(cross.y>straight.y);
  const back={x,y:1.08},sameSide=shotPlan(s,{aim:-sign*.9,power:1},back),opposite=shotPlan(s,{aim:sign*.9,power:1},back);
  assert.equal(sameSide.outside,true);assert.equal(opposite.outside,false);assert.equal(opposite.cross,true);
 }
});
test('forecasts mirror left/right and power changes a continuous unclamped trajectory',()=>{
 const s=createRacketMatch({assisted:true});
 for(const shot of ['normal','slice','drop'])for(const power of [.2,.6,.8,1])for(const aim of [-.9,-.4,0,.4,.9]){
  const a=shotPlan(s,{shot,aim,power},{x:.2,y:.9}),b=shotPlan(s,{shot,aim:-aim,power},{x:.8,y:.9});
  assert.ok(Math.abs(a.x+b.x-1)<1e-9);assert.ok(Math.abs(a.y-b.y)<1e-9);assert.equal(a.outside,b.outside);
 }
 const endpoints=Array.from({length:101},(_,i)=>shotPlan(s,{power:i/100},{x:.5,y:.75}));
 for(let i=1;i<endpoints.length;i++){assert.ok(endpoints[i].y<=endpoints[i-1].y);assert.ok(Math.abs(endpoints[i].y-endpoints[i-1].y)<.03);}
 assert.ok(endpoints.at(-1).y<0,'not silently clamped to the baseline');
});
test('actual racket contact, not the earlier player position, determines the outgoing flight',()=>{
 for(const fps of [30,60,120]){
  const s=createRacketMatch({assisted:true});s.cpu.y=.1;launchBall(s,'cpu','normal',.68,.88,{flight:1.2});
  const q={shot:'normal',aim:-.64,power:.85};let expected;
  for(let f=0;f<fps*5&&!s.returns;f++){
   const before=shotPlan(s,q,{x:s.ball.x,y:s.ball.y});stepRacketMatch(s,{coach:true,stroke:canPrepare(s)?q:null},1/fps);
   if(s.returns)expected=before;
  }
  assert.equal(s.returns,1);assert.ok(Math.abs(s.ball.endX-expected.x)<1e-9);assert.ok(Math.abs(s.ball.endY-expected.y)<1e-9);
 }
});
test('forecast predicts the bounce contact rather than treating every incoming ball as deep',()=>{
 const s=createRacketMatch({assisted:true});s.cpu.y=.15;launchBall(s,'cpu','drop',.6,.62,{flight:1});
 const projected=shotContact(s);assert.ok(projected.y<.85);assert.ok(projected.x>.5);
 assert.equal(shotPlan(s,{power:1}).outside,true);
});
test('fast-rally preparation opens early and completes faster without removing recovery',()=>{
 for(const rally of [0,20]){
  const s=createRacketMatch({assisted:true,difficulty:1.16});s.rally=rally;
  launchBall(s,'cpu','normal',.65,.88,{flight:1});
  assert.equal(canPrepare(s),false);s.ball.age=.06;assert.equal(canPrepare(s),true);
  s.recoverUntil=s.elapsed+.1;assert.equal(canPrepare(s),false);
  s.recoverUntil=0;const delay=preparationTime(s,1);assert.ok(delay>=.09);assert.ok(delay<=(rally?.14:.20));
 }
});
test('late outgoing preparation survives the CPU return but never leaks into the next point',()=>{
 const s=createRacketMatch({assisted:true});s.elapsed=2;s.cpu={...s.cpu,x:.5,y:.2};
 launchBall(s,'player','normal',.5,.2,{flight:1});
 assert.equal(canPrepare(s),false);
 Object.assign(s.ball,{x:.5,y:.21,z:.06,vx:0,vy:-.2,vz:-.1,bounces:1,bounceAt:1.7,age:1.3});s.recoverUntil=0;
 assert.equal(canPrepare(s),true);const q={shot:'slice',aim:.4,power:.5};
 stepRacketMatch(s,{stroke:q});assert.equal(s.ball.last,'cpu');assert.equal(s.prepared.shot,'slice');
 // Force an untouched second bounce on the player side. The buffer must clear.
 Object.assign(s.ball,{x:.5,y:.8,z:.001,vz:-1,bounces:1,bounceAt:s.elapsed-.3});
 s.player.x=0;s.player.y=1.1;stepRacketMatch(s,{});
 assert.ok(s.delay>0);assert.equal(s.prepared,null);
});
test('service preview keeps its own diagonal box and fault rules',()=>{
 const s=createRacketMatch({assisted:true});
 assert.equal(shotPlan(s,{shot:'serve',aim:0,power:.6}).outside,false);
 assert.equal(shotPlan(s,{shot:'serve',aim:0,power:1}).outside,false);
 assert.equal(shotPlan(s,{shot:'serve',aim:1,power:1}).outside,true);
 assert.equal(shotPlan(s,{shot:'normal',aim:0,power:1},{x:.5,y:1.08}).outside,false);
});
