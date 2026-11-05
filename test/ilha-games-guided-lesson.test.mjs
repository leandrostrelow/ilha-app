import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRacketMatch} from '../games/racket-match.js';
import {createRacketLesson,stepRacketLesson,lessonAction,lessonAcceptsGesture} from '../games/racket-lesson.js';
import {gestureShot} from '../games/assisted-input.js';

const setup=(index=0,extra=false)=>{const game=createRacketMatch({assisted:true,practice:true}),lesson=createRacketLesson(game,extra);lesson.index=index;return {game,lesson};};
const tick=(l,s,n=1)=>{for(let i=0;i<n;i++)stepRacketLesson(l,s,{});};
const waitFeedback=(l,s)=>{for(let i=0;i<1500&&l.phase==='practice';i++)tick(l,s);assert.equal(l.phase,'feedback');};
const gesture=(task)=>{
 const start={x:180,y:180},end=task.id==='serve'?{x:180,y:60}:task.id==='drop'?start:task.id==='slice'?{x:300,y:180}:{x:180+(task.aim||0)*65,y:task.power?350:280};
 const g=gestureShot(start,end,{left:0,top:0,width:390,height:410},'tennis',null,task.id==='serve');
 return task.id==='serve'?{serve:g.validServe,serveGesture:g}:{stroke:g};
};
test('guided demo waits indefinitely, rejects shots and starts only on the explicit action',()=>{
 const {game:s,lesson:l}=setup();
 for(let i=0;i<1200;i++)stepRacketLesson(l,s,{serve:true,stroke:{shot:'normal'}});
 assert.equal(l.phase,'demo');assert.equal(l.index,0);assert.equal(s.shotCounts.serve,0);assert.equal(s.ball.active,false);assert.equal(lessonAcceptsGesture(l),false);
 assert.equal(lessonAction(l,s),true);assert.equal(s.awaitingServe,true);assert.equal(lessonAcceptsGesture(l),true);
});
test('every touch lesson completes with one real gesture and a valid outgoing bounce, including both aims and power',()=>{
 for(const extra of [false,true]){
  const {game:s,lesson:l}=setup(0,extra);
  while(!l.completed){
   const index=l.index,task=l.tasks[index];assert.equal(l.phase,'demo');lessonAction(l,s);
   stepRacketLesson(l,s,gesture(task));assert.equal(l.index,index);assert.equal(l.phase,'practice');
   waitFeedback(l,s);assert.equal(l.outcome,'success',task.title);assert.equal(s.event,'lesson-success');assert.equal(l.index,index);
   assert.equal(lessonAction(l,s),false,'celebration cannot be skipped by double tap');tick(l,s,75);
   tick(l,s,300);assert.equal(l.index,index,'never auto advance while reading');lessonAction(l,s);
  }
  assert.equal(s.done,true);assert.equal(s.cpuPoints,0);assert.equal(s.playerPoints,0);
 }
});
test('coach holds a visible first bounce for as long as needed, then accepts a single late gesture',()=>{
 const {game:s,lesson:l}=setup(1);lessonAction(l,s);tick(l,s,900);
 assert.equal(l.phase,'practice');assert.equal(s.ball.last,'cpu');assert.equal(s.ball.bounces,1);assert.ok(s.elapsed-s.ball.bounceAt>=.22);
 const pos={x:s.ball.x,y:s.ball.y,z:s.ball.z};tick(l,s,1200);assert.deepEqual({x:s.ball.x,y:s.ball.y,z:s.ball.z},pos);
 stepRacketLesson(l,s,gesture(l.tasks[l.index]));waitFeedback(l,s);assert.equal(l.outcome,'success');
});
test('wrong gesture and invalid serve explain what to do without awarding the exercise',()=>{
 for(const [index,input,pattern] of [[0,{invalidServe:true},/para cima/],[2,{stroke:{shot:'drop',aim:0,power:.3}},/deixada.*lados/]]){
  const {game:s,lesson:l}=setup(index);lessonAction(l,s);stepRacketLesson(l,s,input);
  assert.equal(l.phase,'feedback');assert.equal(l.outcome,'retry');assert.match(l.feedback,pattern);assert.equal(l.index,index);assert.equal(s.event,'lesson-retry');assert.equal(s.cpuPoints,0);
  tick(l,s,45);lessonAction(l,s);stepRacketLesson(l,s,gesture(l.tasks[l.index]));waitFeedback(l,s);assert.equal(l.outcome,'success');
 }
});
test('aim exercises require the requested landing side and force exercise requires a long drag',()=>{
 for(const [index,stroke,pattern] of [[4,{shot:'normal',aim:.8,power:.5},/esquerda/],[5,{shot:'normal',aim:-.8,power:.5},/direita/],[6,{shot:'normal',aim:0,power:.3},/mais/]]){
  const {game:s,lesson:l}=setup(index);lessonAction(l,s);stepRacketLesson(l,s,{stroke});waitFeedback(l,s);
  assert.equal(l.outcome,'retry');assert.match(l.feedback,pattern);assert.equal(l.index,index);
 }
});
test('replaying the demo cancels the ball and queued shot without skipping a step',()=>{
 const {game:s,lesson:l}=setup(1);lessonAction(l,s);stepRacketLesson(l,s,gesture(l.tasks[1]));assert.ok(s.prepared);
 lessonAction(l,s,'demo');assert.equal(l.phase,'demo');assert.equal(s.ball.active,false);assert.equal(s.prepared,null);tick(l,s,600);assert.equal(l.index,1);
 lessonAction(l,s);stepRacketLesson(l,s,gesture(l.tasks[1]));waitFeedback(l,s);assert.equal(l.outcome,'success');
});
test('guided lesson has large copy, animated hand, replay, reduced-motion fallback and distinct audio',async()=>{
 const base=new URL('../games/',import.meta.url);
 const [view,css,audio,app]=await Promise.all(['lesson-tutorial.js','lesson-tutorial.css','audio.js','app.js'].map(f=>readFile(new URL(f,base),'utf8')));
 assert.match(view,/gesture-finger/);assert.match(view,/aria-live="polite"/);assert.match(view,/Ver o gesto de novo/);
 assert.match(css,/18px\/1.35/);assert.match(css,/@keyframes coach-drag/);assert.match(css,/prefers-reduced-motion/);assert.match(css,/safe-area-inset-bottom/);
 assert.match(audio,/'lesson-success'/);assert.match(audio,/'lesson-retry'/);assert.match(app,/lessonAcceptsGesture\(lesson\)/);
});
