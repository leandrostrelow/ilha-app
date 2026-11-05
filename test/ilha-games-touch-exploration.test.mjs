import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DECOR} from '../games/scenery-data.js';
const read=file=>readFileSync(new URL(`../games/${file}`,import.meta.url),'utf8');
test('removed court umbrella no longer renders or contributes a decor collision',()=>{
 assert.equal(DECOR.some(item=>item.kind==='umbrella'),false);
});
test('exploration exposes contextual conversation and a persistent first-touch tutorial',()=>{
 const app=read('app.js');
 assert.match(app,/interactButton'\).hidden=!target/);
 assert.match(app,/target\?\.kind==='npc'\?'Conversar':'Interagir'/);
 assert.match(app,/storage.set\('walk-tutorial',true\)/);
 assert.match(app,/if\(!state.active\|\|state.blocked\|\|state.introducing\)return/);
 assert.match(read('index.html'),/Toque no caminho para andar até lá/);
 const css=read('arcade-ui.css');
 assert.match(css,/#gameDialog #walkPad\{display:none!important\}/);
 assert.match(css,/#gameDialog\.world-mode \.world-location\{left:50%;right:auto;transform:translateX\(-50%\)/);
 assert.match(css,/#gameDialog\.world-mode \.world-controls\{left:50%;right:auto;transform:translateX\(-50%\)/);
 assert.match(css,/#gameDialog\.world-mode \.world-interaction\{display:flex;flex-direction:column;align-items:center/);
});
