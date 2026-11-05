import {NPCS} from './adventure.js';
import {AMBIENT_NPCS} from './ambient-npcs.js';
export const ALBUM_CAST=[...NPCS,...AMBIENT_NPCS];
const memory=(id,cast,title,text,duration=8)=>({id,cast,title,text,duration});
export const ALBUM_PHOTOS=[
 memory('award',['leandro'],'A Taça do Legado é sua.','{name}, cada ponto trouxe você até aqui. A conquista é sua. A festa é de todo mundo.',12),
 memory('renato',['renato'],'Tudo começou com um saque.','Entre uma explicação e outra, Renato ajudou a nascer mais uma lenda.'),
 memory('emerson',['emerson'],'Só mais uma…','Uma cesta, uma foto, uma aula. Com Emerson, sempre cabe mais uma.'),
 memory('pickleball',['gael'],'O Pequeno General','Gael segue comandando a quadra azul. A próxima final vai ser de pickleball. Segundo ele.'),
 memory('lourenco',['lourenco'],'Pequeno, mas gigante','Lourenço luta até a última bola. E já está pronto para a revanche.'),
 memory('davi',['davi'],'O futuro já está na quadra.','Davi comemora sua conquista, mas a nova geração já está treinando para buscar a taça.'),
 memory('gabriel',['gabriel'],'El Bigodón','Gabriel encontrou uma nova utilidade para o troféu: conferir se o bigode saiu perfeito.'),
 memory('evandro',['evandro'],'Descanso de campeão','Evandro comemorou tanto que precisou descansar do descanso. A revanche pode esperar.'),
 memory('andre',['andre'],'O Malvado saiu sorrindo.','André pediu outra foto. Disse que nessa ficou simpático demais.'),
 memory('romulo',['romulo'],'Respeita o corte.','Rômulo guarda a Foice com orgulho. Hoje o golpe mais forte foi o seu.'),
 memory('beto',['beto'],'Uma bolinha entre as estrelas','Beto foi buscar a bola. Disse que voltava rápido. Saturno tem outro fuso horário.',10),
 memory('felipe',['felipe'],'A melhor jogada é a porção.','Felipe trocou as vitórias no tênis pelas porções e bebidas mágicas da turma. Essa receita deu certo.'),
 memory('kalinca',['kalinca'],'Agora não falta ninguém!','Kalinca achou Gael e a garrafinha. Antes de sair, fez a chamada mais uma vez.'),
 memory('malu',['malu'],'Família empreendedora','Malu vendeu as camisas e reservou a quadra. Gael ainda acha que manda no clube.'),
 memory('higor',['higor'],'O Desesperador','De muletas, mas presente na resenha. Higor promete voltar na próxima Copa. Esperar é desesperador.'),
 memory('vanessa',['vanessa'],'O nome dela é Vanessa!','“Ô, tia!” — “Não sou sua tia!” Os meninos descobriram o banheiro. E aprenderam o nome dela.',10),
 memory('bernar',['bernar'],'BP Sport entrou em quadra.','Bernar trouxe as raquetes. Equipamento não vai faltar. Desculpas, talvez.'),
 memory('scarlt',['scarlt'],'Estacionou a nave direito?','Scarlt só queria uma viagem que terminasse antes do jantar. Com Beto, isso já é uma missão.'),
 memory('michele',['michele'],'Finalmente, Larissa!','Michele encontrou a parceira. Para o próximo jogo: horário, quadra e ponto de encontro combinados.'),
 memory('larissa',['larissa'],'Desta vez, no mesmo lugar.','Larissa e Michele finalmente entraram juntas na quadra. A procura acabou; o jogo começou.'),
 memory('betinho',['betinho'],'Cinco segundos terrestres','Betinho pediu para o pai olhar para a câmera. Beto apontou Saturno. De novo.'),
 memory('group',[],'A Ilha continua.','Uma aventura de Leandro e da turma do Ilha Tênis · Colatina. Obrigado por fazer parte desta história, {name}.',14),
];
export const ALBUM_DURATION=ALBUM_PHOTOS.reduce((sum,p)=>sum+p.duration,0);
export const albumStart=index=>ALBUM_PHOTOS.slice(0,index).reduce((sum,p)=>sum+p.duration,0);
export function albumFrame(time){
 let start=0;
 for(const [index,photo]of ALBUM_PHOTOS.entries()){
  if(time<start+photo.duration){const local=Math.max(0,time-start),progress=local/photo.duration;
   return {...photo,index,start,local,progress,opacity:Math.min(1,local/.65,(photo.duration-local)/.65)};
  }start+=photo.duration;
 }return null;
}
export function albumImage(photo,player){
 const id=photo.id==='award'?(player.avatar==='player-f'||player.id==='player-f'?'award-f':'award-m'):photo.id;
 return `/games/assets/ending-album/${id}-v1.webp`;
}
export function albumCredit(photo,player){
 const names=photo.id==='award'?`${player.name} · Leandro`:photo.cast.map(id=>ALBUM_CAST.find(n=>n.id===id)?.name||id).join(' · ');
 return {names:photo.id==='group'?'Leandro e a turma da Ilha':names,title:photo.title,text:photo.text.replaceAll('{name}',player.name)};
}
// Lazy: ending art never delays the map, matches, or initial game download.
export function createAlbumLoader(load=url=>new Promise((resolve,reject)=>{
 const image=new Image(),timer=setTimeout(()=>{image.onload=image.onerror=null;reject(new Error('photo-timeout'));},12000);
 image.onload=()=>{clearTimeout(timer);resolve(image);};image.onerror=()=>{clearTimeout(timer);reject(new Error('photo-unavailable'));};image.src=url;
})){
 const cache=new Map();
 return url=>{
  if(!cache.has(url))cache.set(url,load(url).then(()=>true,()=>{cache.delete(url);return false;}));
  return cache.get(url);
 };
}
