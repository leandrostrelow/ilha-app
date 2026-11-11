import * as T from './vendor/three.module.min.js';
import {buildWorld,makeRacket,makeCoach,board} from './world.js';
import {makeFeed,advanceBall,racketContact,returnBall,clamp} from './physics.js';
import {alignPlayer} from './xr-placement.js';

const $=id=>document.getElementById(id),canvas=$('scene');
let renderer;
try{renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});}catch(e){$('loading').hidden=true;$('fatal').hidden=false;$('fatal-message').textContent='Este navegador não disponibilizou WebGL 2. Abra no navegador do Quest ou em outro navegador atualizado.';throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local-floor');
const scene=new T.Scene();scene.background=new T.Color(0xc4d9d7);scene.fog=new T.Fog(0xc4d9d7,65,170);
scene.add(new T.HemisphereLight(0xeef4e7,0x8d805d,1.5));const sun=new T.DirectionalLight(0xffedcd,2.1);sun.position.set(-25,40,15);scene.add(sun);renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-50,right:50,top:45,bottom:-65,near:1,far:140});sun.shadow.bias=-.001;sun.shadow.normalBias=.06;
const rig=new T.Group();scene.add(rig);const camera=new T.PerspectiveCamera(58,1,.05,180);rig.add(camera);
const world=buildWorld(scene),training=new T.Group();scene.add(training);const coach=makeCoach(training);
const racket=makeRacket();scene.add(racket);racket.position.set(.48,.58,-.8);
const ballMesh=new T.Mesh(new T.SphereGeometry(.055,14,10),new T.MeshStandardMaterial({color:0xd7f057,emissive:0x6f7914,emissiveIntensity:.13,roughness:.8}));training.add(ballMesh);ballMesh.visible=false;
const seams=new T.Line(new T.BufferGeometry().setFromPoints(Array.from({length:49},(_,i)=>{const a=i*Math.PI/24;return new T.Vector3(Math.cos(a)*.0555,Math.sin(a)*.0555,0);})),new T.LineBasicMaterial({color:0xf5f6cb}));ballMesh.add(seams);
const ballShadow=new T.Mesh(new T.CircleGeometry(.095,20),new T.MeshBasicMaterial({color:0x343e25,transparent:true,opacity:.24,depthWrite:false}));ballShadow.rotation.x=-Math.PI/2;ballShadow.visible=false;training.add(ballShadow);
const landing=new T.Mesh(new T.RingGeometry(.3,.35,32),new T.MeshBasicMaterial({color:0xf3e5a7,transparent:true,opacity:.6,side:T.DoubleSide,depthWrite:false}));landing.rotation.x=-Math.PI/2;landing.position.set(.48,.065,-2.5);landing.visible=false;training.add(landing);
const zone=new T.Mesh(new T.RingGeometry(.55,.59,48),new T.MeshBasicMaterial({color:0xdced8f,transparent:true,opacity:.7,side:T.DoubleSide}));zone.rotation.x=-Math.PI/2;zone.position.set(0,.065,.6);zone.visible=false;training.add(zone);
const target=new T.Mesh(new T.PlaneGeometry(3.2,3.4),new T.MeshBasicMaterial({color:0xdaed8d,transparent:true,opacity:.35,side:T.DoubleSide,depthWrite:false}));target.rotation.x=-Math.PI/2;target.position.set(0,.068,-17);target.visible=false;training.add(target);
const targetEdge=new T.LineSegments(new T.EdgesGeometry(new T.PlaneGeometry(3.2,3.4)),new T.LineBasicMaterial({color:0xe5f0a6}));target.add(targetEdge);
const targetBoard=board(training,'DEVOLVA AQUI','POR CIMA DA REDE',3,.72,0,1,-18.8);targetBoard.visible=false;
const prepareRing=new T.Mesh(new T.TorusGeometry(.23,.012,6,40),new T.MeshBasicMaterial({color:0xd9ed8d,transparent:true,opacity:.65}));prepareRing.position.set(.48,1,-.8);prepareRing.visible=false;training.add(prepareRing);
const gateway=new T.Group();scene.add(gateway);const marker=new T.Mesh(new T.RingGeometry(.65,.8,40),new T.MeshBasicMaterial({color:0xe2f39b,side:T.DoubleSide}));marker.rotation.x=-Math.PI/2;gateway.add(marker);gateway.position.set(0,.08,3.3);board(gateway,'SUA PRIMEIRA AULA','ENTRE NA QUADRA 01',3.3,.85,0,1.8,0);

