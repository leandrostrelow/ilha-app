export const G=9.81, R=.055, NET=-10.885;
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function makeFeed(side=1,index=0){
  // A gentle feed crosses the net, bounces ahead of the student and rises
  // to waist height. No random difficulty spikes during the first lesson.
  const vy=4.9,y=1.5,t=(vy+Math.sqrt(vy*vy+2*G*(y-R)))/G;
  return {p:{x:side*(.48+.12*Math.sin(index*1.7)),y,z:-13.5},v:{x:0,y:vy,z:11/t},bounces:0,hit:false,crossed:false,active:true,age:0};
}
export function advanceBall(ball,dt){
  if(!ball.active)return null;
  const prev={...ball.p}; ball.age+=dt;
  ball.p.x+=ball.v.x*dt;ball.p.y+=ball.v.y*dt-.5*G*dt*dt;ball.p.z+=ball.v.z*dt;ball.v.y-=G*dt;
  if((prev.z-NET)*(ball.p.z-NET)<0){
    const f=(NET-prev.z)/(ball.p.z-prev.z),y=prev.y+(ball.p.y-prev.y)*f;
    if(y-R<.914&&Math.abs(ball.p.x)<6.4){ball.active=false;return {type:'net'};}
    if(ball.hit)ball.crossed=true;
  }
  if(ball.p.y<=R&&ball.v.y<0){
    ball.p.y=R;ball.bounces++;
    if(ball.hit){ball.active=false;return {type:ball.crossed&&Math.abs(ball.p.x)<=4.115+R&&ball.p.z>=-22.77-R&&ball.p.z<NET?'in':'out',x:ball.p.x,z:ball.p.z};}
    if(ball.bounces>=2){ball.active=false;return {type:'miss'};}
    ball.v.y=-ball.v.y*.76;return {type:'bounce'};
  }
  if(ball.p.z>2.7||Math.abs(ball.p.x)>20||ball.age>9){ball.active=false;return {type:'miss'};}
  return null;
}
// Relative swept segment versus an elliptical racket face. Handles balls and
// rackets passing through each other between frames, including fast swings.
export function racketContact(a,b,rx=.23,ry=.30,thickness=.09){
  const dz=b.z-a.z;let t;
  if(Math.abs(dz)<1e-7){if(Math.abs(b.z)>thickness)return false;t=1;}
  else {t=clamp(-a.z/dz,0,1);if(Math.abs(a.z+dz*t)>thickness)return false;}
  const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
  return x*x/(rx*rx)+y*y/(ry*ry)<=1;
}
export function returnBall(ball,aimX=0,power=0){
  const vy=6.8+clamp(power,0,5)*.1,t=(vy+Math.sqrt(vy*vy+2*G*(ball.p.y-R)))/G;
  ball.v={x:(clamp(aimX,-4.8,4.8)-ball.p.x)/t,y:vy,z:(-17-ball.p.z)/t};
  ball.hit=true;ball.bounces=0;ball.crossed=false;return t;
}
