import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vrgames/vendor/three.module.min.js';
import {questSettings,racketMount,trackedController,createQuestButtons,worldViewer} from '../vrgames/quest-input.js';
import {CLUB_PEOPLE,personPosition} from '../vrgames/club-life.js';
import {canStand,setPeopleColliders} from '../vrgames/navigation.js';

const source=hand=>({handedness:hand,targetRayMode:'tracked-pointer',gripSpace:{},profiles:['meta-quest-touch-plus','oculus-touch-v3'],gamepad:{mapping:'xr-standard',buttons:Array.from({length:7},()=>({pressed:false})),axes:[0,0,0,0]}});
test('all racket handles follow the WebXR grip axis; handed grips mirror their faces',()=>{
 const settings=questSettings();
 for(const kind of ['tennis','beach','pickle'])for(const hand of ['left','right']){
  const mount=racketMount(settings,kind,hand),shaft=new T.Vector3(0,1,0).applyQuaternion(mount.quaternion);
  assert.ok(shaft.distanceTo(new T.Vector3(0,0,-1))<1e-8,'handle must follow the held rod, not model-up');
  assert.equal(mount.position.length(),0);
 }
 const right=new T.Vector3(0,0,1).applyQuaternion(racketMount(settings,'tennis','right').quaternion),left=new T.Vector3(0,0,1).applyQuaternion(racketMount(settings,'tennis','left').quaternion);
 assert.ok(right.x*left.x<-.99);
 const continental=new T.Vector3(0,0,1).applyQuaternion(racketMount(settings,'beach','right').quaternion);
 assert.ok(Math.abs(continental.dot(right))<1e-8,'semi-western and continental use distinct bevels');
});
test('per-sport calibration is bounded and does not leak into another racket',()=>{
 const settings=questSettings({hand:'left',grips:{tennis:'continental',beach:'semiwestern'},adjustments:{tennis:{pitch:200,roll:-100,offset:3},pickle:{offset:'bad'}}});
 assert.equal(settings.grips.beach,'continental');assert.equal(settings.grips.tennis,'continental');
 assert.deepEqual(settings.adjustments.tennis,{pitch:35,roll:-45,offset:3});assert.deepEqual(settings.adjustments.beach,{pitch:0,roll:0,offset:0});
 assert.equal(racketMount(settings,'tennis','left').position.z,-.03);assert.equal(racketMount(settings,'pickle','left').position.length(),0);
});
test('Touch A/B/X edges fire once and ignore squeeze, trigger and system buttons',()=>{
 const input=createQuestButtons(),left=source('left'),right=source('right');input.sample(left,0);input.sample(right,0);
 right.gamepad.buttons[4].pressed=true;assert.deepEqual(input.sample(right,.1),['action']);assert.deepEqual(input.sample(right,.2),[]);
 right.gamepad.buttons[4].pressed=false;right.gamepad.buttons[5].pressed=true;assert.deepEqual(input.sample(right,.3),['back']);
 left.gamepad.buttons[4].pressed=true;assert.deepEqual(input.sample(left,.4),['menu']);
 for(const index of [0,1,3,6])right.gamepad.buttons[index].pressed=true;assert.deepEqual(input.sample(right,.5),[]);
});
test('Y requires a deliberate hold, fires once and must be released after tracking returns',()=>{
 const input=createQuestButtons(),left=source('left');input.sample(left,0);left.gamepad.buttons[5].pressed=true;assert.deepEqual(input.sample(left,.1),[]);assert.deepEqual(input.sample(left,.8),[]);assert.deepEqual(input.sample(left,.91),['recenter']);assert.deepEqual(input.sample(left,2),[]);
 input.sample(left,3,false);assert.deepEqual(input.sample(left,4),[]);assert.deepEqual(input.sample(left,8),[]);
 left.gamepad.buttons[5].pressed=false;input.sample(left,9);left.gamepad.buttons[5].pressed=true;input.sample(left,10);assert.deepEqual(input.sample(left,10.9),['recenter']);
});
test('lost, inferred or hand-only poses cannot drive a racket',()=>{
 const controller=source('right');assert.equal(trackedController(controller,{}),true);assert.equal(trackedController(controller,null),false);assert.equal(trackedController(controller,{emulatedPosition:true}),false);assert.equal(trackedController(controller,{},false),false);assert.equal(trackedController({...controller,hand:{}},{}),false);
});
test('ambient walkers stay on their routes and people block walking without blocking activity entries',()=>{
 for(const person of CLUB_PEOPLE.filter(p=>p.end))for(let t=0;t<200;t+=.7){const p=personPosition(person,t);assert.ok(p.x>=Math.min(person.x,person.end[0])&&p.x<=Math.max(person.x,person.end[0]));assert.ok(p.z>=Math.min(person.z,person.end[1])&&p.z<=Math.max(person.z,person.end[1]));assert.ok(canStand(p.x,p.z,.15));}
 setPeopleColliders([{x:0,z:8,radius:.27}]);try{assert.equal(canStand(0,8),false);for(const [x,z]of [[0,6.8],[26.3,-46.8],[-9.8,-24],[0,-28.4],[17,12]])assert.ok(canStand(x,z));}finally{setPeopleColliders([]);}
});

test('VR menu and nearby NPCs use the current headset pose after walking and turning',()=>{
 const rig=new T.Group(),camera=new T.PerspectiveCamera(),head=new T.Vector3(),forward=new T.Vector3();
 rig.position.set(25,0,-40);rig.rotation.y=Math.PI/2;
 const pose={transform:{position:{x:1,y:1.7,z:-2},orientation:{x:0,y:0,z:0,w:1}}};
 worldViewer(pose,rig,camera,head,forward);
 assert.ok(head.distanceTo(new T.Vector3(23,1.7,-41))<1e-8);
 assert.ok(forward.distanceTo(new T.Vector3(-1,0,0))<1e-8);
 const panel=head.clone().addScaledVector(forward,1.45);
 assert.ok(Math.abs(panel.distanceTo(head)-1.45)<1e-8);
 assert.ok(panel.x<22&&panel.z<-40,'menu stays in front of the player at the club, not near the XR origin');
 rig.position.set(-12,0,5);rig.rotation.y=0;worldViewer(pose,rig,camera,head,forward);
 assert.ok(head.distanceTo(new T.Vector3(-11,1.7,3))<1e-8);
});
