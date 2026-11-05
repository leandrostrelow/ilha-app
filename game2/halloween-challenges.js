import {stepRacketMatch,launchBall} from './racket-match.js';

export const CHALLENGES=Object.freeze({
 gabriel:{kind:'win',target:4,difficulty:.50,title:'Fome de vitória',instructions:'Ganhe quatro pontos antes do Gabriel. Não precisa de dois pontos de vantagem.'},
 vanessa:{kind:'perfect',target:4,difficulty:.45,title:'Não é sua tia!',instructions:'Faça 4 × 0. Se Vanessa fizer um ponto, tente novamente. O suco não precisa ser reposto.'},
 higor:{kind:'rally',target:12,difficulty:.58,title:'Fisioterapia do Desesperador',instructions:'Mantenha uma única troca por 12 segundos. Saque e espera não contam. Bola perdida reinicia o relógio, não o tratamento.'},
 michele:{kind:'streak',target:3,limit:5,difficulty:.55,title:'Três lembranças seguidas',instructions:'Faça três pontos seguidos antes que Michele some cinco. Um ponto dela zera apenas sua sequência.'},
 larissa:{kind:'gift',target:3,difficulty:.55,title:'Hoje quem ganha é ela!',instructions:'Deixe Larissa vencer por 3 × 0. Não marque ponto. Saque de leve e deixe as devoluções passarem.'},
 scarlt:{kind:'comeback',target:6,startCpu:3,difficulty:.65,title:'Virada de outro mundo',instructions:'Scarlt começa com três pontos. Vire o placar: chegue a seis antes dela, sem precisar de dois de vantagem.'},
});
export function createChallenge(id,game,override=null){
 const rule=override||CHALLENGES[id];if(!rule)return null;
 game.points=999;game.practice=rule.kind==='rally';game.cpuPoints=rule.startCpu||0;
 return {id,...rule,seconds:0,bestSeconds:0,streak:0,succeeded:false,finished:false,reason:''};
}
function complete(c,s,success,reason){c.finished=true;c.succeeded=success;c.reason=reason;s.done=true;s.ball.active=false;s.prepared=null;s.message=reason;s.feedback=reason;s.event=success?'finish':'miss';s.eventId++;}
// Evaluate actual engine outcomes. Waiting, pausing and the serve itself never
// advance the rally timer. Each challenge instance belongs to one attempt only.
export function evaluateChallenge(c,s,before){
 if(!c||c.finished)return c;
 const playerPoint=s.playerPoints>before.playerPoints,cpuPoint=s.cpuPoints>before.cpuPoints;
 if(c.kind==='rally'){
  if(playerPoint||cpuPoint||!s.ball.active)c.seconds=0;
  else if(s.rally>0&&!s.ball.serve&&!s.delay)c.seconds+=Math.max(0,Math.min(1/30,s.elapsed-before.elapsed));
  c.bestSeconds=Math.max(c.bestSeconds,c.seconds);
  if(c.seconds+1e-6>=c.target)complete(c,s,true,'Doze segundos de troca! Higor recuperou o ritmo e a cor.');
 }else if(c.kind==='perfect'){
  if(s.cpuPoints>0)complete(c,s,false,'Vanessa marcou. O desafio pede 4 × 0. O suco continua valendo: tente outra vez.');
  else if(s.playerPoints>=c.target)complete(c,s,true,'4 × 0! Vanessa voltou ao normal. E continua não sendo sua tia.');
 }else if(c.kind==='gift'){
  if(s.playerPoints>0)complete(c,s,false,'Você marcou! Nesta missão, Larissa precisa vencer por 3 × 0. Tente de novo sem fazer pontos.');
  else if(s.cpuPoints>=c.target)complete(c,s,true,'Larissa ganhou por 3 × 0! Você perdeu o placar e venceu a infecção.');
 }else if(c.kind==='streak'){
  if(cpuPoint)c.streak=0;else if(playerPoint)c.streak++;
  if(c.streak>=c.target)complete(c,s,true,'Três pontos seguidos! As lembranças da Michele voltaram.');
  else if(s.cpuPoints>=c.limit)complete(c,s,false,'Michele chegou a cinco. Busque três pontos seguidos na próxima tentativa.');
 }else if(s.playerPoints>=c.target||s.cpuPoints>=c.target){
  const won=s.playerPoints>=c.target;complete(c,s,won,won?(c.kind==='comeback'?'Virada completa! Scarlt voltou de vez.':'Gabriel recuperou a cor e o juízo. Nada de mastigar decoração!'):'O adversário chegou primeiro. Você pode tentar de novo; o suco já foi entregue.');
 }
 if(c.final&&c.finished){c.reason=c.succeeded?'Última sessão concluída! O antídoto funcionou. Volte a Leandro para reunir a turma.':'Ainda falta completar o desafio final. O suco continua valendo: tente novamente.';s.message=c.reason;s.feedback=c.reason;}
 return c;
}
export function stepChallenge(c,s,input={},dt=1/60){
 if(!c||c.finished)return s;
 const before={playerPoints:s.playerPoints,cpuPoints:s.cpuPoints,elapsed:s.elapsed},ball=s.ball;
 stepRacketMatch(s,input,dt);
 // Higor cooperates with gentle, centered returns. The player still has to
 // prepare every stroke; no automatic player hits or phantom elapsed time.
 if(c.kind==='rally'&&s.ball!==ball&&s.ball.active&&s.ball.last==='cpu'&&!s.ball.serve){
  launchBall(s,'cpu','normal',Math.max(.25,Math.min(.75,s.player.x)),.82,{flight:1.25});
 }
 evaluateChallenge(c,s,before);return s;
}
export function challengeStatus(c,s){
 if(!c)return '';
 if(c.finished)return c.reason;
 if(c.final)return c.kind==='rally'?`Última troca: ${c.seconds.toFixed(1)} / ${c.target} s`:c.kind==='streak'?`Última sequência: ${c.streak}/${c.target} · rival ${s.cpuPoints}/${c.limit}`:`Última virada: você ${s.playerPoints} × ${s.cpuPoints} · primeiro a ${c.target}`;
 if(c.kind==='rally')return 'Troca: '+c.seconds.toFixed(1)+' / 12 s · melhor '+c.bestSeconds.toFixed(1)+' s';
 if(c.kind==='streak')return 'Sequência: '+c.streak+'/3 · Michele: '+s.cpuPoints+'/5';
 if(c.kind==='gift')return 'Deixe Larissa ganhar · você 0 · Larissa '+s.cpuPoints+'/3';
 if(c.kind==='perfect')return 'Meta 4 × 0 · não ceda nenhum ponto';
 return 'Primeiro a '+c.target+' pontos'+(c.kind==='comeback'?' · vire o 0 × 3':'');
}
