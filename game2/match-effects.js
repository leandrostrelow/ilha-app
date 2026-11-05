// Small pixel primitives shared by both sports. Bounded history, no filters,
// textures, timers or per-particle canvases; reduced motion keeps the ball clear.
const pixel=(c,color,x,y,w,h=w)=>{c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),w,h);};
// Back-facing player holds the ball in the free (left) hand. Coordinates are
// the top-left of the ball pixel, kept outside the torso/racket silhouette.
export function heldServeBall(player,scale=1,tossFrames=0){
 const toss=tossFrames?Math.sin((26-tossFrames)/26*Math.PI)*18*scale:0;
 return {x:player.x-13*scale,y:player.y-16*scale-toss};
}
export function drawAimArrow(c,from,to,power,bend=0,color='#ffffff'){
 const length=Math.hypot(to.x-from.x,to.y-from.y);if(length<2)return;
 const head=Math.min(13,length*.27),shaft=3,wing=8,curve=-Math.max(-1,Math.min(1,bend))*length*.22;
 // The head follows the curve's terminal tangent, rather than the straight
 // start-to-end chord. This keeps the belly, neck and tip one continuous turn.
 const controlX=length*.45,tangent=Math.hypot(length-controlX,curve);
 const tx=(length-controlX)/tangent,ty=-curve/tangent,nx=-ty,ny=tx;
 const bx=length-tx*head,by=-ty*head;
 c.save();c.globalAlpha=.55;c.translate(from.x,from.y);c.rotate(Math.atan2(to.y-from.y,to.x-from.x));
 c.beginPath();c.moveTo(0,0);c.quadraticCurveTo(controlX,curve-shaft,bx-nx*shaft,by-ny*shaft);c.lineTo(bx-nx*wing,by-ny*wing);c.lineTo(length,0);c.lineTo(bx+nx*wing,by+ny*wing);c.lineTo(bx+nx*shaft,by+ny*shaft);c.quadraticCurveTo(controlX,curve+shaft,0,0);c.closePath();
 c.save();c.clip();c.fillStyle=color;c.fillRect(0,-length,length*Math.max(0,Math.min(1,power)),length*2);c.restore();
 c.strokeStyle=color;c.lineWidth=1.25;c.stroke();c.restore();
}
export function drawBall(c,{x,y,groundY,size=5,pickle=false}){
 pixel(c,'#112d3b55',x-size*.7,groundY+3,size*1.4,2);
 c.fillStyle=pickle?'#ffdf70':'#dbf77a';c.strokeStyle='#173b36';c.lineWidth=1;
 c.beginPath();c.arc(x,y,size/2,0,Math.PI*2);c.fill();c.stroke();
 c.fillStyle='#fffde6';c.beginPath();c.arc(x-size*.16,y-size*.18,size*.18,0,Math.PI*2);c.fill();
 if(pickle){pixel(c,'#aa781e',x+1,y,1);pixel(c,'#aa781e',x-1,y+2,1);}
 else {c.strokeStyle='#80ae48';c.lineWidth=1;c.beginPath();c.arc(x+size*.30,y,size*.34,Math.PI*.65,Math.PI*1.4);c.stroke();}
}
export function createMatchEffects(){
 let trail=[],impact=null,lastFrame=-1,lastEvent=0;
 return {
  draw(c,{frame,eventId=0,event='',ball=null,reduced=false}){
   if(frame<lastFrame){trail=[];impact=null;lastEvent=0;}
   if(frame!==lastFrame){
    if(eventId!==lastEvent){
     if(['hit','slice','drop','lob','cpu-hit','serve'].includes(event))impact=trail.at(-1)?{...trail.at(-1),frame}:null;
     lastEvent=eventId;trail=[];
    }
    if(ball){trail.push({...ball,frame});if(trail.length>5)trail.shift();}else trail=[];
    lastFrame=frame;
   }
   if(ball){
    if(!reduced)for(let i=0;i<trail.length-1;i++){
     const p=trail[i];pixel(c,['#f5f8c01a','#f5f8c02a','#f5f8c045','#f5f8c06a'][i],p.x-1,p.y-1,2);
    }
    drawBall(c,ball);
   }
   if(impact&&!reduced){
    const age=frame-impact.frame;
    if(age>=0&&age<12){
     const r=3+age*.65;c.save();c.globalAlpha=(1-age/12)*.75;
     for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1]])pixel(c,'#fff4bd',impact.x+dx*r,impact.y+dy*r,2);
     c.restore();
    }
   }
  },
 };
}
