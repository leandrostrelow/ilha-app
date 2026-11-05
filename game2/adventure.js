// Independent Halloween campaign; the Legado tennis simulation stays unchanged.
import {AMBIENT_NPCS} from './ambient-npcs.js';
import {CHALLENGES} from './halloween-challenges.js';
import {normalizeAppearance} from './avatar-customizer.js';
import {CHILDREN,CHILD_IDS} from './children.js';
import {chooseCase,savedCase} from './mystery.js';
import {INVESTIGATION_ROUTES,nextWitness,reportKey} from './investigation.js';
export const ADVENTURE_KEY='misterio:v1';
export const RIVALS=['gabriel','vanessa','higor','michele','larissa','scarlt'];
export const HEALTHY_IDS=['leandro','felipe','renato','gael','lourenco','betinho','malu',...CHILD_IDS];
export const EXPLORE=[];
export const VENUES=['court1','court2','pickleball'];
const people=[
 ['leandro','Leandro','Guia · Não comeu a porção',886,387,'leandro',1],
 ['felipe','Felipe','Bar · Suco antizumbi lacrado',372,685,'felipe',1],
 ['renato','Renato','Professor · Aula opcional',838,674,'renato',2],
 ['gabriel','Gabriel','Paciente 1 · Bigodón com fome',305,805,'gabriel',1],
 ['davi','Davi','Infectado · Ainda consciente',510,1010,'davi',1],
 ['beto','Beto','Astronauta infectado',1052,586,'beto',2],
 ['andre','André','Infectado · Mau humor de sempre',828,1122,'andre',2],
 ['romulo','Rômulo','Infectado · Mais um set?',1032,876,'romulo',1],
 ['emerson','Emerson','Infectado · Só mais uma aula',496,616,'emerson',2],
 ['lourenco','Lourenço','Pequeno gigante · Ajudante saudável',628,676,'lourenco',1],
 ['evandro','Evandro','Morto de cansaço · Quase literalmente',310,216,'evandro',2],
 ['gael','Gael','Saudável · Guardião da azul',850,1230,'gael',1],
];
export const NPCS=[...people.map(([id,name,title,x,y,avatar,court])=>({id,name,label:name,title,x,y,avatar,court,kind:'npc',role:RIVALS.includes(id)?'rival':'guide',radius:39,color:'#a7d86d'})),...CHILDREN];
export const personById=id=>NPCS.find(n=>n.id===id)||AMBIENT_NPCS.find(n=>n.id===id);
export const QUESTS={
 gabriel:{title:'Uma perna para o jantar?',items:['prop-leg'],hint:'Converse com Lourenço. Ele cuidou do manequim da festa e pode explicar ao Gabriel que perna de borracha não é jantar.',helper:'lourenco'},
 vanessa:{title:'Sem ponto e sem “tia”',items:[],hint:'Pegue uma dose no bar e entregue a Vanessa. Depois faça 4 × 0: nenhum ponto para ela.'},
 higor:{title:'Fisioterapia antizumbi',items:[],hint:'Leve o suco a Higor. Sustente um único rali por 12 segundos; perder a bola zera só o cronômetro.'},
 michele:{title:'Três boas lembranças',items:[],hint:'Entregue o suco a Michele. Faça três pontos seguidos antes que ela some cinco.'},
 larissa:{title:'Hoje você deixa ganhar',items:[],hint:'Leve o suco a Larissa. Deixe ela ganhar por 3 × 0. Você deve terminar com zero ponto.'},
 scarlt:{title:'A virada de outro mundo',items:[],hint:'Entregue o suco a Scarlt. Ela começa vencendo por 3 × 0; vire e chegue a seis pontos antes dela.'},
};
export const POST_QUESTS=Object.fromEntries(Object.entries(INVESTIGATION_ROUTES).map(([id,q])=>[id,{...q,recipient:q.route.at(-1),items:[]} ]));
export const CLUES=[
 {id:'purple-vial',name:'Frasco roxo rachado',x:150,y:846,description:'“Sal do Set Impossível. Não usar em comida.” No verso: “Antídoto + atividade em quadra”. Mostre a Leandro.'},
 {id:'prop-leg',name:'Perna de manequim',x:150,y:918,description:'Uma perna de borracha largada na quadra velha. Etiqueta: “Decoração da festa. NÃO COMESTÍVEL”. Carolina estava procurando a peça. Gabriel confundiu com o jantar!'},
 {id:'lost-whistle',name:'Apito antitia',x:700,y:670,description:'O apito que Vanessa emprestou para a festa. Maisa está esperando por ele.'},
 {id:'doubles-book',name:'Caderno de duplas',x:958,y:1278,description:'Michele e Larissa estão na mesma dupla, só não no mesmo lugar. Entregue o caderno a Maisa.'},
 {id:'old-ledger',name:'Diário do clube antigo',x:1102,y:895,description:'“Sal do Set Impossível: adereço encantado. NUNCA usar como tempero.” Quem tocou no pó precisa de uma última sessão em quadra. Leandro vai cruzar isso com as lembranças da turma.'},
 {id:'silver-bell',name:'Sino do clube',x:1180,y:716,description:'Este sino chama o clube para a quadra. Leandro vai organizar um mutirão: suco para todos e tênis acompanhado pelos seis já recuperados.'},
].map(c=>({...c,label:c.name,kind:'item',itemType:'clue',radius:32}));
const cleanName=v=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,18)||'Visitante':'Visitante';
const includes=(v,key,id)=>Array.isArray(v[key])&&v[key].includes(id);
function migrate(value){
 if(value?.edition!=='misterio-ilha')return {};
 if(value.version===10)return value;
 if(value.version===9){
  // Finished chapters and completed saves never reopen because errands changed.
  const completed=RIVALS.filter(id=>includes(value,'deliveries',id));
  const conversations=completed.flatMap(id=>POST_QUESTS[id].route.map(person=>reportKey(id,person)));
  const witnesses=[...new Set(completed.flatMap(id=>POST_QUESTS[id].route))];
  return {...value,version:10,conversations,witnesses};
 }
 if(value.version===8){const ids=key=>(Array.isArray(value[key])?value[key]:[]).map(id=>id==='betinho'?'larissa':id);return migrate({...value,version:9,caseId:savedCase(value),wins:ids('wins'),requests:ids('requests'),dosed:ids('dosed'),deliveries:ids('deliveries'),juiceFor:value.juiceFor==='betinho'?'larissa':value.juiceFor,accused:value.finalBriefing?savedCase(value):null,finalWon:value.finalBriefing===true});}
 if(value.version===7)return migrate({...value,version:8,appearance:normalizeAppearance(value.appearance,value.avatar)});
 if(value.version!==6)return {};
 const old=['gabriel','neco','davi','beto','andre','romulo'];let count=0;
 if(value.cup)for(const id of old){if(!includes(value,'wins',id))break;count++;}
 const wins=RIVALS.slice(0,count);
 return migrate({...value,version:8,migratedFrom6:true,wins,requests:[...wins],dosed:[...wins],deliveries:[...wins],juiceFor:null,clues:includes(value,'clues','purple-vial')?['purple-vial']:[],lessonSkipped:false,appearance:normalizeAppearance(null,value.avatar)});
}
export function readAdventure(value){
 const v=migrate(value),has=(key,id)=>includes(v,key,id);
 const welcomed=v.welcomed===true,felipeIntro=welcomed&&v.felipeIntro===true;
 const clues=felipeIntro?CLUES.filter(c=>has('clues',c.id)).map(c=>c.id):[];
 const history=clues.includes('purple-vial')&&v.history===true,met=history&&v.met===true,trained=met&&v.trained===true,barVisited=trained&&v.barVisited===true,cup=barVisited&&v.cup===true;
 const wins=[];if(cup)for(const id of RIVALS){if(!has('wins',id))break;wins.push(id);}
 const conversations=[];
 for(const id of wins){for(const person of POST_QUESTS[id].route){const key=reportKey(id,person);if(!has('conversations',key))break;conversations.push(key);}}
 const deliveries=[];for(const id of wins){if(!has('deliveries',id)||!POST_QUESTS[id].route.every(person=>conversations.includes(reportKey(id,person))))break;deliveries.push(id);}
 const next=RIVALS[wins.length],available=deliveries.length===wins.length;
 const requests=cup?RIVALS.filter(id=>wins.includes(id)||id===next&&available&&has('requests',id)):[];
 const dosed=requests.filter(id=>wins.includes(id)||has('dosed',id));
 const juiceFor=available&&next&&requests.includes(next)&&!dosed.includes(next)&&v.juiceFor===next?next:null;
 const caseId=savedCase(v),accused=deliveries.length===6&&v.accused===caseId?caseId:null;
 const finalWon=Boolean(accused&&v.finalWon===true);
 const finalBriefing=finalWon&&v.finalBriefing===true,champion=finalBriefing&&v.champion===true;
 const avatar=v.avatar==='player-f'?'player-f':'player-m';
 return {edition:'misterio-ilha',version:10,caseId,accused,finalWon,begun:v.begun===true||welcomed,name:cleanName(v.name),avatar,variant:[1,2].includes(v.variant)?v.variant:0,appearance:normalizeAppearance(v.appearance,avatar),welcomed,felipeIntro,history,met,trained,lessonSkipped:trained&&v.lessonSkipped===true,barVisited,cup,wins,requests,dosed,tasks:[...dosed],deliveries,conversations,juiceFor,clues,witnesses:[...NPCS,...AMBIENT_NPCS].filter(n=>has('witnesses',n.id)).map(n=>n.id),migratedFrom6:v.migratedFrom6===true,finalBriefing,champion,creditsSeen:champion&&v.creditsSeen===true,visited:[...NPCS,...AMBIENT_NPCS].filter(n=>has('visited',n.id)).map(n=>n.id),places:[],balls:[],delivered:[],delivery:null,extraTrained:false,betoStory:false,rainStage:'none',rainChats:[],foice:false,foiceQuest:false,pickleball:trained&&v.pickleball===true,rested:false,legacyChampion:false};
}
export function pendingDelivery(value){const s=readAdventure(value);return s.wins.find(id=>!s.deliveries.includes(id))||null;}
export function stageOf(value){const s=readAdventure(value);return !s.welcomed?'welcome':!s.felipeIntro?'first-bar':!s.clues.includes('purple-vial')?'first-clue':!s.history?'history':!s.met?'find_coach':!s.trained?'lesson':!s.barVisited?'bar':!s.cup?'cup':s.wins.length<6||s.deliveries.length<6?'circuit':!s.accused?'final-guide':!s.finalWon?'final-match':!s.finalBriefing?'final-thanks':!s.champion?'celebrate':'champion';}
export function canChallenge(value,id){const s=readAdventure(value);return s.cup&&RIVALS.includes(id)&&(s.wins.includes(id)||!pendingDelivery(s)&&RIVALS[s.wins.length]===id&&s.dosed.includes(id));}
export function taskComplete(value,id){const s=readAdventure(value);return Boolean(QUESTS[id]&&s.requests.includes(id)&&QUESTS[id].items.every(x=>s.clues.includes(x)));}
export function questItems(value){
 // Legacy item IDs remain in saves, but clues now come from conversations.
 return [];
}
export function advanceAdventure(value,event){
 const s=readAdventure(value),stage=stageOf(s),next=RIVALS[s.wins.length],post=pendingDelivery(s);
 if(event.type==='profile'){if(!s.begun)s.caseId=chooseCase();s.begun=true;s.name=cleanName(event.name);s.avatar=event.avatar==='player-f'?'player-f':'player-m';s.variant=[1,2].includes(event.variant)?event.variant:0;s.appearance=normalizeAppearance(event.appearance,s.avatar);}
 if(event.type==='visit'&&personById(event.id)&&!s.visited.includes(event.id))s.visited.push(event.id);
 if(event.type==='welcome')s.welcomed=true;
 if(event.type==='felipe-clue'&&stage==='first-bar')s.felipeIntro=true;
 if(event.type==='clue-received'){
  const valid=event.id==='purple-vial'&&event.from==='carolina'&&stage==='first-clue'||event.id==='prop-leg'&&event.from==='lourenco'&&stage==='circuit'&&!post&&next==='gabriel'&&s.requests.includes('gabriel');
  if(valid&&!s.clues.includes(event.id)){s.clues.push(event.id);if(!s.witnesses.includes(event.from))s.witnesses.push(event.from);}
 }
 if(event.type==='club-history'&&stage==='history')s.history=true;
 if(event.type==='meet-coach'&&s.history)s.met=true;
 if(event.type==='lesson-passed'&&s.met)s.trained=true;
 if(event.type==='lesson-skipped'&&s.history){s.met=true;s.trained=true;s.lessonSkipped=true;}
 if(event.type==='bar-visited'&&stage==='bar')s.barVisited=true;
 if(event.type==='cup-introduced'&&stage==='cup')s.cup=true;
 if(event.type==='boss-request'&&s.cup&&!post&&next===event.id&&!s.requests.includes(next))s.requests.push(next);
 if(event.type==='juice-collected'&&next===event.id&&!post&&taskComplete(s,next)&&!s.dosed.includes(next))s.juiceFor=next;
 if(event.type==='juice-given'&&next===event.id&&s.juiceFor===next&&taskComplete(s,next)){s.dosed.push(next);s.juiceFor=null;}
 if(event.type==='challenge-completed'&&event.success===true&&canChallenge(s,event.id)&&!s.wins.includes(event.id))s.wins.push(event.id);
 if(event.type==='witness-heard'&&post===event.id&&nextWitness(s,post)===event.person){
  s.conversations.push(reportKey(post,event.person));if(!s.witnesses.includes(event.person))s.witnesses.push(event.person);
  if(!nextWitness(s,post))s.deliveries.push(post);
 }
 if(event.type==='suspect-noted'&&s.welcomed&&['beto','evandro','romulo'].includes(event.id)&&!s.witnesses.includes(event.id))s.witnesses.push(event.id);
 if(event.type==='accuse'&&stage==='final-guide'&&event.id===s.caseId)s.accused=event.id;
 if(event.type==='final-won'&&stage==='final-match'&&event.id===s.caseId&&event.success===true)s.finalWon=true;
 if(event.type==='final-briefing'&&stage==='final-thanks')s.finalBriefing=true;
 if(event.type==='crowned'&&s.finalBriefing)s.champion=true;
 if(event.type==='credits-seen'&&s.champion)s.creditsSeen=true;
 if(event.type==='pickleball-won'&&s.trained)s.pickleball=true;
 return readAdventure(s);
}
export const isRaining=()=>false;
export function objective(value){
 const s=readAdventure(value),stage=stageOf(s),next=RIVALS[s.wins.length],post=pendingDelivery(s);
 if(stage==='circuit'){
  if(post){const q=POST_QUESTS[post],target=nextWitness(s,post),index=q.route.indexOf(target);return {title:q.title,text:`Conversa ${index+1} de ${q.route.length}: fale com ${personById(target).name}. ${q.hint}`,target};}
  const q=QUESTS[next],person=personById(next),previous=RIVALS[s.wins.length-1];
  if(!s.requests.includes(next)){const target=previous?POST_QUESTS[previous].recipient:next;return {title:'Quem precisa do próximo suco?',text:previous?'Converse com '+personById(target).name+' para saber quem precisa de ajuda agora.':'Gabriel parece estar com muita fome. Converse com ele.',target};}
  if(!taskComplete(s,next))return {title:q.title,text:q.hint,target:q.helper};
  if(s.dosed.includes(next))return {title:'Tratamento · '+person.name,text:CHALLENGES[next].instructions+' O suco já está fazendo efeito; tentativas são livres.',target:next};
  if(s.juiceFor===next)return {title:'Suco para '+person.name,text:'Entregue a dose a '+person.name+'. O suco segura a infecção; o desafio em quadra completa a cura.',target:next};
  return {title:'Uma dose para '+person.name,text:'Pegue com Felipe, no bar, uma dose lacrada de suco antizumbi para '+person.name+'.',target:'felipe'};
 }
 return {
 welcome:{title:'NÃO COMA NADA',text:'Leandro espera na entrada. A infecção está começando, mas ainda há tempo.',target:'leandro'},
 'first-bar':{title:'Uma porção suspeita',text:'Procure Felipe. Ele não comeu a porção e está procurando a receita do antídoto.',target:'felipe'},
 'first-clue':{title:'Carolina encontrou uma pista',text:'Converse com Carolina. Ela achou o frasco da decoração e guardou o rótulo para os detetives.',target:'carolina'},
 history:{title:'Suco e tênis?',text:'Mostre o rótulo a Leandro para descobrir o tratamento.',target:'leandro'},
 find_coach:{title:'Revisar ou pular a aula',text:'Fale com Renato. Se já jogou o Legado, escolha “Já sei jogar — pular aula”.',target:'renato'},
 lesson:{title:'Renato · treino opcional',text:'Faça a aula ou volte a Renato e escolha pular. As duas opções seguem a história.',target:'renato'},
 bar:{title:'O suco antizumbi',text:'Volte a Felipe. A receita está pronta e não leva o sal da porção.',target:'felipe'},
 cup:{title:'O plano de tratamento',text:'Leandro indica o primeiro paciente. Cada pessoa curada e cada conversa ajudam a reconstruir a noite.',target:'leandro'},
 'final-guide':{title:'Quem mexeu na porção?',text:'Reúna as lembranças no caderno de pistas e conte sua conclusão ao Leandro.',target:'leandro'},
 'final-match':{title:'O último jogo',text:'Leandro organizou a última etapa do tratamento. Converse com '+personById(s.caseId).name+' e cumpra o desafio.',target:s.caseId},
 'final-thanks':{title:'Mistério resolvido!',text:'Volte a Leandro. Ele vai chamar a turma para a cura coletiva e a comemoração no bar.',target:'leandro'},
 celebrate:{title:'Suco e tênis para todo mundo',text:'Vá ao bar e toque o sino. Os pacientes recuperados vão ajudar no tratamento da turma.',target:'bar'},
 champion:{title:'Turma recuperada!',text:'Convide qualquer personagem para um amistoso ou reveja o final com Leandro.',target:'leandro'},
 }[stage];
}
export function duelRules(id){return {points:999,cpuSpeed:CHALLENGES[id]?.difficulty||.6,label:'TRATAMENTO ANTIZUMBI'};}
export function rewards(value){const s=readAdventure(value),xp=s.clues.length*30+s.conversations.length*20+s.wins.length*120+s.deliveries.length*40+Number(s.trained)*150+Number(s.champion)*300;return {xp,level:Math.min(10,1+Math.floor(xp/160)),attributes:[['Técnica',Math.min(5,1+Number(s.trained)*2+Math.floor(s.wins.length/3))],['Investigação',Math.min(5,1+Math.floor(s.wins.length/2)+Math.floor(s.conversations.length/6))],['Coragem',Math.min(5,1+s.wins.length)]],badges:s.wins.map(id=>'Curado · '+personById(id).name).concat(s.champion?['Turma recuperada']:[])};}
export const journalText=value=>{const o=objective(value);return o.title+'\n'+o.text;};
