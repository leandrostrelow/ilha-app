import {ALBUM_PHOTOS,ALBUM_DURATION,albumFrame,albumStart,albumImage,albumCredit,createAlbumLoader} from './ending-album.js';
const $=id=>document.getElementById(id);
export function createCampaignEnding({getPlayer,onAward,onFinish,onExit,onSound=()=>{},onPause=()=>{},onStart=()=>{}}){
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,load=createAlbumLoader();
 let active=false,ready=false,paused=false,finished=false,awarded=false,raf=0,token=0,time=0,last=0,index=-1,available=new Set();
 const award=()=>{if(!awarded){awarded=true;onAward();}};
 const current=()=>albumFrame(time)||{...ALBUM_PHOTOS.at(-1),index:ALBUM_PHOTOS.length-1,progress:.5,opacity:1};
 function buttons(){
  $('endingArea').dataset.paused=String(paused);
  $('endingPause').hidden=finished;$('endingPause').textContent=paused?'Continuar ▶':'Pausar Ⅱ';$('endingPause').setAttribute('aria-pressed',String(paused));
  $('endingPrev').disabled=!ready||current().index===0;$('endingPrev').hidden=finished;
  $('endingNext').disabled=!ready;$('endingNext').textContent=finished?'Voltar ao clube':'Próxima foto →';
  $('endingSkip').hidden=finished;$('endingSkip').disabled=!ready;$('endingPause').disabled=!ready;
  $('endingExit').textContent=finished?'Rever as fotos':'Voltar ao clube';
 }
 function buildCredits(){
  const track=$('endingCreditTrack');track.replaceChildren();
  for(const photo of ALBUM_PHOTOS){
   const credit=albumCredit(photo,getPlayer()),row=document.createElement('article');row.className='album-credit';
   for(const [tag,className,text]of [['p','album-credit-title',credit.title],['h3','album-credit-name',credit.names],['p','album-credit-text',credit.text]]){
    const el=document.createElement(tag);el.className=className;el.textContent=text;row.append(el);
   }track.append(row);
  }
 }
 function paint(){
  if(!ready)return;
  const photo=current(),credit=albumCredit(photo,getPlayer()),url=albumImage(photo,getPlayer());
  if(index!==photo.index){
   index=photo.index;const image=$('endingPhoto');image.hidden=!available.has(url);
   if(available.has(url))image.src=url;
   image.alt=`${credit.names}. ${credit.title} ${credit.text}`;
   $('endingPhotoFallback').hidden=available.has(url);
   $('endingPhotoFallback').textContent='Esta lembrança não carregou. Os créditos continuam — sua conquista está salva.';
   $('endingTitle').textContent=finished?`${getPlayer().name}, lenda da Ilha!`:credit.title;
   $('endingEyebrow').textContent=finished?'★ HISTÓRIA CONCLUÍDA ★':`LEMBRANÇAS DA ILHA · ${index+1}/${ALBUM_PHOTOS.length}`;
   for(const [i,row]of [...$('endingCreditTrack').children].entries())row.setAttribute('aria-hidden',String(i!==index));
   if(!finished&&photo.id==='award')onSound('fanfare');
   else if(!finished&&photo.id==='group')onSound('applause');
  }
  const viewport=$('endingCreditViewport'),height=viewport.clientHeight||200;
  viewport.style.setProperty('--credit-height',`${height}px`);
  // Photos never pan/zoom. Only names rise and fade through a soft mask.
  const offset=finished?-(ALBUM_PHOTOS.length-1)*height:reduced||paused?-index*height:(.5-index-photo.progress)*height;
  $('endingCreditTrack').style.transform=`translateY(${offset}px)`;
  $('endingPhoto').style.opacity=String(reduced||finished||paused?1:photo.opacity);
  $('endingProgress').value=Math.min(time,ALBUM_DURATION);buttons();
 }
 function finish(){
  award();time=ALBUM_DURATION;finished=true;paused=false;onPause(false);index=-1;
  $('endingArea').dataset.phase='end';$('endingThanks').hidden=false;paint();onFinish();
 }
 function next(){if(!active||!ready)return;if(finished){onExit();return;}if(current().index===ALBUM_PHOTOS.length-1){finish();return;}time=albumStart(current().index+1);paint();}
 function previous(){if(!active||!ready||finished)return;time=albumStart(Math.max(0,current().index-1));paint();}
 function frame(now){
  if(!active)return;const dt=Math.min(.1,Math.max(0,(now-last)/1000));last=now;
  if(!document.hidden&&!paused&&ready&&!finished){time+=dt;if(time>=ALBUM_DURATION)finish();else paint();}
  raf=requestAnimationFrame(frame);
 }
 function stop(){active=false;token++;cancelAnimationFrame(raf);if(paused){paused=false;onPause(false);}}
 async function start(){
  stop();onStart();const request=token;active=true;time=0;last=0;index=-1;finished=awarded=ready=false;paused=reduced;available=new Set();
  const area=$('endingArea');area.dataset.phase='album';area.classList.add('album-mode');
  $('endingThanks').hidden=true;$('endingPhoto').hidden=true;$('endingPhotoFallback').hidden=false;$('endingPhotoFallback').textContent='Revelando as lembranças…';
  $('endingTitle').textContent='Toda lenda deixa boas lembranças.';$('endingEyebrow').textContent='O ÁLBUM DO LEGADO';
  $('endingProgress').max=ALBUM_DURATION;$('endingProgress').value=0;buildCredits();buttons();
  // Save the trophy before images load; replay is idempotent in the reducer.
  award();onPause(paused);
  const urls=ALBUM_PHOTOS.map(photo=>albumImage(photo,getPlayer())),first=load(urls[0]);
  for(const url of urls)load(url).then(ok=>{if(!active||request!==token)return;if(ok)available.add(url);if(ready&&albumImage(current(),getPlayer())===url){index=-1;paint();}});
  const firstReady=await first;if(!active||request!==token)return;if(firstReady)available.add(urls[0]);
  ready=true;paint();$('endingPause').focus({preventScroll:true});last=performance.now();raf=requestAnimationFrame(frame);
 }
 $('endingNext').addEventListener('click',next);$('endingPrev').addEventListener('click',previous);
 const resize=new ResizeObserver(()=>{if(active)paint();});resize.observe($('endingCreditViewport'));
 $('endingPause').addEventListener('click',()=>{if(!active||!ready||finished)return;paused=!paused;onPause(paused);last=performance.now();paint();});
 $('endingSkip').addEventListener('click',()=>{if(active&&ready&&!finished){finish();$('endingNext').focus();}});
 $('endingExit').addEventListener('click',()=>finished?start():onExit());
 return {start,stop};
}
