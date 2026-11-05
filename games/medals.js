import {readAdventure} from './adventure.js';
export const MEDALS=[
 {id:'lourenco',name:'Disciplina',owner:'Lourenço',color:'#edba49',motif:['....#....','...###...','..#####..','....#....','....#....','....#....','..#####..'],description:'Lutou até a última bola.'},
 {id:'gabriel',name:'Parceria',owner:'Gabriel',color:'#41bc83',motif:['.........','..#...#..','.###.###.','#########','####.####','.##...##.','.........'],description:'Resgatou as três bolinhas e venceu El Bigodón.'},
 {id:'davi',name:'Evolução',owner:'Davi',color:'#ae7fed',motif:['.....##..','....##...','...##....','..#####..','....##...','...##....','..##.....'],description:'Aprendeu respeito e superou a nova geração.'},
 {id:'evandro',name:'Estratégia',owner:'Evandro',color:'#ef936e',motif:['.....#...','....#....','..#####..','..#...#..','..#...#..','..#####..','...###...'],description:'Levou o suco e fez o cansado correr.'},
 {id:'andre',name:'Coragem',owner:'André',color:'#ee9e42',motif:['..#...#..','.###.###.','#########','#########','.#######.','..#####..','....#....'],description:'Encarou o saque e o psicológico do Malvado.'},
 {id:'romulo',name:'Legado',owner:'Rômulo',color:'#263b45',motif:['.#..#..#.','.##.#.##.','.#######.','..#####..','..#####..','..#####..','.........'],description:'Encontrou a Foice e venceu a final com a raquete.'},
 {id:'gael',name:'Guardião da Azul',owner:'Gael',color:'#59b8e8',extra:true,motif:['...###...','..#####..','..#####..','...###...','....#....','....#....','....#....'],description:'Venceu o Pequeno General no pickleball.'},
 {id:'beto',name:'Paciência Intergaláctica',owner:'Beto',color:'#3fc8c8',extra:true,motif:['...###...','..#####..','.#######.','##.....##','.#######.','..#####..','...###...'],description:'Ouviu a história inteira da viagem à Lua.'},
];
export function medalCollection(state){const s=readAdventure(state);return MEDALS.map(m=>({...m,earned:m.id==='gael'?s.pickleball:m.id==='beto'?s.betoStory:s.wins.includes(m.id)}));}
export function drawMedal(canvas,medal,earned=true){
 canvas.width=64;canvas.height=76;const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;
 const rect=(x,y,w,h,color)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
 rect(15,3,12,23,earned?medal.color:'#526762');rect(37,3,12,23,earned?medal.color:'#526762');
 rect(18,3,3,20,earned?'#ffffff66':'#74807a');rect(40,3,3,20,earned?'#ffffff66':'#74807a');
 rect(21,19,22,9,earned?medal.color:'#526762');
 const disc=(inset,color)=>{const x=8+inset,y=23+inset,w=48-inset*2;rect(x+8,y,w-16,w,color);rect(x+4,y+4,w-8,w-8,color);rect(x,y+8,w,w-16,color);};
 disc(0,'#132e32');disc(2,earned?'#9d672f':'#556a67');disc(4,earned?'#ffe5a0':'#83978a');disc(7,earned?'#d89a3d':'#405852');disc(9,earned?'#f7c55c':'#4d655c');
 rect(19,34,3,9,earned?'#fff0bc':'#7d9084');
 const motif=earned?medal.motif:['..#####..','......#..','.....#...','....#....','....#....','.........','....#....'];
 for(let y=0;y<motif.length;y++)for(let x=0;x<motif[y].length;x++)if(motif[y][x]==='#')rect(23+x*2,39+y*2,2,2,earned?'#584421':'#a9b7aa');
 rect(23,64,18,2,earned?'#ffedaa':'#7d9084');
}
export function renderMedals(host,state){
 const items=medalCollection(state),grid=document.createElement('div');grid.className='medal-grid';
 for(const medal of items){
  const card=document.createElement('article');card.className=`medal-card${medal.earned?' earned':''}`;
  const art=document.createElement('canvas');art.setAttribute('aria-hidden','true');drawMedal(art,medal,medal.earned);
  const title=document.createElement('h3');title.textContent=medal.name;
  const owner=document.createElement('span');owner.textContent=`${medal.owner}${medal.extra?' · Extra':' · Copa'}`;
  const description=document.createElement('p');description.textContent=medal.earned?medal.description:'Ainda não conquistada';
  const status=document.createElement('strong');status.textContent=medal.earned?'✓ Conquistada':'? A descobrir';
  card.append(art,title,owner,description,status);grid.append(card);
 }
 host.replaceChildren(grid);
}
