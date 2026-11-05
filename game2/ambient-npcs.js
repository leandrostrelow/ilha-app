// Shared sprite metadata. Campaign patients are routed to campaign-story by app.js.
export const AMBIENT_CHAT_KEY='ambient-chats:v1';
const COURTS={vanessa:2,higor:1,michele:2,betinho:1,scarlt:2};
// Open, walkable spots outside foreground tree silhouettes (including haunted art).
const POSITIONS={kalinca:[450,330],malu:[672,421],higor:[516,836],vanessa:[784,658],bernar:[490,930],scarlt:[1081,838],michele:[538,1060],larissa:[950,1120],betinho:[818,396]};
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
].map(n=>({...n,court:COURTS[n.id]||1,x:POSITIONS[n.id][0],y:POSITIONS[n.id][1],avatar:n.id,kind:'npc',role:'ambient',ambient:true,radius:38,height:n.height||42,art:`/games/assets/ilha-extra-${n.id}-v1.png`}));

const LINES={
 kalinca:['Ainda bem que o Gael estava na caça aos doces. Quem ficou verde fui eu!','Se achar meu filho, avisa que até detetive tem horário para ir embora.'],
 malu:['Eu estava na caça aos doces com o Gael, então não comi a porção. Agora separo camisas para os detetives. Família empreendedora até no mistério!'],
 higor:['Eu já era o Desesperador. Agora tenho até aparência de ameaça. Só continuo com o pé ruim. É desesperador.'],
 vanessa:['Os meninos me chamaram de tia-zumbi. Estou quase verde, mas ainda consigo mandar: NÃO SOU SUA TIA!'],
 bernar:['Raquete nova resolve muita coisa. Cor verde na pele eu ainda não garanto.'],
 scarlt:['Vi alguém com um frasco roxo, mas a lembrança está embaralhada. Preciso do suco!','O Beto já viajava demais. Agora precisa voltar de duas coisas: do espaço e dessa maldição.'],
 michele:['Viu a Larissa? Marcamos um jogo antes de ficarmos verdes. A dupla não pode faltar só por causa do apocalipse.'],
 larissa:['A Michele está me procurando? Até zumbi a gente consegue se desencontrar.'],
 betinho:['Eu estava com as crianças na caça aos doces! Não comi a porção. Meu pai viaja demais, mas hoje vou ajudar os detetives a trazer ele de volta.'],
};
export function readAmbientChats(value){const v=value&&typeof value==='object'?value:{};return Object.fromEntries(AMBIENT_NPCS.map(n=>[n.id,Number.isSafeInteger(v[n.id])&&v[n.id]>=0?v[n.id]:0]));}
export function ambientConversation(id,visits=0,playerName='Jogador',cured=false){const lines=LINES[id];if(!lines)return null;return {pages:[['betinho','malu'].includes(id)?lines[0]:cured?'O suco e o tênis funcionaram, '+playerName+'! A próxima festa vai ter comida sem brilho e tênis sem fantasma.':lines[visits%lines.length]],more:!cured&&lines.length>1};}
