import * as T from './vendor/three.module.min.js';
import {moveOnGround,walkDelta,thumbstick,turnAroundHead} from './navigation.js';
import {SPORTS,sportFeed,sportReturn,stepSport} from './club-sports.js';
import {racketContact,clamp} from './physics.js';

export const PLACES = {
 entry:{name:'Entrada',pos:[26.3,0,-46.8],look:[0,1,-36]},
 courts:{name:'Tênis',pos:[0,0,6.8],look:[0,1,-10]},
 bar:{name:'Ilha Bar',pos:[-9.8,0,-24],look:[-13.2,1.5,-28]},
 beach:{name:'Beach tennis',pos:[0,0,-28.4],look:[0,1,-36.5]},
 pickle:{name:'Pickleball',pos:[17,0,12],look:[6,1,12]}
};
const stations=[
 {id:'courts',x:0,z:5.8,radius:4.7,title:'Sua próxima rebatida',action:'Treinar tênis',description:'Aula com o Renato: prepare a raquete, rebata e mire.'},
 {id:'bar',x:-12.3,z:-25,radius:4.6,title:'Uma pausa no Ilha Bar',action:'Tomar uma bebida',description:'Escolha sua bebida virtual. Hoje é por conta da casa!'},
 {id:'beach',x:0,z:-29,radius:4.4,title:'Pés na areia',action:'Jogar beach tennis',description:'Devolva antes de a bola tocar a areia. Acerte três alvos.'},
 {id:'pickle',x:16,z:12,radius:4.4,title:'Bora de pickleball?',action:'Jogar pickleball',description:'Treino de devolução: espere um quique e encontre a bola.'}
];
const drinks=[{name:'Água de coco',color:0xdceccc},{name:'Suco de laranja',color:0xf2ae36},{name:'Limonada',color:0xcee778}];
const $=id=>document.getElementById(id);

