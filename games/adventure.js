// Campaign state is local only; it never changes the authoritative ranking engine.
import {gradeEtiquetteQuiz} from './club-etiquette.js';
import {AMBIENT_NPCS} from './ambient-npcs.js';
export const ADVENTURE_KEY='adventure:v1'; // Keep the key to migrate existing adventures.
export const RIVALS=['lourenco','gabriel','davi','evandro','andre','romulo'];
export const VENUES=['court1','court2','pickleball'];
export const EXPLORE=['court1','court2','bar','pickleball','wood-cabin','river'];
export const FOICE={id:'foice',name:'Foice Lendária',label:'Foice Lendária',kind:'item',x:1180,y:716,radius:30};
export const GABRIEL_BALLS=[{x:86,y:778},{x:268,y:817},{x:150,y:918}].map((p,i)=>({...p,id:`gabriel-ball-${i+1}`,name:`Bolinha ${i+1} de Gabriel`,label:`Bolinha ${i+1} de Gabriel`,kind:'item',itemType:'tennis-ball',radius:30}));
export const NPCS=[
 {id:'gael',name:'Gael',role:'pickleball',title:'Guardião do Pickleball · O Pequeno General',x:866,y:1180,color:'#58b8ed'},
 {id:'lourenco',name:'Lourenço',role:'rival',title:'Chefe 1 · Pequeno, mas Gigante',x:542,y:1190,court:1,color:'#f1c840'},
 {id:'gabriel',name:'Gabriel',role:'rival',title:'Chefe 2 · El Bigodón',x:362,y:260,court:2,color:'#20a76d'},
 {id:'emerson',name:'Emerson',role:'coach',title:'Professor · Guardião da Quadra 2',x:838,y:674,court:2,color:'#d94640'},
 {id:'davi',name:'Davi',role:'rival',title:'Chefe 3 · Next Gen',x:780,y:1122,court:1,color:'#985bd5'},
 {id:'evandro',name:'Evandro',role:'rival',title:'Chefe 4 · O Incansavelmente Cansado',x:904,y:1266,seated:true,court:2,color:'#ed8068'},
 {id:'andre',name:'André',role:'rival',title:'Chefe 5 · O Malvado',x:1042,y:812,court:2,color:'#ef9b30'},
 {id:'romulo',name:'Rômulo',role:'boss',title:'Chefe 6 · O Facão',x:340,y:695,court:1,color:'#b89a4c'},
 {id:'renato',name:'Renato',role:'coach',title:'Professor · Guardião da Quadra 1',x:516,y:875,court:1,color:'#f1ebcf'},
 {id:'beto',name:'Beto',role:'doctor',title:'O Astronauta · Médico Intergaláctico',x:1085,y:870,color:'#32bac1'},
 {id:'felipe',name:'Felipe',role:'host',title:'Ilha Bar · Mestre das Porções',x:400,y:693,color:'#a94664'},
 {id:'leandro',name:'Leandro',role:'guide',title:'Guia · Mestre das Missões',x:894,y:391,color:'#398be6'},
].map(n=>({...n,avatar:n.id,kind:'npc',label:n.name,radius:39}));
const cleanName=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,18)||'Visitante':'Visitante';
export const RAIN_CHAT_IDS=[...NPCS,...AMBIENT_NPCS].map(n=>n.id).filter(id=>id!=='andre');
// During André's rain break, guide the player toward optional faces first.
// Gael and the campaign rivals have already had their story moments by then.
export const RAIN_CHAT_ROUTE=[...AMBIENT_NPCS.map(n=>n.id),...NPCS.filter(n=>!['andre','gael'].includes(n.id)).map(n=>n.id),'gael'];
export const isRaining=s=>['raining','waiting'].includes(s.rainStage);
export function readAdventure(value){
 let v=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 if(v.version===1){
  const started=v.met===true||v.trained===true||v.champion===true;
  // The new six-boss circuit is distinct. Preserve the old trophy as a badge.
  v={...v,version:2,begun:started,welcomed:started,places:started?VENUES:[],barVisited:started,wins:[],champion:false,legacyChampion:v.champion===true};
 }
 if(![2,3,4,5,6].includes(v.version))v={};
 const old=v.version===2||v.version===3;
 const welcomed=v.welcomed===true,places=welcomed&&Array.isArray(v.places)?EXPLORE.filter(id=>v.places.includes(id)):[];
 const barVisited=welcomed&&v.barVisited===true;
 const met=welcomed&&v.met===true&&(v.version!==2||(barVisited&&VENUES.every(id=>places.includes(id)))),trained=met&&v.trained===true;
 const history=welcomed&&(old?met:v.history===true),cup=trained&&barVisited&&(old||v.cup===true);
 const wins=[];if(trained&&barVisited)for(const id of RIVALS){if(!Array.isArray(v.wins)||!v.wins.includes(id))break;wins.push(id);}
 const requests=cup?RIVALS.filter(id=>old?wins.includes(id):Array.isArray(v.requests)&&v.requests.includes(id)):[];
 const delivered=['gabriel','evandro'].filter(id=>wins.includes(id)||(requests.includes(id)&&Array.isArray(v.delivered)&&v.delivered.includes(id)));
 const migratedBalls=v.version===4&&v.delivery==='gabriel'&&requests.includes('gabriel');
 const balls=delivered.includes('gabriel')||migratedBalls?GABRIEL_BALLS.map(b=>b.id):requests.includes('gabriel')?GABRIEL_BALLS.filter(b=>Array.isArray(v.balls)&&v.balls.includes(b.id)).map(b=>b.id):[];
 const rainChats=Array.isArray(v.rainChats)?RAIN_CHAT_IDS.filter(id=>v.rainChats.includes(id)).slice(0,4):[];
 const rainStage=wins.includes('andre')||v.version<6&&v.betoStory===true?'cleared':requests.includes('andre')&&['raining','waiting','cleared'].includes(v.rainStage)?(rainChats.length===4?'cleared':v.rainStage):requests.includes('andre')&&v.betoStory===true?'raining':'none';
 const finalBriefing=wins.length===6&&(v.finalBriefing===true||v.champion===true);
 return {version:6,rainStage,rainChats:rainStage==='none'?[]:rainChats,begun:v.begun===true||welcomed,name:cleanName(v.name),avatar:v.avatar==='player-f'?'player-f':'player-m',welcomed,places:old&&met?[...EXPLORE]:places,history,barVisited,met,trained,cup,wins,requests,balls,delivered,
 delivery:v.delivery==='evandro'&&requests.includes('evandro')&&!delivered.includes('evandro')?'evandro':null,
 extraTrained:wins.includes('davi')||(requests.includes('davi')&&v.extraTrained===true),betoStory:wins.includes('andre')||(requests.includes('andre')&&v.betoStory===true),
 foiceQuest:cup&&(old?wins.includes('romulo'):v.foiceQuest===true),foice:cup&&(old?wins.includes('romulo'):v.foice===true),
 finalBriefing,champion:wins.length===6&&v.champion===true,creditsSeen:wins.length===6&&v.champion===true&&v.creditsSeen===true,
 pickleball:v.pickleball===true,rested:v.rested===true,legacyChampion:v.legacyChampion===true,visited:Array.isArray(v.visited)?NPCS.filter(n=>v.visited.includes(n.id)).map(n=>n.id):[]};
}
export function stageOf(state){const s=readAdventure(state);return !s.welcomed?'welcome':!s.history?(EXPLORE.every(id=>s.places.includes(id))?'history':'explore'):!s.met?'find_coach':!s.trained?'lesson':!s.barVisited?'bar':!s.cup?'cup':s.wins.length<6?'circuit':!s.finalBriefing?'final-guide':!s.champion?'celebrate':'champion';}
export function canChallenge(state,id){const s=readAdventure(state);if(!s.cup||!RIVALS.includes(id))return false;if(s.wins.includes(id))return true;if(RIVALS[s.wins.length]!==id)return false;
 return id==='romulo'?s.foice:s.requests.includes(id)&&({lourenco:s.pickleball,gabriel:s.delivered.includes(id),davi:s.extraTrained,evandro:s.delivered.includes(id),andre:s.betoStory&&s.rainStage==='cleared'})[id];}
