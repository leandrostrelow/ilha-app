import {isZombie} from './halloween-state.js';
import {indexAtlasFrames,heroFrame} from './sprite-frames.js';
import {AMBIENT_NPCS} from './ambient-npcs.js';
import {EXTRA_MATCH_ATLAS_URL,extraMatchFrame,extraMatchGrip} from './match-sprites.js';
import {PREMIUM_AVATAR_URL,VICTORY_AVATAR_URL,premiumAvatarFrame,premiumVictoryFrame} from './premium-avatars.js';
import {CHILD_ATLASES,childFrame} from './children.js';
export const HERO_ATLAS_URL='/games/assets/ilha-legado-players-v1.png';
export const NPC_ATLAS_URL='/games/assets/ilha-legado-npcs-v2.png';
export const NPC_BACK_ATLAS_URL='/games/assets/ilha-legado-npcs-back-v2.png';
export const HERO_WALK_ATLAS_URL='/games/assets/ilha-legado-walk-v2.png';
const atlases={};
async function loadAtlas(key,url,columns,rows){
 const image=new Image();image.decoding='async';image.src=url;await image.decode();
 const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
 const frames=indexAtlasFrames(ctx.getImageData(0,0,canvas.width,canvas.height),columns,rows);
 if(frames.some(f=>f.w<=0||f.h<=0))throw new Error('Atlas de personagens incompleto.');
 const zombie=document.createElement('canvas');zombie.width=canvas.width;zombie.height=canvas.height;const z=zombie.getContext('2d'),pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
 // Runtime palette variant: same frames, poses, equipment and hit geometry.
 for(let i=0;i<pixels.data.length;i+=4){if(!pixels.data[i+3])continue;const r=pixels.data[i],g=pixels.data[i+1],b=pixels.data[i+2];
  if(r>65&&r>g*1.08&&g>b*1.12){const light=(r+g+b)/3;pixels.data[i]=light*.60;pixels.data[i+1]=Math.min(255,light*1.12+24);pixels.data[i+2]=light*.62;}
  else{pixels.data[i]=r*.82+b*.13;pixels.data[i+1]=g*.87;pixels.data[i+2]=Math.min(255,b*.94+10);}
 }z.putImageData(pixels,0,0);
 let halloween=null;
 if(['players','walk'].includes(key)){
  halloween=document.createElement('canvas');halloween.width=canvas.width;halloween.height=canvas.height;
  const costume=ctx.getImageData(0,0,canvas.width,canvas.height);
  // Recolor fabric only, keeping source shading, alpha, skin, hair and every animation frame.
  for(let i=0;i<costume.data.length;i+=4){
   const d=costume.data,r=d[i],g=d[i+1],b=d[i+2];if(!d[i+3])continue;
   if(g>r*1.3&&g>b*1.12&&g>32){d[i]=g*.80;d[i+1]=g*.32;d[i+2]=Math.min(255,g*1.32);}
   else if(b>g*1.45&&r>g*1.3&&b>45){d[i]=Math.min(255,b*1.40);d[i+1]=b*.61;d[i+2]=b*.12;}
  }
  halloween.getContext('2d').putImageData(costume,0,0);
 }
 atlases[key]={image,zombie,halloween,frames};
}
export const heroesReady=Promise.all([loadAtlas('premium',PREMIUM_AVATAR_URL,6,4).catch(()=>false),loadAtlas('premium1','/game2/assets/halloween-heroes-medium-v1.png',6,4).catch(()=>false),loadAtlas('premium2','/game2/assets/halloween-heroes-dark-v1.png',6,4).catch(()=>false),loadAtlas('victory-extra','/game2/assets/halloween-victory-extra-v1.png',4,1).catch(()=>false),loadAtlas('victory',VICTORY_AVATAR_URL,2,1).catch(()=>false),loadAtlas('players',HERO_ATLAS_URL,2,4),loadAtlas('npcs',NPC_ATLAS_URL,4,3),loadAtlas('backs',NPC_BACK_ATLAS_URL,4,3),loadAtlas('walk',HERO_WALK_ATLAS_URL,4,4),loadAtlas('extras-match',EXTRA_MATCH_ATLAS_URL,6,3),...AMBIENT_NPCS.map(n=>loadAtlas(`ambient:${n.id}`,n.art,1,1)),...Object.entries(CHILD_ATLASES).map(([id,url])=>loadAtlas(`child:${id}`,url,3,4))]);
heroesReady.catch(()=>{});
// Hand positions in sprite-height units. Existing racket art is left untouched.
const matchGrips={romulo:[.15,-.46],beto:[.19,-.35],felipe:[.16,-.34],leandro:[.19,-.34]};
export function matchRacketGrip(id,facing='down'){
 const extra=extraMatchGrip(id,facing);if(extra)return extra;
 if(['romulo','beto','felipe','leandro'].includes(id)&&facing==='up')return null;
 return matchGrips[id]||null;
}
function drawMatchRacket(ctx,id,facing,height,sport,pose=null,swing=0){
 const grip=pose?.grip||matchRacketGrip(id,facing);if(!grip)return;
 ctx.save();ctx.translate(grip[0]*height,grip[1]*height);ctx.scale(height/40,height/40);
 ctx.rotate(pose?pose.angle+Math.sin(swing/23*Math.PI)*.85:grip[0]<0?-.45:.45);
 ctx.fillStyle='#182e32';ctx.fillRect(-1.7,-6,3.4,8);
 ctx.fillStyle='#eee4c8';ctx.fillRect(-.6,-5,1.2,6);
 ctx.strokeStyle='#162d35';ctx.lineWidth=2.4;ctx.beginPath();ctx.ellipse(0,-11,4,6,0,0,Math.PI*2);ctx.stroke();
 ctx.fillStyle=sport==='pickleball'?'#269ca7':'#183e4266';ctx.fill();
 ctx.strokeStyle=sport==='pickleball'?'#bfe5d9':'#dcf16e';ctx.lineWidth=1;ctx.stroke();
 ctx.save();ctx.clip();ctx.fillStyle=sport==='pickleball'?'#b5e2df':'#f4efd4';
 for(let i=-3;i<=3;i+=2){if(sport!=='pickleball')ctx.fillRect(i,-17,.55,12);for(let j=-15;j<=-7;j+=2)ctx.fillRect(sport==='pickleball'?i:-4,j,sport==='pickleball'?.65:8,.55);}
 ctx.restore();ctx.fillStyle='#cf9265';ctx.fillRect(-1.7,-1,3.4,2);ctx.restore();
}
export function drawHero(ctx,x,y,character,{facing='down',stride=0,height=40,player=false,swing=0,ready=false,celebrating=false,shadow=true,seated=false,equipment=null}={}){
 const id=character.avatar||character.id,ambient=AMBIENT_NPCS.some(n=>n.id===id);

 const victory=celebrating&&atlases.victory&&premiumVictoryFrame(id);
 const child=childFrame(id,facing,stride,ready||swing>0);
 const premium=child||victory||(atlases.premium&&premiumAvatarFrame(id,facing,stride,ready||swing>0));
 const moving=stride!==0,matchPose=equipment&&extraMatchFrame(id,facing),pose=premium||matchPose||(ambient?{atlas:`ambient:${id}`,index:0,flip:facing==='left'}:heroFrame(id,facing,stride));
 const variant=[1,2].includes(character.variant)?character.variant:0;
 if(variant&&pose.atlas==='premium'&&atlases['premium'+variant])pose.atlas='premium'+variant;
 if(variant&&pose.atlas==='victory'&&atlases['victory-extra']){pose.atlas='victory-extra';pose.index=(variant-1)*2+(id==='player-f'?1:0);}
 const sheet=atlases[pose.atlas],frame=sheet?.frames[pose.index];
 if(!frame)return;
 const sprite=isZombie(character)?sheet.zombie:['player-m','player-f'].includes(id)?sheet.halloween||sheet.image:sheet.image;
 const bob=moving&&pose.atlas!=='walk'&&!premium?-Math.abs(Math.sin(stride*Math.PI))*.8:0;
 ctx.save();ctx.translate(x,y);ctx.imageSmoothingEnabled=false;
 if(shadow){
  ctx.fillStyle='#102c282e';ctx.beginPath();ctx.ellipse(height*.12,height*.04,height*.32,height*.085,.16,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#11282055';ctx.beginPath();ctx.ellipse(1,0,height*.24,height*.055,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#0b211e66';ctx.fillRect(-height*.1,-1,height*.2,2);
 }
 if(player||character.champion){ctx.strokeStyle=character.champion?'#ffe479':'#fff0a688';ctx.lineWidth=character.champion?2:1;ctx.beginPath();ctx.ellipse(0,0,height*.3,height*.09,0,0,Math.PI*2);ctx.stroke();if(character.champion){ctx.fillStyle='#ffe479';for(const [a,b] of [[-height*.34,-height*.4],[height*.29,-height*.72]]){ctx.fillRect(a,b,3,3);ctx.fillRect(a+1,b-1,1,5);}}}
 ctx.translate(0,bob);if(pose.flip)ctx.scale(-1,1);
 if(moving&&pose.atlas==='players')ctx.transform(1,0,Math.sin(stride*Math.PI)*.028,1,0,0);
 if(swing)ctx.rotate(Math.sin(swing/23*Math.PI)*.11*(facing==='up'?-1:1));
 const scale=height/sheet.frames[pose.reference??pose.index].h,w=frame.w*scale,h=frame.h*scale;
 if(seated){
  // Keep the original head/shirt, with bent legs resting in front of the bench.
  ctx.drawImage(sprite,frame.x,frame.y,frame.w,frame.h*.72,-w/2,-height*1.05,w,h*.72);
  ctx.fillStyle='#172b36';ctx.fillRect(-8,-15,16,7);
  ctx.fillStyle='#bc8257';ctx.fillRect(-8,-8,5,10);ctx.fillRect(4,-8,5,10);
  ctx.fillStyle='#f3ead0';ctx.fillRect(-10,2,8,3);ctx.fillRect(4,2,8,3);
  ctx.fillStyle='#c85740';ctx.fillRect(-10,3,7,2);ctx.fillRect(5,3,7,2);
 }else ctx.drawImage(sprite,frame.x,frame.y,frame.w,frame.h,-w/2,premium?-h:-height,w,h);
 if(!victory&&(equipment||premium))drawMatchRacket(ctx,id,facing,premium?h:height,equipment||'tennis',premium,swing);
 if(swing){ctx.strokeStyle='#fff7bb99';ctx.lineWidth=1;ctx.beginPath();ctx.arc(w*.28,-height*.4,height*.32,-1.6,.3);ctx.stroke();}
 ctx.restore();
}
export function characterPortrait(canvas,character){
 const paint=()=>{const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);drawHero(ctx,canvas.width*.43,canvas.height-10,character,{height:Math.min(canvas.height-24,canvas.width*.74),shadow:false});};
 const avatar=['player-m','player-f'].includes(character.avatar||character.id);
 if(atlases.players&&atlases.npcs&&(!avatar||atlases.premium)&&(!CHILD_ATLASES[character.id]||atlases[`child:${character.id}`]))paint();else heroesReady.then(paint).catch(()=>{});
}
export function drawWalker(ctx,x,y,character,facing='down',stride=0,scale=1,player=false){drawHero(ctx,x,y,character,{facing,stride,height:(character.height||42)*scale,player,seated:character.seated===true});}
