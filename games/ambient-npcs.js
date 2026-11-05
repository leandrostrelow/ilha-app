// Optional club conversations. Deliberately separate from adventure.js:
// no campaign events, rewards or required mission destinations. Optional quick matches only.
export const AMBIENT_CHAT_KEY='ambient-chats:v1';
export const AMBIENT_NPCS=[
 {id:'kalinca',name:'Kalinca',title:'Mãe do Gael',x:510,y:1030,color:'#cbe7e5'},
 {id:'malu',name:'Malu',title:'Irmã do Gael · Família empreendedora',x:944,y:690,color:'#eeeadd',height:35},
 {id:'higor',name:'Higor',title:'O Desesperador',x:716,y:690,color:'#202d46'},
 {id:'vanessa',name:'Vanessa',title:'Não é sua tia!',x:942,y:1130,color:'#e477bb'},
 {id:'bernar',name:'Bernar',title:'BP Sport',x:516,y:620,color:'#4274b1'},
 {id:'scarlt',name:'Scarlt',title:'Esposa do Beto',x:305,y:710,color:'#ef8d63'},
 {id:'michele',name:'Michele',title:'À procura da dupla',x:582,y:410,color:'#e0c65c'},
 {id:'larissa',name:'Larissa',title:'Esperando a Michele',x:938,y:1206,color:'#ec8f8c'},
 {id:'betinho',name:'Betinho',title:'Filho do Beto',x:850,y:1230,color:'#824ec0',height:34},
].map(n=>({...n,avatar:n.id,kind:'npc',role:'ambient',ambient:true,radius:38,height:n.height||42,art:`/games/assets/ilha-extra-${n.id}-v1.png`}));

const LINES={
 kalinca:[['Você viu o Gael?\nEu fui embora e esqueci ele aqui! 😂'],['Se encontrar o Gael, fala para ele beber água.\nEle acha que vive de pickleball.']],
 malu:[['Você já comprou a camisa do Ilha?\nTô vendendo! 👕\nFamília empreendedora.'],['Eu quero jogar pickleball…\nMas o Gael não deixa. 🙄\nEle acha que é o dono da quadra.']],
 higor:[['Meu apelido é O Desesperador.\nSou uma lenda por aqui. Eu causo desespero em todos os adversários!', 'Infelizmente não vou poder jogar a Copa…\nBebi suco demais, fiquei muito doido, caí e torci o pé.', 'É desesperador.'],['É desesperador.']],
 vanessa:[['{player}: “Ô tia, onde fica o banheiro?”\n\nVanessa: “NÃO SOU SUA TIA! 😂\nO banheiro fica perto do deck.”']],
 bernar:[['Já comprou sua raquete?\nEu vendo todo tipo de raquete! 🎾\nÉ só entrar na BP Sport: bpsport.com.br'],['Quer vencer o Gael mais fácil?\nPrimeiro você precisa trocar essa raquete aí. 😂']],
 scarlt:[['Você viu a nave do Beto? 🚀\nEle estacionou em algum lugar por aqui…'],['O Beto já voltou do espaço?\nEsse homem não para em casa.']],
 michele:[['Você viu a Larissa?\nEu quero jogar com ela.'],['A gente marcou de jogar…\nMas cadê essa mulher?']],
 larissa:[['Marquei com a Michele…\nMas acho que ela ainda não chegou.'],['Se você encontrar a Michele, avisa que eu tô esperando.']],
 betinho:[['Meu pai viaja demais.'],['Tipo…\nDEMAIS mesmo. 🚀']],
};
export function readAmbientChats(value){
 const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 return Object.fromEntries(AMBIENT_NPCS.map(({id})=>[id,Number.isSafeInteger(source[id])&&source[id]>=0?source[id]:0]));
}
export function ambientConversation(id,visits=0,playerName='Jogador'){
 const variants=LINES[id];if(!variants)return null;
 const index=Number.isSafeInteger(visits)&&visits>=0?visits%variants.length:0;
 const player=typeof playerName==='string'?playerName.slice(0,18):'Jogador';
 return {pages:variants[index].map(line=>line.replace('{player}',player)),more:variants.length>1};
}