export function questItems(state){const s=readAdventure(state);return [...(s.requests.includes('gabriel')&&!s.delivered.includes('gabriel')&&!s.wins.includes('gabriel')?GABRIEL_BALLS.filter(b=>!s.balls.includes(b.id)):[]),...(s.foiceQuest&&!s.foice&&s.wins.length===5?[FOICE]:[])];}
export function advanceAdventure(state,event){
 const s=readAdventure(state);
 if(event.type==='profile'){s.begun=true;s.name=cleanName(event.name);s.avatar=event.avatar;}
 if(event.type==='visit'&&NPCS.some(n=>n.id===event.id)&&!s.visited.includes(event.id))s.visited.push(event.id);
 if(event.type==='welcome'){s.begun=true;s.welcomed=true;}
 // The opening tour is sequential: walking over a hotspot or reaching a
 // later stop cannot silently skip the guided route.
 if(event.type==='visit-place'&&s.welcomed&&event.id===EXPLORE.find(id=>!s.places.includes(id)))s.places.push(event.id);
 if(event.type==='club-history'&&stageOf(s)==='history')s.history=true;
 if(event.type==='bar-visited'&&s.trained)s.barVisited=true;
 if(event.type==='meet-coach'&&s.history)s.met=true;
 if(event.type==='lesson-passed'&&s.met)s.trained=true;
 if(event.type==='cup-introduced'&&s.barVisited&&s.trained)s.cup=true;
 if(event.type==='boss-request'&&s.cup&&RIVALS[s.wins.length]===event.id&&!s.requests.includes(event.id))s.requests.push(event.id);
 if(event.type==='ball-collected'&&questItems(s).some(b=>b.itemType==='tennis-ball'&&b.id===event.id))s.balls.push(event.id);
 if(event.type==='balls-delivered'&&RIVALS[s.wins.length]==='gabriel'&&s.balls.length===3&&!s.delivered.includes('gabriel'))s.delivered.push('gabriel');
 if(event.type==='drink-collected'&&event.id==='evandro'&&s.requests.includes(event.id)&&RIVALS[s.wins.length]===event.id&&!s.delivered.includes(event.id))s.delivery=event.id;
 if(event.type==='drink-delivered'&&s.delivery===event.id){s.delivered.push(event.id);s.delivery=null;}
 if(event.type==='etiquette-passed'&&s.requests.includes('davi')&&gradeEtiquetteQuiz(event.answers).passed)s.extraTrained=true;
 if(event.type==='rain-start'&&s.requests.includes('andre')&&!s.betoStory&&s.rainStage==='none')s.rainStage='raining';
 if(event.type==='beto-story-heard'&&s.requests.includes('andre')){s.betoStory=true;s.rested=true;if(s.rainStage==='none')s.rainStage='raining';}
 if(event.type==='rain-wait'&&s.betoStory&&s.rainStage==='raining')s.rainStage='waiting';
 if(event.type==='rain-chat'&&s.rainStage==='waiting'&&RAIN_CHAT_IDS.includes(event.id)&&!s.rainChats.includes(event.id)){s.rainChats.push(event.id);if(s.rainChats.length>=4)s.rainStage='cleared';}
 if(event.type==='foice-revealed'&&s.wins.length===5)s.foiceQuest=true;
 if(event.type==='foice-collected'&&questItems(s).some(item=>item.id==='foice'))s.foice=true;
 if(event.type==='match-won'&&canChallenge(s,event.id)&&!s.wins.includes(event.id))s.wins.push(event.id);
 if(event.type==='final-briefing'&&s.wins.length===6)s.finalBriefing=true;
 if(event.type==='crowned'&&s.wins.length===6&&s.finalBriefing)s.champion=true;
 if(event.type==='credits-seen'&&s.champion)s.creditsSeen=true;
 if(event.type==='pickleball-won')s.pickleball=true;
 if(event.type==='rested')s.rested=true;
 return readAdventure(s);
}
export function objective(state){
 const s=readAdventure(state),next=RIVALS[s.wins.length],person=NPCS.find(n=>n.id===next);
 if(stageOf(s)==='circuit'){
  if(next==='andre'&&s.betoStory&&isRaining(s))return s.rainStage==='waiting'?{title:`Resenha na chuva · ${s.rainChats.length}/4`,text:'Converse com quatro pessoas diferentes enquanto a chuva passa. A marca vai priorizar alguém novo, mas vale qualquer pessoa da turma, além do André.',target:RAIN_CHAT_ROUTE.find(id=>!s.rainChats.includes(id))}:{title:'O tempo virou!',text:'Terminou a história do Beto? Volte ao André para combinar o que fazer enquanto chove.',target:'andre'};
  if(next==='romulo'&&!s.foiceQuest)return {title:'Quase uma lenda',text:'André mandou você procurar Leandro. Falta o chefão!',target:'leandro'};
  if(next==='romulo'&&!s.foice)return {title:'A Foice Lendária',text:'Contorne a casa mal-assombrada pelo lado esquerdo e procure atrás dela. Guarde o amuleto antes de jogar!',target:'foice'};
  if(!canChallenge(s,next)&&s.requests.includes(next))return {
   lourenco:{title:'Licença do Pequeno General',text:'Vença Gael no pickleball e volte a Lourenço.',target:'gael'},
   gabriel:{title:'As bolinhas do Bigodón',text:s.balls.length===3?'Você achou as três! Entregue as bolinhas a Gabriel no estacionamento.':`Pegue as três bolinhas na quadra abandonada. ${s.balls.length}/3 encontradas.`,target:s.balls.length===3?'gabriel':questItems(s).find(b=>b.itemType==='tennis-ball')?.id},
   davi:{title:'Craque dentro e fora da quadra',text:'Aprenda boas maneiras com Emerson e acerte pelo menos 3 de 4 perguntas. Depois, volte a Davi.',target:'emerson'},
   evandro:{title:'Combustível do cansado',text:s.delivery==='evandro'?'Entregue o Suco do Tenista a Evandro no banco ao lado da quadra azul.':'Busque com Felipe o Suco do Tenista para Evandro.',target:s.delivery==='evandro'?'evandro':'felipe'},
   andre:{title:'Paciência Intergaláctica',text:'Ouça a história espacial de Beto até o fim. André está esperando.',target:'beto'},
  }[next];
  return {title:`${s.wins.length+1}/6 · ${person.name}`,text:canChallenge(s,next)?`Desafio liberado! Volte a ${person.name} para o tie-break.`:`Converse com ${person.name} para combinar o desafio.`,target:next};
 }
 const explore=EXPLORE.find(id=>!s.places.includes(id));
 return {
  welcome:{title:'Bem-vindo à turma',text:'Fale com Leandro na entrada.',target:'leandro'},
  explore:{title:'Seu primeiro passeio',text:`Siga a marca da missão e toque em Interagir em cada parada. ${s.places.length}/${EXPLORE.length} lugares visitados.`,target:explore},
  history:{title:'Como tudo começou',text:'Volte a Leandro para ouvir a história da Ilha.',target:'leandro'},
  bar:{title:'Suco do Tenista',text:'Você terminou a aula! Peça seu Suco do Tenista a Felipe, em frente ao bar.',target:'felipe'},
  cup:{title:'Tem Copa na Ilha!',text:'Felipe mandou você voltar a Leandro. Ele tem uma proposta.',target:'leandro'},
  find_coach:{title:'Cadê o Renato?',text:'Encontre Renato ao lado da Quadra 1.',target:'renato'},
  lesson:{title:'Primeiras raquetadas',text:'Faça a aula rápida com Renato na Quadra 1.',target:'renato'},
  'final-guide':{title:'As seis medalhas',text:'Você venceu Rômulo! Volte ao Leandro antes da premiação.',target:'leandro'},
  celebrate:{title:'A festa é no bar!',text:'Você venceu os seis! Vá ao bar e receba a Taça do Legado.',target:'bar'},
  champion:{title:'★ Lenda da Ilha!',text:'A taça é sua! Converse com qualquer pessoa do clube para convidar para um jogo livre. Leandro pode mostrar o álbum da festa novamente.',target:'leandro'},
 }[stageOf(s)];
}
export function duelRules(id){const i=Math.max(0,RIVALS.indexOf(id));return {points:7,winBy:2,cap:11,cpuSpeed:[.55,.65,.76,.87,1.02,1.16][i],label:id==='romulo'?'FINAL DO LEGADO':'COPA DO LEGADO'};}
export function rewards(state){
 const s=readAdventure(state),count=s.wins.length,cap=n=>Math.min(5,n);
 const xp=50*Number(s.welcomed)+25*s.places.length+75*Number(s.barVisited)+150*Number(s.trained)+100*count+300*Number(s.champion)+120*Number(s.pickleball)+40*Number(s.rested)+5*s.visited.length;
 return {xp,level:Math.min(10,1+Math.floor(xp/160)),attributes:[['Técnica',cap(1+2*Number(s.trained)+Math.floor(count/3))],['Resistência',cap(1+Number(s.rested)+Number(s.pickleball)+Math.floor(count/2))],['Foco',cap(1+Number(s.trained)+Math.floor((count+1)/2))],['Espírito de equipe',cap(1+Math.floor(s.visited.length/3)+Number(s.champion))],['Resenha',cap(1+2*Number(s.barVisited)+Math.floor(s.visited.length/5))]],badges:[...(s.welcomed?['Passaporte da Ilha']:[]),...(s.barVisited?['Suco do Tenista']:[]),...s.wins.map(id=>`Medalha de ${NPCS.find(n=>n.id===id).name}`),...(s.pickleball?['Medalha do Gael']:[]),...(s.betoStory?['Paciência Intergaláctica']:[]),...(s.champion?['Taça do Legado','Aura dourada']:[]),...(s.legacyChampion?['Taça da primeira temporada']:[])]};
}
export function journalText(state){
 const task=objective(state);return `${task.title}\n${task.text}`;
}
