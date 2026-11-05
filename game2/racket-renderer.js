import {COURTS,PICKLEBALL,ABANDONED_COURT} from './scenery-data.js';
import {courtCamera,pickleballCamera} from './court-view.js';
import {renderClub} from './scenery-renderer.js';
import {drawHero} from './characters.js';
import {createMatchEffects,drawAimArrow} from './match-effects.js';
import {canHit,serviceTarget,shotPlan,canPrepare,rallyPace,cpuCondition} from './racket-match.js';
// These are the painted singles lines, not the doubles alleys or blue apron.
export function racketWorld(x,y,sport='tennis',court=1){
 if(sport==='pickleball')return {x:PICKLEBALL.x+22+(1-y)*(PICKLEBALL.w-44),y:PICKLEBALL.y+23+x*(PICKLEBALL.h-46)};
 if(court==='old'){const a=ABANDONED_COURT;return {x:a.x+22+(1-y)*(a.w-44),y:a.y+53+x*(a.h-106)};}
 const c=COURTS[court-1]||COURTS[0];
 const net=137/282,depth=y<=.5?y*2*net:net+(y-.5)*2*(1-net);
 return {x:c.x+18+x*(c.width-36),y:c.y+depth*c.height};
}
export function racketPoint(world,sport='tennis',court=1){
 if(sport==='pickleball')return {x:(world.y-PICKLEBALL.y-23)/(PICKLEBALL.h-46),y:1-(world.x-PICKLEBALL.x-22)/(PICKLEBALL.w-44)};
 if(court==='old'){const a=ABANDONED_COURT;return {x:(world.y-a.y-53)/(a.h-106),y:1-(world.x-a.x-22)/(a.w-44)};}
 const c=COURTS[court-1]||COURTS[0],depth=(world.y-c.y)/c.height,net=137/282;return {x:(world.x-c.x-18)/(c.width-36),y:depth<=net?depth/(2*net):.5+(depth-net)/(2*(1-net))};
}
export function tennisMatchCamera(width,height,court=1){
 const base=courtCamera(court),ratio=Math.max(1,width)/Math.max(1,height),h=Math.max(base.h,base.w/ratio),w=h*ratio;
 return {x:base.x+base.w/2-w/2,y:base.y+base.h/2-h/2,w,h};
}
export function oldCourtCamera(width,height){
 const a=ABANDONED_COURT,ratio=Math.max(1,width)/Math.max(1,height),w=Math.max(a.w+58,(a.h+70)*ratio),h=w/ratio;
 return {x:a.x+a.w/2-w/2,y:a.y+a.h/2-h/2,w,h};
}
export function heldBallOffset(facing,height,scale=1){
 return {x:(facing==='up'||facing==='left'?-.24:.24)*height*scale,y:-.34*height*scale};
}
export function createRacketRenderer(canvas,getView,getPlayer,getOpponent){
 const ctx=canvas.getContext('2d'),fx=createMatchEffects(),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 let camera=null;
 function draw(s){
  const court=getView().court||1,pickle=s.sport==='pickleball',horizontal=pickle||court==='old';
  camera=pickle?pickleballCamera(canvas.width,canvas.height):court==='old'?oldCourtCamera(canvas.width,canvas.height):tennisMatchCamera(canvas.width,canvas.height,court);
  const world=(x,y)=>racketWorld(x,y,s.sport,court),project=(x,y)=>{const p=world(x,y);return {x:(p.x-camera.x)*canvas.width/camera.w,y:(p.y-camera.y)*canvas.height/camera.h};};
  const actors=['cpu','player'].map(side=>{const a=s[side],p=world(a.x,a.y),character=side==='player'?getPlayer():getOpponent();return {...p,side,character,height:(horizontal?34:40)*(character.height&&character.height<40?.82:1),facing:horizontal?(side==='player'?'right':'left'):(side==='player'?'up':'down'),stride:Math.hypot(a.dx,a.dy)>.02?s.elapsed*6:0,swing:a.swing,ready:side==='player'&&!!(s.prepared||s.gesture)};});
  renderClub(ctx,camera,{time:s.elapsed,activeCourt:pickle?'pickleball':court,animate:!reduced,actors,drawSurface(c){
   if(!horizontal){
    const ground=COURTS[court-1];c.fillStyle='#462e2638';c.fillRect(ground.x,ground.y,17,ground.height);c.fillRect(ground.x+ground.width-17,ground.y,17,ground.height);
    c.strokeStyle='#fff0c6';c.lineWidth=1;c.strokeRect(ground.x+18,ground.y,ground.width-36,ground.height);
    c.fillStyle='#542f2440';c.font='bold 6px monospace';c.textAlign='center';c.fillText('SIMPLES',ground.x+ground.width/2,ground.y+ground.height+27);
   }
   if(s.lessonAim){const a=s.lessonAim,from=world(a.minX,a.minY),to=world(a.maxX,a.maxY);c.fillStyle='#e4ff9733';c.fillRect(from.x,from.y,to.x-from.x,to.y-from.y);c.strokeStyle='#edffb4';c.lineWidth=1;c.setLineDash([4,3]);c.strokeRect(from.x,from.y,to.x-from.x,to.y-from.y);c.setLineDash([]);c.font='bold 6px monospace';c.textAlign='center';c.fillStyle='#f7ffd9';c.fillText(a.label,(from.x+to.x)/2,(from.y+to.y)/2);}
   if(!reduced)for(const a of actors){const runner=s[a.side];if(Math.hypot(runner.dx,runner.dy)<.03)continue;for(let i=0;i<3;i++){c.fillStyle=pickle?'#b6dfd93b':'#e8b97b55';c.fillRect(a.x-3+i*3,a.y+2+(s.frame+i)%3,2,1);}}
  },drawActor(c,a){drawHero(c,a.x,a.y,a.character,{...a,player:a.side==='player',equipment:s.sport});}});
  const legal=s.ball.bounces>0||(!s.ball.serve&&(!pickle||(s.serveBounces>=2&&s.player.y>2/3)));
  const ready=canHit(s,'player')&&legal,p=project(s.player.x,s.player.y);
  ctx.strokeStyle=ready?'#e8ff96':'#faf5d466';ctx.lineWidth=ready?2:1;ctx.beginPath();ctx.ellipse(p.x,p.y+1,ready?15:10,4,0,0,Math.PI*2);ctx.stroke();
  const mark=s.lessonTarget||(s.ball.active&&s.ball.last==='cpu'&&s.ball.bounces===0?{x:s.ball.endX,y:s.ball.endY}:null);
  if(mark){const m=project(mark.x,mark.y);ctx.strokeStyle='#fff6ba88';ctx.setLineDash([3,4]);ctx.beginPath();ctx.ellipse(m.x,m.y,10,4,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
  if(s.landing&&s.elapsed-s.landing.at<.7){const l=project(s.landing.x,s.landing.y),age=s.elapsed-s.landing.at;ctx.save();ctx.globalAlpha=1-age/.7;ctx.strokeStyle=s.landing.valid?'#fff5ba':'#ff927d';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(l.x,l.y,6+age*18,3+age*6,0,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#fff5ba';for(const sign of [-1,1])ctx.fillRect(l.x+sign*(6+age*20),l.y-3-age*9,2,2);ctx.restore();}
  const b=s.ball,bp=project(b.active?b.x:s[s.server].x,b.active?b.y:s[s.server].y),height=(b.active?b.z:0)*(horizontal?110:170)*(b.bounces===1?1.45:1);
  if(!b.active){const actor=actors.find(a=>a.side===s.server),hand=heldBallOffset(actor.facing,actor.height,canvas.width/camera.w);bp.x+=hand.x;bp.y+=hand.y;}
  if(s.assisted&&(s.gesture||s.prepared)){
   const q=s.prepared||s.gesture,plan=shotPlan(s,q),service=s.awaitingServe?serviceTarget(s,q):null,to=service?project(service.x,service.y):project(plan.x,plan.y);
   // Float the translucent guide ahead of the athlete, clear of their sprite.
   const dx=to.x-p.x,dy=to.y-p.y,distance=Math.max(1,Math.hypot(dx,dy)),gap=Math.min(46,distance*.28),length=Math.min(52,distance*.3);
   const from={x:p.x+dx/distance*gap,y:p.y+dy/distance*gap};
   drawAimArrow(ctx,from,{x:from.x+dx/distance*length,y:from.y+dy/distance*length},q.power,q.aim,s.prepared||s.awaitingServe||canPrepare(s)?plan.color:'#a2adaa');
   // A projected bounce makes positional risk readable before committing.
   // It is a forecast, not a clamp: the actual contact decides the landing.
   if(s.awaitingServe||canPrepare(s)||s.prepared){ctx.save();ctx.strokeStyle=plan.color;ctx.fillStyle=plan.color+'22';ctx.lineWidth=2;ctx.setLineDash([3,3]);ctx.beginPath();ctx.ellipse(to.x,to.y,9,5,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=plan.color;ctx.fillRect(to.x-1,to.y-1,2,2);ctx.restore();}
  }
  // The ball stays visible even when it crosses the aiming arrow.
  fx.draw(ctx,{frame:s.frame,eventId:s.eventId,event:s.event,reduced,ball:s.delay?null:{x:bp.x,y:bp.y-height,groundY:bp.y,size:pickle?9:8,pickle}});
  if(s.lessonGuided)return;
  const gestureLabel={normal:'TOPSPIN',slice:'SLICE',drop:'DEIXADA',serve:'SAQUE'};
  const q=s.prepared||s.gesture,plan=q?shotPlan(s,q):null;
  const caption=s.delay?s.message:s.assisted?(s.awaitingServe?(s.gesture?plan.label:horizontal?'ARRASTE → PARA SACAR':'ARRASTE ↑ PARA SACAR'):s.comboUntil>s.elapsed?'BOA! CURTA + FUNDO':s.prepared?(s.elapsed<s.prepared.readyAt?'ARMANDO ':'PRONTO · ')+gestureLabel[s.prepared.shot]:!canPrepare(s)?'AGUARDE A DEVOLUÇÃO':s.gesture?plan.label:s.timeScale<1?'SUA VEZ · PREPARE O GOLPE':'TOQUE: DEIXADA · ARRASTE: GOLPE'):s.awaitingServe?'B · SAQUE':ready?'Y · TOPSPIN    A · SLICE    X · DEIXADA':s.feedback;
  ctx.font='bold 12px monospace';ctx.textAlign='center';const w=Math.min(canvas.width-12,ctx.measureText(caption).width+22),captionY=canvas.height-36;
  ctx.fillStyle='#0b2726cf';ctx.fillRect((canvas.width-w)/2,captionY,w,29);ctx.fillStyle=ready?'#e4ff9e':'#f8efd0';ctx.fillText(caption,canvas.width/2,captionY+19,canvas.width-25);
  if(s.assisted&&s.rally>=6){ctx.font='bold 10px monospace';ctx.fillStyle='#102a2bd9';ctx.fillRect(canvas.width/2-82,8,164,21);ctx.fillStyle='#ffdf8d';ctx.fillText(`RITMO ×${rallyPace(s).toFixed(2)} · TROCA ${s.rally}`,canvas.width/2,22);}
  const fatigue=cpuCondition(s).fatigue;
  if(fatigue>.12&&!s.delay){const y=s.rally>=6?33:8;ctx.font='bold 10px monospace';ctx.fillStyle='#102a2bd9';ctx.fillRect(canvas.width/2-82,y,164,25);ctx.fillStyle=fatigue>.5?'#ffdf8d':'#d8ecb8';ctx.fillText(`FÔLEGO RIVAL · ${Math.round((1-fatigue)*100)}%`,canvas.width/2,y+13);ctx.fillRect(canvas.width/2-74,y+19,148*(1-fatigue),3);}
 }
 draw.target=e=>{const r=canvas.getBoundingClientRect();return racketPoint({x:camera.x+(e.clientX-r.left)/r.width*camera.w,y:camera.y+(e.clientY-r.top)/r.height*camera.h},getView().sport||'tennis',getView().court||1);};
 return draw;
}
