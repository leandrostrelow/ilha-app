// Deliberately simplified, local-only pickleball arcade. First to five points.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function createPickleball(){return {player:.5,cpu:.5,cpuTarget:.5,reaction:0,ball:{x:.15,y:.5,vx:0,vy:0,active:false},playerPoints:0,cpuPoints:0,rally:0,returns:0,elapsed:0,done:false,waiting:true,delay:0,hit:null,hitAt:0};}
export function stepPickleball(s,{axis=0,target=null,serve=false}={},dt=1/60){
 if(s.done)return s;dt=clamp(dt,0,1/30);s.elapsed+=dt;
 const desired=target===null?s.player+axis*.85*dt:target;
 s.player=clamp(s.player+clamp(desired-s.player,-.85*dt,.85*dt),.12,.88);
 const b=s.ball;
 // Gael reacts to what is visible, not the future landing point. Long exchanges
 // tire him out: placement and a few solid returns create a real opening.
 s.reaction-=dt;
 if(s.reaction<=0){s.cpuTarget=b.active&&b.vx>0?b.y:.5;s.reaction=.20;}
 const cpuSpeed=Math.max(.18,.44-Math.max(0,s.rally-2)*.045);
 s.cpu=clamp(s.cpu+clamp(s.cpuTarget-s.cpu,-cpuSpeed*dt,cpuSpeed*dt),.14,.86);
 if(s.delay>0)s.delay=Math.max(0,s.delay-dt);
 if(s.waiting){b.x=.15;b.y=s.player;if(serve&&!s.delay){s.waiting=false;b.active=true;b.vx=.43;b.vy=(s.playerPoints+s.cpuPoints)%2?.22:-.22;s.hit='player';s.hitAt=s.elapsed;}}
 else if(b.active){
  b.x+=b.vx*dt;b.y+=b.vy*dt;
  if(b.y<.1||b.y>.9){b.y=clamp(b.y,.1,.9);b.vy*=-1;}
  const left=b.vx<0&&b.x<=.15,right=b.vx>0&&b.x>=.85;
  if(left||right){
   const paddle=left?s.player:s.cpu;
   if(Math.abs(b.y-paddle)<(left?.155:.12)){
    b.x=left?.15:.85;b.vx=(left?1:-1)*Math.min(.70,Math.abs(b.vx)+.025);
    const diagonal=(s.rally+s.playerPoints+s.cpuPoints)%4<2?1:-1;
    b.vy=left?clamp((b.y-paddle)*4+diagonal*.34,-.52,.52):((s.player>=.5?.22:.78)-b.y)*Math.abs(b.vx)/.7;
    s.rally++;if(left)s.returns++;s.hit=left?'player':'cpu';s.hitAt=s.elapsed;
   }else{if(left)s.cpuPoints++;else s.playerPoints++;s.rally=0;b.active=false;s.waiting=true;s.delay=.65;}
  }
 }
 if(Math.max(s.playerPoints,s.cpuPoints)>=5){s.done=true;b.active=false;s.waiting=false;}
 return s;
}
