import {NPCS,RIVALS,QUESTS,POST_QUESTS,stageOf,canChallenge,taskComplete,objective,pendingDelivery,personById} from './adventure.js';
import {CHALLENGES} from './halloween-challenges.js';
import {CASES,evidenceFor,suspectDescription,finalRule,reconstruction} from './mystery.js';
import {nextWitness,witnessPages,AFTER_PARTY} from './investigation.js';
const mission={label:'Seguir a missão',mission:true};
const route=(label,id,event)=>({label,route:id,event});
export const OPENING=[
 ['leandro','Você chegou! Primeiro de tudo…\n\nNÃO COME NADA.'],
 ['leandro','A turma ainda consegue conversar. As crianças escaparam da porção e vão ajudar a investigar. Toma esta raquete e procura Felipe no bar: ele está preparando o antídoto. Eu cuido daqui!'],
];
export const WITNESS_LINES={
 maisa:'Eu estava na caça aos doces com as crianças. Não comemos a porção. Agora temos um clube de detetives: cada pessoa curada lembra de uma pista!',
 carolina:'Eu guardei o rótulo do frasco da decoração. Lourenço guardou a perna de manequim antes que o Gabriel pedisse farofa… Nossa equipe já começou a investigar!',
 bernado:'Estou de olho em quem entra e sai. Detetive precisa observar! Só não vale confundir fantasma com toalha no varal.',
 benicio:'Eu faço as perguntas difíceis: quem, quando, por quê… e quando vai ter lanche NORMAL?',
};
export const BOSS_WIN={
 gabriel:'“Meu bigode voltou! Ainda bem que Lourenço explicou a perna de borracha. O Davi estava na mesa: conversa com ele e leva o relato à Carolina.”',
 vanessa:'“Voltei! Malu sabe quem estava fantasiado, e Kalinca viu as crianças. Fala com elas e com Maisa. Se alguém disser tia-zumbi de novo, eu apito!”',
 higor:'“Curado da infecção, não do pé! Lembrei de um objeto. Pergunta ao Bernar, entrevista Evandro e conta ao Bernado. É desesperador… mas é uma pista!”',
 michele:'“Lembrei do recipiente da mesa! Gael também passou por lá. Fala com ele, entrevista Beto e leva tudo à Maisa.”',
 larissa:'“Ganhei e parei de ficar verde! André ouviu uma frase na mesa. Betinho e Benicio estão juntando as informações: conversa com os três.”',
 scarlt:'“O pó veio da caixa de decoração! Falta entrevistar Rômulo e ler o rótulo que Emerson guardou. Depois, conte tudo ao Leandro.”',
};
export const REFERRALS={
 gabriel:'Relato de Davi anotado! Vanessa precisa da próxima dose. Vou organizar as pistas enquanto você ajuda ela. Só não chama de tia.',
 vanessa:'Confirmamos onde as crianças estavam. Agora Higor precisa de suco e uma troca de bola tranquila. A muleta continua: o tratamento é contra a infecção.',
 higor:'Perfil de Evandro anotado. Agora ajuda Michele: a lembrança dela pode confirmar qual recipiente estava na mesa.',
 michele:'Perfil de Beto anotado e relato de Gael confirmado. Larissa é a próxima: o tratamento dela precisa devolver a confiança. Desta vez, deixa ela ganhar!',
 larissa:'Os relatos combinam! Scarlt viu a caixa de Halloween. Falta ajudar ela, entrevistar Rômulo e conferir o rótulo com Emerson.',
};
export const ZOMBIE_CHAT={
 gael:'Eu estava na caça aos doces! Não comi a porção. Agora vigio a quadra azul. Zumbi não pode comer a bolinha de pickleball!',
 lourenco:'Pequeno é meu tamanho, não minha coragem. Não comi a porção e vou ajudar a turma a melhorar!',
 malu:'Não comi a porção. Estava na caça aos doces com o Gael! Agora separo os uniformes da turma dos detetives.',
 gabriel:'Lourenço guardou um pedaço de perna da festa… Será que vem com farofa? Não me olha assim, é a infecção falando!',
 emerson:'Só mais uma… alma? Aula! Ainda sou eu aqui. Preciso do antídoto antes que eu troque a lista de presença pelo cardápio.',
 davi:'Ainda não virei zumbi completo, mas já evoluí para verde. Essa atualização eu não pedi.',
 evandro:'Antes eu estava morto de cansaço. Agora estão levando a expressão muito a sério.',
 andre:'Eu já era malvado. Essa vontade de morder a rede é novidade.',
 romulo:'Mais um set… e nada de comida roxa. Ainda consigo me controlar!',
 renato:'Eu cheguei atrasado e perdi a porção. Minha pontualidade finalmente teve alguma utilidade.',
 beto:'Houston, temos um problema na porção. Estou ficando verde, mas ainda lembro onde estacionei a nave. Mais ou menos.',
 felipe:'Suco antizumbi LACRADO! Eu não provei a porção: estava trabalhando. Agora virei cozinheiro e farmacêutico de desenho animado.',
 leandro:'A turma ainda está consciente. Primeiro suco, depois o desafio da pessoa. Quem melhora ajuda a salvar o próximo.',
 ...WITNESS_LINES,
 vanessa:'Estou ficando verde, mas ainda entendo perfeitamente quando alguém me chama de tia. NÃO SOU SUA TIA!',
 higor:'Estou quase virando zumbi e ainda tenho que usar muleta. Até o apocalipse me pegou de mau jeito. É desesperador.',
 michele:'Marquei dupla com a Larissa… marquei dupla com a Larissa… Tá vendo? Minha memória travou na mesma frase!',
 larissa:'Estou ficando verde. Será que alguém deixa eu ganhar uma vez? Prometo comemorar só um pouquinho.',
 scarlt:'Vi alguém mexendo na caixa da casinha. A lembrança está sumindo… e a minha cor também. Preciso virar esse jogo.',
};
export function conversation(s,id){
 const stage=stageOf(s),next=RIVALS[s.wins.length],post=pendingDelivery(s);
 if(s.champion)return {pages:[AFTER_PARTY[id]||'O tratamento funcionou! Agora dá para jogar só por diversão.'],actions:[{label:'Entender as pistas do meu caso',notebook:true},...(id==='leandro'?[{label:'Rever o final',party:true}]:[mission])]};
 if(stage==='final-match'&&id===s.caseId)return {pages:[CASES[s.caseId].excuse,'Foi sem querer, mas vou ajudar a consertar. Já tomei o suco. Quem tocou direto no pó precisa desta última sessão:',finalRule(s).instructions],actions:[{label:'Jogar a partida final',final:true},mission]};
 if(id==='leandro'){
  if(stage==='welcome')return {pages:OPENING.map(([,text])=>text),speakers:OPENING.map(([speaker])=>speaker),actions:[route('Procurar Felipe no bar','felipe',{type:'welcome'})]};
  if(stage==='history')return {pages:['Boa, Carolina guardou o rótulo! O tratamento é suco antizumbi e um desafio de tênis diferente para cada pessoa. Renato pode ensinar os gestos — ou você pode pular a aula e seguir.'],actions:[route('Falar com Renato','renato',{type:'club-history'})]};
  if(stage==='cup')return {pages:['Comece pelo Gabriel. Cure a pessoa, ouça a lembrança e converse com quem ela indicar. As crianças vão cruzar os relatos no caderno. Se perder o desafio, pode tentar de novo sem buscar outro suco.'],actions:[route('Ver o que Gabriel quer','gabriel',{type:'cup-introduced'})]};
  if(stage==='final-guide')return {pages:['Higor viu '+CASES[s.caseId].object+'. Michele e Gael viram '+CASES[s.caseId].container+'.','Você ouviu os três suspeitos. Qual deles confirmou que usa ESSES DOIS objetos? O caderno mostra a comparação. Não é a cor da roupa nem a fama da pessoa.'],actions:[{label:'Comparar as pistas',notebook:true},...Object.entries(CASES).map(([suspect,c])=>({label:'As pistas apontam para '+c.name,accuse:suspect})),mission]};
  if(stage==='final-match')return {pages:[reconstruction(s),'As duas pistas apontam para '+CASES[s.caseId].name+'. Vamos ouvir a explicação e completar o tratamento de quem tocou diretamente no pó.',finalRule(s).instructions],actions:[route('Encontrar '+CASES[s.caseId].name,s.caseId)]};
  if(stage==='final-thanks')return {pages:['Você descobriu o que aconteceu e ajudou nossa turma, '+s.name+'! Obrigado por investigar antes de sair acusando todo mundo.','Vou chamar as crianças, os pacientes recuperados e o restante do clube para o bar. Felipe vai distribuir o suco e a turma vai ajudar nos treinos.','E fica a regra: daqui para a frente, só o Felipe tempera a porção!'],actions:[route('Ir para a comemoração no bar','bar',{type:'final-briefing'})]};
 }
 if(id==='renato'&&s.history&&!s.trained)return {pages:['Eu não comi a porção. Cheguei atrasado! Se você já jogou o Legado, pode pular minha aula e seguir a investigação. Os gestos são os mesmos.','Se quiser, ensino tudo de novo: saque, topspin, slice, deixada, força e direção. Você escolhe.'],actions:[{label:'Já sei jogar — pular aula',event:{type:'lesson-skipped'},route:'felipe'},{label:'Quero fazer a aula',event:{type:'meet-coach'},lesson:'renato'}]};
 if(id==='felipe'){
  if(stage==='first-bar')return {pages:['Eu estava no balcão e não comi. Carolina encontrou o frasco roxo perto da decoração e guardou o rótulo. Ela já montou uma equipe de detetives!','Vai conversar com ela. Enquanto vocês investigam, preparo o suco antizumbi. Só sirvo coisa lacrada daqui para a frente.'],actions:[route('Falar com Carolina','carolina',{type:'felipe-clue'})]};
  if(stage==='bar')return {pages:['Suco antizumbi pronto! É receita de faz de conta, viu? Não vai misturar remédio com suco em casa. Aqui no Ilha mal-assombrado, funciona assim: uma dose lacrada e atividade em quadra.','O efeito continua mesmo se você perder a tentativa. Eu já gasto copo demais no bar. O Leandro vai organizar quem precisa de ajuda primeiro.'],actions:[route('Combinar o plano com Leandro','leandro',{type:'bar-visited'})]};
  if(next&&!post&&taskComplete(s,next)&&!s.dosed.includes(next)){
   const name=personById(next).name;
   return {pages:[s.juiceFor===next?'Você já está com a dose de '+name+'. Não precisa pegar duas: a infecção é estranha, não é open bar.':'Uma dose lacrada para '+name+'. Entregue antes de entrar em quadra. O objetivo do tratamento aparece na conversa e durante o jogo.'],actions:[route(s.juiceFor===next?'Levar o suco a '+name:'Pegar suco para '+name,next,s.juiceFor===next?undefined:{type:'juice-collected',id:next})]};
  }
 }
 if(id==='carolina'&&stage==='first-clue')return {pages:['Achei o frasco da decoração! Não abri e não provei nada. No rótulo está escrito: “NÃO USAR EM COMIDA. Antídoto + atividade em quadra”.','Mostra essa informação ao Leandro. Eu, Maisa, Bernado e Benicio vamos juntar as pistas enquanto você ajuda a turma.'],actions:[route('Anotar o rótulo e falar com Leandro','leandro',{type:'clue-received',id:'purple-vial',from:'carolina'})]};
 if(id==='lourenco'&&next==='gabriel'&&s.requests.includes('gabriel')&&!taskComplete(s,'gabriel'))return {pages:['A perna é do manequim que eu ajudei a montar! Já guardei a decoração. Fala para o Gabriel que borracha não combina com farofa.','Agora pega o suco com Felipe e ajuda ele. Detetive pequeno também resolve problema grande!'],actions:[route('Aviso entendido! Buscar o suco','felipe',{type:'clue-received',id:'prop-leg',from:'lourenco'})]};
 if(post&&nextWitness(s,post)===id){
  const q=POST_QUESTS[post],after=q.route[q.route.indexOf(id)+1];
  return {pages:witnessPages(post,id,s),actions:[{label:after?'Anotar e falar com '+personById(after).name:'Anotar e continuar',event:{type:'witness-heard',id:post,person:id},...(after?{route:after}:{again:true})}]};
 }
 const previous=RIVALS[s.wins.length-1];
 if(next&&previous&&s.deliveries.includes(previous)&&!s.requests.includes(next)&&POST_QUESTS[previous].recipient===id)return {pages:[REFERRALS[previous],CHALLENGES[next].instructions],actions:[route('Vou ajudar '+personById(next).name,'felipe',{type:'boss-request',id:next})]};
 if(RIVALS.includes(id)){
  if(s.wins.includes(id))return {pages:[BOSS_WIN[id],evidenceFor(s)[RIVALS.indexOf(id)].text,POST_QUESTS[id].hint],actions:[mission,{label:'Ver caderno de pistas',notebook:true},{label:'Repetir o desafio, sem mudar a história',duel:id}]};
  if(!s.cup||next!==id||post)return {pages:[ZOMBIE_CHAT[id],'Siga o tratamento na ordem. '+objective(s).text],actions:[mission]};
  if(!s.requests.includes(id))return {pages:[ZOMBIE_CHAT[id],QUESTS[id].hint],actions:[{label:'Ajudar '+personById(id).name,event:{type:'boss-request',id},mission:true}]};
  if(!taskComplete(s,id))return {pages:[ZOMBIE_CHAT[id],QUESTS[id].hint],actions:[mission]};
  if(!s.dosed.includes(id))return {pages:[id==='gabriel'?'É de borracha?! Então cancela a farofa. Melhor tomar esse suco antes que eu peça um braço de sobremesa.':'Ainda estou consciente, mas a infecção está avançando. Trouxe o suco?',s.juiceFor===id?'Uma dose antes da quadra. Depois faça este desafio:\n\n'+CHALLENGES[id].instructions:'Felipe está com a dose lacrada no bar.'],actions:s.juiceFor===id?[{label:'Entregar o suco antizumbi',event:{type:'juice-given',id},again:true}]:[route('Buscar a dose no bar','felipe')]};
  return {pages:['Suco tomado! Agora vamos completar o tratamento.',CHALLENGES[id].instructions],actions:[{label:'Começar o desafio · '+CHALLENGES[id].title,duel:id},mission]};
 }
 return {pages:[ZOMBIE_CHAT[id]||'Vamos ajudar a turma!',...(CASES[id]?[suspectDescription(id)]:[])],actions:[...(CASES[id]&&!s.witnesses.includes(id)?[{label:'Anotar o perfil no caderno',event:{type:'suspect-noted',id},again:true}]:[]),mission,{label:'Caderno de pistas',notebook:true}]};
}
export const POSTGAME=Object.fromEntries(NPCS.map(n=>[n.id,'O suco e o tênis funcionaram. Agora só quero uma porção SEM brilho roxo.']));
