import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, createGame, stepGame, replayGame, MAX_FRAMES, clamp } from '../supabase/functions/_shared/ilha-tennis-engine-v1.js';

function play(seed, character, follow = true) {
  const game=createGame(seed,character),inputs=[];
  for(let frame=0;frame<MAX_FRAMES;frame++){
    // A playable strategy follows the landing position and places the return
    // on alternating sides. CPU reaction must permit both rallies and winners.
    const b=game.ball;
    const landing=b.vy>0?b.x+b.vx*Math.max(0,(377-b.y)/b.vy):240;
    const aim=landing+(game.playerPoints%2?-15:15);
    const input=(follow?Math.round(clamp((aim-94)/292*255,0,255)):128)|(game.charge>=3?256:0);
    inputs.push(input);stepGame(game,input);
    assert.ok(Number.isFinite(b.x)&&Number.isFinite(b.y));
    assert.ok(game.player.x>=94&&game.player.x<=386);
  }
  return {game,inputs};
}

test('complete matches replay exactly and compute score from tennis events for every character',()=>{
  for(const c of CHARACTERS){
    const {game,inputs}=play(294812,c.id);
    assert.ok(game.done);assert.equal(game.frame,MAX_FRAMES);
    assert.ok(game.returns>10,`${c.name} should sustain rallies`);
    assert.ok(game.playerPoints>0,`${c.name} should be able to win points`);
    assert.ok(game.specialUsed>0);
    assert.deepEqual(replayGame(294812,c.id,inputs),game);
    assert.equal(game.score,game.returns*10+game.playerPoints*100+(game.playerPoints>game.cpuPoints?300:0));
    const snapshot=structuredClone(game);stepGame(game,511);assert.deepEqual(game,snapshot);
  }
});
test('standing still can lose points and active placement improves the score',()=>{
  const still=play(8247,'leandro',false).game,active=play(8247,'leandro',true).game;
  assert.ok(still.cpuPoints>0);
  assert.ok(active.score>still.score);
});
test('replay rejects incomplete, oversized and malformed input and unknown characters',()=>{
  const valid=Array(MAX_FRAMES).fill(128);
  for(const invalid of [null,[],valid.slice(1),[...valid,128],valid.map((v,i)=>i===3?512:v),valid.map((v,i)=>i===1?1.2:v),valid.map((v,i)=>i===1?'128':v)])assert.throws(()=>replayGame(1,'leandro',invalid));
  assert.throws(()=>replayGame(1,'hacker',valid));
});
test('special needs three returns and cannot be spammed',()=>{
  const game=createGame(29,'leandro');
  for(let i=0;i<110;i++)stepGame(game,384);
  assert.equal(game.specialUsed,0);
  game.charge=3;game.delay=0;
  stepGame(game,384);assert.equal(game.specialUsed,1);assert.equal(game.charge,0);
  for(let i=0;i<10;i++)stepGame(game,384);
  assert.equal(game.specialUsed,1);
});
