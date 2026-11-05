import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RIVALS,duelRules} from '../games/adventure.js';
import {matchPace} from '../games/racket-match.js';
import {QUICK_CHARACTERS,QUICK_VENUES,quickConfig,quickMatchOptions} from '../games/quick-play.js';
const read=path=>readFileSync(new URL(`../games/${path}`,import.meta.url),'utf8');
test('free play offers the entire cast on both sides without making a campaign duel',()=>{
 const app=read('app.js');assert.equal(QUICK_CHARACTERS.length,23);assert.equal(RIVALS.length,6);
 assert.match(app,/return start\(true,\{kind:'quick'/);assert.match(app,/quickMatchOptions\(local.config\)/);
 assert.match(app,/localMatch\?\.kind==='quick'/);assert.match(read('index.html'),/id="legacyFree"/);
 for(const person of QUICK_CHARACTERS){assert.equal(person.stats.length,4);assert.ok(person.stats.every(n=>Number.isInteger(n)&&n>=1&&n<=5));}
 for(const player of QUICK_CHARACTERS)for(const opponent of QUICK_CHARACTERS)for(const venue of QUICK_VENUES){
  const config={player:player.id,opponent:opponent.id,venue:venue.id,sport:venue.sport};assert.deepEqual(quickConfig(config),config);
  const options=quickMatchOptions(config);assert.equal(options.sport,venue.sport);assert.equal(options.horizontal,venue.horizontal);assert.ok(options.difficulty>=.5&&options.difficulty<=.9);
 }
 assert.equal(quickConfig({sport:'pickleball',venue:'old'}).venue,'pickleball');
 assert.equal(quickConfig({sport:'tennis',venue:'pickleball'}).venue,'court1');
});
test('game menu is shown immediately rather than waiting for fullscreen permission',()=>{
 const app=read('app.js'),launch=app.slice(app.indexOf("$('openGame').addEventListener"),app.indexOf("$('legacyFree').addEventListener"));
 assert.ok(launch.indexOf('legacy.menu()')<launch.indexOf('await fullscreen.enter()'));
 assert.match(read('world.js'),/setCamera\(introducing\?762:player.x,introducing\?880:player.y,true\);render\(\)/);
});
test('new pacing offers short reaction windows and progressive threats',()=>{
 const first=matchPace(duelRules(RIVALS[0]).cpuSpeed),last=matchPace(duelRules(RIVALS.at(-1)).cpuSpeed);
 assert.ok(first.focusBudget<=.22);assert.ok(last.focusBudget<=.08);
 assert.ok(last.flight<first.flight);assert.ok(last.cpuMove>first.cpuMove);
});
