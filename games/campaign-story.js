// Short, fictional conversations. Story decisions live in adventure.js.
import {RIVALS,stageOf,canChallenge,objective} from './adventure.js';
import {CHAT} from './legado-story.js';

const route=(label,id,event)=>({label,route:id,event});
const mission={label:'Minha missão',mission:true};
const request={
 lourenco:['Pequeno, mas Gigante','Quer me desafiar? Sou jovem, mas jogo como gente grande: até a última bola! Minha cabeça não desiste. E a sua? Vamos ver se você aguenta a pressão da Copa.','Vença o Gael no pickleball e volte aqui. Ele manda na quadra azul. Se conseguir vencê-lo, eu aceito seu desafio!','Enfrentar Gael','gael'],
 gabriel:['El Bigodón','Meu bigode está pronto. Mas estamos sem bolinhas para jogar!','Três bolinhas foram parar na quadra abandonada. Pegue uma por uma e traga todas para mim, aqui no estacionamento. Aí eu aceito seu desafio!','Ir buscar!','abandoned-court'],
 davi:['Next Gen','Sou o último campeão da Copa do Legado. Aqui a nova geração não dá desconto por idade!','Antes do nosso jogo, faça uma aula de boas maneiras com Emerson. Depois tem uma prova: acerte pelo menos 3 de 4 perguntas e eu aceito o desafio. Craque também respeita a turma!','Falar com Emerson','emerson'],
 evandro:['O Incansavelmente Cansado','Eu até jogaria agora… mas cansei só de pensar no aquecimento.','Busca um Suco do Tenista com Felipe para mim? Preciso de energia para jogar. Estou no banco perto da quadra azul, economizando cada passo.','Ir ao bar','felipe'],
 andre:['O Malvado','Quer me enfrentar? Técnica você até tem. Quero ver o psicológico.','Ouça uma história inteira do Beto. Inteira. Se aguentar o retorno da Lua, talvez aguente meu saque.','Conversar com Beto','beto'],
};
export const BOSS_WIN={
 lourenco:'“Boa! Lutei até a última bola, mas você foi melhor. Sua medalha é merecida! Agora procure Gabriel no estacionamento. O bigode dele está te esperando!”',
 gabriel:'“Jogou muito! Obrigado pelas bolinhas e pela partida. Receba sua medalha! Meu bigode pede revanche, mas primeiro procure Davi perto da quadra azul.”',
 davi:'“Mandou bem! Renato e Emerson te prepararam mesmo. Essa medalha é sua. Agora vá atrás do Evandro. Deve estar descansando do descanso no banco da quadra azul.”',
 evandro:'“Você ganhou porque eu estava cansado. Antes, durante e depois. Procura o André… eu vou ficar sentado mais um pouco.”',
 andre:'“Tá bom. Você ganhou. NÃO PRECISA SORRIR TANTO. Procura o Leandro: ele explica a última encrenca.”',
 romulo:'“Você leu meu corte! A Foice não ganhou esse jogo. Foi sua raquete. Receba a sexta medalha! Agora procure Leandro. Ele vai organizar a premiação.”',
};
export const POSTGAME={
 gael:'Campeão de tênis? Legal. Aqui na azul sua carteirinha continua provisória. Revanche?',
 lourenco:'Da próxima vez eu volto mais forte. E com dois lanches. Parabéns, lenda!',
 gabriel:'A taça ficou bonita. Só não é mais bonita que meu bigode.',
 emerson:'Virou lenda? Ótimo! Falta só mais uma aula.',
 davi:'Respeita a nova geração… e deixa a taça comigo só para uma foto?',
 evandro:'Eu ia te aplaudir de pé, mas o físico pediu recuperação.',
 andre:'Parabéns. Pronto, falei. Não espalha.',
 romulo:'Guardamos a Foice. O Facão continua na raquete. Quando quiser, tem revanche.',
 renato:'Eu sabia que você chegaria lá! Ia falar isso antes, mas me atrasei.',
 beto:'Na Lua seu título já está homologado. Falta só o carimbo de Saturno.',
 felipe:'Campeão da Copa, freguês da casa. A porção não cabe na taça, mas a gente tentou.',
 leandro:'Mais uma lenda revelada pelo meu sorteio impecável. O ChatGPT confirma. Eu acho.',
};
export function conversation(s,id){
 const stage=stageOf(s),next=RIVALS[s.wins.length];
 if(s.champion){
  const action=RIVALS.includes(id)?{label:'Pedir revanche',duel:id}:id==='emerson'?{label:'Rever aula e prova',theory:true}:id==='renato'?{label:'Repetir a aula',lesson:id}:id==='gael'?{label:'Jogar pickleball',pickle:true}:id==='leandro'?{label:'Rever as fotos e os créditos',party:true}:mission;
  return {pages:[POSTGAME[id]],actions:[action]};
 }
 if(id==='leandro'){
  if(stage==='welcome')return {pages:[`Bem-vindo ao Ilha, ${s.name}! Aqui a gente leva o tênis a sério. As desculpas depois do jogo, mais ainda.`,`Dê uma volta: conheça as duas quadras de tênis, o bar, a quadra de pickleball, a casa mal-assombrada e o rio. Siga a marca amarela e toque em Interagir em cada parada. Depois volte aqui.`],actions:[{label:'Começar o passeio!',event:{type:'welcome'},mission:true}]};
  if(stage==='history')return {pages:[
   'Dizem que o Ilha começou com três amigos, uma raquete velha e uma rede improvisada. O primeiro jogo terminou quando alguém gritou “foi fora!”.',
   'Até hoje ninguém concorda com aquela marca. Enquanto discutiam, apareceu mais gente, fizeram as quadras e Felipe abriu o bar. A discussão virou tradição.',
   'É por isso que o clube nunca fica vazio: metade vem jogar, a outra metade vem explicar por que perdeu. Agora procura o Renato. Sua história começa na aula!',
  ],actions:[route('Procurar Renato','renato',{type:'club-history'})]};
  if(stage==='cup')return {pages:[
   'Tomou o Suco do Tenista? Parabéns! Agora você está oficialmente na Copa do Legado!',
   'São seis adversários, seis medalhas e a grande taça. Cada chefe entrega uma medalha quando você vence. Pode olhar sua coleção no botão Medalhas!',
   'Cada jogador tem uma mania. Resolva o pedido dele e ganhe o tie-break: 7 pontos, dois de vantagem. Em 10 a 10, o próximo ponto decide. Comece pelo Lourenço perto da quadra de pickleball!',
  ],actions:[route('Entrar na Copa','lourenco',{type:'cup-introduced'})]};
  if(stage==='circuit'&&next==='romulo'&&!s.foiceQuest)return {pages:[
   'Cinco vitórias! Deixe eu ver suas medalhas… Parabéns, você manda bem no tênis! Agora falta Rômulo, o Facão. O slice dele é tão baixo que passa por baixo de uma discussão.',
   'Para enfrentar o Facão, só com a Foice Lendária! Está escondida atrás da casa mal-assombrada. Contorne a casa pelo lado esquerdo. Se a porta ranger, é o Beto ligando a nave.',
   'Calma: é um amuleto cenográfico da Copa. Pegue a Foice, guarde fora da quadra e enfrente Rômulo com a raquete. Seguro é seguro!',
  ],actions:[route('Buscar a Foice','foice',{type:'foice-revealed'})]};
  if(stage==='final-guide')return {pages:[
   'Você conseguiu, '+s.name+'! Seis adversários, seis medalhas e muita história para contar. Parabéns — você conquistou isso dentro da quadra!',
   'Obrigado por entrar nessa aventura e por reunir a turma toda pelo caminho. A Copa termina, mas o que faz o Ilha especial é todo mundo que vive essas histórias com a gente.',
   'Agora vá para o bar buscar a Taça do Legado. Eu vou chamar todo mundo para a premiação — ninguém vai perder essa foto!',
  ],actions:[route('Ir buscar a taça no bar','bar',{type:'final-briefing'})]};
  if(stage==='celebrate')return {pages:['Você conseguiu! Vá para o bar. A turma e sua taça estão esperando!'],actions:[route('Ir para a festa','bar')]};
 }
 if(id==='felipe'){
  if(stage==='celebrate')return {pages:['Chegou a lenda! Reservei uma mesa para a turma inteira. A taça não serve para dividir a porção, viu?'],actions:[{label:'Começar a festa ★',party:true}]};
  if(stage==='bar')return {pages:['Já fez a aula com Renato? Então aqui está: Suco do Tenista! Receita secreta: fruta, gelo e uma boa dose de coragem para encarar a Copa do Legado.','Beba tranquilo. O brilho passa, mas o que você aprendeu fica! Agora volte ao Leandro. Ele vai explicar o caminho para se tornar campeão.'],actions:[route('Tomar o suco e voltar','leandro',{type:'bar-visited'})]};
  if(next==='evandro'&&s.requests.includes(next)&&!s.delivered.includes(next)){
   if(s.delivery===next)return {pages:['O suco já está com você! Leve ao Evandro antes que o gelo desista.'],actions:[route('Entregar o suco',next)]};
   return {pages:['O Suco do Tenista do Evandro está pronto. É para tomar agora! Se ele disser que perdeu por cansaço, saiba que reservou essa desculpa ontem.'],actions:[route('Pegar e entregar',next,{type:'drink-collected',id:next})]};
  }
 }
 if(id==='renato'&&s.history)return {pages:[s.trained?'O aluno voltou! Vamos rever os gestos e a mira, no seu ritmo. Dessa vez eu cheguei no horário. Mais ou menos.':'Eu estava esperando você! Vou ensinar os gestos do tênis: saque, golpes, mira e força. Primeiro veja o dedo na tela; depois é sua vez. Sem pressa e sem perder pontos. Só não me acerte, hahaha!'],actions:[{label:s.trained?'Repetir a aula':'Começar a aula',lesson:id,event:{type:'meet-coach'}}]};
 if(id==='emerson'&&s.trained){
  if(s.extraTrained)return {pages:['Você já mostrou que sabe cuidar da quadra e respeitar a turma! Quer rever as lições e tentar uma nova prova?'],actions:[{label:'Rever aula e prova',theory:true},mission]};
  if(s.requests.includes('davi'))return {pages:['Davi mandou? Vamos aprender cinco combinados para jogar e conviver bem. Eu ensino primeiro. Depois são quatro perguntas: acertando três, você passa. Se errar, eu explico e a gente tenta de novo!'],actions:[{label:'Começar aula extra',theory:true}]};
  return {pages:['Jogar bem também é respeitar os colegas e cuidar do clube. Quando Davi pedir, eu ensino cinco combinados e faço uma prova com você. Os gestos de raquete você pode rever com Renato!'],actions:[route('Rever golpes com Renato','renato'),mission]};
 }
 if(RIVALS.includes(id)){
  if(id==='andre'&&s.betoStory&&['raining','waiting'].includes(s.rainStage))return {pages:[s.rainStage==='raining'?'Você sobreviveu à história do Beto… mas olha essa chuva! Na quadra molhada não dá para jogar. Vai trocar uma ideia com o pessoal pelo clube enquanto o tempo melhora. Converse com quatro pessoas diferentes e volte aqui!':`Ainda está chovendo! Você já conversou com ${s.rainChats.length} de 4 pessoas diferentes. Vale a turma toda: pode aproveitar para conhecer quem chegou agora. Vou ficar de olho no tempo.`],actions:[s.rainStage==='raining'?{label:'Vou conversar com a turma',event:{type:'rain-wait'},mission:true}:mission]};
  if(id==='gabriel'&&s.balls.length===3&&!s.delivered.includes(id))return {pages:['As três bolinhas! Entrega impecável. O bigode agradece! Agora vamos ver sua raquete.'],actions:[{label:'Entregar as três bolinhas',event:{type:'balls-delivered'},again:true}]};
  if(s.delivery===id)return {pages:['Deixe eu beber primeiro… Até brilhei! Agora posso jogar. Cansado, mas posso.'],actions:[{label:'Entregar e combinar o jogo',event:{type:'drink-delivered',id},again:true}]};
  if(canChallenge(s,id)){
   const ready={lourenco:'Você conseguiu ganhar do Gael? Parabéns, você tem futuro. Desafio aceito!',gabriel:'Bolinhas entregues, bigode alinhado. Desafio aceito!',davi:'Passou na prova do Emerson! Respeito e raquete preparados. Desafio aceito!',evandro:'Suco tomado. Desafio aceito! Vou levantar do banco… só um instante.',andre:'Beto viajou muito? Hahaha! A chuva passou, você conheceu mais gente e a quadra já está pronta. Agora sim: eu aceito o desafio!',romulo:'Você encontrou a Foice Lendária? Então aceito seu desafio! Vamos à final.'};
   return {pages:[`${s.wins.includes(id)?'Voltou para a revanche? Medalha conquistada fica na coleção. Agora vamos jogar mais uma!':ready[id]}\n\nTie-break de 7. Dois de vantagem; em 10 a 10, ponto decisivo.${id==='romulo'?' A Foice fica guardada fora da quadra. Aqui só entra raquete.':''}`],actions:[{label:s.wins.includes(id)?'Pedir revanche':id==='romulo'?'Disputar a final':'Jogar!',duel:id}]};
  }
  if(s.cup&&next===id&&request[id]){
   const [,first,second,label,target]=request[id];
   if(!s.requests.includes(id))return {pages:[first,second],actions:[route(label,target,{type:'boss-request',id})]};
   return {pages:[second],actions:[mission]};
  }
 }
 if(id==='gael')return {pages:[s.requests.includes('lourenco')&&!s.wins.includes('lourenco')?'Lourenço te mandou? Muito bem. Aqui quem manda sou eu! Se me vencer, seu desafio com ele está liberado. Mas no pickleball você joga comigo! Primeiro a cinco, antes do meu lanche.':'Raquete pequena, autoridade gigante. Quer jogar? Cinco pontos e depois tem lanche!'],actions:[{label:'Jogar pickleball',pickle:true}]};
 if(id==='beto'&&s.requests.includes('andre')&&!s.betoStory)return {pages:[
  'André mandou você ouvir minhas histórias? Então senta. Tudo começou quando Renato bateu um balão que não voltou.',
  'Peguei minha nave — aquela casinha ali, não julgue a lataria, ela está disfarçada — e fui buscar a bola na Lua. Trânsito terrível na Via Láctea.\n\nOpa… começou a chover! Deve ser a lavagem da nave. Minha história continua!',
  'Na cratera encontrei um extraterrestre treinando slice. Disse que aprendeu com Rômulo. Eu acreditei: a bola nem quicava.',
  'Voltei de carona num cometa. A bola? Esqueci no porta-luvas. Mas trouxe uma certeza: o saque de André dá para ouvir do espaço.',
  'Você ouviu até o fim! Receba a medalha extra da Paciência Intergaláctica. Volte ao André e veja como fica o jogo com essa chuva. Depois conto a viagem de volta… em três volumes.',
 ],actions:[route('Voltar ao André','andre',{type:'beto-story-heard'})]};
 return {pages:[`${CHAT[id]}\n\n${objective(s).text}`],actions:[mission]};
}

