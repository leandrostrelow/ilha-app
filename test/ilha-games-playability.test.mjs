import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,stepGame,INPUT} from '../supabase/functions/_shared/ilha-tennis-engine.js';
import {createLesson,stepLesson,stepDuel} from '../games/lesson.js';
import {RIVALS,duelRules} from '../games/adventure.js';
import {createPickleball,stepPickleball} from '../games/pickleball-model.js';
import {createMatchEffects} from '../games/match-effects.js';
import {pickleballCamera,keyboardTarget} from '../games/court-view.js';
import {PICKLEBALL} from '../games/scenery-data.js';
import {readFileSync} from 'node:fs';

test('local direction release stops movement and releasing slice does not cancel arrows',()=>{
 const g=createGame(1);g.delay=1000;
 for(let f=0;f<20;f++)stepGame(g,Math.round(keyboardTarget(g.player.x,1)));
 const stopped=g.player.x,target=Math.round(keyboardTarget(stopped));
 for(let f=0;f<30;f++)stepGame(g,target);
 assert.ok(Math.abs(g.player.x-stopped)<1,'releasing does not leave a distant movement target');
 const app=readFileSync(new URL('../games/app.js',import.meta.url),'utf8');
 assert.match(app,/if\(\['ArrowLeft','ArrowRight'\]\.includes\(e.key\)\)stopMoving\(\)/);
 assert.match(app,/if\(direction===value\)stopMoving\(\)/);
});

test('pickleball fills portrait and landscape without cropping paddles or distorting touch',()=>{
 for(const [width,height]of [[320,600],[390,605],[844,230],[1280,640]]){
  const camera=pickleballCamera(width,height);
  assert.ok(Math.abs(camera.w/camera.h-width/height)<.00001);
  for(const x of [PICKLEBALL.x,PICKLEBALL.x+PICKLEBALL.w])for(const y of [PICKLEBALL.y,PICKLEBALL.y+PICKLEBALL.h]){
   assert.ok(x>=camera.x&&x<=camera.x+camera.w);assert.ok(y>=camera.y&&y<=camera.y+camera.h);
   const sy=(y-camera.y)*height/camera.h;
   assert.ok(Math.abs(camera.y+sy/height*camera.h-y)<.00001);
  }
 }
});

test('Renato fixes the target at launch; moving sideways cannot bend the feed',()=>{
 const game=createGame(88),lesson=createLesson(game);lesson.index=2;
 stepLesson(lesson,game,128,stepGame);
 const {endX,vx,startX,flight}=game.ball;
 for(let f=0;f<30;f++)stepLesson(lesson,game,255,stepGame);
 assert.equal(game.ball.endX,endX);assert.equal(game.ball.vx,vx);
 assert.equal(game.ball.x,startX+(endX-startX)*game.ball.age/flight);
 assert.ok(Math.abs(game.player.x-endX)>40);
});
test('a correct return travels all the way back before the lesson advances',()=>{
 const game=createGame(88),lesson=createLesson(game);lesson.index=2;
 for(let f=0;f<200&&game.shotCounts.normal===0;f++)stepLesson(lesson,game,128,stepGame);
 assert.equal(game.shotCounts.normal,1);assert.equal(lesson.index,2);assert.ok(game.ball.vy<0);
 const flight=game.ball.flight;
 for(let f=0;f<flight-1;f++){stepLesson(lesson,game,128,stepGame);assert.equal(lesson.index,2);assert.ok(game.ball.vy<0);}
 assert.ok(game.ball.y<155,'ball visibly reached the coach, not a new incoming feed');
 stepLesson(lesson,game,128,stepGame);assert.equal(lesson.index,3);
});
test('wrong shots and missed feeds retry without silently awarding an exercise',()=>{
 const game=createGame(88),lesson=createLesson(game);lesson.index=3;
 for(let f=0;f<330;f++)stepLesson(lesson,game,128,stepGame);
 assert.equal(lesson.index,3);assert.equal(lesson.hits,0);
 for(let f=0;f<280;f++)stepLesson(lesson,game,255|INPUT.DROP,stepGame);
 assert.equal(lesson.index,3);assert.equal(game.cpuPoints,0);assert.equal(game.playerPoints,0);
 assert.equal(lesson.completed,false);
});
test('Gael is beatable with delayed, approximate movement at 30, 60 and 120 fps',()=>{
 for(const fps of [30,60,120])for(const offset of [-.03,0,.03]){
  const game=createPickleball();let aim=.5;
  for(let f=0;f<fps*100&&!game.done;f++){
   if(f%Math.round(fps*.25)===0)aim=game.ball.y+offset;
   stepPickleball(game,{target:aim,serve:true},1/fps);
  }
  assert.equal(game.playerPoints,5,`${fps}fps, ${offset}`);
  assert.ok(game.playerPoints>game.cpuPoints);assert.ok(game.returns>0);
  assert.ok(game.elapsed<90,'opening mini-game should not become a three-minute rally');
 }
});
test('Gael still requires movement, and waiting to serve never loses on a hidden timer',()=>{
 const idle=createPickleball();for(let i=0;i<7200&&!idle.done;i++)stepPickleball(idle,{serve:true});
 assert.equal(idle.cpuPoints,5);assert.ok(idle.playerPoints<5);
 const waiting=createPickleball();for(let i=0;i<18000;i++)stepPickleball(waiting);
 assert.equal(waiting.done,false);assert.equal(waiting.cpuPoints,0);assert.equal(waiting.playerPoints,0);
});
test('every boss can be beaten with observed positions, delayed arrows and the three visible shots',()=>{
 for(const id of RIVALS){
  let wins=0;
  for(let seed=1;seed<=9;seed++){
   const game=createGame(seed);let target=128,direction=0,previous=null;
   for(let frame=0;frame<36000&&!game.done;frame++){
    if(frame%12===0){
     let aim=240;
     if(game.ball.active&&game.ball.vy>0){
      const b=game.ball,dx=previous&&previous.y<b.y&&b.y-previous.y<65?b.x-previous.x:0;
      aim=b.x+dx*.8+(game.playerPoints%2?16:-16);previous={x:b.x,y:b.y};
     }else previous=null;
     direction=Math.abs(aim-game.player.x)>8?Math.sign(aim-game.player.x):0;
    }
    target=keyboardTarget(game.player.x,direction);
    const input=Math.round(target)|[0,INPUT.SLICE,INPUT.DROP][game.returns%3]|(game.awaitingServe?INPUT.SERVE:0);
    stepDuel(game,input,stepGame,duelRules(id));
   }
   assert.ok(game.done,`${id}: match must finish on points`);
   if(game.playerPoints>game.cpuPoints)wins++;
  }
  assert.ok(wins>=3,`${id}: approachable without hidden lob/power or reading future landing`);
 }
});
test('ball effects support reduced motion and resetting between matches',()=>{
 const calls=[],c={fillRect(...args){calls.push(args);},arc(...args){calls.push(args);},beginPath(){},fill(){},stroke(){},save(){},restore(){}};
 const fx=createMatchEffects(),ball={x:50,y:60,groundY:75,size:5};
 for(let frame=0;frame<80;frame++)fx.draw(c,{frame,ball,reduced:false,eventId:frame>50?1:0,event:'hit'});
 calls.length=0;fx.draw(c,{frame:0,ball,reduced:true});
 assert.ok(calls.length<10,'no animated trails/particles in reduced-motion mode');
 assert.ok(calls.every(a=>a.every(Number.isFinite)));
});
