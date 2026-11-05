// Versioned, deterministic simulation. Never modify v1: unfinished old runs
// must still verify with their original rules.
export { CHARACTERS, FPS, MAX_FRAMES, clamp } from './ilha-tennis-engine-v1.js';
import { CHARACTERS, MAX_FRAMES, clamp } from './ilha-tennis-engine-v1.js';
export const VERSION = 'tennis-rpg-v2';
export const INPUT = Object.freeze({ POWER:256, SLICE:512, LOB:1024, DROP:1536, SHOT_MASK:1536, SERVE:2048, MAX:4095 });
export const SHOTS = Object.freeze([
  {id:'normal',label:'Normal',input:0,arc:17,endY:130,speed:4.05,curve:0},
  {id:'slice',label:'Slice',input:INPUT.SLICE,arc:7,endY:159,speed:3.85,curve:18},
  {id:'lob',label:'Balão',input:INPUT.LOB,arc:62,endY:106,speed:2.85,curve:0},
  {id:'drop',label:'Curta',input:INPUT.DROP,arc:13,endY:210,speed:3.1,curve:0},
]);
function random(state){state.rng=(Math.imul(state.rng,1664525)+1013904223)>>>0;return state.rng/4294967296;}
function event(state,name){state.event=name;state.eventId++;}
export function createGame(seed,characterId='leandro'){
  const character=CHARACTERS.find(c=>c.id===characterId);
  if(!character)throw new Error('Jogador inválido.');
  return {
    version:VERSION,character,rng:seed>>>0,frame:0,
    player:{x:240,y:391,swing:0,dx:0},cpu:{x:240,y:117,swing:0,target:240,targetY:117,reaction:0},
    ball:{x:240,y:377,vx:0,vy:0,age:0,flight:60,arc:0,type:'serve',powered:false,active:false},
    playerPoints:0,cpuPoints:0,returns:0,rally:0,bestRally:0,score:0,
    charge:0,powerFrames:0,specialUsed:0,selectedShot:'normal',shotCounts:{normal:0,slice:0,lob:0,drop:0,serve:0},
    server:'player',awaitingServe:false,serveWait:0,tossFrames:0,delay:45,done:false,
    message:'PREPARE O SAQUE',event:'',eventId:0,
  };
}
function launch(state,{x,y,endX,endY,speed,type='normal',arc=17,powered=false,curve=0}){
  const flight=Math.ceil(Math.abs(endY-y)/speed);
  state.ball={x,y,startX:x,startY:y,endX,endY,vx:(endX-x)/flight,vy:(endY-y)/flight,age:0,flight,arc,type,powered,curve,active:true};
  state.cpu.reaction=type==='drop'?17:type==='slice'?19:12;
}
function point(state,won){
  if(won){state.playerPoints++;state.score+=100;}else state.cpuPoints++;
  state.message=won?'PONTO SEU!':'PONTO DO ADVERSÁRIO';
  state.delay=70;state.rally=0;state.ball.active=false;state.ball.vx=0;state.ball.vy=0;
  state.powerFrames=0;state.awaitingServe=false;state.tossFrames=0;state.serveWait=0;
  state.server=(state.playerPoints+state.cpuPoints)%2===0?'player':'cpu';
  event(state,won?'point':'miss');
}
function cpuServe(state){
  state.cpu.x=150+random(state)*180;state.cpu.y=117;
  launch(state,{x:state.cpu.x,y:130,endX:125+random(state)*230,endY:377,speed:3.5,arc:23,type:'serve'});
  state.cpu.swing=18;state.message='';event(state,'serve');
}
function playerServe(state){
  const x=state.player.x,endX=x<=240?300+random(state)*58:122+random(state)*58;
  launch(state,{x,y:377,endX,endY:130,speed:5.1,arc:24,type:'serve'});
  state.player.swing=23;state.shotCounts.serve++;state.message='';event(state,'serve');
}
function returnPlayer(state){
  const b=state.ball;
  if(Math.abs(b.x-state.player.x)>state.character.reach){point(state,false);return;}
  const shot=SHOTS.find(s=>s.id===state.selectedShot);
  const contact=clamp((b.x-state.player.x)/state.character.reach,-1,1);
  const endX=clamp(240+contact*130+state.player.dx*12,103,377);
  const powered=state.powerFrames>0;
  const speed=Math.min(7.2,(shot.speed+Math.min(state.rally,12)*.12)*state.character.power)*(powered?1.32:1);
  launch(state,{x:b.x,y:376,endX,endY:shot.endY,speed,arc:shot.arc,type:shot.id,powered,curve:shot.curve*(endX<240?-1:1)});
  state.powerFrames=0;state.player.swing=18;state.returns++;state.rally++;
  state.shotCounts[shot.id]++;state.bestRally=Math.max(state.bestRally,state.rally);
  state.score+=10;state.charge=Math.min(3,state.charge+1);
  event(state,powered?'smash':shot.id==='normal'?'hit':shot.id);
}
function returnCpu(state){
  const b=state.ball;
  if(Math.abs(b.x-state.cpu.x)>26||Math.abs((b.y-13)-state.cpu.y)>22){point(state,true);return;}
  launch(state,{x:b.x,y:b.y+1,endX:108+random(state)*264,endY:377,speed:Math.min(6.3,3.65+state.rally*.18)});
  state.cpu.swing=18;event(state,'cpu-hit');
}
function moveCpu(state){
  const b=state.ball;
  state.cpu.reaction=Math.max(0,state.cpu.reaction-1);
  if(!state.cpu.reaction&&state.frame%12===0){
    state.cpu.target=b.vy<0?clamp(b.endX+(random(state)-.5)*22,94,386):240;
    state.cpu.targetY=b.vy<0?b.endY-13:117;
  }
  const speed=b.powered?1.85:2.15+Math.min(.35,state.frame/MAX_FRAMES);
  state.cpu.x+=clamp(state.cpu.target-state.cpu.x,-speed,speed);
  state.cpu.y+=clamp(state.cpu.targetY-state.cpu.y,-2.1,2.1);
}
// Low byte: horizontal target. Bit 8: special. Bits 9–10: selected shot.
// Bit 11: serve request, accepted only while awaiting the player's serve.
export function stepGame(state,input=128){
  if(state.done)return state;state.frame++;
  const target=94+(input&255)*292/255,oldX=state.player.x;
  state.player.x+=clamp(target-state.player.x,-state.character.speed,state.character.speed);
  state.player.dx=state.player.x-oldX;state.player.swing=Math.max(0,state.player.swing-1);state.cpu.swing=Math.max(0,state.cpu.swing-1);
  state.selectedShot=SHOTS[(input&INPUT.SHOT_MASK)>>>9].id;
  if((input&INPUT.POWER)&&state.charge>=3&&state.ball.active&&!state.powerFrames){
    state.charge=0;state.powerFrames=150;state.specialUsed++;event(state,'charge');
  }
  state.powerFrames=Math.max(0,state.powerFrames-1);
  if(state.delay){
    state.delay--;
    if(!state.delay){
      if(state.server==='player'){state.awaitingServe=true;state.message='TOQUE EM SAQUE';state.serveWait=0;}
      else cpuServe(state);
    }
  }else if(state.awaitingServe){
    state.serveWait++;
    if((input&INPUT.SERVE)||state.serveWait>=300){
      state.awaitingServe=false;state.tossFrames=26;state.message='';event(state,'toss');
    }
  }else if(state.tossFrames){
    state.tossFrames--;
    if(!state.tossFrames)playerServe(state);
  }else if(state.ball.active){
    const b=state.ball;moveCpu(state);
    b.age++;const t=Math.min(1,b.age/b.flight);
    b.x=clamp(b.startX+(b.endX-b.startX)*t+Math.sin(Math.PI*t)*b.curve,98,382);
    b.y=b.startY+(b.endY-b.startY)*t;
    if(b.age>=b.flight){if(b.vy>0)returnPlayer(state);else returnCpu(state);}
  }
  if(state.frame>=MAX_FRAMES){state.done=true;state.awaitingServe=false;state.tossFrames=0;if(state.playerPoints>state.cpuPoints)state.score+=300;event(state,'finish');}
  return state;
}
export function replayGame(seed,characterId,inputs){
  if(!Array.isArray(inputs)||inputs.length!==MAX_FRAMES||inputs.some(v=>!Number.isInteger(v)||v<0||v>INPUT.MAX))throw new Error('A partida precisa ter 90 segundos completos.');
  const state=createGame(seed,characterId);
  for(const input of inputs)stepGame(state,input);
  return state;
}
