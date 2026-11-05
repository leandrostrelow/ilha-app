import {renderClub} from './scenery-renderer.js';
import {drawHero} from './characters.js';
import {NPCS} from './adventure.js';

export const INTRO_SHOTS=Object.freeze([
 {seconds:4.5,label:'NAQUELA NOITE…',caption:'Tudo começou depois da última partida.'},
 {seconds:8,label:'SÓ MAIS UMA PORÇÃO',image:'/game2/assets/intro-party-v2.webp',caption:'No bar, a turma dividia histórias e uma porção.\nParecia uma noite como qualquer outra.',focus:[.5,.54]},
 {seconds:7.5,label:'UM PEQUENO ENGANO',image:'/game2/assets/intro-ingredient-v2.webp',caption:'Uma mão. Um pó roxo. Uma péssima ideia.\nAlguém confundiu aquilo com tempero… mas quem?',focus:[.55,.58]},
 {seconds:9,label:'ISSO NÃO É FANTASIA',image:'/game2/assets/intro-green-v2.webp',caption:'A turma começou a ficar verde. E não era o molho!\nAs crianças, ocupadas caçando doces, não comeram nada.',focus:[.5,.46]},
 {seconds:6,label:'AGORA É COM VOCÊ',caption:'Você chega ao Ilha. Leandro corre para avisar:\n“Primeiro de tudo… NÃO COME NADA!”'},
]);

export function createHalloweenIntro({getPlayer,onSound,onDone,onStart=()=>{},onPause=()=>{}}){
 const host=document.createElement('section');host.id='halloweenIntro';host.hidden=true;host.setAttribute('aria-label','Abertura: Ilha Tênis — O Mistério');
 const header=document.createElement('div');header.className='intro-heading';
 const label=document.createElement('span'),counter=document.createElement('span');counter.className='intro-counter';header.append(label,counter);
 const stage=document.createElement('div');stage.className='intro-stage';
 const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;canvas.setAttribute('aria-hidden','true');
 const opening=document.createElement('div');opening.className='intro-opening';opening.setAttribute('aria-hidden','true');
 const title=document.createElement('strong');title.textContent='Uma noite.\nUm mistério.';
 const knocks=document.createElement('span');knocks.className='intro-knocks';opening.append(title,knocks);stage.append(canvas,opening);
 const caption=document.createElement('p');caption.className='intro-caption';caption.setAttribute('aria-live','polite');caption.setAttribute('aria-atomic','true');
 const timeline=document.createElement('div');timeline.className='intro-timeline';timeline.setAttribute('aria-hidden','true');
 const segments=INTRO_SHOTS.map(()=>{const s=document.createElement('span'),fill=document.createElement('i');s.append(fill);timeline.append(s);return fill;});
 const controls=document.createElement('div');controls.className='intro-controls';
 const pause=document.createElement('button'),next=document.createElement('button'),skip=document.createElement('button');
 for(const b of [pause,next,skip])b.type='button';
 next.textContent='Próxima cena →';skip.textContent='Pular abertura';skip.className='intro-skip';controls.append(pause,next,skip);host.append(header,stage,caption,timeline,controls);document.getElementById('gameDialog').append(host);
 const images=new Map(),settled=new Set();
 for(const shot of INTRO_SHOTS.filter(s=>s.image)){const img=new Image();img.decoding='async';img.src=shot.image;img.decode().then(()=>images.set(shot.image,img)).catch(()=>{}).finally(()=>settled.add(shot.image));}
 let active=false,raf=0,last=0,time=0,index=0,bounces=0,paused=false;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 function update(){const shot=INTRO_SHOTS[index];caption.textContent=shot.caption;label.textContent=shot.label;counter.textContent=`${String(index+1).padStart(2,'0')} / ${String(INTRO_SHOTS.length).padStart(2,'0')}`;opening.hidden=index!==0;host.dataset.paused=String(paused);host.dataset.shot=String(index);pause.textContent=paused?'Continuar ▶':'Pausar Ⅱ';pause.setAttribute('aria-pressed',String(paused));next.textContent=index===INTRO_SHOTS.length-1?'Encontrar Leandro →':'Próxima cena →';}
 function stop(){if(!active)return;active=false;cancelAnimationFrame(raf);host.hidden=true;onPause(false);}
 function finish(){if(!active)return;stop();onDone();}
 function advance(){if(!active)return;if(index===INTRO_SHOTS.length-1)return finish();index++;time=0;last=0;update();paint();}
 function paint(){
  const c=canvas.getContext('2d'),shot=INTRO_SHOTS[index];c.fillStyle='#08050e';c.fillRect(0,0,960,540);c.imageSmoothingEnabled=false;
  segments.forEach((s,i)=>{s.style.transform=`scaleX(${i<index?1:i===index?Math.min(1,time/shot.seconds):0})`;});
  if(index===0){knocks.textContent=Array.from({length:Math.max(1,bounces)},()=> 'TOC.').join('     ');return;}
  const motion=reduced?0:Math.min(1,time/shot.seconds),ease=motion*motion*(3-2*motion);
  c.save();c.globalAlpha=reduced||paused?1:Math.min(1,time/.65,(shot.seconds-time)/.65);
  const img=images.get(shot.image);
  if(img){
   const zoom=1+ease*.045,scale=Math.max(960/img.width,540/img.height)*zoom,w=img.width*scale,h=img.height*scale;
   c.drawImage(img,(960-w)*shot.focus[0],(540-h)*shot.focus[1],w,h);
  }else if(!shot.image){
   const walk=reduced?1:Math.min(1,time/3),p=getPlayer(),guide=NPCS.find(n=>n.id==='leandro');
   const actors=[{...p,x:955,y:360+walk*44,isPlayer:true},{...guide,x:795+walk*99,y:391,moving:walk<1}];
   renderClub(c,{x:770+ease*12,y:295+ease*5,w:448-ease*24,h:252-ease*13.5},{time:0,atmosphereTime:0,animate:false,gateOpen:true,actors,drawActor(ctx,a){drawHero(ctx,a.x,a.y,a,{height:40,player:a.isPlayer,facing:a.isPlayer?'left':'right',stride:a.moving?time*5:0});}});
  }else{
   c.fillStyle='#d6c0e9';c.font='20px monospace';c.textAlign='center';c.fillText(settled.has(shot.image)?shot.label:'Preparando a cena…',480,270);
  }
  c.restore();
 }
 function frame(now){if(!active)return;const dt=last?Math.min(.1,(now-last)/1000):0;last=now;
  const shot=INTRO_SHOTS[index],ready=!shot.image||settled.has(shot.image);
  if(!paused&&!document.hidden&&ready){time+=dt;if(index===0){const beat=Math.floor(time/1.4);if(beat>=bounces&&beat<3){bounces=beat+1;onSound('bounce');}}if(time>=shot.seconds)advance();}
  if(active){paint();raf=requestAnimationFrame(frame);}
 }
 pause.onclick=()=>{paused=!paused;onPause(paused);update();paint();};next.onclick=advance;skip.onclick=finish;
 return {start(){for(const id of ['legacyProfile','legacyMenu'])document.getElementById(id).hidden=true;active=true;time=0;index=0;last=0;bounces=0;paused=reduced;host.hidden=false;onStart();onPause(paused);update();onSound('wind');paint();next.focus();cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);},stop};
}
