import {NPCS} from './adventure.js';
import {AMBIENT_NPCS} from './ambient-npcs.js';
import {renderClub} from './scenery-renderer.js';
import {drawHero} from './characters.js';
import {CASES,savedCase} from './mystery.js';
const $=id=>document.getElementById(id);
export const FINALE_PAGES=[
 ['Hora do mutirão.','O sino chama a turma. Felipe distribui o suco antizumbi lacrado. Gabriel, Vanessa, Higor, Michele, Larissa e Scarlt acompanham os outros nas quadras.'],
 ['Cada um no seu ritmo.','Aos poucos, os treinos fazem o antídoto agir. O verde desaparece. A turma toda se recupera. Higor continua de muleta: a receita cura a infecção, não o pé!'],
 ['Mistério resolvido.','Higor lembrou de {object}. Michele e Gael viram {container}. Os dois pertencem a {culprit}, que confundiu o pó com tempero. Foi um engano — a turma ajudou a consertar.'],
 ['A próxima porção é normal.','Leandro agradece a {name} e à equipe das crianças. Larissa comemora seu 3 × 0, Vanessa pede para não ser chamada de tia e Gabriel promete comer só batata. Agora, só tênis por diversão!'],
];
export function createCampaignEnding({getPlayer,getState=()=>({}),onAward,onFinish,onExit,onSound=()=>{},onStart=()=>{},onPause=()=>{}}){
 const cv=document.createElement('canvas');cv.id='halloweenEndingCanvas';cv.width=900;cv.height=600;$('endingPhoto').after(cv);
 let active=false,index=0,paused=false,finished=false,time=0,last=0,raf=0;
 const crew=[...NPCS,...AMBIENT_NPCS];
 function paint(){
  $('endingPhoto').hidden=true;$('endingPhotoFallback').hidden=true;$('endingThanks').hidden=!finished;
  $('endingTitle').textContent=FINALE_PAGES[index][0];$('endingEyebrow').textContent=finished?'MISTÉRIO RESOLVIDO':'O FINAL · '+(index+1)+'/4';
  const row=document.createElement('article');row.className='album-credit';const name=document.createElement('h3');name.className='album-credit-name';name.textContent=index===3?getPlayer().name+' e a turma do Ilha':'A maldição acabou';
  const culprit=CASES[savedCase(getState())];const text=document.createElement('p');text.className='album-credit-text';text.textContent=FINALE_PAGES[index][1].replace('{name}',getPlayer().name).replace('{culprit}',culprit.name).replace('{object}',culprit.object).replace('{container}',culprit.container);row.append(name,text);$('endingCreditTrack').replaceChildren(row);
  const group=Math.ceil(crew.length/4),people=crew.slice(index*group,(index+1)*group).map((n,i)=>({...n,x:292+i*36,y:694+(i%2)*21}));
  people.push({...getPlayer(),x:410,y:748,isPlayer:true});
  renderClub(cv.getContext('2d'),{x:205,y:505,w:420,h:280},{animate:false,actors:people,drawActor(c,a){drawHero(c,a.x,a.y,a,{height:40,player:a.isPlayer,celebrating:a.isPlayer});}});
  $('endingProgress').max=4;$('endingProgress').value=finished?4:index+time/10;$('endingPrev').disabled=index===0;
  $('endingPause').textContent=paused?'Continuar ▶':'Pausar Ⅱ';$('endingNext').textContent=finished?'Voltar ao clube':'Próxima →';$('endingExit').textContent='Voltar ao clube';
 }
 function finish(){if(finished)return;finished=true;index=3;paused=false;onPause(false);onFinish();paint();}
 function next(){if(!active)return;if(finished)return onExit();time=0;if(index===3)return finish();index++;onSound('photo');paint();}
 function frame(now){if(!active)return;const dt=last?Math.min(.1,(now-last)/1000):0;last=now;if(!paused&&!document.hidden&&!finished){time+=dt;if(time>=10)next();}raf=requestAnimationFrame(frame);}
 function stop(){active=false;cancelAnimationFrame(raf);if(paused){paused=false;onPause(false);}}
 function start(){stop();onStart();active=true;index=0;time=0;last=0;paused=matchMedia('(prefers-reduced-motion: reduce)').matches;finished=false;onAward();onSound('fanfare');$('endingArea').dataset.phase='album';paint();raf=requestAnimationFrame(frame);}
 $('endingNext').onclick=next;$('endingPrev').onclick=()=>{if(index>0){index--;time=0;finished=false;paint();}};
 $('endingPause').onclick=()=>{paused=!paused;onPause(paused);paint();};$('endingSkip').onclick=finish;$('endingExit').onclick=onExit;
 return {start,stop};
}