const hudCanvas=document.createElement('canvas');hudCanvas.width=1400;hudCanvas.height=560;const hc=hudCanvas.getContext('2d'),hudTexture=new T.CanvasTexture(hudCanvas);hudTexture.colorSpace=T.SRGBColorSpace;
const hud=new T.Mesh(new T.PlaneGeometry(2.5,1),new T.MeshBasicMaterial({map:hudTexture,transparent:true,depthTest:false}));hud.renderOrder=10;hud.visible=false;scene.add(hud);hud.position.set(0,2.5,-3.5);

let stage=0,hits=0,totalHits=0,totalTargets=0,feedIndex=0,attempts=0,ball=null,nextFeed=0,paused=false,started=false,stageComplete=false,readyTime=0,hand='right',xrMode=null,pendingPlacement=null,sessionRequest=false,simTime=0;
let aim=0,feedback='Sem pressa. Vamos começar pelo começo.',lastHud=0,soundOn=false,audioContext=null,lastHitTime=-10,previousRacket=null,previousHead=null,strokeVelocity=new T.Vector3();
const inputControllers=[],v1=new T.Vector3(),v2=new T.Vector3(),inverse=new T.Matrix4(),previousMatrix=new T.Matrix4(),q1=new T.Quaternion();
const lessons=[
 {chapter:'01 / BEM-VINDO AO CLUBE',title:'Seu primeiro ponto\ncomeça aqui.',desc:'Entre na quadra do Ilha Tênis. O Renato vai guiar você, uma bola de cada vez.',action:'Entrar na quadra',xr:'Gatilho para entrar na quadra'},
 {chapter:'02 / POSIÇÃO DE ESPERA',title:'Prepare a raquete.',desc:'Olhe para a rede e deixe a raquete à frente do corpo, perto da cintura. Encaixe a cabeça da raquete no aro iluminado por um instante.',action:'Centralizar raquete',xr:'Encaixe a raquete no aro. Segurar: reposicionar'},
 {chapter:'03 / SUA PRIMEIRA REBATIDA',title:'Espere o quique.\nEncontre a bola.',desc:'A bola vem devagar para o lado da sua raquete. Depois do primeiro quique, leve a raquete até ela. Faça 3 devoluções dentro da quadra.',action:'Começar as bolas',xr:'Gatilho para começar · Movimento para rebater'},
 {chapter:'04 / DIREÇÃO DA BOLA',title:'Agora, mire\nno espaço verde.',desc:'O alvo alterna entre esquerda e direita. Aponte levemente a face da raquete para o lado desejado. No computador, use os botões de mira ou A/D para escolher a direção.',action:'Começar o desafio',xr:'Gatilho para começar · Incline a face para mirar'},
 {chapter:'AULA CONCLUÍDA',title:'Seu primeiro treino.\nSeu próximo ponto.',desc:'Você preparou a raquete, rebateu depois do quique e direcionou a devolução. A bola deve cruzar a rede e cair dentro das linhas. Agora é continuar praticando!',action:'Treinar livremente',xr:'Gatilho para treinar livremente'},
 {chapter:'TREINO LIVRE',title:'Mais uma bola?',desc:'Continue no seu ritmo. Procure o contato à frente do corpo e acompanhe a bola até ela cruzar a rede. Aqui, o treino não tem fim nem cronômetro.',action:'Pausar o treino',xr:'Gatilho pausa ou continua · Segurar reposiciona'}
];

