import test from 'node:test';
import assert from 'node:assert/strict';
import {createRacketMatch,stepRacketMatch,launchBall,canPrepare,shotPlan,cpuCondition,updateCpuFatigue} from '../games/racket-match.js';

test('ordinary strong drives have margin across court positions, sports and character strength',()=>{
 for(const sport of ['tennis','pickleball'])for(const playerPowerScale of [.9,1,1.1]){
  const s=createRacketMatch({sport,playerPowerScale,assisted:true});
  for(const x of [.12,.5,.88])for(const y of [.7,.85,1.08])for(const aim of [-.64,0,.64]){
   const p=shotPlan(s,{aim,power:.85/playerPowerScale},{x,y});
   assert.equal(p.outside,false,`${sport}: strong drive ${x},${y},${aim}`);
   assert.ok(Number.isFinite(p.x+p.y+p.range));
  }
 }
});

test('maximum power is situational: baseline and cross-court can fit, short straight blasts still go long',()=>{
 const s=createRacketMatch({assisted:true});
 for(const [x,sign]of [[.1,1],[.9,-1]]){
  const deep=shotPlan(s,{aim:0,power:1},{x,y:1.08});
  const cross=shotPlan(s,{aim:sign*.7,power:1},{x,y:.8});
  const straight=shotPlan(s,{aim:0,power:1},{x,y:.8});
  assert.equal(deep.outside,false);assert.equal(cross.outside,false);assert.equal(straight.outside,true);
  assert.equal(deep.color,'#ff7970','red does not force an error');
 }
 // A representative grid, not a player out-ball rate. Previous tuning: 195/500.
 let out=0,total=0;
 for(const x of [.12,.3,.5,.7,.88])for(const y of [.7,.8,.9,1,1.08])for(const aim of [-.64,-.3,0,.3,.64])for(const power of [.75,.85,.9,1]){
  out+=shotPlan(s,{aim,power},{x,y}).outside;total++;
 }
 assert.equal(total,500);assert.ok(out<=60);assert.ok(out>=20,'reckless trajectories remain possible');
});

test('effort is distance-based, direction changes cost extra, and small steering corrections do not',()=>{
 const oneWay=createRacketMatch({assisted:true}),shuttle=createRacketMatch({assisted:true}),jitter=createRacketMatch({assisted:true});
 for(let i=0;i<480;i++){
  updateCpuFatigue(oneWay,1/60,{distance:.01,lateral:.01});
  updateCpuFatigue(shuttle,1/60,{distance:.01,lateral:(Math.floor(i/60)%2?-1:1)*.01});
  updateCpuFatigue(jitter,1/60,{distance:.01,lateral:(i%2?-1:1)*.01});
 }
 assert.ok(cpuCondition(shuttle).fatigue>cpuCondition(oneWay).fatigue+.2);
 assert.ok(Math.abs(cpuCondition(jitter).fatigue-cpuCondition(oneWay).fatigue)<1e-9);
 const idle=createRacketMatch({assisted:true});idle.rally=100;
 for(let i=0;i<480;i++)updateCpuFatigue(idle,1/60);
 assert.equal(cpuCondition(idle).fatigue,0,'a counter alone cannot exhaust the CPU');
});

test('real CPU tracking builds fatigue and exhausted opponents move/turn more slowly without teleporting',()=>{
 for(const fps of [30,60,120]){
  const states=[0,.8].map(fatigue=>{
   const s=createRacketMatch({assisted:true,difficulty:1.16});s.cpu.x=.1;s.cpu.y=.1;s.cpu.fatigue=fatigue;
   launchBall(s,'player','normal',.9,.15,{flight:2});
   for(let i=0;i<fps*.65;i++)stepRacketMatch(s,{},1/fps);
   assert.ok(s.cpu.fatigue>fatigue);assert.ok(s.cpu.x>.1&&s.cpu.x<.9);return s;
  });
  assert.ok(states[0].cpu.x>states[1].cpu.x+.07,`${fps}: fresh runner covers more ground`);
  assert.ok(cpuCondition(states[1]).acceleration<cpuCondition(states[0]).acceleration);
  assert.ok(cpuCondition(states[1]).reaction>cpuCondition(states[0]).reaction);
 }
});

test('tired CPU actually returns a slower ball, not just a cosmetic stamina meter',()=>{
 const flights=[0,.8].map(fatigue=>{
  const s=createRacketMatch({assisted:true,difficulty:1.16,seed:10});s.cpu.x=.5;s.cpu.y=.2;s.cpu.fatigue=fatigue;s.elapsed=2;
  launchBall(s,'player','normal',.5,.2,{flight:1});
  Object.assign(s.ball,{x:.5,y:.21,z:.06,vx:0,vy:-.2,vz:-.1,bounces:1,bounceAt:1.7,age:1.3});
  stepRacketMatch(s,{});assert.equal(s.ball.last,'cpu');return s.ball.flight;
 });
 assert.ok(flights[1]>flights[0]*1.10);
});

test('rest between points/serves restores stamina, without instant resets or fatigue leaking into lessons',()=>{
 for(const fps of [30,60,120]){
  const s=createRacketMatch({assisted:true});s.cpu.fatigue=.8;s.delay=1.25;
  for(let i=0;i<fps*1.5;i++)stepRacketMatch(s,{},1/fps);
  assert.ok(Math.abs(s.cpu.fatigue-.59)<.01);assert.equal(s.awaitingServe,true);
  for(let i=0;i<fps*6;i++)stepRacketMatch(s,{},1/fps);
  assert.equal(s.cpu.fatigue,0);
  s.cpu.fatigue=.9;s.practice=true;updateCpuFatigue(s,1/60,{distance:1,lateral:1});assert.equal(cpuCondition(s).fatigue,0);
  s.practice=false;s.lessonGuided=true;s.cpu.fatigue=.9;assert.equal(cpuCondition(s).fatigue,0);
 }
 const s=createRacketMatch({assisted:true});for(let i=0;i<100;i++)updateCpuFatigue(s,1/60,{distance:1,lateral:i%2?-1:1});
 assert.equal(cpuCondition(s).fatigue,1);assert.equal(cpuCondition(s).speed,.7,'even an exhausted rival still runs');
 assert.equal(createRacketMatch({assisted:true}).cpu.fatigue||0,0,'a new match starts fresh');
});

test('side-to-side placement tires and beats central repetition without automatic winners',()=>{
 for(const sport of ['tennis','pickleball']){
  const points={center:0,corners:0},fatigue={center:0,corners:0};let cpuPoints=0;
  for(const mode of ['center','corners'])for(let seed=1;seed<=6;seed++){
   const s=createRacketMatch({sport,assisted:true,difficulty:1.16,seed});let peak=0;
   for(let f=0;f<36000&&!s.done;f++){
    const q={shot:'normal',power:.86,aim:mode==='center'?0:(s.cpu.x<.5?.64:-.64)};
    stepRacketMatch(s,{serve:true,stroke:canPrepare(s)&&s.ball.last==='cpu'&&s.ball.age>=.28?q:null});peak=Math.max(peak,cpuCondition(s).fatigue);
   }
   assert.ok(s.done);points[mode]+=s.playerPoints;fatigue[mode]+=peak;if(mode==='corners')cpuPoints+=s.cpuPoints;
  }
  assert.ok(points.corners>=points.center+15);assert.ok(fatigue.corners>fatigue.center+2);assert.ok(cpuPoints>=10);
 }
});
