// Local campaign simulation. Ranked replay physics remain versioned separately.
// x = singles width; y = baseline to baseline; z = height above the ground.
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const G=2.8,LINE=.008;
const other=side=>side==='player'?'cpu':'player';
export function matchPace(difficulty){const level=clamp((difficulty-.4)/.76,0,1);return {focusBudget:.12-level*.10,focusScale:.93+level*.06,flight:.88-level*.22,cpuMove:1.80+level*.30,level};}
export const SHOT_FLIGHTS={normal:.94,slice:1.12,drop:1.04,lob:1.65,serve:1.04};
export const gentleMatch=s=>s.practice||s.lessonGuided;
export function cpuCondition(s){
 const fatigue=s.assisted&&!gentleMatch(s)?clamp(s.cpu.fatigue||0,0,1):0;
 return {fatigue,speed:1-fatigue*.30,acceleration:1-fatigue*.42,reaction:fatigue*.09,flight:1+fatigue*.16};
}
// Effort is earned by actual movement, not by the rally counter. A change of
// direction costs extra only after a meaningful run, never for steering jitter.
export function updateCpuFatigue(s,dt,{distance=0,lateral=0,rest=false}={}){
 const a=s.cpu;if(!s.assisted||gentleMatch(s)){a.fatigue=0;return;}
 let effort=distance*.055;
 if(Math.abs(lateral)>.00001){
  const direction=Math.sign(lateral);
  if(a.runDirection&&a.runDirection!==direction){if(a.lateralRun>.16)effort+=Math.min(.045,a.lateralRun*.06);a.lateralRun=0;}
  a.runDirection=direction;a.lateralRun=(a.lateralRun||0)+Math.abs(lateral);
 }
 const recovery=rest?.14:distance<dt*.12?.025:0;
 a.fatigue=clamp((a.fatigue||0)+effort-dt*recovery,0,1);
}
export function rallyPace(s){return gentleMatch(s)?1:1+Math.min(.5,s.rally*.03)*(.6+matchPace(s.difficulty).level*.4);}
const reboundPace=s=>!s.assisted?.65:gentleMatch(s)?.5:.56+matchPace(s.difficulty).level*.10;
export function preparationTime(s,power=.55){return gentleMatch(s)?0:Math.max(.09,(.10+clamp(power,0,1)*.10)/rallyPace(s));}
export function canPrepare(s){
 if(!s.assisted||!s.ball.active||s.delay||s.done)return false;
 const b=s.ball;
 if(b.last==='cpu')return gentleMatch(s)||b.age>=.055/rallyPace(s)&&s.elapsed>=(s.recoverUntil||0);
 // Only buffer a return as the rival approaches contact, not immediately after
 // our own shot. The prepared gesture survives the CPU hit, never the point.
 return !gentleMatch(s)&&b.last==='player'&&b.bounces===1&&b.y<.47&&s.elapsed-b.bounceAt>=.07&&
  Math.hypot((b.x-s.cpu.x)*.52,b.y-s.cpu.y)<.18&&s.elapsed>=(s.recoverUntil||0);
}
export function shotContact(s){
 const b=s.ball;
 if(!b.active||b.last!=='cpu')return {x:s.player.x,y:s.player.y};
 if(canHit(s,'player'))return {x:b.x,y:b.y};
 const g=b.gravity||G,retention=b.type==='slice'?.46:b.type==='drop'?.45:.58;
 const vz=b.bounces?b.vz:Math.sqrt(b.vz*b.vz+2*g*b.z)*retention,z=b.bounces?b.z:0;
 let t=Math.max(0,.22-(b.bounces?s.elapsed-b.bounceAt:0));
 if(z+vz*t-g*t*t/2>.18)t=(vz+Math.sqrt(Math.max(0,vz*vz+2*g*(z-.18))))/g;
 const speed=b.bounces?1:reboundPace(s);
 return {x:clamp((b.bounces?b.x:b.endX)+b.vx*speed*t,-.22,1.22),y:clamp((b.bounces?b.y:b.endY)+b.vy*speed*t,.54,1.24)};
}
export function shotPlan(s,{shot='normal',aim=0,power=.55}={},contact=shotContact(s)){
 const p=clamp(power*(s.playerPowerScale||1),0,1),a=clamp(aim,-1,1),gentle=gentleMatch(s);
 if(shot==='serve'){
  const target=serviceTarget(s,{aim:a,power}),outside=!validLanding(s,{...target,last:'player',serve:true,serviceSide:s.player.x>=.5?1:-1});
  const risk=gentle?0:outside?1:Math.max(clamp((power-.72)/.28,0,1)*.8,clamp((Math.abs(a)-.65)/.35,0,1)*.8);
  return {...target,power:clamp(power,0,1),outside,risk,color:risk>=.72?'#ff7970':risk>.05?'#ffdc71':'#ffffff',label:outside?'SAQUE · RISCO DE FALTA':risk>.05?'SAQUE · CUIDADO COM A FORÇA':'SAQUE SEGURO'};
 }
 if(gentle)return {x:clamp(.5+a*.43,.06,.94),y:shot==='drop'?.39:shot==='slice'?.29-p*.17:.30-p*.23,power:p,risk:0,color:'#ffffff',label:'GOLPE SEGURO'};
 // Aim is a ray towards the far baseline. Width and length use court units,
 // so cross-court really has more flight space, independent of screen rotation.
 const width=.48,cx=contact.x,cy=Math.max(.51,contact.y);
 // A diagonal topspin gesture must reach the corners without turning into a
 // slice. Angles beyond the singles lines still carry a real geometric risk.
 const lateral=shot==='normal'?clamp(a*1.25,-1,1):a;
 const targetX=.5+lateral*.46+Math.sign(lateral)*Math.max(0,Math.abs(lateral)-.82)*.42;
 const dx=(targetX-cx)*width,dy=-cy,distance=Math.hypot(dx,dy),ux=dx/distance,uy=dy/distance;
 const controlledDepth=shot==='drop'?.46-Math.min(p,.6)*.14:shot==='slice'?.36-Math.min(p,.6)*.16:.32-Math.min(p,.6)*.18;
 const controlledRange=(cy-controlledDepth)/(-uy);
 const rawRange=shot==='drop'?.94:shot==='slice'?.99:shot==='lob'?1.06:1.02;
 // Most power adds pace with controlled depth. Only the last portion extends
 // the flight: short straight blasts can go long; deep/cross-court drives fit.
 // This is a continuous trajectory, not a clamp or a random out-ball roll.
 const fullRange=(cy-.045)/(-uy)*.72+rawRange*.28;
 const drive=(Math.max(0,p-.60)/.40)**1.3;
 const range=controlledRange+(fullRange-controlledRange)*drive;
 const x=cx+ux*range/width,y=cy+uy*range;
 const margin=Math.min(x,1-x,y,.5-y),outside=!inSingles(x,y)||y>=.5;
 const cross=Math.abs(targetX-cx)>.48,deep=cy>=.98;
 const risk=Math.max(outside?1:clamp((.065-margin)/.075,0,.9),clamp((p-.78)/.22,0,1)*.74);
 const label=outside?'RISCO · FORÇA OU ÂNGULO DEMAIS':p>=.85?(cross?'FORTE NA CRUZADA · MAIS ESPAÇO':deep?'FORTE DO FUNDO · HÁ ESPAÇO':'FORTE · ATENÇÃO À LINHA'):risk>.05?'CUIDADO COM A LINHA':'GOLPE SEGURO';
 return {x,y,power:p,risk,color:risk>=.72?'#ff7970':risk>.05?'#ffdc71':'#ffffff',label,contact:{x:cx,y:cy},range,cross,outside};
}
export function createRacketMatch({sport='tennis',horizontal=sport==='pickleball',difficulty=.65,points=sport==='pickleball'?5:7,seed=1,practice=false,assisted=false,playerMoveScale=1,playerPowerScale=1}={}){
 const s={manual:true,sport,difficulty,points,practice,seed:seed>>>0,frame:0,elapsed:0,player:{x:.5,y:1.04,dx:0,dy:0,swing:0},cpu:{x:.5,y:-.04,dx:0,dy:0,swing:0},ball:{x:.5,y:1.04,z:.06,active:false},server:'player',awaitingServe:true,waiting:true,delay:0,tossFrames:0,playerPoints:0,cpuPoints:0,returns:0,rally:0,bestRally:0,score:0,charge:0,shotCounts:{normal:0,slice:0,drop:0,lob:0,serve:0},event:'',eventId:0,message:'B para sacar',feedback:'B para sacar',done:false,faults:0,cpuReaction:0,cpuTarget:{x:.5,y:.1},swingQueue:null,swingCooldown:0,hit:null,hitAt:0,landing:null,serveBounces:0};
 s.assisted=assisted;s.horizontal=horizontal;s.playerMoveScale=clamp(playerMoveScale,.9,1.1);s.playerPowerScale=clamp(playerPowerScale,.9,1.1);s.prepared=null;s.recoverUntil=0;s.lastPlayerShot=null;s.repeatShots=0;return s;
}
function random(s){s.seed=(Math.imul(s.seed,1664525)+1013904223)>>>0;return s.seed/4294967296;}
function event(s,name){s.event=name;s.eventId++;}
export function inSingles(x,y){return x>=-LINE&&x<=1+LINE&&y>=-LINE&&y<=1+LINE;}
export function validLanding(s,b){
 if(!inSingles(b.x,b.y))return false;
 if(b.last==='player'?b.y>=.5:b.y<=.5)return false;
 if(!b.serve)return true;
 const correctSide=b.serviceSide>0?b.x<=.5+LINE:b.x>=.5-LINE;
 const depth=s.sport==='pickleball'?(b.last==='player'?b.y<1/3-LINE:b.y>2/3+LINE):(b.last==='player'?b.y>=.27-LINE:b.y<=.73+LINE);
 return correctSide&&depth;
}
export function launchBall(s,side,shot,x,y,{flight=SHOT_FLIGHTS[shot],serve=false}={}){
 const a=s[side],b=s.ball,start=b.active?{x:b.x,y:b.y,z:b.z}:{x:a.x,y:a.y,z:.065};
 const gravity=shot==='slice'?1.35:shot==='drop'?1.7:shot==='lob'?3.2:G;
 // Fast CPU shots still need a physically legal arc over the net. Increasing
 // difficulty must not hand points away by shortening flight into the net.
 if(s.assisted){const u=(.5-start.y)/(y-start.y);if(u>0&&u<1)flight=Math.max(flight,Math.sqrt(Math.max(0,2*(.055-start.z*(1-u))/(gravity*u*(1-u)))));}
 s.ball={...start,vx:(x-start.x)/flight,vy:(y-start.y)/flight,vz:(gravity*flight*flight/2-start.z)/flight,gravity,active:true,last:side,type:shot,serve,serviceSide:a.x>=.5?1:-1,bounces:0,age:0,flight,endX:x,endY:y};
 a.swing=18;s.hit=side;s.hitAt=s.elapsed;s.swingQueue=null;s.awaitingServe=false;s.waiting=false;
 if(side==='player'){s.prepared=null;s.recoverUntil=s.elapsed+(gentleMatch(s)?0:.22/rallyPace(s));}
 if(side==='player'&&s.assisted&&!gentleMatch(s))s.cpuReaction=.18-matchPace(s.difficulty).level*.07+cpuCondition(s).reaction;
 s.feedback=serve?(side==='player'?'Saque!':'Prepare a devolução'):side==='cpu'?'Aproxime-se e bata':s.feedback;
 event(s,serve?'serve':side==='cpu'?'cpu-hit':shot==='normal'?'hit':shot);
}
function resetServe(s){
 const side=s.server==='player'?1:-1,alternate=(s.playerPoints+s.cpuPoints)%2?-.20:.20;
 s.player.x=.5+alternate;s.player.y=1.045;s.cpu.x=.5-alternate;s.cpu.y=-.045;
 s[s.server].x=.5+alternate*side;
 s.awaitingServe=s.server==='player';s.waiting=s.awaitingServe;s.cpuReaction=.65;
 s.ball={x:s[s.server].x,y:s[s.server].y,z:.06,active:false};s.serveBounces=0;
 s.prepared=null;s.lastPlayerShot=null;s.repeatShots=0;s.comboUntil=0;s.cpuApproachUntil=0;s.cpu.steerX=0;s.cpu.steerY=0;
 s.cpu.runDirection=0;s.cpu.lateralRun=0;
 s.feedback=s.awaitingServe?'B para sacar':'Saque do adversário';
}
function point(s,winner,reason){
 const b=s.ball;
 if(b.serve&&b.bounces===0&&winner!==b.last&&s.faults===0){
  s.faults=1;s.delay=.85;b.active=false;s.prepared=null;s.message='Falta · segundo saque';s.feedback=s.message;event(s,'miss');return;
 }
 s[winner+'Points']++;s.score+=winner==='player'?100:0;
 s.bestRally=Math.max(s.bestRally,s.rally);s.rally=0;s.faults=0;
 s.message=reason+(winner==='player'?' · seu ponto':' · ponto adversário');s.feedback=s.message;
 s.delay=1.25;b.active=false;s.awaitingServe=false;s.waiting=false;s.swingQueue=null;s.prepared=null;
 const a=s.playerPoints,c=s.cpuPoints,total=a+c;
 s.server=s.sport==='pickleball'?winner:Math.floor((total+1)/2)%2===0?'player':'cpu';
 s.done=s.sport==='pickleball'?Math.max(a,c)>=s.points:Math.max(a,c)>=s.points&&(Math.abs(a-c)>=2||Math.max(a,c)>=11);
 event(s,winner==='player'?'point':'miss');
 if(s.done){s.score+=a>c?300:0;event(s,'finish');}
}
export function canHit(s,side){
 const b=s.ball,a=s[side];
 if(!b.active||b.last===side||b.z>.18||b.z<0)return false;
 // Assisted exchanges always show a real bounce before either racket hits.
 // Count alone allowed a return on the very next frame, hiding the bounce.
 if((s.assisted||b.serve||s.sport==='pickleball'&&s.serveBounces<2)&&
    (b.bounces<1||b.bounceAt===undefined||s.elapsed-b.bounceAt<(s.assisted?.22:.12)))return false;
 if(side==='player'?b.y<.51:b.y>.49)return false;
 return Math.hypot((b.x-a.x)*.52,b.y-a.y)<(side==='player'?.112:.072);
}
function strike(s,side,shot,aim=0,power=null){
 const b=s.ball,a=s[side];
 if(b.serve&&b.bounces===0){s.feedback='Deixe o saque quicar';return false;}
 if(s.sport==='pickleball'&&b.bounces===0){
  if(s.serveBounces<2){s.feedback='Deixe quicar antes de devolver';return false;}
  if(side==='player'?a.y<=2/3:a.y>=1/3){point(s,other(side),'Voleio na cozinha');return true;}
 }
 // Direction aims across court; poor spacing may genuinely send it wide.
 const spacing=(b.x-a.x)*.38;
 // Neutral input assists placement into open space; holding a direction
 // overrides it. This keeps casual exchanges from locking into one corner.
 let x=Math.abs(aim)>.2?.5+clamp(aim,-1,1)*.50+spacing:(s.cpu.x<.5?.88:.12)+spacing;
 if(side==='cpu'){
  const spread=s.assisted?.37+matchPace(s.difficulty).level*.08:.25;
  x=.5+(s.player.x<.5?spread:-spread)+(random(s)-.5)*.08;
 }
 const plan=shotPlan(s,{shot,aim,power:power??.55},{x:b.x,y:b.y});
 if(side==='player'&&power!==null)x=plan.x;
 const strength=clamp((power??.55)*(side==='player'?s.playerPowerScale:1),0,1);
 const depth=power!==null&&side==='player'?plan.y:(shot==='drop'?.39:shot==='slice'?.19:.10);
 const y=side==='player'?depth:1-depth;
 const combo=side==='player'&&s.assisted&&!gentleMatch(s)&&s.lastPlayerShot?.shot==='drop'&&shot==='normal'&&strength>=.66&&s.cpu.y>.12;
 if(side==='cpu'&&s.assisted&&s.lastPlayerShot?.shot==='drop')s.cpuApproachUntil=s.elapsed+1.1;
 const flight=SHOT_FLIGHTS[shot]*(power!==null&&side==='player'?1.14-strength*.26:side==='cpu'&&s.assisted?matchPace(s.difficulty).flight*cpuCondition(s).flight:1)/(s.assisted?rallyPace(s):1)*(combo?.91:1);
 if(side==='player'){const previous=s.lastPlayerShot;s.repeatShots=previous?.shot===shot&&Math.abs(previous.aim-aim)<.3?s.repeatShots+1:0;s.lastPlayerShot={shot,aim};if(combo)s.comboUntil=s.elapsed+1.2;}
 launchBall(s,side,shot,x,y,{flight});
 if(combo)s.cpuReaction+=.08;
 s.rally++;s.bestRally=Math.max(s.rally,s.bestRally);
 if(side==='player'){s.returns++;s.score+=10;s.shotCounts[shot]++;s.feedback=shot==='drop'?'Deixada!':shot==='slice'?'Slice!':'Topspin!';}
 return true;
}
function move(a,x,y,speed,dt,side){
 const magnitude=Math.max(1,Math.hypot(x,y)),oldX=a.x,oldY=a.y;
 a.x=clamp(a.x+x/magnitude*speed*dt,-.22,1.22);
 a.y=clamp(a.y+y/magnitude*speed*.50*dt,side==='player'?.54:-.14,side==='player'?1.14:.46);
 a.dx=(a.x-oldX)/dt;a.dy=(a.y-oldY)/dt;a.swing=Math.max(0,a.swing-60*dt);
}
function cpuStep(s,dt){
 const b=s.ball;s.cpuReaction-=dt;
 if(s.cpuReaction<=0){
  const incoming=b.active&&b.last==='player';
  // Anticipate the landing with a finite reaction time; never teleport to it.
  const gravity=b.gravity||G,remaining=incoming?Math.max(0,(b.vz+Math.sqrt(b.vz*b.vz+2*gravity*b.z))/gravity):0;
  if(s.assisted&&incoming){
   const bounceVz=Math.sqrt(b.vz*b.vz+2*gravity*b.z)*(b.type==='slice'?.46:b.type==='drop'?.45:.58);
   const contactTime=Math.max(.24,bounceVz*bounceVz>2*gravity*.18?(bounceVz+Math.sqrt(bounceVz*bounceVz-2*gravity*.18))/gravity:0);
   if(!b.cpuArrival)b.cpuArrival={x:clamp((b.bounces?b.x:b.endX)+b.vx*(b.bounces?.08:contactTime*reboundPace(s)),-.15,1.15),y:clamp((b.bounces?b.y:b.endY)+b.vy*(b.bounces?.08:contactTime*reboundPace(s))-.045,-.13,.43)};
   s.cpuTarget=b.cpuArrival;
  }else s.cpuTarget={x:incoming?clamp(b.x+b.vx*remaining,.03,.97):s.assisted&&s.repeatShots>=2?clamp(.5+(s.lastPlayerShot?.aim||0)*.23,.24,.76):.5,y:incoming?clamp(b.y+b.vy*remaining-.035,-.09,.40):s.cpuApproachUntil>s.elapsed?.30:.09};
  s.cpuReaction=s.assisted?.13-.07*matchPace(s.difficulty).level+cpuCondition(s).reaction:.26-.10*Math.min(1,s.difficulty);
 }
 const condition=cpuCondition(s),tired=s.assisted?condition.speed:Math.max(.30,1-Math.max(0,s.rally-2)*.07);
 const speed=(.27+s.difficulty*.22)*tired*(s.assisted?matchPace(s.difficulty).cpuMove:1),dx=s.cpuTarget.x-s.cpu.x,dy=(s.cpuTarget.y-s.cpu.y)*2;
 let steerX=Math.abs(dx)<.01?0:clamp(dx*9,-1,1),steerY=Math.abs(dy)<.01?0:clamp(dy*9,-1,1);
 if(s.assisted){const accel=(3.8+matchPace(s.difficulty).level*2.6)*condition.acceleration*dt;s.cpu.steerX=(s.cpu.steerX||0)+clamp(steerX-(s.cpu.steerX||0),-accel,accel);s.cpu.steerY=(s.cpu.steerY||0)+clamp(steerY-(s.cpu.steerY||0),-accel,accel);steerX=s.cpu.steerX;steerY=s.cpu.steerY;}
 const oldX=s.cpu.x,oldY=s.cpu.y;
 move(s.cpu,steerX,steerY,speed,dt,'cpu');
 updateCpuFatigue(s,dt,{distance:Math.hypot(s.cpu.x-oldX,(s.cpu.y-oldY)*2),lateral:s.cpu.x-oldX});
 if(canHit(s,'cpu')&&b.bounces>=1){
  const shot=s.assisted?(s.player.y>.78&&random(s)<.30+matchPace(s.difficulty).level*.20?'drop':random(s)<.24?'slice':'normal'):s.difficulty>.8&&s.rally%4===3?'drop':s.rally%3===2?'slice':'normal';
  strike(s,'cpu',shot);
 }
}
function integrateBall(s,dt){
 const b=s.ball,gravity=b.gravity||G;
 // Solve contact time within the frame: a ball aimed exactly at a line is in
 // at 30/60/120Hz instead of being judged at the next frame's overshoot.
 const groundTime=(b.vz+Math.sqrt(Math.max(0,b.vz*b.vz+2*gravity*b.z)))/gravity;
 const elapsed=Math.min(dt,Math.max(0,groundTime)),netTime=(.5-b.y)/b.vy;
 if(netTime>=0&&netTime<=elapsed&&b.z+b.vz*netTime-gravity*netTime*netTime/2<.033){point(s,other(b.last),'Na rede');return;}
 const advance=t=>{b.x+=b.vx*t;b.y+=b.vy*t;b.z+=b.vz*t-gravity*t*t/2;b.vz-=gravity*t;b.age+=t;};
 advance(elapsed);
 if(groundTime<=dt){
  b.z=0;s.landing={x:b.x,y:b.y,at:s.elapsed,valid:b.bounces>0||validLanding(s,b)};
  if(b.bounces===0&&!s.landing.valid){point(s,other(b.last),'Fora');return;}
  b.bounces++;b.bounceAt=s.elapsed;
  if(b.bounces>=2){point(s,b.last,'Dois quiques');return;}
  s.serveBounces++;b.vz=Math.abs(b.vz)*(b.type==='slice'?.46:b.type==='drop'?.45:.58);const bouncePace=reboundPace(s);b.vx*=bouncePace;b.vy*=bouncePace;
  event(s,'bounce');
  advance(dt-elapsed);
 }
}
export function serviceTarget(s,gesture=null){
 const right=s[s.server].x>=.5,p=clamp(gesture?.power??.5,0,1),aim=clamp(gesture?.aim??0,-1,1);
 const risk=gesture&&s.assisted&&!gentleMatch(s),extra=risk?Math.sign(aim)*Math.max(0,Math.abs(aim)-.82)*.65:0;
 const x=gesture?(right?.25:.75)+aim*.18+extra:(right?.28:.72);
 const depth=gesture?(s.sport==='pickleball'?.27-p*.14:.40-p*.10)-(risk?Math.max(0,p-.94)*.48:0):(s.sport==='pickleball'?.20:.37);
 return {x,y:s.server==='player'?depth:1-depth,flight:SHOT_FLIGHTS.serve*(gesture?1.15-p*.25:1)};
}
export function stepRacketMatch(s,{moveX=0,moveY=0,target=null,shot=null,serve=false,serveGesture=null,aim=moveX,power=.55,stroke=null,coach=false,aiming=false}={},dt=1/60){
 if(s.done)return s;dt=clamp(dt,0,1/30);
 const incoming=s.ball.active&&s.ball.last==='cpu'&&!s.delay;
 if(!incoming)s.focusUsed=0;
 // Matches run at full speed in flight. A short post-bounce window helps
 // aiming without giving every return several seconds of extra thinking time.
 // Lessons retain their forgiving pace while the player learns the gestures.
 const afterBounce=s.ball.bounces===1,pace=matchPace(s.difficulty);
 const focus=s.assisted&&incoming&&(coach||afterBounce)&&!stroke&&!shot&&(s.focusUsed||0)<(coach?2.4:pace.focusBudget)&&(aiming||(!s.prepared&&s.ball.y>.58));
 s.timeScale=focus?(coach?(aiming?.2:.45):pace.focusScale):1;
 // Keep the initial rebound readable; do not slow the CPU's receiving turn.
 if(s.assisted&&incoming&&afterBounce&&s.elapsed-s.ball.bounceAt<.22)s.timeScale=Math.min(s.timeScale,coach?.42:pace.focusScale);
 if(focus)s.focusUsed=(s.focusUsed||0)+dt;
 dt*=s.timeScale;s.elapsed+=dt;s.frame++;
 if(s.delay>0||!s.ball.active)updateCpuFatigue(s,dt,{rest:true});
 if(s.assisted){
  // One prepared return per incoming ball; planning never moves the ball.
  if(!s.delay&&(stroke||shot)&&s.ball.active){const type=stroke?.shot||shot;
   if((coach||canPrepare(s))&&Object.hasOwn(SHOT_FLIGHTS,type)&&type!=='serve'&&!s.prepared){const p=clamp(stroke?.power??power,0,1);s.prepared={shot:type,aim:clamp(stroke?.aim??aim,-1,1),power:p,readyAt:s.elapsed+(coach?0:preparationTime(s,p))};}
   else if(!s.prepared)s.feedback='Espere a devolução da CPU';
  }
  const b=s.ball,incoming=b.active&&b.last==='cpu';
  if(incoming){
   // Commit to a point behind the post-bounce contact, not the moving ball.
   if(!b.arrival){const extra=.26*reboundPace(s);
    b.arrival={x:clamp(b.bounces?b.x:b.endX+b.vx*extra,-.17,1.17),y:clamp((b.bounces?b.y:b.endY+b.vy*extra)+.07,.56,1.13)};}
   target=b.arrival;
  }else if(b.active)target={x:.5,y:.86};
  // During serve/waits the player stays put; the pad is optional aiming only.
  moveX=0;moveY=0;
 }
 if(target){moveX=clamp((target.x-s.player.x)*10,-1,1);moveY=clamp((target.y-s.player.y)*20,-1,1);}
 move(s.player,moveX,moveY,.95*s.playerMoveScale*(s.assisted&&!coach&&!gentleMatch(s)?(1-matchPace(s.difficulty).level*.12)/rallyPace(s)**.2:1),dt,'player');s.swingCooldown=Math.max(0,s.swingCooldown-dt);
 if(s.delay>0){s.prepared=null;s.delay=Math.max(0,s.delay-dt);if(!s.delay)resetServe(s);return s;}
 if(!s.ball.active){
  if(coach&&!s.awaitingServe)return s;
  if(s.server==='cpu')s.cpuReaction-=dt;
  if((s.awaitingServe&&serve)||(s.server==='cpu'&&s.cpuReaction<=0)){
   const a=s[s.server];a.y=s.server==='player'?1.045:-.045;
   const target=serviceTarget(s,s.server==='player'?serveGesture:null);
   launchBall(s,s.server,'serve',target.x,target.y,{serve:true,flight:target.flight*(s.assisted&&s.server==='cpu'?pace.flight:1)});s.serveBounces=0;
   if(s.server==='player')s.shotCounts.serve++;
  }return s;
 }
 if(s.assisted&&!aiming&&s.prepared&&s.elapsed>=s.prepared.readyAt&&canHit(s,'player')&&s.ball.bounces>=1){const q=s.prepared;if(strike(s,'player',q.shot,q.aim,q.power))s.prepared=null;}
 if(!s.assisted&&shot&&Object.hasOwn(SHOT_FLIGHTS,shot)&&shot!=='serve'&&!s.swingCooldown){
  s.swingQueue={shot,aim,until:s.elapsed+.22};s.swingCooldown=.27;s.player.swing=18;s.feedback='…';
 }
 if(s.swingQueue){
  if(canHit(s,'player')){const q=s.swingQueue;strike(s,'player',q.shot,q.aim);}
  if(s.swingQueue&&s.elapsed>s.swingQueue.until){s.swingQueue=null;s.feedback='Mais perto da bola · bata na hora!';}
 }
 if(!s.ball.active)return s;
 if(!coach)cpuStep(s,dt);
 integrateBall(s,dt);
 return s;
}
