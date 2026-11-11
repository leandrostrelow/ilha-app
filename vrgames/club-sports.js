export const SPORTS = {
 beach:{name:'Beach tennis',x:0,z:-36.5,yaw:0,width:4,length:8,net:1.7,contact:6.3,eye:7.5,bounce:false,landing:-5.3},
 pickle:{name:'Pickleball',x:6,z:12,yaw:Math.PI/2,width:3.05,length:6.705,net:.864,contact:5.2,eye:6.4,bounce:true,landing:-4.8}
};
export function sportFeed(kind,hand=1,index=0){
 const c=SPORTS[kind],p={x:hand*.48+Math.sin(index*1.7)*.07,y:kind==='beach'?2:1.6,z:kind==='beach'?-6.2:-5};
 const speed=kind==='beach'?6.4:6,t=(c.contact-p.z)/speed;
 return {p,v:{x:0,y:kind==='beach'?(1.28-p.y+4.905*t*t)/t:3.9,z:speed},active:true,hit:false,bounces:0,age:0};
}
export function sportReturn(ball,kind,aim){
 const c=SPORTS[kind],duration=kind==='beach'?1.75:1.4;
 const x=Math.max(-c.width+.35,Math.min(c.width-.35,aim));
 ball.v={x:(x-ball.p.x)/duration,y:(.055-ball.p.y+4.905*duration*duration)/duration,z:(c.landing-ball.p.z)/duration};ball.hit=true;
}
export function stepSport(ball,kind,dt){
 if(!ball.active)return null;const c=SPORTS[kind],previousZ=ball.p.z;
 ball.age+=dt;ball.p.x+=ball.v.x*dt;ball.p.y+=ball.v.y*dt-4.905*dt*dt;ball.p.z+=ball.v.z*dt;ball.v.y-=9.81*dt;
 let event=null;
 if(previousZ*ball.p.z<=0&&Math.abs(ball.p.x)<=c.width+.5&&ball.p.y<c.net+.055)event={type:'net'};
 else if(ball.p.y<=.055&&ball.v.y<0){
  ball.p.y=.055;
  if(ball.hit)event={type:Math.abs(ball.p.x)<=c.width&&ball.p.z>=-c.length&&ball.p.z<=0?'in':'out',x:ball.p.x,z:ball.p.z};
  else if(!c.bounce||ball.bounces>=1)event={type:'miss'};
  else{ball.bounces++;ball.v.y=-ball.v.y*.72;return {type:'bounce'};}
 }
 if(ball.age>8)event={type:'miss'};
 if(event)ball.active=false;return event;
}
