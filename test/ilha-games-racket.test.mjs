import test from 'node:test';
import assert from 'node:assert/strict';
import {createRacketMatch,stepRacketMatch,launchBall,canHit,inSingles,validLanding} from '../games/racket-match.js';
import {createRacketLesson,stepRacketLesson} from '../games/racket-lesson.js';
import {lessonTasks} from '../games/lesson.js';
import {racketWorld,racketPoint,tennisMatchCamera} from '../games/racket-renderer.js';
import {createMatchInput} from '../games/match-input.js';
import {COURTS,PICKLEBALL} from '../games/scenery-data.js';

const feed=(s,x=.5,y=.86)=>{s.cpu.x=.5;s.cpu.y=.12;launchBall(s,'cpu','normal',x,y,{flight:1.4});s.serveBounces=2;};
test('manual match moves on both axes, normalized diagonals and never crosses the net',()=>{
 const s=createRacketMatch(),before={...s.player};
 for(let i=0;i<30;i++)stepRacketMatch(s,{moveX:1,moveY:-1});
 assert.ok(s.player.x>before.x);assert.ok(s.player.y<before.y);
 const stopped={...s.player};stepRacketMatch(s);assert.equal(s.player.x,stopped.x);assert.equal(s.player.y,stopped.y);
 for(let i=0;i<500;i++)stepRacketMatch(s,{moveY:-1});assert.equal(s.player.y,.54);
 for(let i=0;i<500;i++)stepRacketMatch(s,{moveY:1});assert.equal(s.player.y,1.14);
});
test('standing on the ball is not an automatic swing; an early press expires',()=>{
 for(const early of [false,true]){
  const s=createRacketMatch();feed(s);s.player.y=.9;
  for(let i=0;i<220;i++)stepRacketMatch(s,{shot:early&&i===0?'normal':null,coach:true});
  assert.equal(s.returns,0);assert.equal(s.cpuPoints,1);
 }
});
test('each face button creates a distinct manual return, with no homing trajectory',()=>{
 const flights=[];
 for(const shot of ['normal','slice','drop']){
  const s=createRacketMatch();feed(s);s.player.y=.9;
  for(let i=0;i<150&&!canHit(s,'player');i++)stepRacketMatch(s,{coach:true});
  stepRacketMatch(s,{shot,coach:true});assert.equal(s.shotCounts[shot],1);assert.equal(s.ball.last,'player');
  const {vx,vy,endX,endY,flight}=s.ball;flights.push([flight,endY]);
  for(let i=0;i<20;i++)stepRacketMatch(s,{moveX:1,moveY:-1,coach:true});
  assert.equal(s.ball.vx,vx);assert.equal(s.ball.vy,vy);assert.equal(s.ball.endX,endX);assert.equal(s.ball.endY,endY);
 }
 assert.equal(new Set(flights.map(String)).size,3);
});
test('painted singles and pickleball lines use the same geometry as touch and rules',()=>{
 for(const sport of ['tennis','pickleball'])for(const court of [1,2])for(const x of [0,.5,1])for(const y of [0,.5,1]){
  const back=racketPoint(racketWorld(x,y,sport,court),sport,court);
  assert.ok(Math.abs(back.x-x)<1e-9);assert.ok(Math.abs(back.y-y)<1e-9);
 }
 const c=COURTS[0];assert.equal(racketWorld(0,0).x,c.x+18);assert.equal(racketWorld(1,0).x,c.x+c.width-18);
 assert.equal(racketWorld(0,1,'pickleball').x,PICKLEBALL.x+22);
 assert.equal(inSingles(0,1),true);assert.equal(inSingles(-.009,.5),false);assert.equal(inSingles(1.009,.5),false);
});
test('wide and long landings lose a point, lines are in, sides never reflect',()=>{
 for(const fps of [30,60,120])for(const sport of ['tennis','pickleball'])for(const [x,y,valid] of [[-.13,.16,false],[1.13,.16,false],[.5,-.12,false],[.5,.1,true],[0,.1,true],[1,.1,true]]){
  const s=createRacketMatch({sport});s.player.x=.5;s.player.y=.9;
  launchBall(s,'player','normal',x,y);
  const direction=Math.sign(s.ball.vx);
  for(let f=0;f<fps*3&&s.ball.active&&s.ball.bounces===0;f++){
   stepRacketMatch(s,{coach:true},1/fps);assert.equal(Math.sign(s.ball.vx),direction);
  }
  assert.equal(s.cpuPoints,valid?0:1,`${sport} ${x},${y}`);
  assert.equal(s.landing.valid,valid);
 }
});
test('a valid first bounce may exit the court; second bounce belongs to striker',()=>{
 const s=createRacketMatch();launchBall(s,'player','normal',.95,.08);
 for(let f=0;f<240&&!s.playerPoints;f++)stepRacketMatch(s,{coach:true});
 assert.equal(s.playerPoints,1);assert.equal(s.cpuPoints,0);assert.match(s.message,/Dois quiques/);
});
test('net, diagonal service box and second fault adjudication',()=>{
 const s=createRacketMatch();
 assert.equal(validLanding(s,{x:.25,y:.37,last:'player',serve:true,serviceSide:1}),true);
 assert.equal(validLanding(s,{x:.75,y:.37,last:'player',serve:true,serviceSide:1}),false);
 assert.equal(validLanding(s,{x:.25,y:.15,last:'player',serve:true,serviceSide:1}),false);
 for(let fault=0;fault<2;fault++){
  s.delay=0;s.ball={x:.5,y:.51,z:.01,vx:0,vy:-1,vz:0,active:true,last:'player',type:'serve',serve:true,bounces:0,age:0};
  stepRacketMatch(s,{coach:true});
  assert.equal(s.cpuPoints,fault===0?0:1);
 }
});
test('pickleball needs two initial bounces and forbids kitchen volleys',()=>{
 const s=createRacketMatch({sport:'pickleball'});s.player={...s.player,x:.5,y:.6};
 const incoming=()=>{s.ball={x:.5,y:.6,z:.06,vx:0,vy:.2,vz:0,active:true,last:'cpu',type:'normal',bounces:0,age:0};s.swingCooldown=0;s.swingQueue=null;};
 incoming();s.serveBounces=0;stepRacketMatch(s,{shot:'normal',coach:true});assert.equal(s.returns,0);assert.equal(s.cpuPoints,0);
 incoming();s.serveBounces=2;stepRacketMatch(s,{shot:'normal',coach:true});assert.equal(s.cpuPoints,1);assert.match(s.message,/cozinha/);
});
test('Gael and all six bosses finish and can be beaten with deliberate manual shots',()=>{
 for(const sport of ['tennis','pickleball'])for(const difficulty of sport==='tennis'?[.55,.65,.76,.87,1.02,1.16]:[.4])for(const fps of [30,60,120]){
  const s=createRacketMatch({sport,difficulty});let target={x:.5,y:.85},reaction=0,shotCooldown=0,shots=0;
  for(let f=0;f<fps*180&&!s.done;f++){
   reaction-=1/fps;shotCooldown-=1/fps;
   if(reaction<=0){reaction=.20;target=s.ball.active&&s.ball.last==='cpu'?{x:s.ball.endX,y:s.ball.endY+.055}:{x:.5,y:.82};}
   const legal=s.ball.bounces>0||(!s.ball.serve&&(sport==='tennis'||s.serveBounces>=2));
   const shot=canHit(s,'player')&&legal&&shotCooldown<=0?['normal','slice','drop'][shots++%3]:null;
   if(shot)shotCooldown=.30;
   stepRacketMatch(s,{target,shot,serve:true,aim:0},1/fps);
  }
  assert.ok(s.done,`${sport} ${difficulty} ${fps}fps`);assert.ok(s.playerPoints>s.cpuPoints);assert.ok(s.returns>=3);
 }
});
test('not swinging loses the match; waiting to serve does not spend a hidden timer',()=>{
 for(const sport of ['tennis','pickleball']){
  const s=createRacketMatch({sport,difficulty:.4});
  for(let f=0;f<12000;f++)stepRacketMatch(s);
  assert.equal(s.done,false);assert.equal(s.cpuPoints,0);
  for(let f=0;f<12000&&!s.done;f++)stepRacketMatch(s,{serve:true});
  assert.equal(s.done,true);assert.ok(s.cpuPoints>s.playerPoints);assert.equal(s.returns,0);
 }
});
test('the serve prompt disappears once the ball is in play',()=>{
 const s=createRacketMatch();stepRacketMatch(s,{serve:true});assert.equal(s.awaitingServe,false);assert.equal(s.feedback,'Saque!');
 launchBall(s,'cpu','normal',.4,.86);assert.equal(s.feedback,'Aproxime-se e bata');
});
test('new tie-break needs two points of advantage and stops at the 10–10 deciding point',()=>{
 for(const [a,b,done] of [[6,6,false],[7,6,true],[10,10,true]]){
  const s=createRacketMatch();s.playerPoints=a;s.cpuPoints=b;
  launchBall(s,'player','normal',.95,.1);
  for(let f=0;f<180&&s.playerPoints===a;f++)stepRacketMatch(s,{coach:true});
  assert.equal(s.playerPoints,a+1);assert.equal(s.done,done);
 }
});
test('Renato and Emerson teach manual swings; wrong buttons cannot complete tasks',()=>{
 for(const extra of [false,true]){
  const s=createRacketMatch(),l=createRacketLesson(s,extra);let cooldown=0;
  for(let f=0;f<6000&&!l.completed;f++){
   const task=lessonTasks(l)[l.index],b=s.ball;cooldown--;
   const shot=canHit(s,'player')&&cooldown<=0?task.id:null;if(shot)cooldown=20;
   stepRacketLesson(l,s,task.id==='move'?{moveX:f<20?-1:1,moveY:-1}:{target:b.active&&b.last==='cpu'?{x:b.endX,y:b.endY+.04}:null,serve:true,shot});
  }
  assert.ok(l.completed);assert.ok(s.shotCounts.normal>0);assert.ok(s.shotCounts.slice>0);assert.ok(s.shotCounts.drop>0);
 }
 const s=createRacketMatch(),l=createRacketLesson(s);l.index=3;
 for(let f=0;f<600;f++)stepRacketLesson(l,s,{target:{x:.5,y:.9},shot:canHit(s,'player')?'normal':null});
 assert.equal(l.index,3);assert.equal(s.playerPoints,0);assert.equal(s.cpuPoints,0);
});
test('the serve lesson waits for a real button press, not a single-frame opportunity',()=>{
 const s=createRacketMatch(),l=createRacketLesson(s);l.index=1;
 for(let f=0;f<600;f++)stepRacketLesson(l,s,{});
 assert.equal(s.awaitingServe,true);assert.equal(l.cooldown,0);assert.equal(s.shotCounts.serve,0);
 stepRacketLesson(l,s,{serve:true});assert.equal(s.shotCounts.serve,1);assert.equal(s.ball.active,true);
 for(let f=0;f<100&&!l.cooldown;f++)stepRacketLesson(l,s,{});
 assert.equal(l.index,2);
});
test('manual tennis camera fills both orientations without stretching or clipping the court',()=>{
 for(const [width,height] of [[390,510],[604,345],[320,280],[960,600]]){
  const c=tennisMatchCamera(width,height,2);assert.ok(Math.abs(c.w/c.h-width/height)<1e-9);
  for(const x of [-.2,1.2])for(const y of [-.1,1.1]){const p=racketWorld(x,y,'tennis',2);assert.ok(p.x>=c.x&&p.x<c.x+c.w&&p.y>=c.y&&p.y<c.y+c.h);}
 }
});
test('movement and face buttons accept independent pointers; shots are pulses and pause clears keys',()=>{
 class Element extends EventTarget{style={};disabled=false;classes=new Set();classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name)};querySelector(){return this.knob;}setPointerCapture(id){this.pointer=id;}getBoundingClientRect(){return {left:0,top:0,width:100,height:100};}focus(){}}
 const oldDocument=globalThis.document,oldWindow=globalThis.window;
 globalThis.document=new EventTarget();globalThis.window=new EventTarget();
 try{
  const pad=new Element(),button=new Element(),canvas=new Element();pad.knob=new Element();let active=true;
  const input=createMatchInput(pad,[[button,'slice']],canvas,()=>active);
  const emit=(el,type,props={})=>{const e=new Event(type,{cancelable:true});for(const[k,v]of Object.entries(props))Object.defineProperty(e,k,{value:v});el.dispatchEvent(e);};
  emit(pad,'pointerdown',{pointerId:1,clientX:80,clientY:25});emit(button,'pointerdown',{pointerId:2});
  const both=input.read();assert.ok(both.moveX>0&&both.moveY<0);assert.equal(both.shot,'slice');assert.equal(input.read().shot,null);
  assert.ok(button.classes.has('is-pressing'));emit(button,'pointerup',{pointerId:2});assert.equal(button.classes.size,0);assert.ok(input.read().moveX>0);
  emit(pad,'lostpointercapture',{pointerId:2});assert.ok(input.read().moveX>0,'another finger cannot cancel movement');
  emit(pad,'pointerup',{pointerId:1});assert.equal(input.read().moveX,0);
  emit(document,'keydown',{key:'ArrowUp',target:canvas});assert.equal(input.read().moveY,-1);
  input.reset();assert.equal(input.read().moveY,0);
  active=false;emit(button,'pointerdown',{pointerId:2});assert.equal(input.read().shot,null);
 }finally{globalThis.document=oldDocument;globalThis.window=oldWindow;}
});
