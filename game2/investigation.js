// Short conversations replace the old ground-item errands. Every original
// club member has a required role; children coordinate, never become suspects.
import {CASES,savedCase} from './mystery.js';

export const INVESTIGATION_ROUTES=Object.freeze({
 gabriel:{title:'Quem estava perto da mesa?',route:['davi','carolina'],hint:'Davi estava no bar. Ouça o que ele viu e conte à Carolina.'},
 vanessa:{title:'Verde não é uma pista!',route:['malu','kalinca','maisa'],hint:'Malu e Kalinca ajudam a separar fantasia de infecção. Maisa organiza o relato.'},
 higor:{title:'De quem é esse objeto?',route:['bernar','evandro','bernado'],hint:'Fale com Bernar sobre o objeto lembrado por Higor, entreviste Evandro e procure Bernado.'},
 michele:{title:'O recipiente da mesa',route:['gael','beto','maisa'],hint:'Gael viu o recipiente da mesa. Entreviste Beto e cruze as informações com Maisa.'},
 larissa:{title:'A frase que entregou o engano',route:['andre','betinho','benicio'],hint:'André ouviu uma frase importante. Betinho e Benicio ajudam a conferir o relato.'},
 scarlt:{title:'Fechar a investigação',route:['romulo','emerson','leandro'],hint:'Ouça Rômulo, confirme o rótulo com Emerson e leve a conclusão a Leandro.'},
});
export const reportKey=(chapter,person)=>`${chapter}:${person}`;
export function nextWitness(state,chapter){return INVESTIGATION_ROUTES[chapter]?.route.find(id=>!state.conversations?.includes(reportKey(chapter,id)))||null;}

export function witnessPages(chapter,id,state){
 const c=CASES[savedCase(state)];
 return {
  'gabriel:davi':['Eu estava na mesa! O Felipe ficou no balcão quando o pó caiu. Não foi ele que temperou a porção. Minha evolução para verde veio depois… péssima atualização.','Conta isso à Carolina. Ela está montando a ordem dos acontecimentos, não uma lista de quem ficou mais feio de zumbi.'],
  'gabriel:carolina':['Anotado: Felipe estava no balcão. E a perna do Gabriel era de manequim! Uma investigação, dois sustos a menos.','Agora vamos ajudar a Vanessa. Ela pediu para avisar: pode chamar de paciente, de parceira… de tia, não!'],
  'vanessa:malu':['Eu separei as camisas da festa. Tinha gente de verde ANTES da confusão. Cor de roupa não prova quem mexeu na comida!','Minha mãe, Kalinca, viu onde as crianças estavam. Pergunta para ela antes de inventarem que foi a nossa caça aos doces.'],
  'vanessa:kalinca':['Gael, Malu e os outros pequenos estavam caçando doces longe da mesa. Ninguém ali comeu a porção. Quem ficou verde fui eu… mãe não ganha folga nem no apocalipse!','Conta à Maisa: as crianças podem ajudar a investigar, mas não são suspeitas.'],
  'vanessa:maisa':['Vamos separar as coisas: Felipe estava no balcão; as crianças estavam na caça aos doces. Ficar verde ou usar camisa verde não torna ninguém culpado.','Higor precisa da próxima dose. Vamos fazer uma troca de bola tranquila com ele. A muleta não faz parte do mistério!'],
  'higor:bernar':['O Higor lembrou de '+c.object+'. Isso é um objeto pessoal, não uma decoração da festa. Precisamos descobrir quem costuma carregar isso.','Conversa com Evandro sobre as coisas dele. Depois procura o Bernado, nosso detetive do estacionamento. Eu sou o Bernar, da BP Sport — tem quase um xará nesta investigação!'],
  'higor:evandro':['Minha almofadinha de viagem está sempre comigo. E minha caneca é azul, com uma lua desenhada. São meus equipamentos oficiais para sobreviver acordado a um set.','Se você viu algo parecido, anota. Minha lembrança do bar está embaralhada, mas minhas coisas eu reconheço. O Bernado está juntando os depoimentos.'],
  'higor:bernado':['Perfil anotado: Evandro usa almofadinha e caneca azul com lua. Compare isso com o objeto que Higor viu — não com a cara de sono dele!','Michele é a próxima paciente. Ela estava olhando a mesa e talvez se lembre do recipiente que ficou ao lado do pó.'],
  'michele:gael':['Eu voltei da caça aos doces para buscar minha bolinha. Vi '+c.container+' na mesa do bar. É o mesmo recipiente que a Michele lembrou!','Mas não vi a mão colocando o pó. Pergunta ao Beto quais são as coisas dele. Vou ficar de guarda na quadra azul: sem comer bolinha de pickleball!'],
  'michele:beto':['Meu chaveiro tem um foguete. Minha garrafa é prateada, com uma estrela. Eu levo os dois para todo lado. Equipamento espacial aprovado… por mim mesmo.','Anota meu perfil e leva à Maisa. Não confunda foguete com foice, nem estrela com lua. Até uma nave erra o caminho quando mistura essas coisas.'],
  'michele:maisa':['Agora temos duas observações diferentes: Higor viu '+c.object+'; Michele e Gael viram '+c.container+'.','O dono precisa combinar com AS DUAS coisas. O caderno compara isso para você. Vamos curar Larissa e ouvir o restante antes de tirar uma conclusão.'],
  'larissa:andre':['Eu ouvi a frase: “'+c.phrase+'” Foi perto da porção, antes de todo mundo ficar verde. A pessoa parecia achar que estava ajudando.','Eu tenho fama de malvado, mas nem eu temperaria uma porção com coisa brilhante. O Betinho e o Benicio estão conferindo o que a turma ouviu.'],
  'larissa:betinho':['Meu pai, Beto, vive com um foguete no chaveiro e uma garrafa com estrela. Mas gostar de espaço não é prova de nada, né?','A pista é o que estava NA MESA naquela hora. Compara o objeto e o recipiente. O Benicio está juntando as perguntas para o final.'],
  'larissa:benicio':['Recebido! Objeto, recipiente e a frase que o André ouviu. Não vale apontar alguém só porque perdeu uma partida para ele!','Scarlt viu a caixa de decoração. Cura ela para descobrir de onde veio o pó. Eu vou cuidar da pergunta mais importante: quando vai ter lanche normal?'],
  'scarlt:romulo':['Meu chaveiro é uma foice de brinquedo. Minha garrafa é preta, com duas raquetes. A foice de verdade não veio para a festa, pode ficar tranquilo!','Anota tudo. Eu gosto de “mais um set”, mas é preciso comparar as pistas, não só o bordão. Emerson está com o rótulo completo do frasco.'],
  'scarlt:emerson':['Li o rótulo inteiro: “Sal do Set Impossível. Adereço de Halloween. NÃO USAR EM COMIDA.” Alguém confundiu com tempero energético.','Quem só comeu melhora com o suco e o desafio. Quem mexeu diretamente no pó precisa de uma última sessão em quadra. Leva os relatos ao Leandro; vamos resolver isso sem brigar com ninguém.'],
  'scarlt:leandro':['Você ouviu a turma, e as crianças organizaram tudo. Agora temos os três perfis, o objeto, o recipiente e o rótulo.','Vamos comparar as provas antes de apontar alguém. Foi um engano; nossa missão é descobrir e ajudar a consertar.'],
 }[reportKey(chapter,id)]||[];
}

