import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createGameAudio,musicForSection,musicForMatch,MUSIC_TRACKS} from '../games/audio.js';
import {SOUNDTRACK} from '../games/legado-ui.js';
import {advanceWalkCycle,WALK_SPEED,moveWalker,distance} from '../games/world-model.js';

test('footstep texture and thud are quiet while racket effects remain audible',()=>{
 const h=harness({noise:true});h.audio.unlock();h.audio.setScene('map');h.audio.effect('step');
 assert.ok(Math.max(...h.levels)<=.024);assert.ok(h.levels.some(v=>v===.024));
 h.audio.setScene('match');const first=h.levels.length;h.audio.effect('hit');assert.ok(Math.max(...h.levels.slice(first))>.07);
});
test('returning to app recovers an interrupted Web Audio mixer even when media still says playing',async()=>{
 const h=harness({mixer:true});h.audio.unlock();h.audio.setScene('ending');h.media.metadata();h.media.currentTime=30;
 h.context.state='interrupted';assert.equal(h.media.paused,false);h.audio.recover();await Promise.resolve();assert.equal(h.context.state,'running');assert.equal(h.media.currentTime,30);
 h.audio.setHidden(true);h.context.state='suspended';h.audio.recover();assert.equal(h.context.state,'suspended');
 h.audio.setHidden(false);await Promise.resolve();assert.equal(h.context.state,'running');assert.equal(h.media.paused,false);
 for(const scene of ['map','menu','match','menu','map']){h.audio.setScene(scene);h.media.metadata();assert.equal(h.media.src,MUSIC_TRACKS[scene]);assert.equal(h.media.paused,false);}
 h.audio.setPaused(true);h.context.state='suspended';h.audio.recover();assert.equal(h.context.state,'suspended');h.audio.setPaused(false);await Promise.resolve();assert.equal(h.context.state,'running');
 h.audio.setEnabled(false);h.context.state='interrupted';h.audio.recover();assert.equal(h.context.state,'interrupted');assert.equal(h.mediaCount,1);
});
test('app entry and foreground lifecycle clear stale hidden audio and recover the installed menu',async()=>{
 const app=await readFile(new URL('../games/app.js',import.meta.url),'utf8');
 assert.match(app,/function initAudio\(\)\{audio\.setHidden\(document\.hidden\);audio\.unlock\(\);audio\.recover\(\);\}/);
 assert.match(app,/window\.addEventListener\('pageshow',restoreAfterReturn\)/);
 assert.match(app,/if\(appMode&&!\$\('gameDialog'\)\.open\)legacy\.menu\(\)/);
 assert.match(app,/if\(appMode\)\{legacy\.menu\(\);return;\}/);
 assert.match(app,/audio\.setScene\('menu',\{restart:true\}\)/);
});
test('canplay retries a stalled song, but never restarts while app is hidden',()=>{
 const h=harness();h.audio.unlock();h.audio.setScene('map');h.media.paused=true;const n=h.media.plays;h.media.handlers.canplay();assert.equal(h.media.plays,n+1);
 h.audio.setHidden(true);h.media.handlers.canplay();assert.equal(h.media.plays,n+1);
});

