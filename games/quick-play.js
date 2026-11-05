import {NPCS} from './adventure.js';
import {AMBIENT_NPCS} from './ambient-npcs.js';

export const QUICK_ATTRIBUTES=['Força','Habilidade','Velocidade','Mental'];
const ratings={
 'player-m':[3,3,3,3],'player-f':[3,3,4,3],
 gael:[2,4,5,4],lourenco:[3,4,5,4],gabriel:[4,4,3,4],emerson:[4,5,3,5],
 davi:[4,4,5,3],evandro:[5,4,2,5],andre:[4,5,4,4],romulo:[5,5,4,5],
 renato:[4,5,3,5],beto:[3,4,3,5],felipe:[4,3,3,4],leandro:[3,4,4,4],
 kalinca:[3,4,3,4],malu:[2,3,5,4],higor:[5,4,1,5],vanessa:[3,4,4,4],
 bernar:[4,5,4,4],scarlt:[3,4,4,4],michele:[4,5,4,4],larissa:[4,4,4,4],betinho:[2,3,5,3],
};
export const QUICK_CHARACTERS=[
 {id:'player-m',avatar:'player-m',name:'Atleta do Ilha',color:'#27a77c'},
 {id:'player-f',avatar:'player-f',name:'Atleta do Ilha · roxo',color:'#9662cf'},
 ...NPCS,...AMBIENT_NPCS,
].map(person=>({...person,stats:ratings[person.id]}));
export const QUICK_VENUES=[
 {id:'court1',court:1,sport:'tennis',name:'Quadra 1 · Saibro',hint:'Ao lado do bar',horizontal:false},
 {id:'court2',court:2,sport:'tennis',name:'Quadra 2 · Saibro',hint:'Do lado da alameda',horizontal:false},
 {id:'old',court:'old',sport:'tennis',name:'Quadra velha · Tênis',hint:'Rede antiga · visão lateral',horizontal:true},
 {id:'pickleball',court:'pickleball',sport:'pickleball',name:'Quadra azul · Pickleball',hint:'Visão lateral',horizontal:true},
];
export function quickCharacter(id){return QUICK_CHARACTERS.find(person=>person.id===id)||QUICK_CHARACTERS[0];}
export function quickPlayer(id,profile){
 const person=quickCharacter(id);
 return person.id.startsWith('player-')&&profile?.begun?{...person,name:profile.name,champion:profile.champion}:person;
}
export function trainingInvite(person){
 const sport=['gael','vanessa','betinho'].includes(person.id)?'pickleball':'tennis';
 const venue=sport==='pickleball'?'pickleball':['bernar','scarlt'].includes(person.id)?'old':person.court===2||person.id==='malu'?'court2':'court1';
 return {opponent:person.id,sport,venue};
}
export function quickConfig(value={}){
 const sport=value.sport==='pickleball'?'pickleball':'tennis';
 const venue=QUICK_VENUES.find(v=>v.id===value.venue&&v.sport===sport)||QUICK_VENUES.find(v=>v.sport===sport);
 const player=quickCharacter(value.player),opponent=quickCharacter(value.opponent||'romulo');
 return {player:player.id,opponent:opponent.id,sport,venue:venue.id};
}
export function quickMatchOptions(value){
 const config=quickConfig(value),player=quickCharacter(config.player),opponent=quickCharacter(config.opponent);
 const average=opponent.stats.reduce((sum,n)=>sum+n,0)/4;
 return {sport:config.sport,horizontal:QUICK_VENUES.find(v=>v.id===config.venue).horizontal,assisted:true,difficulty:.50+(average-1)*.10,
  playerMoveScale:.94+player.stats[2]*.02,playerPowerScale:.94+player.stats[0]*.02};
}