function tell(message){feedback=message;$('feedback').textContent=message;paintHud();}
function updateUI(){
 const l=lessons[stage];$('chapter').textContent=l.chapter;$('title').replaceChildren(...l.title.split('\n').flatMap((s,i)=>i?[document.createElement('br'),document.createTextNode(s)]:[document.createTextNode(s)]));$('description').textContent=l.desc;
 $('action').innerHTML=`${stageComplete?'Continuar a aula':started&&stage>=2&&stage!==4?(paused?'Continuar treino':'Pausar treino'):l.action} <span>↗</span>`;
 $('restart').hidden=stage===0;$('aim-controls').hidden=stage!==3&&stage!==5;$('experience').classList.toggle('playing',stage>0);$('score').hidden=stage<2;$('pause').textContent=paused?'Continuar':'Pausar';$('pause').disabled=!started||stageComplete||stage===4;$('progress-box').hidden=stage===0||stage>=4;
 $('goal-label').textContent=stage===1?'Raquete preparada':stage===2?'Devoluções dentro':'Acertos no alvo';$('goal-value').textContent=stage===1?`${Math.min(100,Math.round(readyTime/1.1*100))}%`:`${hits} / 3`;$('progress-fill').style.width=`${stage===1?Math.min(100,readyTime/1.1*100):hits/3*100}%`;
 $('returns').textContent=String(totalHits).padStart(2,'0');$('targets').textContent=String(totalTargets).padStart(2,'0');$('feedback').textContent=feedback;
 [...$('journey').children].forEach((li,i)=>{li.className=i===Math.min(stage,3)?'current':i<stage?'done':'';});
 $('club-tour').hidden=stage!==0;gateway.visible=stage===0;zone.visible=stage>0;prepareRing.visible=stage===1;target.visible=targetBoard.visible=stage===3||stage===5;coach.visible=xrMode!=='immersive-ar';paintHud();
}
function wrapText(text,x,y,maxWidth,lineHeight,font){hc.font=font;let row='',yy=y;for(const word of text.split(' ')){const test=row+word+' ';if(hc.measureText(test).width>maxWidth&&row){hc.fillText(row,x,yy);row=word+' ';yy+=lineHeight;}else row=test;}hc.fillText(row,x,yy);return yy;}
function paintHud(){
 hc.clearRect(0,0,1400,560);hc.fillStyle='rgba(246,244,229,.96)';hc.beginPath();hc.roundRect(0,0,1400,560,35);hc.fill();hc.fillStyle='#638048';hc.font='600 28px sans-serif';hc.fillText(lessons[stage].chapter,55,57);hc.fillStyle='#203d2d';hc.font='700 55px sans-serif';hc.fillText(lessons[stage].title.replace('\n',' '),55,130);
 const short=stage===0?'Bem-vindo ao Ilha Tênis. Aperte o gatilho para entrar na quadra 01.':stage===1?'Encaixe a raquete no aro, à frente da cintura.':stage===2?'Espere um quique e rebata. Devolva por cima da rede, dentro das linhas.':stage===3?'Incline a face da raquete para o lado do alvo verde.':lessons[stage].desc;
 wrapText(short,55,195,1280,43,'34px sans-serif');hc.fillStyle='#537343';wrapText(paused?'PAUSADO · Gatilho para continuar':feedback,55,320,1280,40,'600 32px sans-serif');
 hc.fillStyle='#1b402d';hc.fillRect(40,423,1320,95);hc.fillStyle='#eff3d8';hc.font='29px sans-serif';hc.fillText(stageComplete?'Boa! Gatilho para a próxima parte.':started&&stage>=2?'Rebata com o movimento · Gatilho pausa · Segurar reposiciona':lessons[stage].xr,65,480);
 if(stage===2||stage===3){hc.textAlign='right';hc.font='700 30px sans-serif';hc.fillText(`${hits}/3`,1300,65);hc.textAlign='left';}hudTexture.needsUpdate=true;
}
function sound(freq=450,duration=.08,volume=.035){if(!soundOn)return;try{audioContext??=new(window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')audioContext.resume();const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type='sine';osc.frequency.setValueAtTime(freq,audioContext.currentTime);osc.frequency.exponentialRampToValueAtTime(freq*.65,audioContext.currentTime+duration);gain.gain.setValueAtTime(volume,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+duration);osc.connect(gain).connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+duration);}catch{}}
function haptic(){const source=inputControllers.find(c=>c.source?.handedness===hand)?.source;try{source?.gamepad?.hapticActuators?.[0]?.pulse(.32,45)?.catch(()=>{});}catch{}}
function setStage(value){stage=value;hits=0;started=false;stageComplete=false;paused=false;readyTime=0;ball=null;ballMesh.visible=ballShadow.visible=landing.visible=false;nextFeed=0;previousRacket=null;if(stage===3)setTarget();if(stage===5){started=true;nextFeed=simTime+2;}tell(stage===1?'No computador, mova o mouse na cena até encaixar a raquete.':stage===2?'Primeiro, olhe a trajetória. Depois, encontre a bola.':stage===3?'O alvo verde indica onde a bola deve cair.':stage===4?'Muito bem! Você completou os primeiros passos.':'Sem pressa. Cada bola é uma nova chance.');updateUI();}
function setTarget(){target.position.x=hits%2===0?-2.1:2.1;targetBoard.position.x=target.position.x;}
const clubViews={entry:{pos:[26.3,0,-46.8],look:[0,1,-36]},courts:{pos:[19,0,6.8],look:[4,1,-15]},bar:{pos:[-9.8,0,-22],look:[-13.2,1.5,-28]}};
let clubView='entry';
function placePlayer(arrival=false){
 const view=clubViews[clubView],pos=arrival?new T.Vector3(...view.pos):new T.Vector3(0,0,.75),look=arrival?new T.Vector3(...view.look):new T.Vector3(0,1.3,-10);
 if(renderer.xr.isPresenting){pendingPlacement={pos,look};}
 else {rig.position.set(0,0,0);rig.rotation.set(0,0,0);camera.position.copy(pos);camera.position.y=1.65;camera.lookAt(look);}
 previousRacket=null;previousHead=null;racket.position.set(hand==='right'?.48:-.48,.58,-.8);racket.rotation.set(0,0,0);aim=0;
}
function placeXR(frame){
 const pose=frame.getViewerPose(renderer.xr.getReferenceSpace());if(!pose)return;
 const {pos,look}=pendingPlacement,localHead=pose.transform.position,o=pose.transform.orientation;
 v2.set(0,0,-1).applyQuaternion(new T.Quaternion(o.x,o.y,o.z,o.w));
 const placement=alignPlayer(localHead,Math.atan2(-v2.x,-v2.z),pos,Math.atan2(pos.x-look.x,pos.z-look.z));
 rig.rotation.set(0,placement.yaw,0);rig.position.set(placement.x,0,placement.z);rig.updateMatrixWorld(true);pendingPlacement=null;const forward=look.clone().sub(pos);forward.y=0;forward.normalize();hud.position.copy(pos).addScaledVector(forward,3.5);hud.position.y=Math.max(1.9,localHead.y+.6);hud.lookAt(pos.x,hud.position.y,pos.z);previousRacket=null;previousHead=null;
}
function transition(fn){if(renderer.xr.isPresenting){fn();return;}$('fade').classList.add('on');setTimeout(()=>{fn();$('fade').classList.remove('on');},170);}
// User actions are shared by the accessible DOM buttons and physical triggers.
function primary(){
 if(stage===0){transition(()=>{placePlayer();setStage(1);});return;}
 if(stage===1){if(renderer.xr.isPresenting){placePlayer();tell('Treino à sua frente. Encaixe a raquete no aro.');}else{racket.position.set(hand==='right'?.48:-.48,.58,-.8);tell('Raquete centralizada. Segure um instante.');}return;}
 if(stageComplete){setStage(stage+1);return;}
 if(stage===4){setStage(5);return;}
 if(!started){started=true;nextFeed=simTime+2;tell('Prepare a raquete. A primeira bola já vem.');updateUI();return;}
 togglePause();
}
function togglePause(){if(stage<2||stage===4||stageComplete||!started)return;paused=!paused;tell(paused?'Aula pausada. Continue quando estiver pronto.':'Vamos continuar. Acompanhe a bola.');previousRacket=null;updateUI();}
function completeAttempt(result){
 const good=result.type==='in';
 if(good){totalHits++;const inTarget=Math.abs(result.x-target.position.x)<=1.6+.055&&Math.abs(result.z-target.position.z)<=1.7+.055;if(stage===2||stage===5)hits++;if((stage===3||stage===5)&&inTarget){totalTargets++;if(stage===3)hits++;sound(880,.17);tell('No alvo! Você direcionou a devolução.');}else{sound(610,.11);tell(stage===3?'Dentro da quadra! Agora tente o lado do alvo verde.':'Boa! A bola cruzou a rede e caiu dentro.');}}
 else tell(result.type==='net'?'A bola ficou na rede. Busque contato à frente do corpo.':result.type==='out'?'Foi para fora. Tente apontar mais para o centro.':'Tudo bem! Espere um quique e encontre a próxima bola.');
 nextFeed=simTime+2.2;landing.visible=false;
 if((stage===2||stage===3)&&hits>=3){stageComplete=true;started=false;nextFeed=Infinity;tell(stage===2?'Três devoluções! Vamos aprender a direcionar.':'Você completou o desafio de direção!');}
 else if(stage===3&&good)setTarget();updateUI();
}

for(let i=0;i<2;i++){
 const controller=renderer.xr.getController(i),grip=renderer.xr.getControllerGrip(i),bat=makeRacket();grip.add(bat);rig.add(controller,grip);const item={controller,grip,bat,source:null};inputControllers.push(item);bat.visible=false;
 controller.addEventListener('connected',e=>{item.source=e.data;bat.visible=e.data.handedness===hand;previousRacket=null;});controller.addEventListener('disconnected',()=>{item.source=null;bat.visible=false;previousRacket=null;});
 controller.addEventListener('selectstart',()=>{if(!item.source||item.source.handedness===hand)primary();});
 controller.addEventListener('squeezestart',()=>{if(item.source?.handedness===hand){placePlayer(stage===0);if(started&&!paused)togglePause();tell('Posição ajustada. Gatilho para continuar.');}});
}
function activeRacket(){if(!renderer.xr.isPresenting)return racket;return inputControllers.find(c=>c.source?.handedness===hand)?.bat??null;}
function changeHand(h){hand=h;document.querySelectorAll('[data-hand]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.hand===h)));for(const c of inputControllers)c.bat.visible=c.source?.handedness===h;prepareRing.position.x=h==='right'?.48:-.48;racket.position.x=prepareRing.position.x;previousRacket=null;previousHead=null;if(ball?.active){ball.active=false;ballMesh.visible=false;ballShadow.visible=false;nextFeed=simTime+2;}tell(`Raquete na mão ${h==='right'?'direita':'esquerda'}.`);}
$('restart').onclick=()=>transition(()=>{setStage(0);placePlayer(true);});document.querySelectorAll('[data-aim]').forEach(b=>b.onclick=()=>{aim=Number(b.dataset.aim);racket.rotation.y=-aim;document.querySelectorAll('[data-aim]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));tell(`Mira: ${aim===0?'centro':aim<0?'esquerda':'direita'}.`);});$('action').onclick=primary;$('pause').onclick=togglePause;document.querySelectorAll('[data-hand]').forEach(b=>b.onclick=()=>changeHand(b.dataset.hand));
$('sound').onclick=()=>{soundOn=!soundOn;$('sound').textContent=soundOn?'Som ligado':'Som desligado';$('sound').setAttribute('aria-pressed',String(soundOn));sound();};
$('help').onclick=()=>{if(started&&!paused)togglePause();$('help-dialog').showModal();};$('close-help').onclick=()=>$('help-dialog').close();
let pointerDown=false;
function moveRacket(event){if(renderer.xr.isPresenting||stage===0||stage===4)return;const rect=canvas.getBoundingClientRect();const p=new T.Vector3((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1,.5).unproject(camera);const dir=p.sub(camera.position).normalize(),t=(-.8-camera.position.z)/dir.z;const hit=camera.position.clone().addScaledVector(dir,t);racket.position.set(clamp(hit.x,-1.25,1.25),clamp(hit.y-.4,-.05,1.5),-.8);}
canvas.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'||pointerDown)moveRacket(e);});canvas.addEventListener('pointerdown',e=>{pointerDown=true;canvas.setPointerCapture(e.pointerId);moveRacket(e);canvas.focus();});canvas.addEventListener('pointerup',()=>pointerDown=false);canvas.addEventListener('pointercancel',()=>pointerDown=false);
window.addEventListener('keydown',e=>{if($('help-dialog').open||['INPUT','SELECT'].includes(document.activeElement?.tagName))return;if(e.code==='Space'){if(document.activeElement?.tagName==='BUTTON')return;e.preventDefault();primary();}if(e.code==='KeyR'&&stage>0){placePlayer();tell('Raquete centralizada.');}if(['ArrowLeft','KeyA','ArrowRight','KeyD'].includes(e.code)){e.preventDefault();aim=clamp(aim+(['ArrowLeft','KeyA'].includes(e.code)?-.12:.12),-.55,.55);racket.rotation.y=-aim;tell(`Mira: ${Math.abs(aim)<.08?'centro':aim<0?'esquerda':'direita'}.`);}if(e.code==='Escape'&&started&&!paused)togglePause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&started&&!paused)togglePause();});window.addEventListener('blur',()=>{if(!renderer.xr.isPresenting&&started&&!paused)togglePause();});

async function enterXR(mode){
 if(sessionRequest||renderer.xr.isPresenting)return;sessionRequest=true;let session;
 try{session=await navigator.xr.requestSession(mode,{requiredFeatures:['local-floor'],optionalFeatures:['bounded-floor']});xrMode=mode;await renderer.xr.setSession(session);renderer.xr.setFoveation(1);$('experience').classList.add('xr-active');camera.position.set(0,0,0);camera.rotation.set(0,0,0);racket.visible=false;hud.visible=true;world.visible=mode!=='immersive-ar';scene.background=mode==='immersive-ar'?null:new T.Color(0xc4d9d7);scene.fog=mode==='immersive-ar'?null:new T.Fog(0xc4d9d7,65,170);renderer.setClearAlpha(mode==='immersive-ar'?0:1);setStage(mode==='immersive-ar'?1:0);placePlayer(mode!=='immersive-ar');
  session.addEventListener('visibilitychange',()=>{if(session.visibilityState!=='visible'&&started&&!paused)togglePause();});
 }catch(e){if(session){try{await session.end();}catch{}}tell(`Não foi possível entrar ${mode==='immersive-ar'?'em realidade mista':'em VR'}. ${e.name==='NotAllowedError'?'Autorize a sessão no navegador do Quest.':'Tente abrir o link diretamente no navegador do Quest.'}`);}
 finally{sessionRequest=false;}
}
renderer.xr.addEventListener('sessionend',()=>{xrMode=null;pendingPlacement=null;hud.visible=false;racket.visible=true;world.visible=true;scene.background=new T.Color(0xc4d9d7);scene.fog=new T.Fog(0xc4d9d7,65,170);renderer.setClearAlpha(1);$('experience').classList.remove('xr-active');camera.fov=58;resize();setStage(0);placePlayer(true);updateUI();});
$('vr').onclick=()=>enterXR('immersive-vr');$('mr').onclick=()=>enterXR('immersive-ar');
async function detectXR(){
 if(!isSecureContext){$('vr').textContent='Quest: abra o link HTTPS';$('xr-note').textContent='Para VR, abra o link publicado com HTTPS no navegador do Quest.';return;}
 if(!navigator.xr){$('vr').textContent='Abra no Quest para jogar em VR';return;}
 try{const [vr,ar]=await Promise.all([navigator.xr.isSessionSupported('immersive-vr'),navigator.xr.isSessionSupported('immersive-ar')]);$('vr').disabled=!vr;$('vr').textContent=vr?'Entrar em VR no Quest':'VR indisponível neste navegador';$('mr').hidden=!ar;if(vr)$('xr-note').textContent='No Quest, use os controles. Escolha a mão da raquete abaixo.';}catch{$('vr').textContent='VR indisponível neste navegador';}
}
function resize(){const r=$('experience').getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}window.addEventListener('resize',resize);resize();
placePlayer(true);updateUI();detectXR();$('loading').hidden=true;

let lastTime=0;
renderer.setAnimationLoop((time,frame)=>{
 const dt=Math.min((time-lastTime)/1000||.016,.04);lastTime=time;if(pendingPlacement&&frame)placeXR(frame);
 const bat=activeRacket();if(bat){bat.updateWorldMatrix(true,true);const head=bat.userData.head;head.getWorldPosition(v1);if(previousHead)strokeVelocity.copy(v1).sub(previousHead).divideScalar(Math.max(dt,.001));else strokeVelocity.set(0,0,0);previousHead=v1.clone();
  if(stage===1){const within=Math.abs(v1.x-prepareRing.position.x)<.25&&Math.abs(v1.y-prepareRing.position.y)<.26&&Math.abs(v1.z-prepareRing.position.z)<.35;readyTime=within?readyTime+dt:Math.max(0,readyTime-dt*1.5);prepareRing.material.color.setHex(within?0xffffff:0xd9ed8d);if(readyTime>=1.1){setStage(2);sound(640,.14);}else if(time-lastHud>120){updateUI();lastHud=time;}}
 }
 if(!paused){simTime+=dt;
  if(started&&!stageComplete&&stage>=2&&stage!==4&&(!ball||!ball.active)&&simTime>=nextFeed){ball=makeFeed(hand==='right'?1:-1,feedIndex++);attempts++;landing.position.x=ball.p.x;landing.visible=true;ballMesh.visible=ballShadow.visible=true;tell('Olhe a bola. Espere o quique.');}
  if(ball?.active){
   const steps=Math.ceil(dt/(1/180)),step=dt/steps;let previousBall={...ball.p};
   for(let i=0;i<steps&&ball.active;i++){previousBall={...ball.p};const e=advanceBall(ball,step);if(e?.type==='bounce'){sound(230,.06,.02);tell('Agora: encontre a bola à frente do corpo.');}else if(e){completeAttempt(e);break;}}
   if(ball.active&&!ball.hit&&ball.bounces===1&&bat&&simTime-lastHitTime>.3){
    bat.userData.head.updateWorldMatrix(true,false);inverse.copy(bat.userData.head.matrixWorld).invert();
    const end=new T.Vector3(ball.p.x,ball.p.y,ball.p.z).applyMatrix4(inverse),start=new T.Vector3(previousRacket?.ball.x??previousBall.x,previousRacket?.ball.y??previousBall.y,previousRacket?.ball.z??previousBall.z).applyMatrix4(previousRacket?previousMatrix:inverse);
    if(racketContact(start,end)){
     bat.getWorldQuaternion(q1);const normal=new T.Vector3(0,0,-1).applyQuaternion(q1);if(normal.z>0)normal.negate();const angle=renderer.xr.isPresenting?clamp(normal.x/Math.max(.3,-normal.z),-.8,.8):aim;
     const destination=clamp(angle*6+strokeVelocity.x*.12,-4.8,4.8);returnBall(ball,destination,strokeVelocity.length());lastHitTime=simTime;sound(490,.09,.05);haptic();landing.visible=false;tell('Boa rebatida! Veja onde a bola cai.');
    }
   }
   ballMesh.position.set(ball.p.x,ball.p.y,ball.p.z);ballMesh.rotation.x+=dt*6;ballShadow.position.set(ball.p.x,.07,ball.p.z);ballShadow.scale.setScalar(1+ball.p.y*.2);
  }
  if(ball&&!ball.active){ballMesh.visible=false;ballShadow.visible=false;}
 }
 if(bat&&ball?.active){previousRacket={ball:{...ball.p}};previousMatrix.copy(bat.userData.head.matrixWorld).invert();}else previousRacket=null;
 racket.visible=!renderer.xr.isPresenting&&stage>0&&stage!==4;renderer.render(scene,camera);
});

for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{if(stage!==0)return;clubView=button.dataset.view;transition(()=>placePlayer(true));for(const other of document.querySelectorAll('[data-view]'))other.setAttribute('aria-pressed',String(other===button));});
