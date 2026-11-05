// One reusable music element: tracks never overlap, including on mobile Safari.
export const MUSIC_TRACKS=Object.freeze({
 menu:'/game2/assets/audio/misterio-no-ilha-menu-v1.mp3',
 map:'/game2/assets/audio/haunted-pixel-woods-v1.mp3',
 match:'/games/assets/audio/jogando-v1.mp3',
 pickleball:'/games/assets/audio/pickleball-v1.mp3',
 ending:'/games/assets/audio/valeu-aventura-ending-v1.mp3',
 beto:null,
 medal:'/games/assets/audio/medalha-v1.mp3',
 lesson:'/games/assets/audio/aula-renato-v1.mp3',
 romulo:'/games/assets/audio/romulo-final-v1.mp3',
});
export function musicForSection(section,sport='tennis'){
 if(section==='endingArea')return 'ending';
 if(section==='worldArea')return 'map';
 if(section==='playArea')return sport==='pickleball'?'pickleball':'match';
 if(section==='pickleArea')return 'pickleball';
 if(['selection','results','quickPlayArea','legacyMenu','legacyProfile','legacyRosterArea','legacyInfo'].includes(section))return 'menu';
 return null;
}
export function musicForMatch(match,sport='tennis'){
 if(match?.kind==='lesson'&&match.id==='renato')return 'lesson';
 if(match?.kind==='duel'&&match.id==='romulo')return 'romulo';
 return sport==='pickleball'?'pickleball':'match';
}
// frequency, end frequency, duration, volume, waveform, delay
const tones={
 bat:[[2300,2900,.055,.008,'sine'],[2700,1900,.08,.006,'sine',.16],[190,90,.09,.004,'triangle',.06],[170,80,.09,.004,'triangle',.22]],
 ghost:[[240,370,.9,.009,'sine'],[365,210,1.3,.007,'sine',.65],[480,430,1.4,.003,'sine',.2]],
 'tree-creak':[[95,150,.65,.008,'triangle'],[155,105,.85,.006,'triangle',.4],[280,175,.5,.003,'sine',.9]],
 bird:[[1450,2400,.10,.025,'sine'],[1900,1350,.12,.02,'sine',.14],[1600,2500,.09,.017,'sine',.34]],
 monkey:[[420,650,.09,.028,'triangle'],[650,380,.13,.022,'triangle',.11],[480,790,.08,.02,'sine',.31],[550,290,.16,.019,'triangle',.42]],
 wind:[[140,80,1.8,.012,'sine']],
 splash:[[820,100,.12,.014,'triangle'],[380,80,.15,.01,'sine',.07]],
 step:[[130,55,.055,.008,'triangle'],[75,42,.025,.003,'triangle']],
 'menu-move':[[720,910,.04,.018,'square']],
 'menu-select':[[660,660,.055,.025,'square'],[990,990,.07,.02,'square',.055]],
 hit:[[920,180,.065,.075,'square'],[1500,450,.022,.035,'triangle']],
 'cpu-hit':[[700,150,.065,.065,'square']],
 bounce:[[230,75,.06,.045,'triangle']],
 slice:[[540,160,.09,.065,'sawtooth']],
 lob:[[450,980,.12,.028,'triangle']],
 drop:[[660,220,.055,.055,'square']],
 toss:[[200,350,.06,.018,'triangle']],
 serve:[[1100,180,.085,.08,'square'],[1800,650,.024,.025,'triangle']],
 smash:[[1500,220,.12,.035,'square']],
 charge:[[660,990,.10,.025,'square']],
 point:[[660,660,.12,.027,'square'],[880,880,.15,.027,'square',.09]],
 miss:[[260,110,.18,.025,'triangle']],
 'lesson-success':[[660,660,.10,.04,'triangle'],[880,880,.12,.04,'triangle',.12],[1320,1320,.20,.04,'triangle',.26]],
 'lesson-retry':[[440,440,.13,.03,'sine'],[330,330,.18,.025,'sine',.17]],
 'item-pickup':[[784,988,.09,.035,'triangle'],[1175,1568,.16,.04,'sine',.10]],
 'rare-item':[[392,784,.18,.035,'triangle'],[988,988,.22,.04,'sine',.15],[1175,1568,.30,.035,'triangle',.34]],
 drink:[[330,190,.09,.025,'sine'],[420,250,.1,.025,'sine',.12],[520,880,.15,.03,'triangle',.25]],
 'item-delivery':[[659,659,.10,.03,'triangle'],[784,784,.10,.035,'triangle',.12],[1046,1046,.24,.04,'sine',.24]],
 finish:[[660,660,.12,.025,'square'],[880,880,.12,.025,'square',.09],[1320,1320,.18,.025,'square',.18]],
 rain:[],
 fanfare:[[523,523,.18,.04,'triangle'],[659,659,.18,.04,'triangle',.18],[784,784,.22,.045,'triangle',.36],[1046,1046,.6,.05,'triangle',.6]],
 applause:[[320,90,.07,.04,'sawtooth'],[450,130,.06,.03,'triangle',.13],[280,100,.08,.04,'sawtooth',.28],[390,120,.07,.03,'triangle',.42]],
 photo:[[1800,120,.045,.05,'square'],[750,90,.035,.025,'triangle',.06]],
};
// Cached, filtered noise adds texture without downloading SFX or a running loop.
// Rain uses a long, low bed with a slow fade. Adjacent beds overlap slightly,
// avoiding the short loud bursts that sounded like compressed air.
const noiseEffects={rain:{duration:4.6,volume:.016,cutoff:1900,attack:.9},wind:{duration:3,volume:.055,cutoff:600,attack:1},step:{duration:.075,volume:.024,cutoff:700,attack:.008},applause:{duration:.65,volume:.075,cutoff:2800,attack:.02}};
// A short hollow paddle "pop", distinct from the tennis string-bed sound.
const paddleTones={
 hit:[[1250,420,.045,.08,'triangle'],[620,210,.07,.04,'square']],
 'cpu-hit':[[1050,360,.045,.07,'triangle'],[520,180,.06,.035,'square']],
 serve:[[1450,400,.055,.085,'triangle'],[680,200,.075,.04,'square']],
 slice:[[980,280,.06,.07,'triangle'],[1600,480,.03,.025,'square']],
 drop:[[1150,450,.035,.06,'triangle']],
 bounce:[[420,160,.045,.04,'triangle']],
};
function browserMedia(){
 const media=document.createElement('audio');
 media.hidden=true;media.setAttribute('aria-hidden','true');media.dataset.gameMusic='';
 document.body.append(media);return media;
}
export function createGameAudio({enabled=true,createMedia=browserMedia,createContext=()=>new (globalThis.AudioContext||globalThis.webkitAudioContext)(),now=()=>performance.now()}={}){
 let unlocked=false,hidden=false,paused=false,scene=null,loaded=null,media=null,context=null,restoreAt=null,musicSource=null,musicGain=null,resuming=false;
 const positions=new Map(),lastEffects=new Map(),voices=new Set(),noiseBuffers=new Map();
 const musicAllowed=()=>enabled&&unlocked&&!hidden&&!paused&&Boolean(scene);
 function resumeContext(){
  if(!musicAllowed()||!context||context.state==='running'||context.state==='closed'||resuming)return;
  resuming=true;
  try{Promise.resolve(context.resume()).then(()=>{resuming=false;if(context?.state==='running')syncMusic();}).catch(()=>{resuming=false;});}
  catch{resuming=false;}
 }
 function mediaReady(){restorePosition();syncMusic();}
 // iOS can suspend/interupt Web Audio while the reusable audio element still
 // reports paused=false. Recover both layers, not only HTMLMediaElement.play().
 function recover(){if(!musicAllowed())return;resumeContext();syncMusic();}
 function stopEffects(){for(const voice of [...voices])voice.stop();lastEffects.clear();}
 function restorePosition(){
  if(restoreAt===null||!media||media.readyState<1)return;
  if(restoreAt>0&&media.seekable&&media.seekable.length===0)return;
  try{media.currentTime=Number.isFinite(media.duration)?Math.min(restoreAt,Math.max(0,media.duration-.05)):restoreAt;restoreAt=null;}catch{/* Wait for usable metadata. */}
 }
 function syncMusic(){
  if(!MUSIC_TRACKS[scene]){if(media)media.pause();return;} // Silent sections keep SFX active.
  if(!musicAllowed()){if(media){media.muted=!enabled;media.pause();}return;}
  try{
   resumeContext();
   if(!media){media=createMedia();media.loop=true;media.preload='none';media.volume=.28;media.addEventListener('loadedmetadata',restorePosition);media.addEventListener('canplay',mediaReady);media.addEventListener('ended',repeatTrack);}
   const musicLevel=['match','pickleball','lesson','romulo'].includes(scene)?.065:.28;
   // iOS may ignore HTMLMediaElement.volume. Mix music through Web Audio
   // so it cannot drown out racket effects even with the phone volume raised.
   if(!musicSource&&context?.createMediaElementSource){
    musicSource=context.createMediaElementSource(media);musicGain=context.createGain();musicSource.connect(musicGain);musicGain.connect(context.destination);
   }
   media.muted=false;media.volume=musicGain?1:musicLevel;
   if(musicGain)musicGain.gain.setValueAtTime(musicLevel,context.currentTime);
   if(loaded!==scene){
    if(loaded&&restoreAt===null)positions.set(loaded,Number.isFinite(media.currentTime)?media.currentTime:0);
    media.pause();loaded=scene;restoreAt=positions.get(scene)||0;media.src=MUSIC_TRACKS[scene];media.dataset.gameMusic=scene;
   }
   // Assigning src starts loading asynchronously: readyState may still describe
   // the OLD track here. Seek only from loadedmetadata for the new resource.
   if(media.paused){
    // A rejected autoplay/load request must not break gameplay. Retry on a gesture.
    const attempt=media.play();
    attempt?.then(()=>{if(!musicAllowed())media?.pause();}).catch(()=>{});
   }
  }catch{/* Audio is optional; a missing/unsupported track cannot stop the game. */}
 }
 function repeatTrack(){if(!musicAllowed()||!media)return;restoreAt=null;positions.set(scene,0);media.currentTime=0;syncMusic();}
 function unlock(){
  if(!enabled)return;
  unlocked=true;
  // Use the same playback audio session as music on supported mobile Safari.
  try{if(globalThis.navigator?.audioSession)globalThis.navigator.audioSession.type='playback';}catch{/* Optional browser API. */}
  try{context ||=createContext();if(context.state!=='running')context.resume()?.catch(()=>{});}catch{/* Music can work without Web Audio. */}
  syncMusic();
 }
 function effect(kind){
  if(!enabled||!unlocked||hidden||!scene||!context||context.state!=='running'||(paused&&!kind.startsWith('menu-')))return false;
  const notes=(scene==='pickleball'&&paddleTones[kind])||tones[kind];if(!notes)return false;
  const time=now(),limit=['bat','ghost','tree-creak'].includes(kind)?6500:kind==='step'?140:kind==='rain'?3500:kind==='wind'?3000:['bird','monkey'].includes(kind)?1500:kind.startsWith('menu-')?65:12;
  if(time-(lastEffects.get(kind)??-Infinity)<limit)return false;
  lastEffects.set(kind,time);
  try{
   const texture=noiseEffects[kind];
   if(texture&&context.createBuffer&&context.createBufferSource&&context.createBiquadFilter){
    if(voices.size>=8)voices.values().next().value.stop();
    if(!noiseBuffers.has(kind)){
     const rate=22050,buffer=context.createBuffer(1,Math.ceil(texture.duration*rate),rate),data=buffer.getChannelData(0);
     let seed=379,rainBed=0;for(let i=0;i<data.length;i++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;const white=seed/2147483648-1;
      if(kind==='rain'){rainBed=rainBed*.965+white*.035;data[i]=rainBed*.7+white*.045;}
      else data[i]=white*(kind==='applause'?.35+.65*Math.abs(Math.sin(i/rate*39)):1);
     }
     noiseBuffers.set(kind,buffer);
    }
    const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain(),start=context.currentTime;
    source.buffer=noiseBuffers.get(kind);filter.type='lowpass';filter.frequency.setValueAtTime(texture.cutoff,start);filter.Q.setValueAtTime(.6,start);
    gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(texture.volume,start+texture.attack);gain.gain.setValueAtTime(texture.volume,start+texture.duration*.7);gain.gain.exponentialRampToValueAtTime(.0001,start+texture.duration);
    source.connect(filter);filter.connect(gain);gain.connect(context.destination);
    const clean=()=>{source.disconnect();filter.disconnect();gain.disconnect();voices.delete(voice);};
    const voice={stop(){try{source.stop();}catch{/* Already ended. */}clean();}};source.onended=clean;voices.add(voice);source.start(start);source.stop(start+texture.duration+.01);
    // Footsteps keep the low thud too; rain/wind/claps use natural texture only.
    if(kind!=='step')return true;
   }
   for(const [frequency,end,duration,volume,type,delay=0] of notes){
    if(voices.size>=8)voices.values().next().value.stop();
    const oscillator=context.createOscillator(),gain=context.createGain(),start=context.currentTime+delay;
    oscillator.type=type;oscillator.frequency.setValueAtTime(frequency,start);oscillator.frequency.exponentialRampToValueAtTime(end,start+duration);
    const boost=['bat','ghost','tree-creak','bird','monkey','splash','step'].includes(kind)?1.25:2.4;
    const attack=kind==='ghost'?.18:kind==='tree-creak'?.08:.003;
    gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(Math.min(.22,volume*boost),start+attack);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
    oscillator.connect(gain);gain.connect(context.destination);
    const voice={stop(){try{oscillator.stop();}catch{/* Already ended. */}oscillator.disconnect();gain.disconnect();voices.delete(voice);}};
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();voices.delete(voice);};voices.add(voice);
    oscillator.start(start);oscillator.stop(start+duration+.01);
   }
   return true;
  }catch{return false;}
 }
 return {
  unlock,effect,recover,
  setScene(value,{restart=false}={}){
   const next=Object.hasOwn(MUSIC_TRACKS,value)?value:null;
   if(next!==scene||!next)stopEffects();scene=next;paused=false;
   if(restart&&scene){positions.delete(scene);if(loaded===scene){restoreAt=0;restorePosition();}}
   syncMusic();
  },
  setEnabled(value){enabled=Boolean(value);if(!enabled)stopEffects();syncMusic();},
  setPaused(value){paused=Boolean(value);if(paused)stopEffects();syncMusic();},
  setHidden(value){hidden=Boolean(value);if(hidden)stopEffects();syncMusic();},
  destroy(){scene=null;stopEffects();musicSource?.disconnect();musicGain?.disconnect();musicSource=musicGain=null;if(media){media.pause();media.removeEventListener('loadedmetadata',restorePosition);media.removeEventListener('canplay',mediaReady);media.removeEventListener('ended',repeatTrack);media.remove();media=null;}context?.close()?.catch(()=>{});context=null;unlocked=false;loaded=null;},
 };
}