test('special songs restart for new rewards/films but Beto pages keep playing and map resumes',()=>{
 const h=harness();h.audio.unlock();h.audio.setScene('map');h.media.metadata();h.media.currentTime=26;
 h.audio.setScene('beto');h.media.metadata();h.media.currentTime=19;h.audio.setScene('beto');assert.equal(h.media.currentTime,19);
 h.audio.setScene('medal',{restart:true});h.media.metadata();h.media.currentTime=14;
 h.audio.setScene('map');h.media.metadata();assert.equal(h.media.currentTime,26);
 h.audio.setScene('medal',{restart:true});h.media.metadata();assert.equal(h.media.currentTime,0);
 h.audio.setScene('ending');h.media.metadata();h.media.currentTime=38;h.audio.setScene('ending',{restart:true});assert.equal(h.media.currentTime,0);
 assert.equal(musicForSection('endingArea'),'ending');assert.equal(musicForSection('quickPlayArea'),'menu');assert.equal(h.mediaCount,1);
});
test('quick pickleball uses its own song and paddle timbre, not the tennis section default',async()=>{
 assert.equal(musicForSection('playArea','pickleball'),'pickleball');assert.equal(musicForSection('playArea','tennis'),'match');
 assert.equal(musicForSection('playArea'),'match');
 const app=await readFile(new URL('../games/app.js',import.meta.url),'utf8');assert.match(app,/showSection\('playArea',game.sport,musicForMatch\(local,game.sport\)\)/);assert.match(app,/musicForSection\(id,sport\)/);
});
test('Renato lesson and Romulo final use their exclusive supplied songs',()=>{
 assert.equal(musicForMatch({kind:'lesson',id:'renato'},'tennis'),'lesson');
 assert.equal(musicForMatch({kind:'duel',id:'romulo'},'tennis'),'romulo');
 assert.equal(musicForMatch({kind:'duel',id:'andre'},'tennis'),'match');
 assert.equal(musicForMatch({kind:'quick',id:'gael'},'pickleball'),'pickleball');
 assert.equal(MUSIC_TRACKS.lesson,'/games/assets/audio/aula-renato-v1.mp3');
 assert.equal(MUSIC_TRACKS.romulo,'/games/assets/audio/romulo-final-v1.mp3');
});
test('the latest supplied Vamos La song is the exclusive menu opening theme',()=>{
 assert.equal(MUSIC_TRACKS.menu,'/games/assets/audio/vamos-la-menu-v2.mp3');
 for(const section of ['selection','results','quickPlayArea','legacyMenu','legacyProfile','legacyRosterArea','legacyInfo'])assert.equal(musicForSection(section),'menu');
 assert.notEqual(MUSIC_TRACKS.menu,MUSIC_TRACKS.map);
});
test('Valeu a Aventura is reserved for the ending and credits',()=>{
 assert.equal(MUSIC_TRACKS.ending,'/games/assets/audio/valeu-aventura-ending-v1.mp3');
 assert.equal(musicForSection('endingArea'),'ending');
 assert.notEqual(MUSIC_TRACKS.ending,MUSIC_TRACKS.menu);
});
test('the menu offers a complete playable soundtrack without inventing audio routes',async()=>{
 const ids=SOUNDTRACK.map(([id])=>id);assert.deepEqual([...ids].sort(),Object.keys(MUSIC_TRACKS).sort());assert.equal(new Set(ids).size,ids.length);
 const html=await readFile(new URL('../games/index.html',import.meta.url),'utf8');assert.match(html,/id="legacyMusic"[^>]*>Ouvir músicas/);
 const ui=await readFile(new URL('../games/legado-ui.js',import.meta.url),'utf8');assert.match(ui,/showSection\('legacyInfo',undefined,scene\)/);assert.match(ui,/Tocando agora:/);
});
test('textured rain, wind, steps and rewards obey mute/pause/scene lifecycle and voice cap',()=>{
 const h=harness({noise:true});h.audio.unlock();h.audio.setScene('map');
 for(const kind of ['rain','wind','step','bird','monkey','item-pickup','rare-item','drink','item-delivery','applause']){assert.equal(h.audio.effect(kind),true,kind);h.advance(200);}
 assert.ok(h.nodes.some(n=>n.buffer));assert.ok(h.nodes.filter(n=>!n.disconnected).length<=8);
 h.audio.setScene('match');assert.ok(h.nodes.every(n=>n.disconnected));
 h.audio.setPaused(true);assert.equal(h.audio.effect('rain'),false);h.audio.setPaused(false);
 h.audio.effect('wind');h.audio.setHidden(true);assert.ok(h.nodes.every(n=>n.disconnected));assert.equal(h.audio.effect('rain'),false);
 h.audio.setHidden(false);h.audio.effect('rain');h.audio.setEnabled(false);assert.ok(h.nodes.every(n=>n.disconnected));assert.equal(h.audio.effect('rare-item'),false);
 h.audio.destroy();
});
test('rain is a quiet continuous bed instead of loud compressor-like bursts',()=>{
 const h=harness({noise:true});h.audio.unlock();h.audio.setScene('map');
 assert.equal(h.audio.effect('rain'),true);
 assert.ok(Math.max(...h.levels)<=.016);
 h.advance(2000);assert.equal(h.audio.effect('rain'),false);
 h.advance(1600);assert.equal(h.audio.effect('rain'),true);
});

