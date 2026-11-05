import {createRacketMatch,stepRacketMatch} from './racket-match.js';
import {createRacketRenderer} from './racket-renderer.js';
import {createAssistedInput} from './assisted-input.js';

export function createPickleballArcade({canvas,getCharacter,onFinish,onSound=()=>{},onPause=()=>{},onTestSound=()=>{}}){
 const $=id=>document.getElementById(id);
 const guide=document.querySelector('.gesture-guide').cloneNode(true);
 guide.querySelectorAll('b')[0].textContent='→';guide.querySelectorAll('b')[1].textContent='←';guide.querySelectorAll('b')[2].textContent='↕';
 document.querySelector('.pickle-controls').prepend(guide);
 const overlay=document.createElement('div');overlay.className='pause-overlay';overlay.hidden=true;
 overlay.innerHTML='<p class="eyebrow">INTERVALO NA ILHA</p><h2>Respira. Próximo ponto!</h2><p class="pause-score"></p><button type="button" class="primary">Continuar ▶</button><button type="button" class="sound-check">Testar som ♪</button><button type="button" class="text-button">Voltar ao clube</button>';
 $('pickleStage').append(overlay);
 overlay.querySelector('.primary').addEventListener('click',()=>toggle());
 overlay.querySelector('.text-button').addEventListener('click',()=>$('pickleExit').click());
 overlay.querySelector('.sound-check').addEventListener('click',onTestSound);
 let state=null,active=false,paused=false,last=0,raf=0,pointer=null,target=null,accumulator=0;
 const draw=createRacketRenderer(canvas,()=>({sport:'pickleball'}),getCharacter,()=>({id:'gael',avatar:'gael'}));
 const input=createAssistedInput(canvas,[['pickleTopspin','normal'],['pickleSlice','slice'],['pickleDrop','drop'],['pickleServe','serve']].map(([id,value])=>[$(id),value]),()=>state,()=>active&&!paused);
 const resize=new ResizeObserver(([entry])=>{
  const {width,height}=entry.contentRect;if(width<1||height<1)return;
  canvas.width=Math.round(Math.min(720,width));canvas.height=Math.round(canvas.width*height/width);
  canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
  if(state)draw(state);
 });resize.observe(canvas.parentElement);
 function render(){
  state.gesture=input.preview();draw(state);$('pickleScore').textContent=`${state.playerPoints} × ${state.cpuPoints}`;
  $('pickleStatus').textContent=paused?'Pausado':'Corra no automático · escolha o golpe com o dedo';
  for(const id of ['pickleTopspin','pickleSlice','pickleDrop'])$(id).disabled=paused;
  $('pickleServe').disabled=paused||!state.awaitingServe;
 }
 function tick(now){
  if(!active)return;
  if(!paused&&!document.hidden){
   if(now-last>1000)pause();
   else{
    accumulator+=Math.min(100,now-last);
    while(accumulator>=1000/60&&!state.done){
     const i=input.read();if(i.moveX||i.moveY)target=null;
     const before=state.eventId;
     // The world court is horizontal: screen right means toward the net.
     stepRacketMatch(state,i);
     if(state.eventId!==before)onSound(state.event);
     accumulator-=1000/60;
    }
   }
  }
  last=now;render();
  if(state.done){active=false;input.reset();onFinish({...state});return;}
  raf=requestAnimationFrame(tick);
 }
 function resetInput(){input.reset();pointer=null;target=null;}
 function pause(){if(!active)return;paused=true;onPause(true);resetInput();overlay.hidden=false;overlay.querySelector('.pause-score').textContent=`${getCharacter().name||'Você'} ${state.playerPoints} × ${state.cpuPoints} GAEL`;overlay.querySelector('.primary').focus();$('picklePause').textContent='Continuar';render();}
 function toggle(){if(!active)return;if(!paused)return pause();paused=false;overlay.hidden=true;onPause(false);last=performance.now();accumulator=0;$('picklePause').textContent='Pausar';canvas.focus({preventScroll:true});}
 $('picklePause').addEventListener('click',toggle);
 canvas.addEventListener('pointerdown',e=>{if(!active||paused||state.assisted)return;pointer=e.pointerId;canvas.setPointerCapture(pointer);target=draw.target(e);});
 canvas.addEventListener('pointermove',e=>{if(e.pointerId===pointer)target=draw.target(e);});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{pointer=null;target=null;});
 window.addEventListener('blur',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
 return {start(){$('pickleNames').textContent=`${getCharacter().name||'Você'} × GAEL`;state=createRacketMatch({sport:'pickleball',difficulty:.4,assisted:true});$('picklePad').hidden=true;active=true;paused=false;overlay.hidden=true;resetInput();$('picklePause').textContent='Pausar';last=performance.now();accumulator=0;cancelAnimationFrame(raf);raf=requestAnimationFrame(tick);canvas.focus({preventScroll:true});},stop(){active=false;overlay.hidden=true;resetInput();cancelAnimationFrame(raf);},pause,get active(){return active;},get paused(){return paused;}};
}
