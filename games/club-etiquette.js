// Short lessons and a four-question quiz; questions always come from these lessons.
export const ETIQUETTE_LESSONS=[
 {id:'quiet',title:'Torça na hora certa',text:'Enquanto a bola está em jogo, fale baixinho e evite gritos ou brincadeiras perto da quadra. Os jogadores precisam se concentrar. Quando o ponto acabar, pode aplaudir!',question:'A bola está em jogo. Como você pode ajudar quem está jogando?',choices:['Gritar para dar uma dica.','Esperar o ponto acabar para torcer.','Bater na grade do alambrado.'],answer:1,explanation:'Esperar o fim do ponto ajuda os jogadores a se concentrar. Depois, aplauda à vontade!'},
 {id:'sweep',title:'Cuide do nosso saibro',text:'Terminou de jogar? Os dois jogadores ajudam a passar a vassoura de arrasto, seguindo a orientação do professor. Isso espalha o saibro e deixa a quadra pronta para a próxima turma.',question:'Quem ajuda a cuidar da quadra de saibro depois do jogo?',choices:['Só quem perdeu a partida.','Ninguém: a próxima turma resolve.','Os dois jogadores, com orientação do professor.'],answer:2,explanation:'Ganhar ou perder não muda o combinado: os dois ajudam a deixar a quadra pronta.'},
 {id:'respect',title:'Respeito vale ponto',text:'Todo mundo erra enquanto aprende. Não ria do erro do colega nem brigue por um ponto. Se houver dúvida, converse com calma e peça ajuda ao professor. No fim, agradeça pela partida.',question:'Seu colega errou uma bola fácil. O que você faz?',choices:['Incentivo e continuo jogando com respeito.','Dou risada para ele errar outra.','Digo que ele não pode mais jogar.'],answer:0,explanation:'Incentivar faz parte do jogo. Todo mundo precisa de tempo para aprender!'},
 {id:'entry',title:'Espere para entrar',text:'Uma bolinha escapou para outra quadra? Espere o ponto terminar e avise os jogadores antes de entrar. Nunca atravesse uma jogada para buscar a bola. Assim ninguém se assusta ou tropeça.',question:'Sua bola caiu na quadra ao lado durante uma jogada. E agora?',choices:['Corro para pegar antes que percebam.','Espero o ponto acabar e peço licença.','Mando outra bola para chamar atenção.'],answer:1,explanation:'Primeiro espere. Depois avise e peça licença para buscar a bola com segurança.'},
 {id:'care',title:'Cuide de você e da turma',text:'Faça uma pausa para beber água quando precisar. Guarde o lixo na lixeira e use a raquete com espaço ao redor. Sentiu dor ou mal-estar? Avise o professor. Jogar bem também é cuidar de você e dos colegas.',question:'Você sentiu dor ou mal-estar durante o treino. O que deve fazer?',choices:['Esconder para não parar o jogo.','Continuar correndo ainda mais.','Parar e avisar o professor.'],answer:2,explanation:'Avise o professor e faça uma pausa. Sua saúde vem antes do placar.'},
];
export const QUIZ_SIZE=4,QUIZ_PASS=3;
export function createEtiquetteQuiz(random=Math.random){
 const pool=[...ETIQUETTE_LESSONS];
 for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
 return {questions:pool.slice(0,QUIZ_SIZE),answers:[]};
}
export function answerEtiquetteQuiz(quiz,questionId,choice){
 const question=quiz.questions[quiz.answers.length];
 if(!question||question.id!==questionId||!Number.isInteger(choice)||choice<0||choice>=question.choices.length)return quiz;
 return {...quiz,answers:[...quiz.answers,{id:questionId,choice}]};
}
export function gradeEtiquetteQuiz(answers){
 if(!Array.isArray(answers)||answers.length!==QUIZ_SIZE||new Set(answers.map(a=>a?.id)).size!==QUIZ_SIZE)return {complete:false,score:0,passed:false};
 let score=0;
 for(const answer of answers){const question=ETIQUETTE_LESSONS.find(q=>q.id===answer?.id);if(!question||!Number.isInteger(answer.choice)||answer.choice<0||answer.choice>=question.choices.length)return {complete:false,score:0,passed:false};if(answer.choice===question.answer)score++;}
 return {complete:true,score,passed:score>=QUIZ_PASS};
}
