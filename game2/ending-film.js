import {NPCS} from './adventure.js';
import {AMBIENT_NPCS} from './ambient-npcs.js';
import {renderClub} from './scenery-renderer.js';
import {drawHero} from './characters.js';
import {drawTrophy,drawFoice} from './campaign-props.js';

export const ENDING_CAST=[...NPCS,...AMBIENT_NPCS];
export const ENDING_STAGE={x:410,y:744};
export const ENDING_SHOTS=[
 {id:'arrival',duration:6,speaker:'felipe',title:'Pode chegar, campeão!',text:'“A porção já está na mesa, {name}. Hoje a casa é sua!” A turma abre espaço para receber você.',width:440,cx:410,cy:685,cue:'menu-select'},
 {id:'award',duration:8,speaker:'leandro',title:'Essa conquista tem o seu nome.',text:'“Você ajudou a turma, aprendeu e não desistiu. Em nome de todo mundo: a Taça do Legado é sua!”',width:180,cx:397,cy:718,cue:'fanfare'},
 {id:'lift',duration:7,speaker:'renato',title:'Agora levanta essa taça!',text:'“Lembra do primeiro saque? Olha onde você chegou, {name}!” Renato dá um passo para trás: o aplauso é todo seu.',width:150,cx:410,cy:709,cue:'fanfare'},
 {id:'applause',duration:7,speaker:'davi',title:'O clube inteiro comemora.',text:'Davi puxa os aplausos. Lourenço já quer revanche. Até André sorri. Evandro aplaude sentado: economia de energia!',width:335,cx:409,cy:709,cue:'applause'},
 {id:'photo',duration:8,speaker:'emerson',title:'Junta a turma. Ninguém fica de fora!',text:'“Raquetes para baixo, taça para cima! Olha aqui… três, dois, um!” Dessa vez Renato chegou a tempo.',width:365,cx:410,cy:714,cue:'menu-select'},
 {id:'legend',duration:7,speaker:'romulo',title:'A Copa acabou. A Ilha continua.',text:'“Você mereceu, {name}. Guarde a taça… e a raquete por perto. Aqui sempre tem alguém querendo jogar.”',width:230,cx:410,cy:717,cue:'fanfare'},
];
export const ENDING_FILM_DURATION=ENDING_SHOTS.reduce((sum,s)=>sum+s.duration,0);
export function endingShotAt(time){let start=0;for(const [index,shot]of ENDING_SHOTS.entries()){if(time<start+shot.duration)return {...shot,index,start,local:Math.max(0,time-start),progress:Math.max(0,(time-start)/shot.duration)};start+=shot.duration;}return null;}
const mix=(a,b,t)=>a+(b-a)*t,smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const child=id=>['gael','lourenco','malu','betinho'].includes(id);

