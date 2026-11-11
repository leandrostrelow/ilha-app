import test from 'node:test';import assert from 'node:assert/strict';
import {makeFeed,advanceBall,racketContact,returnBall,NET} from '../vrgames/physics.js';
test('beginner feeds clear the net and reach the racket after exactly one bounce',()=>{
 for(const side of [-1,1])for(let n=0;n<12;n++){const b=makeFeed(side,n);let arrived=false;
  for(let i=0;i<720&&b.active;i++){const e=advanceBall(b,1/180);assert.notEqual(e?.type,'net');if(b.p.z>=-.8){assert.equal(b.bounces,1);assert.ok(b.p.y>.65&&b.p.y<1.4);assert.ok(Math.abs(b.p.x)<.7);arrived=true;break;}}
  assert.ok(arrived);
 }
});
test('assisted returns land within the opposite singles court and preserve aim',()=>{
 for(const x of [-2.8,0,2.8]){const b=makeFeed();while(b.p.z<-.8)advanceBall(b,1/240);returnBall(b,x);let result;
  for(let n=0;n<1000&&b.active;n++)result=advanceBall(b,1/240)||result;
  assert.equal(result.type,'in');assert.ok(Math.abs(result.x-x)<.04);assert.ok(result.z<NET);
 }
});
test('second bounce ends the attempt; low returns hit the net; wide balls are out',()=>{
 let b=makeFeed(),e;for(let n=0;n<1200&&b.active;n++)e=advanceBall(b,1/180)||e;assert.equal(e.type,'miss');
 b={p:{x:0,y:.4,z:NET+.1},v:{x:0,y:0,z:-10},active:true,hit:true,age:0,bounces:0};assert.equal(advanceBall(b,.03).type,'net');
 b=makeFeed();while(b.p.z<-.8)advanceBall(b,1/240);returnBall(b,4.8);for(let n=0;n<1000&&b.active;n++)e=advanceBall(b,1/240)||e;assert.equal(e.type,'out');
});
test('swept face catches high-speed hits but excludes edge and parallel misses',()=>{
 assert.equal(racketContact({x:.05,y:.1,z:-1},{x:.06,y:.1,z:1}),true);
 assert.equal(racketContact({x:.5,y:0,z:-1},{x:.5,y:0,z:1}),false);
 assert.equal(racketContact({x:0,y:0,z:.3},{x:0,y:0,z:.3}),false);
 assert.equal(racketContact({x:0,y:0,z:.03},{x:0,y:0,z:.03}),true);
});