export const PARTY=[
 ['leandro','Taça do Legado', 'Seis adversários, seis medalhas, bolinhas resgatadas e lições dentro e fora da quadra. Você venceu a Copa do Legado! Esta taça é sua. Bem-vindo às lendas da Ilha!'],
 ['gael','O Pequeno General','Parabéns! Mas na próxima Copa vai ter pickleball na final. Já estou escrevendo o regulamento.'],
 ['lourenco','Pequeno, mas Gigante','Você lutou até a última bola. Gostei disso. Na revanche, vou lutar mais uma.'],
 ['gabriel','El Bigodón','Vitória merecida! Meu bigode pediu para sair do lado bom na foto. São os dois lados.'],
 ['emerson','Só mais uma','Agora descansa… depois de só mais uma foto, um saque e três cestas de bola.'],
 ['davi','Next Gen','Pode ficar com a taça por enquanto. A nova geração já está atualizando o treino.'],
 ['evandro','Pausa para descansar','Levanta a taça por mim também? Estou poupando energia para comemorar.'],
 ['andre','O Malvado','Jogou bem. Não vou repetir. E quem piscou na foto vai correr dez voltas.'],
 ['romulo','O Facão','Respeitou o corte, teve paciência e ganhou. A Foice fica na coleção; o mérito fica com você.'],
 ['renato','Professor da lenda','Cheguei! Já entregaram a taça? Eu estava no estacionamento… desde antes de começar.'],
 ['beto','Transmissão intergaláctica','Sua vitória está sendo transmitida para Saturno. O sinal chega daqui a uns anos, mas a audiência é boa.'],
 ['felipe','A resenha continua','Sai uma porção para a mesa das lendas! Trouxe garfos para a turma toda. André, isso não é competição.'],
];
export const CREDITS=[
 ['gael','Tentou levar a taça para a quadra azul. Kalinca lembrou que campeão também bebe água.\n\nPróximo plano: colocar pickleball em todas as finais.'],
 ['lourenco','Pequeno no tamanho, gigante até o último ponto. Já pediu revanche e preparou dois lanches para o treino.'],
 ['davi','A nova geração saiu da foto direto para a quadra. Prometeu buscar a taça de volta — com respeito e uma boa devolução.'],
 ['renato','Renato chega para a foto. A foto já foi tirada.'],
 ['emerson','Emerson organiza só mais uma foto. Renato é salvo.'],
 ['beto','Beto procura sua bolinha entre as estrelas.'],
 ['evandro','Evandro dorme antes de terminar a comemoração.'],
 ['andre','André reclama que saiu simpático demais na foto.'],
 ['gabriel','Gabriel penteia o bigode usando o reflexo da taça.'],
 ['felipe','Felipe aparece com uma porção maior que o troféu.'],
 ['romulo','Rômulo guarda a Foice. O armário pede revanche.'],
 ['kalinca','Achou Gael, a garrafinha e quase toda a turma. Antes de ir embora, fez a chamada duas vezes. Dessa vez ninguém fica no clube!'],
 ['malu','Vendeu a camisa, organizou a foto e reservou a quadra. Gael ainda acha que manda no pickleball. Ela deixou ele acreditar.'],
 ['higor','Aplaudiu sentado, com o pé descansando. O Desesperador promete voltar na próxima Copa. Esperar até lá? É desesperador.'],
 ['vanessa','Indicou o caminho do banheiro e voltou para perto da quadra azul. Na foto todo mundo aprendeu: o nome dela é Vanessa. Não é tia!'],
 ['bernar','Trouxe raquetes para a turma e jogou conversa fora com o campeão. A BP Sport garantiu o equipamento; a desculpa ficou por conta de cada um.'],
 ['scarlt','Conferiu se Beto estacionou a nave direito. A foto ficou linda, mas ela ainda está esperando uma viagem que termine antes do jantar.'],
 ['michele','Finalmente encontrou Larissa na festa. As duas combinaram o próximo jogo — desta vez com horário, quadra e ponto de encontro!'],
 ['larissa','Chegou do outro lado do clube para a foto. Encontrou Michele, riu da confusão e prometeu esperar no lugar combinado.'],
 ['betinho','Saiu na foto com o pai. Só precisou pedir para Beto parar de apontar Saturno por cinco segundos. Cinco segundos terrestres.'],
 ['leandro','Reuniu a turma para a última foto e abriu o clube para novas partidas. A taça encontrou uma lenda. A Ilha ganhou mais uma história.'],
];
