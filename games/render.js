import {COURT_VIEW,courtCamera,projectCourt,blendCamera} from './court-view.js';
import {courtPoint} from './club-scene.js';
import {renderClub} from './scenery-renderer.js';
import {drawHero} from './characters.js';
import {createMatchEffects,heldServeBall} from './match-effects.js';
export {drawWalker,characterPortrait} from './characters.js';
const rect=(ctx,color,x,y,w,h)=>{ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),w,h);};

// World and match share the tile renderer, geometry, nets and depth-sorted props.
export function createRenderer(canvas,getOpponent=()=>null,getView=()=>({court:1,overview:false}),getPlayer=()=>null){
 const ctx=canvas.getContext('2d');canvas.width=COURT_VIEW.width;canvas.height=COURT_VIEW.height;
 ctx.imageSmoothingEnabled=false;
 let transition=null,previousCpu={x:240,y:117};
 const effects=createMatchEffects(),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 function draw(state){
  const view=getView(),now=performance.now(),target=courtCamera(view.court,view.overview);
  const t=transition?Math.min(1,(now-transition.started)/850):1;
  const camera=transition?blendCamera(transition.from,target,t):target;
  if(t>=1)transition=null;
  rect(ctx,'#163525',0,0,480,600);
  const cpuMoving=Math.hypot(state.cpu.x-previousCpu.x,state.cpu.y-previousCpu.y)>.1;
  previousCpu={x:state.cpu.x,y:state.cpu.y};
  const actors=t<.8?[]:[{...courtPoint(state.cpu.x,state.cpu.y+9,view.court),character:getOpponent()||state.character,facing:'down',stride:cpuMoving?state.frame/9:0,swing:state.cpu.swing},{...courtPoint(state.player.x,state.player.y+9,view.court),character:getPlayer()||state.character,facing:'up',stride:Math.abs(state.player.dx)>.1?state.frame/9:0,swing:state.tossFrames?20:state.player.swing,player:true}];
  renderClub(ctx,camera,{time:state.frame/60,activeCourt:view.court,animate:!reduced,actors,drawActor(c,actor){c.save();c.globalAlpha=Math.min(1,(t-.8)*5);drawHero(c,actor.x,actor.y,actor.character,{...actor,height:34,equipment:'tennis'});c.restore();}});
  const scale=480/camera.w,project=(x,y)=>projectCourt(x,y,view.court,camera);
  if(t<.8)return;
  ctx.save();ctx.globalAlpha=Math.min(1,(t-.8)*5);
  const player=project(state.player.x,state.player.y+9);
  if(Number.isFinite(state.lessonTarget)){
   const aim=project(state.lessonTarget,377);
   ctx.strokeStyle='#fff3b3bb';ctx.lineWidth=2;ctx.setLineDash([4,4]);
   ctx.beginPath();ctx.ellipse(aim.x,aim.y+2,13*scale,4*scale,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
  }
  if(!reduced&&Math.abs(state.player.dx)>1){
   for(let i=0;i<3;i++)rect(ctx,['#e5b37a55','#f1c38b44','#f5c89633'][i],player.x-Math.sign(state.player.dx)*(8+i*4),player.y+2+(state.frame+i)%3,2+i%2,1);
  }
  if(state.powerFrames){ctx.strokeStyle='#dfff91';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(player.x,player.y+1,11*scale,3*scale,0,0,Math.PI*2);ctx.stroke();}
  if(state.ball.active){
   const b=state.ball,p=project(b.x,b.y),height=Math.max(0,Math.sin(Math.min(1,b.age/b.flight)*Math.PI))*(b.arc||17)*scale*.42;
   const x=p.x,y=p.y-height,size=Math.max(4,3.5*scale);
   if(b.type==='lob'){ctx.strokeStyle='#fff5ca66';ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(x,p.y);ctx.lineTo(x,y+4);ctx.stroke();ctx.setLineDash([]);}
   effects.draw(ctx,{frame:state.frame,eventId:state.eventId,event:state.event,reduced,ball:{x,y,groundY:p.y,size:Math.round(size)}});
  }else if(state.awaitingServe||state.tossFrames){
   const held=heldServeBall(player,scale,state.tossFrames);
   rect(ctx,'#e7fc88',held.x,held.y,Math.max(4,3*scale),Math.max(4,3*scale));
  }else effects.draw(ctx,{frame:state.frame,reduced});
  ctx.restore();
  if(state.message&&(state.delay>12||state.awaitingServe)){
   const p=project(240,295),text=state.awaitingServe?'SEU SAQUE':state.message;
   ctx.font='bold 9px monospace';ctx.textAlign='center';const width=ctx.measureText(text).width+18;
   rect(ctx,'#173923e8',p.x-width/2,p.y-15,width,23);ctx.fillStyle='#f4efc3';ctx.fillText(text,p.x,p.y);
  }
  if(state.rally>=3&&state.ball.active){ctx.font='bold 9px monospace';ctx.fillStyle='#fff2c1';ctx.textAlign='center';ctx.fillText('RALLY '+state.rally,240,577);}
 }
 draw.enterFrom=from=>{transition=matchMedia('(prefers-reduced-motion: reduce)').matches?null:{from,started:performance.now()};};
 draw.transitioning=()=>Boolean(transition&&performance.now()-transition.started<850);
 return draw;
}
