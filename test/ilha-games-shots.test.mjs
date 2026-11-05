import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTERS,createGame,stepGame,replayGame,MAX_FRAMES,INPUT,SHOTS,clamp,VERSION} from '../supabase/functions/_shared/ilha-tennis-engine.js';
import {courtCamera,projectCourt,viewToCourtX,blendCamera} from '../games/court-view.js';
import {COURTS,courtPoint} from '../games/club-scene.js';
import {heldServeBall} from '../games/match-effects.js';

test('serve ball rests in the free hand beside the player before the toss',()=>{
  const player={x:240,y:500},held=heldServeBall(player,2,0),tossed=heldServeBall(player,2,13);
  assert.ok(held.x<player.x-20,'ball must sit beside the left hand, not behind the body');
  assert.ok(held.y<player.y-25&&held.y>player.y-40,'ball must align with the hand');
  assert.equal(tossed.x,held.x,'the toss rises from the same hand');
  assert.ok(tossed.y<held.y,'the tossed ball must rise');
});

function play(seed,character,follow=true){
  const game=createGame(seed,character),inputs=[];
  for(let frame=0;frame<MAX_FRAMES;frame++){
    const landing=game.ball.active&&game.ball.vy>0?game.ball.endX:240;
    const aim=landing+(game.playerPoints%2?-18:18);
    const input=(follow?Math.round(clamp((aim-94)/292*255,0,255)):128)|SHOTS[game.returns%4].input|(game.awaitingServe?INPUT.SERVE:0)|(game.charge>=3?INPUT.POWER:0);
    inputs.push(input);stepGame(game,input);
    assert.ok(Number.isFinite(game.ball.x)&&Number.isFinite(game.ball.y));
    assert.ok(game.player.x>=94&&game.player.x<=386);
  }
  return {game,inputs};
}
test('v2 replays four-shot tennis identically for all characters without changing classic version',()=>{
  assert.equal(VERSION,'tennis-rpg-v2');
  for(const character of CHARACTERS){
    const {game,inputs}=play(294812,character.id);
    assert.ok(game.done);assert.equal(game.frame,MAX_FRAMES);
    assert.ok(game.returns>10,`${character.id}: returns ${game.returns}`);
    assert.ok(game.playerPoints>0);assert.ok(game.specialUsed>0);
    for(const shot of SHOTS)assert.ok(game.shotCounts[shot.id]>0,shot.id);
    assert.deepEqual(replayGame(294812,character.id,inputs),game);
    assert.equal(game.score,game.returns*10+game.playerPoints*100+(game.playerPoints>game.cpuPoints?300:0));
    const snapshot=structuredClone(game);stepGame(game,INPUT.MAX);assert.deepEqual(game,snapshot);
  }
});
test('player serve waits, tosses once, and ignores repeated presses during the rally',()=>{
  const game=createGame(22);
  for(let i=0;i<45;i++)stepGame(game,128|INPUT.SERVE);
  assert.equal(game.awaitingServe,true);assert.equal(game.ball.active,false);
  stepGame(game,128);assert.equal(game.tossFrames,0);
  stepGame(game,128|INPUT.SERVE);assert.equal(game.tossFrames,26);
  for(let i=0;i<26;i++)stepGame(game,128|INPUT.SERVE);
  assert.equal(game.shotCounts.serve,1);assert.equal(game.ball.active,true);
  for(let i=0;i<15;i++)stepGame(game,128|INPUT.SERVE);
  assert.equal(game.shotCounts.serve,1);assert.equal(game.tossFrames,0);
});
test('idle player automatically serves after five seconds, special needs charge',()=>{
  const game=createGame(22);
  for(let i=0;i<45+300+26;i++)stepGame(game,128|INPUT.POWER);
  assert.equal(game.shotCounts.serve,1);assert.equal(game.specialUsed,0);
  game.charge=3;stepGame(game,128|INPUT.POWER);assert.equal(game.specialUsed,1);
  for(let i=0;i<10;i++)stepGame(game,128|INPUT.POWER);
  assert.equal(game.specialUsed,1);
});
function receive(shot){
  const game=createGame(22);game.delay=0;game.player.x=240+292/510;
  game.ball={x:240,y:376,startX:240,startY:130,endX:240,endY:377,vy:4,vx:0,age:59,flight:60,arc:17,curve:0,active:true};
  stepGame(game,128|shot.input);return game;
}
test('slice curves low, lob goes high and deep, drop pulls CPU toward net',()=>{
  const [normal,slice,lob,drop]=SHOTS.map(receive);
  assert.ok(slice.ball.arc<normal.ball.arc);assert.notEqual(slice.ball.curve,0);
  assert.ok(lob.ball.arc>normal.ball.arc*3);assert.ok(lob.ball.endY<normal.ball.endY);
  assert.ok(drop.ball.endY>normal.ball.endY);assert.ok(drop.ball.flight<normal.ball.flight);
  for(let i=0;i<30;i++)stepGame(drop,128|INPUT.DROP);
  assert.ok(drop.cpu.y>117,'CPU should run toward the short ball');
});
test('active placement improves the score and malformed replay is rejected',()=>{
  assert.ok(play(8247,'leandro').game.score>play(8247,'leandro',false).game.score);
  const inputs=Array(MAX_FRAMES).fill(128);
  for(const invalid of [null,[],inputs.slice(1),[...inputs,128],inputs.map((v,i)=>i===1?4096:v),inputs.map((v,i)=>i===1?-1:v),inputs.map((v,i)=>i===1?1.5:v),inputs.map((v,i)=>i===1?'128':v)])assert.throws(()=>replayGame(1,'leandro',invalid));
  assert.throws(()=>replayGame(1,'unknown',inputs));
});
test('pointer projection follows chosen court at both camera zoom levels',()=>{
  for(const court of [1,2])for(const overview of [true,false])for(const x of [94,240,386]){
    const camera=courtCamera(court,overview);
    const screenX=projectCourt(x,250,court,camera).x;
    assert.ok(Math.abs(viewToCourtX(screenX,court,overview)-x)<1e-9);
  }
});
test('playable baselines and net are aligned with the actual map, transition keeps endpoints',()=>{
  for(const court of [1,2]){
    const c=COURTS[court-1];assert.deepEqual(courtPoint(100,112,court),{x:c.x,y:c.y});
    assert.deepEqual(courtPoint(380,394,court),{x:c.x+c.width,y:c.y+c.height});
    assert.ok(Math.abs(courtPoint(240,249,court).y-(c.y+c.height*137/282))<1e-9);
  }
  const from={x:20,y:30,w:420,h:700},to=courtCamera(2);
  assert.deepEqual(blendCamera(from,to,0),from);assert.deepEqual(blendCamera(from,to,1),to);
});
