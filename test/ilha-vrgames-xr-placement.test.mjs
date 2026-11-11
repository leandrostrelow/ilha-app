import test from 'node:test';import assert from 'node:assert/strict';import {alignPlayer} from '../vrgames/xr-placement.js';
test('arrival and court placement preserve the chosen head position and facing direction',()=>{
 for(const head of [{x:0,z:0},{x:1.7,z:-2.4},{x:-3,z:.5}])for(const headYaw of [0,Math.PI/2,-2.3])for(const destination of [{x:27,z:11},{x:0,z:.75}]){
  const heading=destination.x?Math.atan2(21,20):0,p=alignPlayer(head,headYaw,destination,heading),c=Math.cos(p.yaw),s=Math.sin(p.yaw);
  assert.ok(Math.abs(p.x+c*head.x+s*head.z-destination.x)<1e-10);
  assert.ok(Math.abs(p.z-s*head.x+c*head.z-destination.z)<1e-10);
  assert.ok(Math.abs(p.yaw+headYaw-heading)<1e-10);
 }
});