export const AFTER_PARTY=Object.freeze({
 leandro:'A turma toda ajudou, e ninguém precisou virar vilão. Agora só o Felipe tempera a porção. Quer rever como as pistas se encaixaram?',
 felipe:'A próxima porção vem com um ingrediente revolucionário: tempero normal. O bar voltou a ser bar!',
 renato:'Todo mundo recuperado! Minha próxima aula vai ser de leitura de rótulo… brincadeira, é de saque mesmo.',
 gabriel:'Devolvi a perna de manequim. Agora, se vier com fome, a única coisa que eu mordo é uma batata de verdade.',
 davi:'Voltei para minha cor normal. Essa foi a primeira atualização que eu fiz questão de desfazer!',
 beto:'Houston, porção normalizada. Nave liberada para mais um jogo — sem suplemento espacial no molho.',
 andre:'Continuo malvado na quadra. Fora dela, até eu ajudei com uma pista. Não espalha muito.',
 romulo:'Resolvido! Agora pode ter mais um set. A garrafa continua sendo de água e a foice do chaveiro, de brinquedo.',
 emerson:'Lista de presença: todo mundo humano. Foi minha aula mais estranha, mas a turma passou!',
 lourenco:'Eu expliquei que a perna era de borracha! Pequeno no tamanho, gigante no controle de qualidade do lanche.',
 evandro:'Curado da infecção. Do sono, ainda não. Minha almofadinha e eu já estamos prontos para o próximo intervalo.',
 gael:'Quadra azul liberada! Agora todo mundo pode jogar pickleball, mas a bolinha continua fora do cardápio.',
 kalinca:'Os meninos ajudaram de verdade. Agora que o mistério acabou, só falta convencer essa turma a ir embora!',
 malu:'As camisas dos detetives fizeram sucesso. Na próxima festa vou incluir uma etiqueta: “verde na camisa, não na pele”.',
 higor:'Continuo de muleta, mas não estou mais verde. Uma coisa por vez. É desesperador… mas deu certo!',
 vanessa:'Muito obrigada, detetive. E agradece aos meninos por mim. Só não escrevam “tia Vanessa” nos créditos!',
 bernar:'O equipamento resolveu parte do mistério. Mas o prêmio foi conseguir separar Bernar de Bernado na lista da equipe.',
 scarlt:'Ainda bem que olhamos o rótulo inteiro. Na próxima decoração, o pó fica bem longe da cozinha.',
 michele:'Achei minha dupla e minha memória. Larissa, desta vez o nosso próximo compromisso é um jogo de verdade!',
 larissa:'Eu sei que você deixou eu ganhar no tratamento. Mas comemorei mesmo assim. Agora quero a revanche!',
 betinho:'Meu pai voltou do espaço… e do verde. Eu ajudei a conferir as pistas! Já posso ter um rádio de detetive?',
 carolina:'Caso resolvido! A perna voltou ao manequim e as pistas ficaram no caderno. Na próxima eu escolho uma investigação sem comida esquisita.',
 bernado:'Anotei tudo, sem perder nenhum suspeito de vista. Agora o estacionamento virou a sede oficial dos detetives!',
 benicio:'Descobrimos quem, como e por quê. Só falta responder minha última pergunta: cadê a porção normal?',
 maisa:'Objeto e recipiente combinando: era isso! A equipe dos detetives funcionou. Pode chamar a gente na próxima aventura.',
});
