import test from 'node:test';
import assert from 'node:assert/strict';
import {halloweenAmbientCue} from '../game2/halloween-sounds.js';
import {halloweenBatPosition,halloweenProps} from '../game2/halloween-art.js';
import {LANDMARK_TREES} from '../game2/scenery-data.js';
import {createGameAudio,MUSIC_TRACKS,musicForSection} from '../game2/audio.js';
import {statSync} from 'node:fs';
import {SOUNDTRACK} from '../game2/legado-ui.js';
test('menu music and playlist cover all available Halloween tracks',()=>{
 assert.equal(MUSIC_TRACKS.menu,'/game2/assets/audio/misterio-no-ilha-menu-v1.mp3');
 assert.equal(musicForSection('legacyMenu'),'menu');
 assert.deepEqual(SOUNDTRACK.map(([id])=>id).sort(),Object.keys(MUSIC_TRACKS).filter(id=>MUSIC_TRACKS[id]).sort());
 for(const [id]of SOUNDTRACK)assert.ok(statSync(new URL('..'+MUSIC_TRACKS[id],import.meta.url)).size>1000);
 const media={dataset:{},paused:true,addEventListener(){},pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();}};
 const audio=createGameAudio({createMedia:()=>media,createContext:()=>({state:'running'})});
 audio.unlock();
 for(const scene of ['menu','map','match','menu']){audio.setScene(scene);assert.equal(media.src,MUSIC_TRACKS[scene]);assert.equal(media.loop,true);}
 audio.setEnabled(false);assert.equal(media.paused,true);
});
test('supplied Halloween music plays on the map and leaves matches unchanged',()=>{
 assert.equal(musicForSection('worldArea'),'map');
 assert.equal(MUSIC_TRACKS.map,'/game2/assets/audio/haunted-pixel-woods-v1.mp3');
 assert.ok(statSync(new URL('../game2/assets/audio/haunted-pixel-woods-v1.mp3',import.meta.url)).size>1000);
 const media={dataset:{},paused:true,addEventListener(){},pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();}};
 const audio=createGameAudio({createMedia:()=>media,createContext:()=>({state:'running'})});
 audio.unlock();audio.setScene('map');assert.equal(media.src,MUSIC_TRACKS.map);assert.equal(media.loop,true);
 audio.setScene('match');assert.equal(media.src,'/games/assets/audio/jogando-v1.mp3');
 audio.setScene('map');assert.equal(media.src,MUSIC_TRACKS.map);
 audio.setEnabled(false);assert.equal(media.paused,true);
});
const camera={x:0,y:0,w:1536,h:1536};
test('ambient cues follow nearby bats, ghosts and trees, never distant scenery',()=>{
 assert.equal(halloweenAmbientCue(1,{x:500,y:500},camera),null);
 assert.equal(halloweenAmbientCue(7,halloweenBatPosition(7,0),camera).kind,'bat');
 assert.equal(halloweenAmbientCue(14,LANDMARK_TREES[0],camera).kind,'tree-creak');
 const ghost=halloweenProps(camera).find(o=>o.propType==='ghost');
 assert.equal(halloweenAmbientCue(21,ghost,camera).kind,'ghost');
 assert.equal(halloweenAmbientCue(21,{x:-9999,y:-9999},camera),null);
});
test('Halloween audio is quiet, throttled, muted and stopped with the app lifecycle',()=>{
 let time=10000,voices=0;const levels=[];
 const parameter={setValueAtTime(){},exponentialRampToValueAtTime(v){levels.push(v);}};
 const context={state:'running',currentTime:0,resume:()=>Promise.resolve(),createOscillator:()=>({frequency:parameter,connect(){},disconnect(){},start(){voices++;},stop(){}}),createGain:()=>({gain:parameter,connect(){},disconnect(){}})};
 const audio=createGameAudio({createContext:()=>context,now:()=>time});
 audio.unlock();audio.setScene('map');
 for(const kind of ['bat','ghost','tree-creak']){assert.equal(audio.effect(kind),true);assert.equal(audio.effect(kind),false);}
 const before=voices;audio.setEnabled(false);time+=10000;assert.equal(audio.effect('ghost'),false);assert.equal(voices,before);
 audio.setEnabled(true);audio.setHidden(true);assert.equal(audio.effect('bat'),false);
 audio.setHidden(false);audio.setPaused(true);assert.equal(audio.effect('tree-creak'),false);
 // Frequency ramps use the same stub; only gain-range values are inspected.
 assert.ok(Math.max(...levels.filter(v=>v<1))<=.012);
});