export function createClub({scene,camera,rig,renderer,canvas,teleport,startTennis,getRacket,getHand,feedback=()=>{}}){
 let mode='menu',nearest=null,message='',clock=0,feedAt=0,ball=null,returns=0,hits=0,feedIndex=0,running=false,complete=false,aim=0;
 let turnLatch=false,drag=null,lastUI='',selectedDrink=0,served=false,sipUntil=0,travelIndex=0;
 const keys=new Set(),buttons=new Set(),forward=new T.Vector3(),head=new T.Vector3(),lookEuler=new T.Euler(0,0,0,'YXZ');
 const root=new T.Group();scene.add(root);
 const ballMesh=new T.Mesh(new T.SphereGeometry(.055,16,12),new T.MeshStandardMaterial({color:0xf2bc61,roughness:.7}));root.add(ballMesh);ballMesh.visible=false;
 const ballShade=new T.Mesh(new T.CircleGeometry(.085,20),new T.MeshBasicMaterial({color:0x293b2b,transparent:true,opacity:.24,depthWrite:false}));ballShade.rotation.x=-Math.PI/2;root.add(ballShade);ballShade.visible=false;
 const target=new T.Mesh(new T.PlaneGeometry(2.5,2.4),new T.MeshBasicMaterial({color:0xe5f78f,transparent:true,opacity:.4,depthWrite:false,side:T.DoubleSide}));target.rotation.x=-Math.PI/2;target.position.y=.075;target.visible=false;root.add(target);
 const edge=new T.LineSegments(new T.EdgesGeometry(new T.PlaneGeometry(2.5,2.4)),new T.LineBasicMaterial({color:0xe8f7a0}));target.add(edge);
 const halo=new T.Mesh(new T.RingGeometry(.65,.72,40),new T.MeshBasicMaterial({color:0xe5f78f,side:T.DoubleSide,transparent:true,opacity:.7,depthWrite:false}));halo.rotation.x=-Math.PI/2;halo.position.y=.08;halo.visible=false;scene.add(halo);
 const hudCanvas=document.createElement('canvas');hudCanvas.width=1024;hudCanvas.height=320;const ctx=hudCanvas.getContext('2d');
 const hudTexture=new T.CanvasTexture(hudCanvas);hudTexture.colorSpace=T.SRGBColorSpace;
 const hud=new T.Mesh(new T.PlaneGeometry(1.5,.47),new T.MeshBasicMaterial({map:hudTexture,transparent:true,depthTest:false}));hud.renderOrder=12;hud.visible=false;scene.add(hud);
 const cup=new T.Group();scene.add(cup);cup.visible=false;
 const cupMaterial=new T.MeshStandardMaterial({color:drinks[0].color,roughness:.35});
 const cupBody=new T.Mesh(new T.CylinderGeometry(.046,.032,.13,24),cupMaterial);cup.add(cupBody);
 const lip=new T.Mesh(new T.TorusGeometry(.046,.003,6,24),new T.MeshStandardMaterial({color:0xf6f1da}));lip.rotation.x=Math.PI/2;lip.position.y=.065;cup.add(lip);
 const straw=new T.Mesh(new T.CylinderGeometry(.003,.003,.16,6),new T.MeshStandardMaterial({color:0xc3d78b}));straw.position.set(.018,.1,0);straw.rotation.z=-.1;cup.add(straw);
 let previousBall=null,previousInverse=null;

 function clearInput(){keys.clear();buttons.clear();drag=null;turnLatch=false;}
 function headPose(frame){
  const pose=frame?.getViewerPose(renderer.xr.getReferenceSpace());rig.updateMatrixWorld(true);
  if(pose){head.set(pose.transform.position.x,pose.transform.position.y,pose.transform.position.z).applyMatrix4(rig.matrixWorld);const q=pose.transform.orientation;forward.set(0,0,-1).applyQuaternion(new T.Quaternion(q.x,q.y,q.z,q.w)).applyQuaternion(rig.quaternion);}
  else{camera.getWorldPosition(head);camera.getWorldDirection(forward);}
  forward.y=0;forward.normalize();
 }
 function turn(angle){
  if(renderer.xr.isPresenting){const p=turnAroundHead(rig.position,head,angle);rig.position.x=p.x;rig.position.z=p.z;rig.rotation.y+=angle;rig.updateMatrixWorld(true);}
  else{lookEuler.setFromQuaternion(camera.quaternion,'YXZ');lookEuler.y+=angle;camera.quaternion.setFromEuler(lookEuler);}
  forward.applyAxisAngle(new T.Vector3(0,1,0),angle);
 }
 function move(input,dt){
  const d=walkDelta(forward,input,dt,renderer.xr.isPresenting?1.55:2.5),p=moveOnGround(head,d.x,d.z);
  const node=renderer.xr.isPresenting?rig:camera;node.position.x+=p.x-head.x;node.position.z+=p.z-head.z;head.x=p.x;head.z=p.z;
 }
 function clearGame(){ball=null;ballMesh.visible=ballShade.visible=target.visible=cup.visible=false;previousBall=previousInverse=null;running=false;complete=false;served=false;sipUntil=0;clearInput();}
 function menu(){clearGame();mode='menu';halo.visible=hud.visible=false;updateUI();}
 function walk(){clearGame();nearest=null;mode='walk';message='Passeie e chegue perto de uma atividade. Use E ou o botão para interagir.';updateUI();canvas.focus();}
 function visit(id){const place=PLACES[id];if(!place)return;clearInput();teleport(place.pos,place.look);if(mode!=='menu')walk();}
 function exit(){if(mode==='walk'){menu();return;}const destination=mode==='bar'?'bar':mode;walk();if(PLACES[destination])visit(destination);}
 function nextPlace(){travelIndex=(travelIndex+1)%Object.keys(PLACES).length;visit(Object.keys(PLACES)[travelIndex]);}
 function targetPosition(){target.position.set((hits%2===0?-1:1)*(mode==='beach'?1.9:1.45),.075,SPORTS[mode].landing);}
 function placeRacket(){const bat=getRacket();if(!bat||renderer.xr.isPresenting)return;const c=SPORTS[mode];const p=root.localToWorld(new T.Vector3(getHand()==='left'?-.48:.48,mode==='beach'?.88:.83,c.contact));bat.position.copy(p);bat.rotation.set(0,c.yaw-aim,0);}
 function sport(kind){
  clearGame();mode=kind;returns=hits=feedIndex=0;aim=0;message=kind==='beach'?'Aqui a bola não pode quicar: encontre a bola no ar.':'Espere um quique. A cozinha é a faixa perto da rede.';
  const c=SPORTS[kind];root.position.set(c.x,0,c.z);root.rotation.y=c.yaw;root.updateMatrixWorld(true);
  const pos=root.localToWorld(new T.Vector3(0,0,c.eye)),look=root.localToWorld(new T.Vector3(0,1.3,0));teleport(pos.toArray(),look.toArray());placeRacket();target.visible=true;targetPosition();ballMesh.material.color.setHex(kind==='beach'?0xf2b258:0xd5ee57);updateUI();
 }
 function openBar(){clearGame();mode='bar';selectedDrink=0;message='Uma pausa merecida. Escolha sua bebida virtual.';teleport(PLACES.bar.pos,PLACES.bar.look);updateUI();}
 function setDrink(index){selectedDrink=(index+drinks.length)%drinks.length;served=false;cup.visible=false;message='Bebida escolhida: '+drinks[selectedDrink].name+'.';updateUI();}
 function action(){
  if(mode==='walk'){if(!nearest)return;if(nearest.id==='courts'){menu();startTennis();}else if(nearest.id==='bar')openBar();else sport(nearest.id);return;}
  if(mode==='bar'){
   if(!served){served=true;feedback('drink');cupMaterial.color.setHex(drinks[selectedDrink].color);message='Prontinho! '+drinks[selectedDrink].name+' na mão.';}
   else{served=false;sipUntil=clock+.7;feedback('drink');message='Saúde! 😄 Bebida tomada. Bora para a próxima quadra?';}
   updateUI();return;
  }
  if(SPORTS[mode]){if(complete){sport(mode);return;}running=!running;if(running&&!ball?.active)feedAt=clock+1.4;message=running?'Prepare a raquete. A bola já vem.':'Treino pausado. Continue quando quiser.';updateUI();}
 }
 function setAim(value){if(!SPORTS[mode])return;aim=value;placeRacket();message=aim<0?'Mire no lado esquerdo.':aim>0?'Mire no lado direito.':'Mira no centro.';updateUI();}
 function updateUI(){
  const active=mode!=='menu',playing=Boolean(SPORTS[mode]);$('experience').classList.toggle('club-active',active);$('experience').classList.toggle('club-walking',mode==='walk');$('club-panel').hidden=!active;$('walk-controls').hidden=mode!=='walk';$('club-drinks').hidden=mode!=='bar';$('club-aim').hidden=!playing;$('club-exit').textContent=mode==='walk'?'Voltar à apresentação':'Voltar ao passeio';
  const title=mode==='walk'?(nearest?.title||'O clube é seu.') : mode==='bar'?'Um brinde ao Ilha.':SPORTS[mode]?.name||'';
  const detail=mode==='walk'?(nearest?.description||'WASD para andar · arraste a cena para olhar. As setas da tela também funcionam.'):mode==='bar'?'Bebidas virtuais, só para entrar no clima do clube.':mode==='beach'?'Sem quique na areia. Devolva sobre a rede e acerte os alvos alternados.':'Espere um quique e devolva para os alvos. Na partida, a cozinha limita o voleio perto da rede.';
  const label=mode==='walk'?(nearest?.action||'Aproxime-se de uma atividade'):mode==='bar'?(served?'Tomar bebida':'Pedir '+drinks[selectedDrink].name):complete?'Jogar de novo':running?'Pausar treino':ball?'Continuar treino':'Começar treino';
  $('club-title').textContent=title;$('club-description').textContent=detail;$('club-status').textContent=message;$('club-action').textContent=label;$('club-action').disabled=mode==='walk'&&!nearest;$('club-score').hidden=!playing;$('club-score').textContent=`Devoluções: ${returns} · Alvos: ${hits}/3`;
  document.querySelectorAll('[data-drink]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.drink)===selectedDrink)));
  document.querySelectorAll('[data-club-aim]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.clubAim)===aim)));
  const hint=mode==='walk'?'Esquerdo: andar · Direito: girar · Segurar: próximo lugar':mode==='bar'?'Direito: escolher bebida · Gatilho: pedir / tomar · Segurar: sair':'Gatilho: começar / pausar · Segurar: voltar ao passeio';
  const key=[title,label,message,hits,returns].join('|');if(key===lastUI)return;lastUI=key;
  ctx.clearRect(0,0,1024,320);ctx.fillStyle='rgba(245,244,228,.95)';ctx.beginPath();ctx.roundRect(0,0,1024,320,25);ctx.fill();ctx.fillStyle='#244536';ctx.font='700 39px sans-serif';ctx.fillText(title,32,58);ctx.font='26px sans-serif';ctx.fillText(playing?`Devoluções: ${returns}    Alvos: ${hits}/3`:mode==='bar'?drinks[selectedDrink].name:'PASSEIO LIVRE',32,104);ctx.font='23px sans-serif';ctx.fillText(hint,32,157);ctx.fillStyle='#214734';ctx.fillRect(24,201,976,91);ctx.fillStyle='#f3f7da';ctx.font='600 29px sans-serif';ctx.fillText('Gatilho: '+label,44,256);hudTexture.needsUpdate=true;
 }
 function finish(result){
  if(result.type==='in'){returns++;if(Math.abs(result.x-target.position.x)<1.3&&Math.abs(result.z-target.position.z)<1.25){hits++;feedback('point');message='No alvo! Boa devolução.';}else message='Dentro! Agora tente o lado iluminado.';}
  else message=result.type==='net'?'Na rede. Encontre a bola um pouco mais à frente.':mode==='beach'?'A bola tocou a areia. Tente rebater ainda no ar.':'Espere o primeiro quique e encontre a próxima bola.';
  if(hits>=3){complete=true;running=false;message='Desafio concluído! Três alvos, boa!';}else targetPosition();feedAt=clock+2;updateUI();
 }
 function updateGame(dt){
  if(!running)return;
  if(!ball?.active&&clock>=feedAt){ball=sportFeed(mode,getHand()==='left'?-1:1,feedIndex++);ballMesh.visible=ballShade.visible=true;previousBall=previousInverse=null;}
  if(!ball?.active)return;
  const before={...ball.p},steps=Math.ceil(dt*180);
  for(let i=0;i<steps&&ball.active;i++){const e=stepSport(ball,mode,dt/steps);if(e?.type==='bounce'){feedback('bounce');message='Agora! Rebata depois do quique.';updateUI();}else if(e)finish(e);}
  const bat=getRacket();if(ball.active&&!ball.hit&&bat&&ball.bounces===(SPORTS[mode].bounce?1:0)){
   bat.updateWorldMatrix(true,true);const inv=bat.userData.head.matrixWorld.clone().invert();
   const a=root.localToWorld(new T.Vector3(previousBall?.x??before.x,previousBall?.y??before.y,previousBall?.z??before.z)).applyMatrix4(previousInverse||inv);
   const b=root.localToWorld(new T.Vector3(ball.p.x,ball.p.y,ball.p.z)).applyMatrix4(inv);
   if(racketContact(a,b)){let angle=aim;if(renderer.xr.isPresenting){const normal=new T.Vector3(0,0,-1).applyQuaternion(bat.getWorldQuaternion(new T.Quaternion())).applyAxisAngle(new T.Vector3(0,1,0),-SPORTS[mode].yaw);if(normal.z>0)normal.negate();angle=clamp(normal.x/Math.max(.3,-normal.z),-.8,.8);}sportReturn(ball,mode,angle*5.2);feedback('hit');message='Boa! Veja onde a bola cai.';updateUI();}
   previousInverse=inv;
  }
  previousBall={...ball.p};ballMesh.position.set(ball.p.x,ball.p.y,ball.p.z);ballShade.position.set(ball.p.x,.07,ball.p.z);ballMesh.visible=ballShade.visible=ball.active;
 }
 function update(dt,frame){
  if(mode==='menu'){hud.visible=halo.visible=false;return;}
  const session=renderer.xr.getSession();if(document.hidden||$('help-dialog').open||(session&&session.visibilityState!=='visible')){clearInput();return;}
  clock+=dt;headPose(frame);const sources=Array.from(session?.inputSources||[]),left=thumbstick(sources.find(s=>s.handedness==='left')),right=thumbstick(sources.find(s=>s.handedness==='right'));
  if(Math.abs(right.x)<.25)turnLatch=false;
  if(mode==='walk'){
   if(Math.abs(right.x)>.6&&!turnLatch){turn(-Math.sign(right.x)*Math.PI/6);turnLatch=true;}
   if(keys.has('ArrowLeft'))turn(dt*1.3);if(keys.has('ArrowRight'))turn(-dt*1.3);
   const input={x:left.x+Number(keys.has('KeyD')||buttons.has('right'))-Number(keys.has('KeyA')||buttons.has('left')),y:left.y+Number(keys.has('KeyW')||keys.has('ArrowUp')||buttons.has('forward'))-Number(keys.has('KeyS')||keys.has('ArrowDown')||buttons.has('back'))};move(input,dt);
   const next=stations.find(s=>Math.hypot(s.x-head.x,s.z-head.z)<s.radius)||null;if(next!==nearest){nearest=next;message=next?'Você chegou. Use E, o gatilho ou o botão para começar.':'Passeie pelo clube ou escolha um destino no alto da tela.';updateUI();}
   halo.visible=Boolean(nearest);if(nearest)halo.position.set(nearest.x,.08,nearest.z);
  }else{halo.visible=false;if(mode==='bar'&&Math.abs(right.x)>.6&&!turnLatch){setDrink(selectedDrink+Math.sign(right.x));turnLatch=true;}if(SPORTS[mode])updateGame(dt);}
  hud.visible=renderer.xr.isPresenting;hud.position.copy(head).addScaledVector(forward,1.8);hud.position.y-=.63;hud.lookAt(head);
  cup.visible=mode==='bar'&&(served||sipUntil>clock);if(cup.visible){
   const bat=getRacket();if(renderer.xr.isPresenting&&bat){bat.getWorldPosition(cup.position);bat.getWorldQuaternion(cup.quaternion);cup.position.y+=.12;}
   else{camera.updateMatrixWorld();cup.position.set(.32,sipUntil>clock?-.12:-.34,sipUntil>clock?-.42:-.7).applyMatrix4(camera.matrixWorld);cup.quaternion.copy(camera.quaternion);cup.rotateZ(-.12);}
  }
 }
 function pointerRacket(event){
  if(!SPORTS[mode]||renderer.xr.isPresenting)return;const bat=getRacket();if(!bat)return;
  const rect=canvas.getBoundingClientRect(),p=new T.Vector3((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1,.5).unproject(camera);
  const localCamera=root.worldToLocal(camera.position.clone()),localPoint=root.worldToLocal(p),dir=localPoint.sub(localCamera).normalize(),t=(SPORTS[mode].contact-localCamera.z)/dir.z;
  const hit=localCamera.addScaledVector(dir,t);hit.x=clamp(hit.x,-1.25,1.25);hit.y=clamp(hit.y-.4,-.05,1.7);bat.position.copy(root.localToWorld(hit));bat.rotation.set(0,SPORTS[mode].yaw-aim,0);
 }
 $('explore').onclick=walk;$('club-action').onclick=action;$('club-exit').onclick=exit;
 document.querySelectorAll('[data-drink]').forEach(b=>b.onclick=()=>setDrink(Number(b.dataset.drink)));
 document.querySelectorAll('[data-club-aim]').forEach(b=>b.onclick=()=>setAim(Number(b.dataset.clubAim)));
 document.querySelectorAll('[data-turn]').forEach(b=>b.onclick=()=>{headPose();turn(Number(b.dataset.turn)*Math.PI/6);});
 for(const b of document.querySelectorAll('[data-walk]')){
  b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);buttons.add(b.dataset.walk);});
  const release=()=>buttons.delete(b.dataset.walk);b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);
  b.addEventListener('click',e=>{if(e.detail===0){headPose();move({x:b.dataset.walk==='left'?-1:b.dataset.walk==='right'?1:0,y:b.dataset.walk==='forward'?1:b.dataset.walk==='back'?-1:0},.25);}});
 }
 canvas.addEventListener('pointerdown',e=>{if(mode==='walk'){canvas.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY};}});
 canvas.addEventListener('pointermove',e=>{if(mode==='walk'&&drag?.id===e.pointerId&&!renderer.xr.isPresenting){lookEuler.setFromQuaternion(camera.quaternion,'YXZ');lookEuler.y-=(e.clientX-drag.x)*.004;lookEuler.x=clamp(lookEuler.x-(e.clientY-drag.y)*.003,-.9,.9);camera.quaternion.setFromEuler(lookEuler);drag.x=e.clientX;drag.y=e.clientY;}});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>drag=null);
 window.addEventListener('keydown',e=>{
  if(mode==='menu'||$('help-dialog').open||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
  if(mode==='walk'&&['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)){e.preventDefault();keys.add(e.code);}
  if((e.code==='KeyE'||(e.code==='Space'&&document.activeElement?.tagName!=='BUTTON'))&&!e.repeat){e.preventDefault();action();}
  if(e.code==='Escape'){e.preventDefault();exit();}
  if(SPORTS[mode]&&['KeyA','KeyD'].includes(e.code)){e.preventDefault();setAim(e.code==='KeyA'?-.36:.36);}
 });
 function suspend(){clearInput();if(SPORTS[mode]&&running){running=false;message='Treino pausado. Continue quando quiser.';updateUI();}}
 window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{if(!renderer.xr.isPresenting)suspend();});document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();});
 return {get active(){return mode!=='menu';},get playing(){return Boolean(SPORTS[mode]);},get mode(){return mode;},menu,walk,visit,exit,nextPlace,action,update,pointerRacket,clearInput};
}
