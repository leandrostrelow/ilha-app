import { WORLD_SIZE, SPAWN, ENTRY, PLACES, NPC_SPOTS, steerWalker, followRoute, nearestWalkable, routeTo, nearbyTarget, distance, advanceWalkCycle } from './world-model.js';
import { drawWalker } from './render.js';
import {renderClub,renderMiniMap,sceneryReady} from './scenery-renderer.js';
import {heroesReady} from './characters.js';
import {locationAt,entryPosition} from './scenery-data.js';
import {drawFoice,drawQuestBall} from './campaign-props.js';
import {drawClue} from './halloween-art.js';
import {drawClubRain} from './club-rain.js';
import {halloweenAmbientCue} from './halloween-sounds.js';

export function createClubWorld({canvas,minimap,getCharacter,getCharacters,getNpcs=null,getItems=()=>[],getObjective=()=>null,getRain=()=>false,onNearby,onPlace,onIntroEnd,onInteract,onArrive=()=>{},onStep=()=>{},onAmbient=()=>{}}) {
  const context=canvas.getContext('2d');
  const ready=Promise.all([heroesReady,sceneryReady]);ready.catch(()=>{});
  const player={...SPAWN,facing:'down',stride:0};
  const camera={x:0,y:0,w:880,h:560};
  let active=false,blocked=false,intro=0,introducing=false,shownIntro=false,entry=0;
  let raf=0,last=0,clock=0,route=[],destination=null,nearby=null,placeLabel='',previousTarget='';
  let analog={x:0,y:0},keys=new Set(),npcs=[],drawingReady=false;
  let lastAmbient='',lastRainSound=-1;
  let lastHalloweenSlot=-1;
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function populate(){npcs=getNpcs?getNpcs():getCharacters().filter(c=>c.id!==getCharacter().id).map((c,i)=>({...c,...NPC_SPOTS[i],kind:'npc'}));}
  function resetControls(){keys.clear();analog={x:0,y:0};player.vx=0;player.vy=0;}
  function resize(){
    const r=canvas.getBoundingClientRect();
    camera.w=r.width<600?420:800;camera.h=Math.min(1180,camera.w*r.height/Math.max(1,r.width));
    camera.w=camera.h*Math.max(1,r.width)/Math.max(1,r.height);
    canvas.width=Math.round(camera.w);canvas.height=Math.round(camera.h);context.imageSmoothingEnabled=false;
  }
  const observer=new ResizeObserver(()=>{if(active)resize();});observer.observe(canvas);
  function setCamera(x,y,snap=false,dt=1/60){
    const nextX=Math.max(0,Math.min(WORLD_SIZE-camera.w,x-camera.w/2));
    const nextY=Math.max(0,Math.min(WORLD_SIZE-camera.h,y-camera.h*.46));
    const smoothing=snap||reducedMotion?1:1-Math.exp(-8*dt);camera.x+=(nextX-camera.x)*smoothing;camera.y+=(nextY-camera.y)*smoothing;
  }
  function updateLocation(){
    const label=locationAt(player);
    if(label!==placeLabel){placeLabel=label;onPlace(label);}
    nearby=nearbyTarget(player,npcs,getItems(),getObjective());
    const key=nearby?.id||'';if(key!==previousTarget){previousTarget=key;onNearby(nearby);}
  }
  function render(){
    const c=context;c.clearRect(0,0,canvas.width,canvas.height);
    const actors=[...(getNpcs?getNpcs():npcs).map(n=>({...n,facing:'down',stride:n.child&&!reducedMotion&&!blocked&&(clock+n.x)%11<1.6?clock*1.6:0})),...getItems().map(item=>({...item,isQuestItem:true})),{...player,...getCharacter(),isPlayer:true}].sort((a,b)=>a.y-b.y);
    renderClub(c,camera,{time:clock,animate:!reducedMotion,gateOpen:!introducing||intro>1.5,actors,drawActor(c,actor){
      if(actor.isQuestItem&&actor.itemType==='clue'){drawClue(c,actor,clock);return;}
      if(actor.isQuestItem){(actor.itemType==='tennis-ball'?drawQuestBall:drawFoice)(c,actor.x,actor.y,reducedMotion?0:clock);return;}
      drawWalker(c,actor.x,actor.y,actor,actor.facing,actor.stride,1,actor.isPlayer);
      if(actor.carryingFoice||actor.juiceGlow){c.fillStyle=actor.carryingFoice?'#e7e798':'#a7f1d4';for(let i=0;i<4;i++){const phase=reducedMotion?i:clock*2+i*1.6;c.fillRect(Math.round(actor.x+Math.cos(phase)*16),Math.round(actor.y-20+Math.sin(phase)*18),2,2);}}
      if(!actor.isPlayer){
        const bob=reducedMotion?0:Math.sin(clock*2+actor.x)*2;
        const quest=getObjective()===actor.id;
        const head=(actor.height||42)+13;
        c.fillStyle=quest?'#ffdf70':nearby?.id===actor.id?'#e4f49b':'#f8edc9';c.fillRect(actor.x-7,actor.y-head+bob,15,13);c.fillStyle='#28422c';c.font='bold 11px monospace';c.textAlign='center';c.fillText(quest?'!':'…',actor.x+1,actor.y-head+10+bob);
        if(quest||nearby?.id===actor.id){c.font='bold 8px monospace';const w=c.measureText(actor.name).width+8;c.fillStyle='#153529ed';c.fillRect(actor.x-w/2,actor.y+5,w,12);c.fillStyle='#fff0bd';c.fillText(actor.name,actor.x,actor.y+14);}
      }
    }});
    c.save();c.translate(-Math.round(camera.x),-Math.round(camera.y));
    if(!introducing){
      const mission=PLACES.find(p=>p.id===getObjective());
      if(mission){
        const bob=reducedMotion?0:Math.sin(clock*3)*4,y=mission.y-38+bob;
        c.fillStyle='#fff3a5';c.beginPath();c.moveTo(mission.x-9,y-7);c.lineTo(mission.x+9,y-7);c.lineTo(mission.x,y+3);c.fill();
        c.fillStyle='#183c2b';c.fillRect(mission.x-26,y-22,52,14);c.strokeStyle='#fff3a5';c.lineWidth=1;c.strokeRect(mission.x-26,y-22,52,14);
        c.fillStyle='#fff3a5';c.font='bold 8px monospace';c.textAlign='center';c.fillText('INTERAJA',mission.x,y-12);
      }
      if(destination){c.strokeStyle='#effabc';c.lineWidth=2;c.strokeRect(destination.x-6,destination.y-3,12,6);}
      c.fillStyle='#f8ebb3';
      if(!reducedMotion)for(let i=0;i<7;i++){const x=360+Math.sin(clock*.2+i*8)*90,y=1060+Math.cos(clock*.17+i*5)*60;c.globalAlpha=.25+Math.sin(clock+i)*.12;c.fillRect(x,y,2,2);}c.globalAlpha=1;
    }
    c.restore();
    if(getRain()){const time=performance.now()/1000;drawClubRain(c,time,{reduced:reducedMotion});const cue=Math.floor(time/4);if(cue!==lastRainSound&&!document.hidden){lastRainSound=cue;onAmbient('rain');}}
    if(introducing){const size=32;c.fillStyle='#101d15';c.fillRect(0,0,canvas.width,size);c.fillRect(0,canvas.height-size,canvas.width,size);}
    if(minimap&&drawingReady)renderMiniMap(minimap,camera,player);
  }
  function frame(now){
    if(!active)return;const dt=Math.min(.05,(now-last)/1000||0);last=now;
    if(!document.hidden&&!blocked){
      clock+=dt;
      {const cue=Math.floor(clock/28);if(cue!==lastAmbient){lastAmbient=cue;onAmbient('wind');}}
      {const cue=halloweenAmbientCue(clock,player,camera);if(cue&&cue.key!==lastHalloweenSlot){lastHalloweenSlot=cue.key;onAmbient(cue.kind);}}
      if(introducing){
        intro+=dt;
        if(intro<1.5){const t=Math.min(1,intro/1.5);const smooth=t*t*(3-2*t);setCamera(762+(SPAWN.x-762)*smooth,880+(SPAWN.y-880)*smooth,true);}
        else {const before={...player};Object.assign(player,entryPosition((intro-1.5)/6));if(advanceWalkCycle(player,distance(before,player)))onStep();setCamera(player.x,player.y,false,dt);}
        if(intro>=7.6)skipIntro();
      }else{
        let dx=analog.x+(keys.has('ArrowRight')||keys.has('d')?1:0)-(keys.has('ArrowLeft')||keys.has('a')?1:0);
        let dy=analog.y+(keys.has('ArrowDown')||keys.has('s')?1:0)-(keys.has('ArrowUp')||keys.has('w')?1:0);
        const manual=Boolean(dx||dy),following=!manual&&route.length>0,before={x:player.x,y:player.y};
        if(manual){route=[];destination=null;}
        const moved=following?followRoute(player,route,dt):steerWalker(player,dx,dy,dt);
        if(following&&!route.length){destination=null;onArrive();}
        if(advanceWalkCycle(player,moved?distance(before,player):0))onStep();
        setCamera(player.x,player.y,false,dt);updateLocation();
      }
    }
    render();raf=requestAnimationFrame(frame);
  }
  function skipIntro(){introducing=false;shownIntro=true;Object.assign(player,ENTRY);player.stride=0;resetControls();setCamera(player.x,player.y,true);updateLocation();onIntroEnd();}
  function interact(){if(!active||blocked||introducing)return;resetControls();route=[];destination=null;if(nearby)onInteract(nearby);}
  function keydown(event){if(!active||blocked||introducing||event.target.matches('input,textarea'))return;
    const key=event.key.length===1?event.key.toLowerCase():event.key;
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d'].includes(key)){event.preventDefault();keys.add(key);}
    if((key==='e'||key==='Enter')&&!event.repeat&&event.target===canvas){event.preventDefault();interact();}
  }
  document.addEventListener('keydown',keydown);document.addEventListener('keyup',event=>keys.delete(event.key.length===1?event.key.toLowerCase():event.key));
  window.addEventListener('blur',resetControls);document.addEventListener('visibilitychange',resetControls);
  canvas.addEventListener('pointerdown',event=>{if(!active||blocked||introducing)return;const r=canvas.getBoundingClientRect();const target={x:camera.x+(event.clientX-r.left)/r.width*camera.w,y:camera.y+(event.clientY-r.top)/r.height*camera.h};
    const clicked=getItems().find(n=>Math.hypot(n.x-target.x,n.y-18-target.y)<35)||npcs.find(n=>Math.hypot(n.x-target.x,n.y-18-target.y)<35)||PLACES.find(p=>Math.hypot(p.x-target.x,p.y-target.y)<35);
    if(clicked&&distance(player,clicked)<(clicked.radius||48)){onInteract(clicked);return;}
    if(clicked)navigate(clicked);else{const destination=nearestWalkable(target);if(destination)navigate(destination);}canvas.focus({preventScroll:true});
  });
  function navigate(target){if(introducing||blocked)return;const arrival=target.kind==='npc'?nearestWalkable({x:target.x,y:target.y+24}):target;route=arrival?routeTo(player,arrival):[];destination=route.at(-1)||null;resetControls();}
  return {
    async enter(){const request=++entry;await ready;if(request!==entry)return null;drawingReady=true;populate();blocked=false;active=true;resize();introducing=!shownIntro&&!reducedMotion;intro=0;last=performance.now();previousTarget='reset';if(!shownIntro){Object.assign(player,SPAWN);if(reducedMotion)skipIntro();}setCamera(introducing?762:player.x,introducing?880:player.y,true);render();cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);updateLocation();return {intro:introducing};},
    leave(){entry++;active=false;resetControls();cancelAnimationFrame(raf);},
    reset(){entry++;active=false;shownIntro=false;route=[];destination=null;resetControls();Object.assign(player,SPAWN);cancelAnimationFrame(raf);},
    block(value){blocked=value;resetControls();route=[];destination=null;},
    move(x,y){if(!blocked&&!introducing)analog={x,y};},
    interact,navigate,skipIntro,
    getNearby(){return nearby;},
    places:PLACES,
    // Diagnostic snapshot contains only game coordinates, never credentials.
    snapshot(){return {active,blocked,introducing,player:{...player},camera:{...camera},nearby:nearby?.id||null,walkingRoute:route.length};},
  };
}
