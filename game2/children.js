// The children investigate; they never receive the infection palette.
export const CHILDREN=Object.freeze([
 {id:'carolina',name:'Carolina',title:'Detetive · Guardiã das pistas',x:305,y:710,color:'#a365c9',height:34},
 {id:'bernado',name:'Bernado',title:'Detetive · Olho vivo no estacionamento',x:362,y:260,color:'#e4d9be',height:36},
 {id:'benicio',name:'Benicio',title:'Detetive · Especialista em perguntas',x:720,y:672,color:'#668b72',height:32},
 {id:'maisa',name:'Maisa',title:'Detetive · Capitã da investigação',x:582,y:410,color:'#f4edf6',height:37},
].map(p=>({...p,avatar:p.id,label:p.name,court:1,kind:'npc',role:'guide',radius:39,child:true})));
export const CHILD_IDS=CHILDREN.map(p=>p.id);
export const CHILD_ATLASES=Object.fromEntries(CHILD_IDS.map(id=>[id,`/game2/assets/kids-${id}-v2.webp`]));
const phases=[1,0,2,0];
export function childFrame(id,facing='down',stride=0,ready=false){
 if(!CHILD_IDS.includes(id))return null;
 const direction=facing==='up'?1:['left','right'].includes(facing)?2:0;
 const phase=stride===0?0:phases[((Math.floor(stride*2)%4)+4)%4];
 return {atlas:`child:${id}`,index:ready?9+direction:direction*3+phase,reference:direction*3,flip:facing==='left',
  grip:ready?(direction===1?[.20,-.35]:[.13,-.34]):direction===2?[.08,-.35]:[.25,-.35],angle:ready?1.18:.7};
}