// All shots share a physical stage in front of the bar. A close-up changes the
// camera, never puts a screen-space sprite on top of an unrelated river view.
export function endingComposition(time,player,{focus=null,final=false,ratio=356/480,reduced=false}={}){
 const shot=focus?{id:'credit',width:190,cx:415,cy:719,progress:1,local:time}:final?{...ENDING_SHOTS.at(-1),progress:1,local:7}:endingShotAt(time)||{...ENDING_SHOTS.at(-1),progress:1,local:7};
 const photo=shot.id==='photo',arrival=shot.id==='arrival'?smooth(shot.progress):1;
 const crowd=ENDING_CAST.filter(n=>!['leandro','emerson',focus?.id].includes(n.id));
 const actors=crowd.map((n,i)=>{
  const right=i>=11,j=right?i-11:i;
  const x=right?456+j%3*27:295+j%3*27,y=684+Math.floor(j/3)*23;
  const group={x:275+i%11*26+(i>=11?13:0),y:690+Math.floor(i/11)*27};
  const arrange=photo?smooth(shot.progress*2):0;
  return {...n,x:mix(x,group.x,arrange),y:mix(y,group.y,arrange),height:child(n.id)?27:33};
 });
 const hero={...player,x:focus?454:mix(512,ENDING_STAGE.x,arrival),y:mix(717,ENDING_STAGE.y,arrival),height:focus?34:44,isHero:true};
 for(const [id,x,y]of [['leandro',377,744],['emerson',501,765]]){
  if(focus?.id!==id)actors.push({...ENDING_CAST.find(n=>n.id===id),x,y,height:36,photographer:id==='emerson'&&photo});
 }
 if(focus)actors.push({...focus,x:ENDING_STAGE.x,y:ENDING_STAGE.y,height:child(focus.id)?34:44,featured:true});
 actors.push(hero);
 const w=shot.width*(reduced?1:1-shot.progress*.025),h=w*ratio;
 return {shot,actors,hero,camera:{x:shot.cx-w/2,y:shot.cy-h/2,w,h}};
}
function drawPartyProp(ctx,n,time){
 if(n.id==='felipe'){ctx.fillStyle='#d5b87d';ctx.fillRect(n.x-24,n.y-11,16,3);ctx.fillStyle='#c48642';for(let i=0;i<6;i++)ctx.fillRect(n.x-23+i%3*4,n.y-17+Math.floor(i/3)*3,3,6);}
 if(n.id==='romulo')drawFoice(ctx,n.x+18,n.y-1,time);
 if(n.id==='evandro'){ctx.fillStyle='#f6e7bb';ctx.font='bold 6px monospace';ctx.fillText('Z z',n.x+8,n.y-34);}
 if(n.id==='beto'||n.id==='scarlt'){ctx.fillStyle='#ddf3c7';ctx.fillRect(n.x+13,n.y-38,2,7);ctx.fillRect(n.x+11,n.y-36,6,2);}
 if(n.id==='higor'){ctx.fillStyle='#bcd0cf';ctx.fillRect(n.x+12,n.y-24,2,24);ctx.fillRect(n.x+9,n.y-24,8,2);}
}
export function paintEndingFilm(c,time,player,{reduced=false,focus=null,final=false}={}){
 const {shot,actors,hero,camera}=endingComposition(time,player,{reduced,focus,final,ratio:c.canvas.height/c.canvas.width});
 const photo=shot.id==='photo',celebrating=final||focus||['lift','applause','photo','legend'].includes(shot.id);
 renderClub(c,camera,{time,atmosphereTime:174,hiddenProps:['bar-shade'],animate:!reduced,actors:actors.map(n=>({...n,isPlayer:n.isHero||n.featured})),
  drawSurface(ctx){
   ctx.fillStyle='#b29464';ctx.fillRect(365,727,101,27);ctx.fillStyle='#6e583e';ctx.fillRect(365,751,101,5);
   for(let y=730;y<752;y+=6){ctx.fillStyle='#d0b783';ctx.fillRect(367,y,97,1);}
   ctx.fillStyle='#dcc985';for(const x of [366,463])ctx.fillRect(x,727,2,24);
  },
  drawActor(ctx,n){
   const cheering=celebrating&&!n.isHero&&!n.photographer&&!n.featured&&n.id!=='evandro';
   const clap=reduced?0:Math.sin(time*7+n.x),hop=cheering&&!reduced?Math.max(0,clap)*1.2:0;
   drawHero(ctx,n.x,n.y-hop,n,{height:n.height,player:n.isHero,champion:false,celebrating:n.isHero&&celebrating&&!focus,seated:n.id==='evandro',facing:n.photographer?'up':!photo&&!n.isHero&&!n.featured?(n.x<hero.x?'right':'left'):'down',stride:n.isHero&&shot.id==='arrival'&&!reduced?time*3:0});
   // Victory is a dedicated two-arm pose; no painted arms over the idle sprite.
   if(cheering){ctx.fillStyle='#edbc8d';ctx.fillRect(n.x-5+(clap>0?3:0),n.y-18,3,3);ctx.fillRect(n.x+3-(clap>0?3:0),n.y-18,3,3);}
   if(n.photographer){ctx.fillStyle='#203440';ctx.fillRect(n.x-7,n.y-28,14,9);ctx.fillStyle='#cbdbcf';ctx.fillRect(n.x-3,n.y-26,5,5);}
   if(n.featured)drawPartyProp(ctx,n,time);
  }});
 const project=(x,y)=>({x:(x-camera.x)*c.canvas.width/camera.w,y:(y-camera.y)*c.canvas.height/camera.h});
 const transfer=shot.id==='arrival'?0:shot.id==='award'?smooth(shot.progress):1;
 const lift=shot.id==='lift'?smooth(shot.progress):celebrating?1:0;
 const liftHeight=focus?0:lift;
 const trophy=project(mix(386,hero.x+16-liftHeight*16,transfer),mix(718,hero.y-17,transfer)-liftHeight*32);
 drawTrophy(c,trophy.x,trophy.y,.64*c.canvas.width/camera.w);
 if(celebrating&&!focus){
  for(let i=0;i<36;i++){const x=(i*53+19+(reduced?0:Math.sin(time+i)*9))%c.canvas.width,y=(i*71+(reduced?18:time*18))%c.canvas.height;c.fillStyle=['#e6d77c','#b6dcce','#d9a8da','#eeac81'][i%4];c.fillRect(Math.round(x),Math.round(y),2+i%2,4);}
 }
 if(photo){
  c.strokeStyle='#f7edce';c.lineWidth=2;for(const [x,y,dx,dy]of [[18,20,1,1],[c.canvas.width-18,20,-1,1],[18,c.canvas.height-22,1,-1],[c.canvas.width-18,c.canvas.height-22,-1,-1]]){c.beginPath();c.moveTo(x+dx*17,y);c.lineTo(x,y);c.lineTo(x,y+dy*17);c.stroke();}
  if(shot.local<3){c.font='bold 25px monospace';c.textAlign='center';c.fillStyle='#fff1be';c.fillText(String(3-Math.floor(shot.local)),c.canvas.width/2,40);}
  else {c.fillStyle='#142e2bd9';c.fillRect(c.canvas.width/2-115,c.canvas.height-35,230,21);c.fillStyle='#fff0c1';c.font='bold 11px monospace';c.textAlign='center';c.fillText('ESSA TURMA FAZ PARTE DA SUA HISTÓRIA',c.canvas.width/2,c.canvas.height-21,220);
   if(!reduced&&shot.local<3.18){c.fillStyle=`rgba(255,248,219,${(3.18-shot.local)*2})`;c.fillRect(0,0,c.canvas.width,c.canvas.height);}
  }
 }
 if(shot.id==='legend'){c.fillStyle='#102823bc';c.fillRect(40,17,c.canvas.width-80,40);c.fillStyle='#ffeaa3';c.font='bold 16px monospace';c.textAlign='center';c.fillText('LENDA DA ILHA',c.canvas.width/2,35);c.font='bold 11px monospace';c.fillText(player.name.toUpperCase(),c.canvas.width/2,49,c.canvas.width-100);}
 c.fillStyle='#0b1d1b';c.fillRect(0,0,c.canvas.width,7);c.fillRect(0,c.canvas.height-7,c.canvas.width,7);

}
