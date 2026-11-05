import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {journalText,readAdventure} from '../games/adventure.js';
import {LESSONS,stepArcade} from '../games/lesson.js';
import {createGame,stepGame} from '../supabase/functions/_shared/ilha-tennis-engine.js';

test('SNES diamond exposes four named shot actions and current mission only',async()=>{
 const html=await readFile(new URL('../games/index.html',import.meta.url),'utf8');
 const app=await readFile(new URL('../games/app.js',import.meta.url),'utf8');
 for(const [id,label] of [['serveButton','B: saque'],['topspinButton','Y: topspin'],['dropButton','X: deixada'],['sliceButton','A: slice']]){
  assert.match(html,new RegExp(`id="${id}"[^>]*aria-label="${label}"`));
  assert.ok(app.includes(`$('${id}').addEventListener('click'`));
 }
 assert.match(html,/id="pickleServe"[^>]*aria-label="B: saque de pickleball"/);
 assert.match(html,/id="interactButton"[^>]*>A<\/button>/);
 assert.doesNotMatch(app,/minimap:\$\('miniMap'\)/);
 assert.equal(journalText(readAdventure(null)).split('\n').length,2);
 assert.deepEqual(LESSONS.map(s=>s.id),['move','serve','normal','slice','drop']);
});

test('quiet UI ships cache-busted styling, no minimap and static non-interactive grain',async()=>{
 const css=await readFile(new URL('../games/arcade-ui.css',import.meta.url),'utf8');
 const html=await readFile(new URL('../games/index.html',import.meta.url),'utf8');
 const build=await readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8');
 assert.match(css,/#miniMapButton[^}]*display:none!important/);
 assert.match(css,/pointer-events:none;opacity:\.045/);
 assert.match(css,/image-rendering:pixelated/);
 assert.match(build,/'arcade-ui.css'/);assert.doesNotMatch(html,/ilha-legado-duo-pixel-v2.png|launch-heroes/);assert.match(html,/data-game-logo/);
 for(const letter of ['x','y','a','b'])assert.match(css,new RegExp(`\\.snes-${letter}\\{grid-area:`));
});

test('local topspin adjustment leaves ranked engine untouched and changes a real return',()=>{
 const local=createGame(42),ranked=createGame(42);
 for(const game of [local,ranked]){game.delay=0;game.awaitingServe=false;game.ball={x:game.player.x,y:374,startX:240,startY:150,endX:game.player.x,endY:377,vx:0,vy:3,age:75,flight:76,arc:17,type:'normal',powered:false,curve:0,active:true};}
 stepArcade(local,128,stepGame);stepGame(ranked,128);
 assert.equal(local.shotCounts.normal,1);assert.equal(ranked.shotCounts.normal,1);
 assert.equal(local.ball.arc,30);assert.notEqual(local.ball.arc,ranked.ball.arc);assert.ok(local.ball.flight<ranked.ball.flight);
});
