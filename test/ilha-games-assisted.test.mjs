import test from 'node:test';
import assert from 'node:assert/strict';
import {createRacketMatch,stepRacketMatch,launchBall,canHit,canPrepare,serviceTarget,matchPace,shotPlan,rallyPace} from '../games/racket-match.js';
import {createRacketLesson,stepRacketLesson,lessonAction} from '../games/racket-lesson.js';
import {lessonTasks} from '../games/lesson.js';
import {gestureShot,createAssistedInput} from '../games/assisted-input.js';
import {drawAimArrow,drawBall} from '../games/match-effects.js';
test('each boss reduces focus time and increases ball pace and court coverage',()=>{
 const levels=[.55,.65,.76,.87,1.02,1.16].map(matchPace);
 for(let i=1;i<levels.length;i++){
  assert.ok(levels[i].focusBudget<levels[i-1].focusBudget);
  assert.ok(levels[i].focusScale>levels[i-1].focusScale);
  assert.ok(levels[i].flight<levels[i-1].flight);
  assert.ok(levels[i].cpuMove>levels[i-1].cpuMove);
 }
 assert.ok(levels.at(-1).focusBudget<=.14);
});
test('gestures alone choose all shots and directional serves respect the service box',()=>{
 const r={left:0,top:0,width:400,height:500},a={x:200,y:250};
 for(const sport of ['tennis','pickleball']){
  const down=sport==='tennis'?{x:210,y:340}:{x:110,y:260},side=sport==='tennis'?{x:280,y:260}:{x:210,y:330},forward=sport==='tennis'?{x:240,y:140}:{x:310,y:290};
  assert.equal(gestureShot(a,down,r,sport).shot,'normal');assert.equal(gestureShot(a,side,r,sport).shot,'slice');assert.equal(gestureShot(a,a,r,sport).shot,'drop');
  assert.equal(gestureShot(a,forward,r,sport,null,true).validServe,true);assert.equal(gestureShot(a,down,r,sport,null,true).validServe,false);assert.equal(gestureShot(a,a,r,sport,null,true).validServe,false);
  for(const x of [.3,.7])for(const aim of [-.65,.65]){const s=createRacketMatch({sport,assisted:true});s.player.x=x;const target=serviceTarget(s,{aim,power:.8});assert.ok(x>.5?target.x<.5:target.x>.5);stepRacketMatch(s,{serve:true,serveGesture:{aim,power:.8}});assert.equal(s.ball.endX,target.x);}
 }
});
test('runner commits behind the predicted bounce instead of chasing the ball',()=>{
 const s=createRacketMatch({assisted:true});launchBall(s,'cpu','normal',.65,.83,{flight:1.4});stepRacketMatch(s,{});const target={...s.ball.arrival};assert.ok(target.y>s.ball.endY+.07);
 for(let i=0;i<45;i++){stepRacketMatch(s,{});assert.deepEqual(s.ball.arrival,target);}
});
test('both coaches can be completed using only classified touch gestures',()=>{
 const r={left:0,top:0,width:400,height:500},a={x:200,y:250};
 for(const extra of [false,true]){const s=createRacketMatch({assisted:true}),l=createRacketLesson(s,extra);
  for(let f=0;f<16000&&!l.completed;f++){if(l.phase!=='practice'){lessonAction(l,s);stepRacketLesson(l,s,{});continue;}const task=lessonTasks(l)[l.index],end=task.id==='serve'?{x:220,y:130}:task.id==='slice'?{x:300,y:255}:task.id==='drop'?a:{x:200+(task.aim||0)*65,y:task.power?450:350};const g=gestureShot(a,end,r,'tennis',null,task.id==='serve');stepRacketLesson(l,s,task.id==='serve'?{serve:g.validServe,serveGesture:g}:{stroke:g});}
  assert.ok(l.completed);
 }
});
test('both receivers must visibly wait after a serve bounce, at every frame rate',()=>{
 for(const sport of ['tennis','pickleball'])for(const receiver of ['player','cpu'])for(const fps of [30,60,120]){
  const s=createRacketMatch({sport,assisted:true}),sender=receiver==='player'?'cpu':'player';
  const y=receiver==='player'?(sport==='tennis'?.63:.8):(sport==='tennis'?.37:.2);
  launchBall(s,sender,'serve',.28,y,{flight:1.4,serve:true});let bounce=null,returned=false;
  for(let f=0;f<fps*6&&s.ball.active;f++){
   if(s.ball.bounces===0)assert.equal(canHit(s,receiver),false);
   if(s.ball.bounces&&bounce===null)bounce=s.ball.bounceAt;
   stepRacketMatch(s,{stroke:receiver==='player'?{shot:'normal',aim:.5,power:.55}:null},1/fps);
   if(s.ball.last===receiver){assert.notEqual(bounce,null);assert.ok(s.elapsed-bounce>=.22);assert.ok(s.landing,'bounce ring survives return');returned=true;break;}
  }
  assert.ok(returned,`${sport} ${receiver} ${fps}`);
 }
});
test('curved arrow head follows the shaft tangent in both directions',()=>{
 for(const bend of [-1,0,1]){
  const curves=[],lines=[],c={save(){},restore(){},translate(){},rotate(){},beginPath(){},moveTo(){},lineTo(...p){lines.push(p);},quadraticCurveTo(...p){curves.push(p);},closePath(){},clip(){},fillRect(){},stroke(){}};
  drawAimArrow(c,{x:0,y:0},{x:52,y:0},.5,bend);
  const base={x:(lines[0][0]+lines[2][0])/2,y:(lines[0][1]+lines[2][1])/2};
  const control={x:curves[0][0],y:(curves[0][1]+curves[1][1])/2};
  const tip={x:lines[1][0],y:lines[1][1]};
  assert.ok(Math.abs((tip.x-base.x)*(tip.y-control.y)-(tip.y-base.y)*(tip.x-control.x))<1e-8);
  assert.equal(Math.sign(tip.y-base.y)||0,bend);
 }
});
test('arrow power fills inside its clipped shape and the ball uses round paths',()=>{
 const fills=[],arcs=[],c={save(){},restore(){},translate(){},rotate(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},closePath(){},fill(){},stroke(){},ellipse(){},clip(){this.clipped=true;},fillRect(...a){fills.push({a,clipped:this.clipped});},arc(...a){arcs.push(a);}};
 drawAimArrow(c,{x:0,y:0},{x:100,y:0},.65);assert.equal(fills[0].clipped,true);assert.equal(fills[0].a[2],65);
 drawBall(c,{x:20,y:30,groundY:40,size:8});assert.ok(arcs.some(a=>a[2]===4&&a[4]===Math.PI*2));
});
test('match focus starts after bounce, lasts at most a short reaction window and preserves lessons',()=>{
 for(const sport of ['tennis','pickleball'])for(const fps of [30,60,120]){
  const s=createRacketMatch({sport,assisted:true});launchBall(s,'cpu','normal',.5,.9,{flight:1.4});
  const start=s.elapsed;for(let i=0;i<fps;i++)stepRacketMatch(s,{aiming:true},1/fps);
  assert.ok(Math.abs(s.elapsed-start-1)<.001);assert.equal(s.timeScale,1);assert.equal(s.returns,0);
  while(s.ball.bounces===0&&s.ball.active)stepRacketMatch(s,{aiming:true},1/fps);
  stepRacketMatch(s,{aiming:true},1/fps);assert.equal(s.timeScale,matchPace(s.difficulty).focusScale);
  for(let i=0;i<fps*.65;i++)stepRacketMatch(s,{aiming:true},1/fps);
  assert.equal(s.timeScale,1);
  stepRacketMatch(s,{stroke:{shot:'normal',aim:.5,power:.6}},1/fps);assert.equal(s.timeScale,1);
  const held=createRacketMatch({sport,assisted:true});launchBall(held,'cpu','normal',.5,.9,{flight:1.4});
  for(let i=0;i<fps*3;i++)stepRacketMatch(held,{aiming:true},1/fps);
  assert.equal(held.timeScale,1,'holding cannot freeze the rally forever');
  const lesson=createRacketMatch({sport,assisted:true});launchBall(lesson,'cpu','normal',.5,.9,{flight:1.4});
  for(let i=0;i<fps;i++)stepRacketMatch(lesson,{aiming:true,coach:true},1/fps);
  assert.ok(Math.abs(lesson.elapsed-.2)<.001);
 }
 const manual=createRacketMatch();launchBall(manual,'cpu','normal',.5,.9,{flight:1.4});stepRacketMatch(manual,{aiming:true});assert.equal(manual.timeScale,1);
});
test('prompt post-bounce gestures return the ball but a late release lets the CPU score',()=>{
 for(const sport of ['tennis','pickleball'])for(const fps of [30,60,120])for(const reaction of [.25,.9]){
  const s=createRacketMatch({sport,assisted:true});launchBall(s,'cpu','normal',.65,.88,{flight:1.1});let bouncedAt=null;
  for(let f=0;f<fps*6&&!s.returns&&!s.cpuPoints;f++){
   if(s.ball.bounces&&bouncedAt===null)bouncedAt=f;
   const release=bouncedAt!==null&&(f-bouncedAt)/fps>=reaction;
   stepRacketMatch(s,release?{stroke:{shot:'normal',aim:.7,power:.7}}:{aiming:bouncedAt!==null},1/fps);
  }
  assert.equal(s.returns,reaction<.5?1:0,`${sport} ${fps} ${reaction}`);
  assert.equal(s.cpuPoints,reaction<.5?0:1);
 }
});
test('drag direction rotates for pickleball; longer drags add power; taps are safe',()=>{
 const r={left:0,top:0,width:400,height:500},a={x:200,y:300};
 assert.ok(gestureShot(a,{x:290,y:200},r).aim>0);
 assert.ok(gestureShot(a,{x:250,y:190},r,'pickleball').aim<0);
 assert.ok(gestureShot(a,{x:300,y:100},r).power>gestureShot(a,{x:220,y:280},r).power);
 assert.equal(gestureShot(a,a,r).power,.35);assert.equal(gestureShot(a,a,r).shot,'drop');
});
test('auto runner follows the ball but planning waits for the incoming reaction window',()=>{
 for(const sport of ['tennis','pickleball'])for(const fps of [30,60,120]){
  const s=createRacketMatch({sport,assisted:true});s.cpu.y=.1;launchBall(s,'cpu','normal',.78,.88,{flight:1.4});s.serveBounces=2;
  const vx=s.ball.vx;stepRacketMatch(s,{stroke:{shot:'slice',aim:-.8,power:.6}},1/fps);assert.equal(s.ball.vx,vx);
  assert.equal(s.prepared,null,'the return cannot be queued on the CPU strike frame');
  while(!canPrepare(s))stepRacketMatch(s,{},1/fps);
  stepRacketMatch(s,{stroke:{shot:'slice',aim:-.8,power:.6}},1/fps);assert.ok(s.prepared.readyAt>s.elapsed);
  for(let f=0;f<fps*3&&!s.returns;f++)stepRacketMatch(s,{},1/fps);
  assert.equal(s.returns,1,`${sport} ${fps}`);assert.equal(s.ball.last,'player');assert.equal(s.ball.type,'slice');assert.ok(s.ball.endX<.35);assert.equal(s.prepared,null);
 }
});
test('assisted lessons accept gestures and finish both coaches without manual running',()=>{
 for(const extra of [false,true]){
  const s=createRacketMatch({assisted:true}),l=createRacketLesson(s,extra);
  for(let f=0;f<12000&&!l.completed;f++){
   if(l.phase!=='practice'){lessonAction(l,s);stepRacketLesson(l,s,{});continue;}
   const t=lessonTasks(l)[l.index];stepRacketLesson(l,s,t.id==='serve'?{serve:true}:{stroke:{shot:t.id,aim:t.aim||.6,power:t.power?.85:.55}});
  }assert.ok(l.completed,`coach ${extra}`);
 }
});
function playBot({sport='tennis',difficulty=1.16,seed=1,fps=60,mixed=true,late=false}={}){
 const s=createRacketMatch({sport,difficulty,assisted:true,seed});
 for(let f=0;f<fps*600&&!s.done;f++){
  const drop=mixed&&s.lastPlayerShot?.shot!=='drop',ready=canPrepare(s)&&s.ball.last==='cpu'&&(!late?s.ball.age>=.28:s.ball.bounces===1&&s.elapsed-s.ball.bounceAt>=.7);
  const aim=(s.cpu.x<.5?1:-1)*(drop?.65:.64);let power=drop?.35:.86;
  if(!drop)while(power>.45&&shotPlan(s,{aim,power}).outside)power-=.025;
  stepRacketMatch(s,{serve:true,stroke:ready?{shot:drop?'drop':'normal',aim,power}:null},1/fps);
 }
 assert.ok(s.done,`${sport} ${difficulty} ${fps}: match finishes`);return s;
}
test('short/deep variation and sustained side-to-side runs are both viable against the final CPU',()=>{
 for(const sport of ['tennis','pickleball']){
  let mixedPoints=0,repeatedPoints=0,cpuPoints=0,wins=0,rallies=0;
  for(let seed=1;seed<=6;seed++){
   const mixed=playBot({sport,seed}),repeated=playBot({sport,seed,mixed:false});
   mixedPoints+=mixed.playerPoints;repeatedPoints+=repeated.playerPoints;cpuPoints+=mixed.cpuPoints+repeated.cpuPoints;wins+=mixed.playerPoints>mixed.cpuPoints;
   rallies+=repeated.bestRally;
  }
  assert.ok(rallies/6>=8,'the final boss sustains long exchanges');assert.ok(mixedPoints>=24);assert.ok(repeatedPoints>=15,'running the CPU side to side now earns points too');assert.ok(cpuPoints>=10);assert.ok(wins>=4,'good strategy is still winnable, not a guaranteed win');
 }
});
test('late release loses at all frame rates and the first boss remains approachable',()=>{
 for(const sport of ['tennis','pickleball'])for(const fps of [30,60,120]){
  const first=playBot({sport,fps,difficulty:.55});assert.ok(first.playerPoints>first.cpuPoints);
  const late=playBot({sport,fps,late:true});assert.ok(late.cpuPoints>late.playerPoints);
 }
});
test('gesture fires once on release, cancellation and blur clear pending input',()=>{
 class Element extends EventTarget{disabled=false;classList={add(){},remove(){},toggle(){}};setPointerCapture(){}focus(){}getBoundingClientRect(){return {left:0,top:0,width:390,height:450};}}
 const oldDocument=globalThis.document,oldWindow=globalThis.window;globalThis.document=new EventTarget();globalThis.window=new EventTarget();
 try{
  const c=new Element(),b=new Element(),s=createRacketMatch({assisted:true});s.awaitingServe=false;
  const i=createAssistedInput(c,[[b,'slice']],()=>s,()=>true),emit=(el,type,props={})=>{const e=new Event(type,{cancelable:true});for(const [k,v]of Object.entries(props))Object.defineProperty(e,k,{value:v});el.dispatchEvent(e);};
  emit(c,'pointerdown',{pointerId:1,clientX:180,clientY:300});emit(c,'pointermove',{pointerId:1,clientX:280,clientY:200});assert.ok(i.preview().power>0);assert.deepEqual(i.read(),{aiming:true});assert.ok(i.preview().aim>0);
  emit(c,'pointerup',{pointerId:1,clientX:280,clientY:200});assert.ok(i.read().stroke.aim>0);assert.deepEqual(i.read(),{});assert.equal(i.preview(),null);
  emit(c,'pointerdown',{pointerId:2,clientX:180,clientY:300});emit(c,'pointercancel',{pointerId:2});assert.deepEqual(i.read(),{});assert.equal(i.preview(),null);
  emit(b,'pointerdown',{pointerId:3});assert.equal(i.read().stroke.shot,'slice');emit(b,'pointerdown',{pointerId:3});emit(window,'blur');assert.deepEqual(i.read(),{});
 }finally{globalThis.document=oldDocument;globalThis.window=oldWindow;}
});
test('power changes pace and depth, and auto running alone never hits',()=>{
 const results=[];
 for(const power of [.2,.9]){const s=createRacketMatch({assisted:true});launchBall(s,'cpu','normal',.5,.9,{flight:1.4});s.serveBounces=2;for(let f=0;f<200&&!s.returns;f++)stepRacketMatch(s,{stroke:canPrepare(s)?{shot:'normal',aim:.8,power}:null});assert.equal(s.returns,1);results.push(s.ball);}
 assert.ok(results[1].flight<results[0].flight);assert.ok(results[1].endY<results[0].endY);
 const s=createRacketMatch({assisted:true});launchBall(s,'cpu','normal',.8,.85,{flight:1.4});for(let f=0;f<480&&!s.cpuPoints;f++)stepRacketMatch(s,{});assert.equal(s.returns,0);assert.equal(s.cpuPoints,1);
});
test('risk colors reflect the landing geometry, not a blanket red-equals-out rule',()=>{
 const s=createRacketMatch({assisted:true});
 for(const [q,contact,color,outside] of [[{aim:0,power:.6},{x:.5,y:1.08},'#ffffff',false],[{aim:0,power:.86},{x:.5,y:1.08},'#ffdc71',false],[{aim:0,power:1},{x:.5,y:1.08},'#ff7970',false],[{aim:0,power:1},{x:.5,y:.75},'#ff7970',true],[{aim:-1,power:1},{x:.1,y:1.08},'#ff7970',true]]){
  const plan=shotPlan(s,q,contact);assert.equal(plan.color,color);assert.equal(plan.outside,outside);
  const game=createRacketMatch({assisted:true});launchBall(game,'player','normal',plan.x,plan.y);
  while(game.ball.active&&!game.ball.bounces)stepRacketMatch(game,{coach:true});
  assert.equal(game.cpuPoints,outside?1:0);
 }
 const lesson=createRacketMatch({assisted:true,practice:true});assert.equal(shotPlan(lesson,{aim:1,power:1}).risk,0);
});
test('early outgoing balls cannot queue shots and a committed shot cannot be overwritten',()=>{
 const s=createRacketMatch({assisted:true});stepRacketMatch(s,{serve:true});
 stepRacketMatch(s,{stroke:{shot:'normal',aim:0,power:.6}});assert.equal(s.prepared,null);
 launchBall(s,'cpu','normal',.5,.85,{flight:1.2});while(!canPrepare(s))stepRacketMatch(s,{});
 stepRacketMatch(s,{stroke:{shot:'slice',aim:.2,power:.6}});const prepared={...s.prepared};
 stepRacketMatch(s,{stroke:{shot:'drop',aim:-1,power:1}});assert.deepEqual(s.prepared,prepared);
});
test('long rallies gain bounded speed without accelerating lessons',()=>{
 const s=createRacketMatch({assisted:true,difficulty:1.16});let previous=1;
 for(const rally of [0,4,8,12,20,100]){s.rally=rally;const pace=rallyPace(s);assert.ok(pace>=previous&&pace<=1.5);previous=pace;}
 s.lessonGuided=true;assert.equal(rallyPace(s),1);
});
test('strong centered serves land in; excessive direction still faults and grants a second serve',()=>{
 for(const sport of ['tennis','pickleball'])for(const aim of [0,1]){
  const s=createRacketMatch({sport,assisted:true});stepRacketMatch(s,{serve:true,serveGesture:{aim,power:1}});
  while(s.ball.active&&!s.ball.bounces)stepRacketMatch(s,{coach:true});
  assert.equal(s.faults,aim===1?1:0);assert.equal(s.cpuPoints,0,'first fault still grants a second serve');
 }
});
test('touch-classified positional strategy is winnable with human preparation at 30/60/120 Hz',()=>{
 let cpuPoints=0,wins=0;const rect={left:0,top:0,width:400,height:500},start={x:200,y:250};
 for(const fps of [30,60,120])for(let seed=1;seed<=6;seed++){
  const s=createRacketMatch({assisted:true,difficulty:1.16,seed});
  for(let f=0;f<fps*600&&!s.done;f++){
   const drop=s.lastPlayerShot?.shot!=='drop',sign=s.cpu.x<.5?1:-1,aim=.64*sign;let power=.86;
   if(!drop)while(power>.45&&shotPlan(s,{aim,power}).outside)power-=.025;
   const length=power*200,dx=aim*Math.max(115,length*1.08),dy=Math.sqrt(length**2-dx**2),tap={x:200+sign*130,y:250};
   const gesture=drop?gestureShot(tap,tap,rect):gestureShot(start,{x:200+dx,y:250+dy},rect);
   assert.equal(gesture.shot,drop?'drop':'normal');
   stepRacketMatch(s,{serve:true,stroke:canPrepare(s)&&s.ball.last==='cpu'&&s.ball.age>=.28?gesture:null},1/fps);
  }
  assert.ok(s.done);wins+=s.playerPoints>s.cpuPoints;cpuPoints+=s.cpuPoints;
 }
 assert.ok(wins>=12,'a precise, varied strategy can win at different frame rates');
 assert.ok(cpuPoints>=10,'the CPU contests the match even against a precise strategy');
});
