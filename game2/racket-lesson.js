import {createLesson,lessonTasks} from './lesson.js';
import {stepRacketMatch,launchBall,clamp} from './racket-match.js';
export const TOUCH_LESSONS=[
 {id:'serve',title:'Vamos sacar!',gesture:'up',text:'Encoste na quadra, arraste para cima e solte.',tip:'O boneco corre sozinho. Você só escolhe o golpe!',success:'Saque dentro! Você começou o ponto.'},
 {id:'normal',title:'Topspin: para baixo',gesture:'down',text:'Arraste para baixo e solte. A bola vai para o outro lado!',tip:'Pode preparar antes: o boneco espera o quique para bater.',success:'Boa! Esse é o topspin: uma bola mais funda.'},
 {id:'slice',title:'Slice: para o lado',gesture:'side',text:'Arraste para um dos lados e solte.',tip:'Esse golpe passa mais baixo. Aqui, vamos tentar para a direita.',success:'Slice certinho! Você mudou o ritmo da bola.'},
 {id:'drop',title:'Deixada: só um toque',gesture:'tap',text:'Toque na quadra e tire o dedo. Sem arrastar!',tip:'Um toque curtinho faz a bola cair pertinho da rede.',success:'Que toque! A deixada caiu perto da rede.'},
 {id:'normal',title:'Mire na esquerda',gesture:'left',aim:-1,text:'Puxe para baixo, inclinando para a esquerda. Depois solte.',tip:'Olhe a seta branca. Mande a bola na área iluminada!',success:'Na esquerda! Agora você sabe escolher um canto.'},
 {id:'normal',title:'Agora, na direita',gesture:'right',aim:1,text:'Puxe para baixo, inclinando para a direita. Depois solte.',tip:'O lado que você inclina é o lado para onde a bola vai.',success:'Na direita! Trocar de canto ajuda a vencer.'},
 {id:'normal',title:'Um pouco mais de força',gesture:'power',power:true,text:'Faça uma puxada mais longa para baixo e solte.',tip:'Mais arrasto enche a seta: a bola vai mais forte e mais no fundo da quadra.',success:'Mandou bem! Você aprendeu os golpes, a mira e a força.'},
];
const TOUCH_EXTRA=[TOUCH_LESSONS[1],TOUCH_LESSONS[4],TOUCH_LESSONS[5],TOUCH_LESSONS[2],TOUCH_LESSONS[3]].map(t=>({...t}));
export function createRacketLesson(game,extra=false){
 const lesson={...createLesson(game,extra),minY:game.player.y,maxY:game.player.y,seenLanding:0};
 if(game.assisted){Object.assign(lesson,{guided:true,tasks:extra?TOUCH_EXTRA:TOUCH_LESSONS,phase:'demo',pauseFrames:0,outcome:null,feedback:'',attempt:0});clearExercise(game);game.lessonGuided=true;}
 return lesson;
}
function clearExercise(s){s.ball.active=false;s.awaitingServe=false;s.prepared=null;s.gesture=null;s.swingQueue=null;s.lessonTarget=null;s.landing=null;s.delay=0;s.faults=0;s.playerPoints=0;s.cpuPoints=0;s.message='';s.feedback='';}
export function lessonAcceptsGesture(lesson){return !lesson?.guided||lesson.phase==='practice';}
// Reading and celebrating are untimed. Only the player starts the next ball.
export function lessonAction(lesson,s,action='next'){
 if(!lesson?.guided||lesson.completed)return false;
 if(action==='demo'){clearExercise(s);lesson.phase='demo';lesson.feedback='';lesson.outcome=null;lesson.pauseFrames=0;return true;}
 if(!['demo','feedback'].includes(lesson.phase)||lesson.pauseFrames>0)return false;
 if(lesson.phase==='feedback'&&lesson.outcome==='success'){
  lesson.index++;
  if(lesson.index===lesson.tasks.length){lesson.completed=true;s.done=true;return true;}
  lesson.phase='demo';lesson.outcome=null;lesson.feedback='';s.lessonAim=null;return true;
 }
 clearExercise(s);lesson.phase='practice';lesson.outcome=null;lesson.feedback='Sua vez! Faça o gesto na quadra.';lesson.pending=false;lesson.attempt++;
 const task=lesson.tasks[lesson.index];s.done=false;s.server='player';s.player.x=.5;s.player.y=1.045;s.cpu.x=.5;s.cpu.y=-.045;s.focusUsed=0;
 s.lessonAim={minX:task.aim===1?.6:.06,maxX:task.aim===-1?.4:.94,minY:task.id==='drop'?.32:.04,maxY:task.power?.17:.46,label:task.aim===-1?'ESQUERDA':task.aim===1?'DIREITA':task.power?'MAIS LONGE':'AQUI'};
 if(task.id==='serve'){s.awaitingServe=true;s.lessonAim={minX:.06,maxX:.49,minY:.27,maxY:.49,label:'SAQUE AQUI'};}
 else{launchBall(s,'cpu','normal',.5,.84,{flight:1.65});s.serveBounces=2;}
 return true;
}
function stepGuidedLesson(l,s,input){
 if(l.completed)return;
 if(l.phase!=='practice'){l.pauseFrames=Math.max(0,l.pauseFrames-1);return;}
 const task=l.tasks[l.index],stroke=input.stroke;
 const feedback=(success,text)=>{
  clearExercise(s);l.phase='feedback';l.outcome=success?'success':'retry';l.feedback=text;l.pauseFrames=success?75:45;l.pending=false;
  s.event=success?'lesson-success':'lesson-retry';s.eventId++;
 };
 if(input.invalidServe){feedback(false,'Para sacar, arraste para cima e solte. Olhe o dedo na demonstração.');return;}
 // Ignore repeated gestures once the ball has left the racket.
 if(s.ball.last!=='player'||s.awaitingServe){
  if(stroke&&stroke.shot!==task.id){const name={normal:'um topspin',slice:'um slice',drop:'uma deixada'}[stroke.shot]||'outro golpe';feedback(false,`Você fez ${name}. ${task.text}`);return;}
  if(stroke||input.serve){l.pending=true;l.accepted=stroke||input.serveGesture||{power:.5,aim:0};l.feedback='Gesto preparado! Veja o quique e a rebatida.';}
 }
 // Hold at the top of the first bounce until the child chooses a gesture.
 // No deadline, no automatic hit, and no penalty for taking time to read.
 const b=s.ball;
 if(b.active&&b.last==='cpu'&&b.bounces===1&&s.elapsed-b.bounceAt>=.22&&!s.prepared&&!stroke){l.feedback='A bola esperou você! Faça o gesto na quadra.';return;}
 const before=s.shotCounts[task.id];
 stepRacketMatch(s,{...input,coach:true});
 if(s.shotCounts[task.id]>before)l.feedback='Boa batida! Vamos ver onde a bola cai…';
 if(s.landing&&s.ball.last==='player'&&s.ball.bounces===1&&s.landing.at>=s.hitAt&&l.pending){
  if(!s.landing.valid)feedback(false,'Quase! A bola saiu. Tente apontar a seta para dentro da quadra.');
  else if(task.aim&&!(task.aim<0?s.landing.x<=.4:s.landing.x>=.6))feedback(false,`O golpe saiu! Agora incline mais para a ${task.aim<0?'esquerda':'direita'}, na área iluminada.`);
  else if(task.power&&(l.accepted.power<.65||s.landing.y>.17))feedback(false,'Boa! Para ir mais longe, arraste um pouco mais antes de soltar.');
  else feedback(true,task.success);
 }else if(!s.ball.active&&!s.awaitingServe)feedback(false,'Tudo bem! Vamos de novo. Prepare o gesto e solte o dedo.');
 s.playerPoints=0;s.cpuPoints=0;s.done=false;s.score=0;
}
export function stepRacketLesson(lesson,s,input){
 if(lesson.guided)return stepGuidedLesson(lesson,s,input);
 if(lesson.completed)return;
 const task=lessonTasks(lesson)[lesson.index];
 if(task.id==='move'){
  if(s.assisted){s.ball.active=false;s.awaitingServe=false;s.lessonFeedback='Arraste na quadra e solte para apontar o golpe.';if(input.stroke||input.shot)advance();return;}
  s.ball.active=false;s.awaitingServe=false;s.server='player';s.delay=0;
  stepRacketMatch(s,{...input,coach:true});
  lesson.min=Math.min(lesson.min,s.player.x);lesson.max=Math.max(lesson.max,s.player.x);
  lesson.minY=Math.min(lesson.minY,s.player.y);lesson.maxY=Math.max(lesson.maxY,s.player.y);
  s.lessonFeedback=lesson.max-lesson.min<.12?'Mexa para os lados.':'Agora vá para frente e para trás.';
  if(lesson.max-lesson.min>.12&&lesson.maxY-lesson.minY>.075)advance();
  return;
 }
 if(lesson.cooldown>0){lesson.cooldown--;s.delay=0;s.awaitingServe=false;s.ball.active=false;s.prepared=null;stepRacketMatch(s,{...input,coach:true});return;}
 if(!s.ball.active){
  s.delay=0;s.server='player';s.swingQueue=null;s.faults=0;
  if(task.id==='serve'){s.awaitingServe=true;s.lessonFeedback=s.assisted?'Arraste para cima para sacar.':'B para sacar para o outro lado.';}
  else{
   s.awaitingServe=false;s.cpu.x=.5;s.cpu.y=.12;
   launchBall(s,'cpu','normal',clamp(s.player.x,.18,.82),.86,{flight:1.4});
   s.serveBounces=2;s.lessonTarget={x:s.ball.endX,y:s.ball.endY};
   s.lessonFeedback=s.assisted?({normal:'Puxe para baixo e solte.',slice:'Puxe para o lado e solte.',drop:'Só um toque curto.'}[task.id])+' Eu corro até a bola!':'Aproxime-se e aperte '+({normal:'Y',slice:'A',drop:'X'}[task.id])+' quando a bola chegar.';
  }
 }
 const before=s.shotCounts[task.id];
 stepRacketMatch(s,{...input,coach:true});
 if(s.shotCounts[task.id]>before){lesson.pending=true;s.lessonTarget=null;s.lessonFeedback='Boa! Veja a bola voltar…';}
 if(s.landing&&s.landing.at!==lesson.seenLanding){
  lesson.seenLanding=s.landing.at;
  if(s.ball.last==='player'&&s.landing.valid&&lesson.pending){lesson.hits++;lesson.pending=false;s.ball.active=false;lesson.cooldown=40;if(lesson.hits>=(task.count||1))advance();}
 }
 if(!s.ball.active&&!lesson.cooldown&&task.id!=='serve'){lesson.cooldown=45;lesson.pending=false;s.lessonFeedback='Sem problema. Vamos de novo!';}
 s.playerPoints=0;s.cpuPoints=0;s.done=lesson.completed;s.message='';s.delay=0;
 function advance(){
  lesson.index++;lesson.hits=0;lesson.pending=false;lesson.cooldown=40;s.ball.active=false;s.prepared=null;s.lessonTarget=null;
  if(lesson.index>=lessonTasks(lesson).length){lesson.completed=true;s.done=true;}
 }
}
