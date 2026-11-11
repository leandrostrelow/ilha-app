import test from 'node:test';
import assert from 'node:assert/strict';
import {canStand,moveOnGround,walkDelta,thumbstick,turnAroundHead,registerTrunk,clearTrunks} from '../vrgames/navigation.js';
import {SPORTS,sportFeed,sportReturn,stepSport} from '../vrgames/club-sports.js';

test('walking passes through the entry and court gates, but not fences, bar or river',()=>{
 assert.equal(canStand(26.3,-46.8),true);
 assert.ok(moveOnGround({x:26.3,z:-46.8},-6,0).x<21);
 assert.ok(moveOnGround({x:26.3,z:-40},-6,0).x>24.5);
 assert.ok(moveOnGround({x:0,z:6.8},0,-6).z<1);
 assert.ok(moveOnGround({x:14.8,z:6.8},0,-6).z<1);
 assert.ok(moveOnGround({x:19,z:6.8},0,-12).z>4.5);
 assert.ok(moveOnGround({x:-12,z:-25},0,-30).z>-27.65);
 assert.ok(moveOnGround({x:29,z:10},100,0).x<=30.4);
 assert.ok(moveOnGround({x:0,z:18},0,100).z<=20.5);
});
test('walking normalizes diagonals and ignores head pitch',()=>{
 const a=walkDelta({x:0,z:-1},{x:0,y:1},1),b=walkDelta({x:0,z:-.5},{x:1,y:1},1);
 assert.ok(Math.abs(Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))<1e-8);
 assert.ok(a.z<0);assert.ok(b.x>0&&b.z<0);
 const side=walkDelta({x:-1,z:0},{x:0,y:1},1);assert.ok(side.x<0&&Math.abs(side.z)<1e-8);
});
test('Quest input reads standard thumbstick axes, rejects drift and missing controllers',()=>{
 assert.deepEqual(thumbstick(null),{x:0,y:0});
 assert.deepEqual(thumbstick({gamepad:{mapping:'xr-standard',axes:[.9,.9,.1,-.08]}}),{x:0,y:0});
 assert.deepEqual(thumbstick({gamepad:{mapping:'xr-standard',axes:[0,0,1,-1]}}),{x:1,y:1});
 assert.deepEqual(thumbstick({gamepad:{mapping:'other',axes:[1,-1]}}),{x:0,y:0});
});
test('snap turns preserve the world position of a head offset from the XR origin',()=>{
 for(const angle of [-Math.PI/6,Math.PI/6,Math.PI]){
  const origin={x:10,z:-25},head={x:11.7,z:-27.4},p=turnAroundHead(origin,head,angle);
  const lx=head.x-origin.x,lz=head.z-origin.z;
  assert.ok(Math.abs(p.x+Math.cos(angle)*lx+Math.sin(angle)*lz-head.x)<1e-9);
  assert.ok(Math.abs(p.z-Math.sin(angle)*lx+Math.cos(angle)*lz-head.z)<1e-9);
 }
});
test('beach feed reaches the racket in the air; pickleball arrives after one bounce',()=>{
 for(const kind of Object.keys(SPORTS))for(const hand of [-1,1]){
  const b=sportFeed(kind,hand);let reached=false;
  for(let i=0;i<1000&&b.active;i++){
   const e=stepSport(b,kind,1/180);assert.notEqual(e?.type,'net');
   if(b.p.z>=SPORTS[kind].contact){assert.equal(b.bounces,kind==='pickle'?1:0);assert.ok(b.p.y>.9&&b.p.y<1.6);reached=true;break;}
  }
  assert.ok(reached,kind);
 }
});
test('both sports return to alternating targets and end missed feeds',()=>{
 for(const kind of Object.keys(SPORTS)){
  for(const target of [-1.9,1.9]){
   const b=sportFeed(kind);while(b.p.z<SPORTS[kind].contact)stepSport(b,kind,1/240);
   sportReturn(b,kind,target);let event;
   for(let i=0;i<1000&&b.active;i++)event=stepSport(b,kind,1/240)||event;
   assert.equal(event.type,'in');assert.ok(Math.abs(event.x-target)<.03);
  }
  const missed=sportFeed(kind);let event;for(let i=0;i<2000&&missed.active;i++)event=stepSport(missed,kind,1/180)||event;
  assert.equal(event.type,'miss');
 }
});

test('walking stops before scene-registered trunks and can slide around them',()=>{
 clearTrunks();registerTrunk(0,12,.3);
 try{const stopped=moveOnGround({x:0,z:10},0,5);assert.ok(stopped.z<11.5);const aside=moveOnGround(stopped,1,0);const passed=moveOnGround(aside,0,3);assert.ok(passed.z>13);}finally{clearTrunks();}
});
