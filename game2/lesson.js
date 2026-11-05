// Friendly training and campaign variants wrap, but never modify, the ranked engine.
export const LESSONS=[
 {id:'move',title:'1/5 · Aquecimento',text:'“Cheguei! Mexa para os lados e para frente e para trás.”',buttons:['moveLeft','moveRight','matchPad']},
 {id:'serve',title:'2/5 · Saque',text:'“B para sacar. Sem acertar o bar, combinado?”',buttons:['serveButton']},
 {id:'normal',title:'3/5 · Topspin',text:'“Chegue perto da bola e aperte Y na hora de bater.”',buttons:['topspinButton']},
 {id:'slice',title:'4/5 · Slice',text:'“A: slice. Rasteira na bola, não no professor!”',buttons:['sliceButton']},
 {id:'drop',title:'5/5 · Deixada',text:'“X: deixada. Curtinha. Depois, bora jogar!”',buttons:['dropButton']},
];
export const EXTRA_LESSONS=[
 {id:'move',title:'1/4 · Pernas prontas',text:'“Cruze um pedaço da quadra. A bola não vem de elevador!”',buttons:['moveLeft','moveRight'],distance:65},
 {id:'normal',title:'2/4 · Constância',text:'“Duas devoluções com Y. Uma… e só mais uma!”',buttons:['topspinButton'],count:2},
 {id:'slice',title:'3/4 · Mude o ritmo',text:'“Duas com A. Bola baixa, cabeça erguida.”',buttons:['sliceButton'],count:2},
 {id:'drop',title:'4/4 · O toque final',text:'“X para a curtinha. Pronto! O Davi está esperando.”',buttons:['dropButton']},
];
export const lessonTasks=lesson=>lesson?.tasks||(lesson?.extra?EXTRA_LESSONS:LESSONS);
export function createLesson(game,extra=false){return {extra,index:0,hits:0,anchor:game.player.x,min:game.player.x,max:game.player.x,cooldown:0,completed:false,pending:false};}
function feed(game){
 // Pick a landing spot once. Never steer an airborne ball toward the player.
 const x=Math.max(130,Math.min(350,game.player.x));
 game.delay=0;game.awaitingServe=false;game.tossFrames=0;
 game.cpu.x=240;game.cpu.y=137;game.cpu.swing=18;
 game.lessonTarget=x;game.lessonFeedback='Encontre a bola e devolva.';
 game.ball={x:240,y:150,startX:240,startY:150,endX:x,endY:377,vx:(x-240)/120,vy:227/120,age:0,flight:120,arc:32,type:'normal',powered:false,curve:0,active:true};
}
export function stepLesson(lesson,game,input,stepGame){
 if(lesson.completed)return;
 const tasks=lessonTasks(lesson),task=tasks[lesson.index],previous={...game.shotCounts};
 game.frame=Math.min(game.frame,5000);game.done=false;
 const outgoing=game.ball.active&&game.ball.vy<0;
 // Let every return cross the net and reach the coach before changing exercise.
 const caught=outgoing&&game.ball.age>=game.ball.flight-1;
 if(caught){
  game.ball.active=false;game.lessonTarget=null;lesson.cooldown=48;
  game.lessonFeedback=lesson.pending?'Boa! Essa voltou certinha.':'Experimente o botão destacado.';
  game.cpu.swing=18;
  if(lesson.pending){lesson.hits++;lesson.pending=false;}
 }
 if(task.id==='move'){game.delay=2;game.ball.active=false;game.awaitingServe=false;game.lessonFeedback='Um passinho para o lado.';}
 if(task.id==='serve')game.serveWait=0;
 if(!['move','serve'].includes(task.id)){
  if(!game.ball.active){
   game.delay=2;game.awaitingServe=false;
   if(lesson.cooldown)lesson.cooldown--;
   else feed(game);
  }
 }
 if(caught)game.delay=2;
 const misses=game.cpuPoints;
 stepArcade(game,input,stepGame);
 lesson.min=Math.min(lesson.min,game.player.x);lesson.max=Math.max(lesson.max,game.player.x);
 if(game.shotCounts[task.id]>previous[task.id]){lesson.pending=true;game.lessonTarget=null;game.lessonFeedback='Isso! Olha a devolução…';}
 if(game.cpuPoints>misses){lesson.cooldown=55;game.lessonTarget=null;game.lessonFeedback='Sem pressa. Vai outra bola!';}
 // Lessons have no opponent score, time limit or penalty for missing a feed.
 game.playerPoints=0;game.cpuPoints=0;game.message='';
 const passed=task.id==='move'?lesson.max-lesson.min>(task.distance||24):lesson.hits>=(task.count||1);
 if(passed){
  lesson.index++;lesson.hits=0;lesson.cooldown=35;
  if(lesson.index===tasks.length){lesson.completed=true;game.done=true;return;}
  game.ball.active=false;game.delay=tasks[lesson.index].id==='serve'?1:0;game.server='player';game.awaitingServe=false;game.tossFrames=0;
 }
}
// Local topspin has a higher arc and faster dip; ranked replays stay unchanged.
export function stepArcade(game,input,stepGame){
 const before=game.shotCounts.normal;stepGame(game,input);
 if(game.shotCounts.normal>before&&!game.ball.powered){const b=game.ball;b.arc=30;b.flight=Math.max(20,Math.round(b.flight*.91));b.vx=(b.endX-b.startX)/b.flight;b.vy=(b.endY-b.startY)/b.flight;}
}
export function stepDuel(game,input,stepGame,rules){
 if(game.done)return;
 const before={x:game.cpu.x,y:game.cpu.y,points:game.playerPoints+game.cpuPoints};
 // The ranked engine has a 90-second clock. Local tie-breaks end on points only.
 game.campaignFrames=(game.campaignFrames||0)+1;game.frame=(game.campaignFrames-1)%4800;
 if(game.awaitingServe)game.serveWait=0;
 stepArcade(game,input,stepGame);
 // Scale only actual CPU running, not its serve positioning jump.
 if(Math.abs(game.cpu.x-before.x)<4&&Math.abs(game.cpu.y-before.y)<4){game.cpu.x=before.x+(game.cpu.x-before.x)*rules.cpuSpeed;game.cpu.y=before.y+(game.cpu.y-before.y)*rules.cpuSpeed;}
 const total=game.playerPoints+game.cpuPoints;
 if(total!==before.points)game.server=tiebreakServer(total);
 if(tiebreakFinished(game.playerPoints,game.cpuPoints,rules)){game.done=true;game.ball.active=false;game.awaitingServe=false;game.tossFrames=0;game.event='finish';game.eventId++;if(game.playerPoints>game.cpuPoints)game.score+=300;}
}
export const tiebreakServer=points=>Math.floor((points+1)/2)%2===0?'player':'cpu';
export const tiebreakFinished=(a,b,{points=7,winBy=2,cap=11}={})=>Math.max(a,b)>=points&&(Math.abs(a-b)>=winBy||Math.max(a,b)>=cap);