function harness({enabled=true,rejected=false,deferred=false,unsupported=false,staleMetadata=false,mixer=false,noise=false}={}){
 let time=0,mediaCount=0,contextCount=0,resolvePlay;
 const media={paused:true,currentTime:0,duration:180,readyState:0,dataset:{},handlers:{},plays:0,pauses:0,
  set src(value){this.url=value;this.currentTime=0;if(!staleMetadata)this.readyState=0;},get src(){return this.url;},
  addEventListener(name,fn){this.handlers[name]=fn;},removeEventListener(name){delete this.handlers[name];},
  metadata(){this.readyState=1;this.handlers.loadedmetadata?.();},
  play(){this.plays++;if(rejected)return Promise.reject(new Error('Autoplay blocked'));this.paused=false;return deferred?new Promise(resolve=>{resolvePlay=resolve;}):Promise.resolve();},
  pause(){this.paused=true;this.pauses++;},remove(){this.removed=true;},
 };
 const nodes=[],levels=[],musicLevels=[];let sources=0;
 const param=()=>({setValueAtTime(){},exponentialRampToValueAtTime(){}});
 const context={state:'suspended',currentTime:0,destination:{},
  resume(){this.state='running';return Promise.resolve();},close(){this.state='closed';return Promise.resolve();},
  createOscillator(){const node={frequency:param(),connect(){},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stops=(this.stops||0)+1;}};nodes.push(node);return node;},
  createGain(){return {gain:{...param(),setValueAtTime(value){musicLevels.push(value);},exponentialRampToValueAtTime(value){levels.push(value);}},connect(){},disconnect(){}};},
 };
 if(noise){context.createBuffer=(_,length)=>({getChannelData:()=>new Float32Array(length)});context.createBufferSource=()=>context.createOscillator();context.createBiquadFilter=()=>({type:'',frequency:param(),Q:param(),connect(){},disconnect(){}});}
 if(mixer)context.createMediaElementSource=()=>{sources++;return {connect(){},disconnect(){}};};
 const audio=createGameAudio({enabled,now:()=>time,createMedia:()=>{mediaCount++;return media;},createContext:()=>{contextCount++;if(unsupported)throw new Error('No Web Audio');return context;}});
 return {audio,media,context,nodes,levels,musicLevels,get sources(){return sources;},advance(ms){time+=ms;},resolvePlay(){resolvePlay?.();},get mediaCount(){return mediaCount;},get contextCount(){return contextCount;}};
}
test('music uses a single Web Audio mixer when available, including scene switches',()=>{
 const h=harness({mixer:true});h.audio.unlock();h.audio.setScene('match');assert.equal(h.media.volume,1);assert.equal(h.musicLevels.at(-1),.065);
 h.audio.setScene('map');assert.equal(h.musicLevels.at(-1),.28);h.audio.setScene('pickleball');assert.equal(h.musicLevels.at(-1),.065);assert.equal(h.sources,1);
 h.audio.destroy();assert.equal(h.context.state,'closed');
});
test('stronger shot effects stay bounded without raising the music volume',()=>{
 const h=harness();h.audio.unlock();h.audio.setScene('match');h.audio.effect('hit');
 assert.equal(h.media.volume,.065);
 h.audio.setScene('pickleball');assert.equal(h.media.volume,.065);
 h.audio.setScene('map');assert.equal(h.media.volume,.28);
 assert.ok(Math.max(...h.levels)>.07);
 assert.ok(h.levels.every(level=>level<=.22));
});
test('music is gesture-gated, defaults to no track and maps each section to its soundtrack',()=>{
 const h=harness();assert.equal(h.mediaCount,0);assert.equal(h.contextCount,0);
 h.audio.setScene('menu');assert.equal(h.mediaCount,0);assert.equal(h.audio.effect('hit'),false);
 h.audio.unlock();assert.equal(h.mediaCount,1);assert.equal(h.media.src,MUSIC_TRACKS.menu);assert.equal(h.media.loop,true);assert.ok(h.media.volume<.4);
 for(const s of ['selection','results','legacyMenu','legacyProfile','legacyRosterArea','legacyInfo'])assert.equal(musicForSection(s),'menu');
 assert.equal(musicForSection('worldArea'),'map');assert.equal(musicForSection('playArea'),'match');assert.equal(musicForSection('pickleArea'),'pickleball');assert.equal(musicForSection('closed'),null);
});
test('racket, paddle and bounce effects are audible events, distinct by sport and muted together',()=>{
 const h=harness();h.audio.unlock();
 for(const scene of ['match','pickleball']){
  h.audio.setScene(scene);
  for(const kind of ['serve','hit','cpu-hit','slice','drop','bounce','lesson-success','lesson-retry']){h.advance(100);const count=h.nodes.length;assert.equal(h.audio.effect(kind),true);assert.ok(h.nodes.length>count);}
 }
 h.audio.setEnabled(false);h.advance(100);assert.equal(h.audio.effect('bounce'),false);assert.equal(h.audio.effect('serve'),false);
});
test('all supplied songs loop, including a guarded ended fallback, and pickleball resumes independently',()=>{
 const h=harness();h.audio.unlock();
 for(const scene of Object.keys(MUSIC_TRACKS)){
  h.audio.setScene(scene);h.media.metadata();assert.equal(h.media.loop,true);assert.equal(h.media.src,MUSIC_TRACKS[scene]);
  h.media.currentTime=h.media.duration;h.media.paused=true;const plays=h.media.plays;h.media.handlers.ended();assert.equal(h.media.currentTime,0);assert.equal(h.media.plays,plays+1);
 }
 h.audio.setScene('pickleball');h.media.metadata();h.media.currentTime=31;h.audio.setScene('map');h.media.metadata();h.audio.setScene('pickleball');h.media.metadata();assert.equal(h.media.currentTime,31);
 h.audio.setPaused(true);const plays=h.media.plays;h.media.handlers.ended();assert.equal(h.media.plays,plays);
 h.audio.destroy();assert.equal(h.media.handlers.ended,undefined);
});
test('one music element switches tracks and restores the map position without overlapping music',()=>{
 const h=harness();h.audio.unlock();h.audio.setScene('menu');h.media.metadata();h.media.currentTime=12;
 h.audio.setScene('map');h.media.metadata();h.media.currentTime=29;
 h.audio.setScene('match');h.media.metadata();h.media.currentTime=8;
 h.audio.setScene('map');h.media.metadata();assert.equal(h.media.currentTime,29);
 h.audio.setScene('menu');h.media.metadata();assert.equal(h.media.currentTime,12);
 assert.equal(h.mediaCount,1);assert.equal(h.media.paused,false);
 const plays=h.media.plays;h.audio.setScene('menu');assert.equal(h.media.plays,plays);assert.equal(h.media.currentTime,12);
});
test('master sound disables music and live effects and preserves the requested scene while muted',()=>{
 const h=harness();h.audio.unlock();h.audio.setScene('map');assert.equal(h.audio.effect('step'),true);
 h.audio.setEnabled(false);assert.equal(h.media.paused,true);assert.equal(h.media.muted,true);assert.ok(h.nodes.every(n=>n.disconnected));assert.equal(h.audio.effect('hit'),false);
 const plays=h.media.plays;h.audio.setScene('match');assert.equal(h.media.plays,plays);
 h.audio.setEnabled(true);assert.equal(h.media.src,MUSIC_TRACKS.match);assert.equal(h.media.paused,false);
});
test('a saved muted preference does not create audio until explicitly enabled and unlocked',()=>{
 const h=harness({enabled:false});h.audio.setScene('menu');h.audio.unlock();assert.equal(h.mediaCount,0);assert.equal(h.contextCount,0);
 h.audio.setEnabled(true);assert.equal(h.mediaCount,0);h.audio.unlock();assert.equal(h.media.paused,false);
});
test('pause, hidden tab, close and late play completion cannot leave background music running',async()=>{
 const h=harness();h.audio.unlock();h.audio.setScene('match');h.audio.setPaused(true);assert.equal(h.media.paused,true);assert.equal(h.audio.effect('hit'),false);assert.equal(h.audio.effect('menu-move'),true);
 h.audio.setHidden(true);h.audio.setHidden(false);assert.equal(h.media.paused,true);
 h.audio.setPaused(false);assert.equal(h.media.paused,false);h.audio.setHidden(true);assert.equal(h.media.paused,true);assert.equal(h.audio.effect('menu-select'),false);
 h.audio.setHidden(false);assert.equal(h.media.paused,false);h.audio.setScene(null);assert.equal(h.media.paused,true);assert.equal(h.audio.effect('step'),false);
 const late=harness({deferred:true});late.audio.unlock();late.audio.setScene('menu');late.audio.setScene(null);late.media.paused=false;late.resolvePlay();await Promise.resolve();assert.equal(late.media.paused,true);
});
test('autoplay rejection and missing Web Audio are non-fatal and retry on the next gesture',async()=>{
 const h=harness({rejected:true});h.audio.unlock();h.audio.setScene('menu');await Promise.resolve();h.audio.unlock();await Promise.resolve();assert.equal(h.media.plays,2);
 const noWeb=harness({unsupported:true});assert.doesNotThrow(()=>{noWeb.audio.setScene('menu');noWeb.audio.unlock();});assert.equal(noWeb.media.paused,false);assert.equal(noWeb.audio.effect('hit'),false);
});
test('retro effects cover footsteps, menu and tennis shots; footsteps/hover are rate-limited',()=>{
 const h=harness();h.audio.unlock();h.audio.setScene('map');
 for(const sound of ['step','menu-move','menu-select','hit','cpu-hit','slice','lob','drop','toss','serve','smash','charge','point','miss','finish']){assert.equal(h.audio.effect(sound),true,sound);h.advance(200);}
 assert.equal(h.audio.effect('step'),true);assert.equal(h.audio.effect('step'),false);h.advance(150);assert.equal(h.audio.effect('step'),true);
 assert.equal(h.audio.effect('menu-move'),true);assert.equal(h.audio.effect('menu-move'),false);assert.equal(h.audio.effect('unknown'),false);
 assert.ok(h.nodes.every(n=>n.started));assert.ok(h.nodes.filter(n=>!n.disconnected).length<=8);
 h.audio.destroy();assert.equal(h.media.paused,true);assert.equal(h.context.state,'closed');assert.ok(h.nodes.every(n=>n.disconnected));
});
test('rapid scene changes before metadata cannot copy the previous track position to a new track',()=>{
 const h=harness();h.audio.unlock();h.audio.setScene('menu');h.media.metadata();h.media.currentTime=44;
 h.audio.setScene('map');h.audio.setScene('match');h.audio.setScene('menu');h.media.metadata();assert.equal(h.media.currentTime,44);
 h.audio.setScene('map');h.media.metadata();assert.equal(h.media.currentTime,0);
});
test('track restore waits for NEW metadata even if the browser still reports the previous readyState',()=>{
 const h=harness({staleMetadata:true});h.audio.unlock();h.audio.setScene('menu');h.media.metadata();h.media.currentTime=44;
 h.audio.setScene('map');h.media.currentTime=0;h.media.metadata();h.media.currentTime=12;
 h.audio.setScene('menu');h.audio.unlock();
 // The actual load algorithm resets playback after src assignment returns.
 h.media.currentTime=0;h.media.metadata();assert.equal(h.media.currentTime,44);
});
test('a seek waits until buffered/range metadata makes the music seekable',()=>{
 const h=harness();h.audio.unlock();h.audio.setScene('map');h.media.metadata();h.media.currentTime=26;
 h.audio.setScene('menu');h.media.metadata();h.audio.setScene('map');h.media.seekable={length:0};h.media.metadata();assert.equal(h.media.currentTime,0);
 h.media.seekable={length:1};h.media.handlers.canplay();assert.equal(h.media.currentTime,26);
});
test('walking is 120px/s and footfalls follow actual distance, independent of frame rate or walls',()=>{
 assert.equal(WALK_SPEED,120);
 for(const fps of [30,60,120]){
  const p={x:516,y:800,stride:0},start={...p};let steps=0;
  for(let i=0;i<fps;i++){const before={...p};moveWalker(p,0,1,1/fps);if(advanceWalkCycle(p,distance(before,p)))steps++;}
  assert.ok(Math.abs(distance(start,p)-120)<.001);assert.ok(steps>=4&&steps<=5);
 }
 const p={x:1100,y:74,stride:0};let steps=0;
 for(let i=0;i<60;i++){const before={...p};moveWalker(p,1,0,1/60);if(advanceWalkCycle(p,distance(before,p)))steps++;}
 assert.ok(steps<=1,'the wall must not produce walking sounds');assert.equal(advanceWalkCycle(p,0),false);assert.equal(p.stride,0);
});
test('all nine supplied MP3 tracks and the cache-fingerprinted module are shipped with Games',async()=>{
 for(const url of Object.values(MUSIC_TRACKS)){const file=await readFile(new URL(`..${url}`,import.meta.url));assert.equal(file.subarray(0,3).toString(),'ID3');assert.ok(file.length>100000);}
 const build=await readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8');assert.match(build,/'audio.js'/);
 const app=await readFile(new URL('../games/app.js',import.meta.url),'utf8');assert.match(app,/onStep:\(\)=>beep\('step'\)/);assert.match(app,/beep\(game.event\)/);assert.match(app,/onSound:beep/);
});
