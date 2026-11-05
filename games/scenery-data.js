// Shared plan: owner's 5bb60c20 landscaped sketch, over the satellite/street references.
// The public lane runs down the east side; the club entrance turns west beside the houses.
export const WORLD_SIZE=1536;
// PSD revision: abandoned asphalt court, exploration only (not a sports arena).
export const ABANDONED_COURT={x:24,y:724,w:317,h:228};
export const SPAWN={x:1100,y:74},ENTRY={x:946,y:393},GATE={x:1024,y:393,axis:'vertical'};
export const ENTRY_ROUTE=[SPAWN,{x:1100,y:200},{x:1094,y:393},ENTRY];
export function entryPosition(progress){
 const lengths=ENTRY_ROUTE.slice(1).map((p,i)=>Math.hypot(p.x-ENTRY_ROUTE[i].x,p.y-ENTRY_ROUTE[i].y));
 let left=Math.max(0,Math.min(1,progress))*lengths.reduce((a,b)=>a+b,0);
 for(let i=0;i<lengths.length;i++){if(left<=lengths[i]||i===lengths.length-1){const a=ENTRY_ROUTE[i],b=ENTRY_ROUTE[i+1],t=left/lengths[i];return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,facing:b.x<a.x-20?'left':'down'};}left-=lengths[i];}
}
export const STREET=[[1100,74],[1100,200],[1094,393],[1074,680],[1052,870],[1052,1040],[1052,1148]];
export const COURTS=Object.freeze([
 {id:1,x:600,y:768,width:144,height:286,grounds:{x:562,y:716,w:220,h:390},focus:{x:506,y:706,w:332,h:415}},
 {id:2,x:820,y:768,width:144,height:286,grounds:{x:782,y:716,w:220,h:390},focus:{x:726,y:706,w:332,h:415}},
]);
export const COURT_OVERVIEW=Object.freeze({x:502,y:654,w:560,h:700});
// The latest marked plan explicitly identifies these two northern sports areas.
export const SAND_COURTS=[
 {id:'beach',label:'BEACH TÊNIS',x:532,y:482,w:204,h:162},
 {id:'footvolley',label:'FUTEVÔLEI',x:794,y:500,w:196,h:156},
];
export const PICKLEBALL={x:554,y:1138,w:266,h:136};
export const PICKLEBALL_CAMERA={x:PICKLEBALL.x-39,y:PICKLEBALL.y-66,w:PICKLEBALL.w+78,h:PICKLEBALL.h+106};
export const GRAVEL=[[464,1114],[988,1114],[988,1282],[448,1380]];
export const TERRACE=[484,710,65,397],BAR_COURTYARD=[300,1110,249,50];
export const BAR_STAIRS={x:484,y:654,w:65,h:56};
export const PARKING=[216,130,286,224],ENTRY_PARKING=[982,215,57,139];
export const WALLS=[{x:1019,y:215,w:8,h:142},{x:1019,y:429,w:8,h:260},{x:793,y:358,w:226,h:8}];
export const NODES=[
 [1100,74],[1100,200],[1094,393],[946,393],[766,410],[494,447],
 [516,586],[516,632],[516,680],[516,780],[516,930],[516,1044],[516,1148],
 [750,448],[764,680],[672,680],[892,680],[1074,680],
 [1052,870],[1052,1040],[1052,1148],[910,1122],[692,1122],
 [390,1136],[505,1245],[455,1290],[978,1248],[1018,1260],
 [520,395],[486,375],[362,375],[362,260],[1074,902],[1165,902],
 [520,1326],[842,1300],[955,1276],
 [400,693],[516,693],
 [326,693],[304,710],[304,790],[180,835],
 [1074,715],[1180,716],
];
export const EDGES=[
 [0,1,39],[1,2,38],[2,17,34],[17,18,31],[18,19,31],[19,20,31],
 [2,3,29],[3,4,30],[4,5,30],[5,6,28],[6,7,27],[7,8,27],
 [8,9,26],[9,10,26],[10,11,26],[11,12,27],
 [4,13,27],[13,14,24],[8,15,28],[15,14,28],[14,16,28],[16,17,28],
 [20,21,29],[21,22,29],[22,12,29],[12,23,25],[12,24,27],[24,25,26],
 [20,26,28],[26,27,26],
 [4,28,29],[28,29,26],[29,30,27],[30,31,26],[17,32,30],[32,18,30],[32,33,22],
 [24,34,27],[34,35,25],[35,36,26],[36,26,27],
 [7,38,23],[38,37,20],[38,8,23],
 [37,39,25],[39,40,23],[40,41,22],[41,42,26],
 [17,43,16],[43,44,16],
];
export const PLACES=[
 {id:'abandoned-court',label:'Quadra abandonada',short:'QUADRA VELHA',x:240,y:830,radius:32,kind:'scenery'},
 {id:'bar',label:'Bar do Ilha',short:'BAR',x:400,y:693,radius:35,kind:'bar'},
 {id:'court1',label:'Quadra 1',short:'QUADRA 1',x:540,y:907,radius:30,kind:'court'},
 {id:'court2',label:'Quadra 2',short:'QUADRA 2',x:1020,y:907,radius:30,kind:'court'},
 {id:'pickleball',label:'Quadra de pickleball',short:'PICKLEBALL',x:692,y:1122,radius:30,kind:'pickleball'},
 {id:'river',label:'Mirante do rio',short:'RIO',x:1018,y:1260,radius:30,kind:'river'},
 {id:'gazebo',label:'Jardim do clube',short:'JARDIM',x:455,y:1290,radius:32,kind:'scenery'},
 {id:'parking',label:'Estacionamento',short:'ESTACIONAMENTO',x:362,y:260,radius:30,kind:'scenery'},
 {id:'wood-cabin',label:'Casa mal-assombrada',short:'CASINHA',x:1165,y:902,radius:30,kind:'scenery'},
];
export const NPC_SPOTS=[{x:515,y:792},{x:513,y:880},{x:513,y:977}];
export const BUILDINGS=[
 {id:'bar-wing',x:229,y:509,w:262,h:162,kind:'barwing'},
 {id:'entry-house',x:814,y:218,w:157,h:128,kind:'entryhouse'},
 {id:'entry-cabin',x:787,y:432,w:126,h:50,kind:'entrycabin'},
 {id:'street-workshop',x:826,y:77,w:207,h:123,kind:'workshop'},
 {id:'wood-cabin',x:1090,y:747,w:151,h:120,kind:'woodcabin'},
 {id:'neighbor',x:355,y:989,w:123,h:103,kind:'house'},
 {id:'gazebo',x:355,y:791,w:123,h:82,kind:'gazebo'},
 {id:'gazebo-middle',x:355,y:856,w:123,h:82,kind:'gazebo'},
 {id:'gazebo-lower',x:355,y:921,w:123,h:82,kind:'gazebo'},
];
// Center one stand at each fence, keeping the cross-club path at y=680 clear.
export const STANDS=COURTS.map(c=>({x:c.x+c.width/2-29,y:692,w:58,h:20,axis:'horizontal'}));
export const CARS=[[1006,246,0],[1006,318,1],
 [257,172,3],[317,174,1],[452,174,0],[283,242,0],
 [452,245,0],[230,304,2]];
export function buildingBounds(b){return {x:b.x,y:b.y,w:b.w,h:b.h};}
export function buildingCollision(x,y,b,pad=0){return inRect(x,y,[b.x,b.y,b.w,b.h],pad);}
const SOCIAL_SURFACES=[TERRACE,BAR_COURTYARD,[BAR_STAIRS.x,BAR_STAIRS.y,BAR_STAIRS.w,BAR_STAIRS.h]];
export const RECT_SOLIDS=[...BUILDINGS.map(b=>[b.x,b.y,b.w,b.h]),...WALLS.map(b=>[b.x,b.y,b.w,b.h]),
 ...COURTS.map(c=>[c.grounds.x,c.grounds.y,c.grounds.w,c.grounds.h]),...SAND_COURTS.map(c=>[c.x,c.y,c.w,c.h]),
 [PICKLEBALL.x,PICKLEBALL.y,PICKLEBALL.w,PICKLEBALL.h],...STANDS.map(s=>[s.x,s.y,s.w,s.h]),...CARS.map(([x,y])=>[x-19,y-33,38,67])];
export const GARDENS=[[446,620,599,87],[454,1098,105,270],[996,755,88,390],[295,1103,258,65],[825,1138,214,176],[466,399,530,69],[1087,872,170,54],[330,350,202,80]];
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function hash(x,y,seed=0){let n=Math.imul(x+seed*31,374761393)^Math.imul(y+seed*17,668265263);n=Math.imul(n^(n>>>13),1274126177);return (n^(n>>>16))>>>0;}
export function segmentDistance(x,y,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy),0,1);return Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t);}
export function pathDistance(x,y){let best=Infinity;for(const [a,b,width]of EDGES)best=Math.min(best,segmentDistance(x,y,NODES[a],NODES[b])-width);return best;}
export function streetDistance(x,y){return Math.min(...STREET.slice(1).map((p,i)=>segmentDistance(x,y,STREET[i],p)));}
export function inRect(x,y,[rx,ry,w,h],pad=0){return x>rx-pad&&x<rx+w+pad&&y>ry-pad&&y<ry+h+pad;}
export function gravelAt(x,y){let inside=false;for(let i=0,j=GRAVEL.length-1;i<GRAVEL.length;j=i++){const [ax,ay]=GRAVEL[i],[bx,by]=GRAVEL[j];if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;}return inside;}
const shoreline=[[0,1590],[1140,1580],[1215,1570],[1240,1410],[1260,1225],[1280,1130],[1370,974],[1440,716],[1536,366]];
export function shoreX(y){for(let i=1;i<shoreline.length;i++){const [ay,ax]=shoreline[i-1],[by,bx]=shoreline[i];if(y<=by)return ax+(bx-ax)*(y-ay)/(by-ay)+Math.sin(y*.029)*7;}return 366;}
export function waterAt(x,y){return x>shoreX(y);}
export function parkAt(x,y){return GARDENS.some(r=>inRect(x,y,r));}
export function terrainAt(x,y){
 if(waterAt(x,y))return 'water';
 if(Math.abs(x-shoreX(y))<18)return 'bank';
 if(streetDistance(x,y)<(y<410?38:31))return y<470?'cobbles':'earth';
 if(inRect(x,y,TERRACE)||inRect(x,y,SOCIAL_SURFACES[2]))return 'deck';
 if(gravelAt(x,y))return 'gravel';
 // Former front entrances become a continuous, walkable lawn by the benches.
 if(inRect(x,y,[550,654,452,62]))return 'lawn';
 if(inRect(x,y,BAR_COURTYARD)||inRect(x,y,PARKING)||inRect(x,y,ENTRY_PARKING)||pathDistance(x,y)<0)return 'path';
 if(y<74)return 'city';
 return parkAt(x,y)?'lawn':'grass';
}
// Hand-placed trunk anchors, not random trees: keep the owner's landmarks stable.
export const LANDMARK_TREES=[
 {id:'entry-shade',kind:'tree',x:1000,y:488,variant:0,scale:1.24,radius:10},
 {id:'court-plaza-shade',kind:'tree',x:611,y:675,variant:0,scale:1.32,radius:10},
 {id:'bar-shade',kind:'tree',x:479,y:833,variant:0,scale:1.28,radius:10},
 {id:'pickle-west-shade',kind:'tree',x:461,y:1256,variant:0,scale:1.26,radius:10},
 ...[[748,482,.76],[748,546,.78],[748,629,.86],[977,684,.82],[418,1117,1.06],[694,1292,1.26]].map(([x,y,scale],i)=>({id:`sketch-coconut-${i+1}`,kind:'palm',x,y,variant:1,scale,radius:8})),
 ...[[987,444,1.18],[757,346,1.2],[1114,552,1.3],[1104,793,1.3],[1088,1060,1.14]].map(([x,y,scale])=>({id:`palm-${x}-${y}`,kind:'palm',x,y,variant:0,scale,radius:8})),
 ...[[255,125,.94],[348,125,1],[452,125,.94],[295,484,.9],[362,489,.86],[426,508,.88]].map(([x,y,scale])=>({id:`parking-grove-${x}-${y}`,kind:'tree',x,y,variant:1,scale,radius:10})),
];
// Reserve the visible fronts as well as the footprints. A trunk outside a
// building can still put its entire canopy over the doorway or parked cars.
const CLEAR_FOREGROUNDS=[PARKING,...BUILDINGS.filter(b=>['barwing','woodcabin'].includes(b.kind)).map(b=>[b.x,b.y,b.w,b.h])];
export const TREES=[];
for(let gy=122;gy<1536;gy+=42)for(let gx=16;gx<1536;gx+=42){
 const h=hash(gx,gy,7),x=gx+h%25-12,y=gy+(h>>>6)%25-12;
 if(inRect(x,y,[ABANDONED_COURT.x,ABANDONED_COURT.y,ABANDONED_COURT.w,ABANDONED_COURT.h],28))continue;
 if(waterAt(x,y)||pathDistance(x,y)<32||RECT_SOLIDS.some(r=>inRect(x,y,r,31))||SOCIAL_SURFACES.some(r=>inRect(x,y,r,35))||inRect(x,y,PARKING,38)||inRect(x,y,ENTRY_PARKING,30))continue;
 if(gravelAt(x,y)||inRect(x,y,[450,1105,526,266])||LANDMARK_TREES.some(t=>Math.hypot(t.x-x,t.y-y)<48))continue;
 if(CLEAR_FOREGROUNDS.some(([rx,ry,w,h])=>x>rx-65&&x<rx+w+65&&y>ry&&y<ry+h+164))continue;
 if(parkAt(x,y)&&h%11!==0)continue;
 const palm=h%9===0;let scale=.9+(h%6)*.075;
 // Low riverbank growth frames the gravel instead of hiding the blue court.
 if(x>400&&x<1030&&y>1270){const edge=1360-(clamp(x,464,960)-464)*92/496,maxHeight=y-edge-12;if(maxHeight<48)continue;scale=Math.min(scale,maxHeight/(palm?150:130));}
 const variant=palm?(h>>>12)%2:h%37===0?3:h%7===0?2:h%3?1:0;
 TREES.push({id:`tree-${gx}-${gy}`,kind:palm?'palm':'tree',x,y,variant,scale,radius:palm?7:10,depth:y});
}
for(const t of LANDMARK_TREES)TREES.push({...t,depth:t.y});
export const DECOR=[
 ...BUILDINGS.map(b=>({...b,depth:b.y+b.h})),...STANDS.map(s=>({...s,kind:'stand',depth:s.y+s.h})),
 ...WALLS.map(w=>({...w,kind:'wall',depth:w.y+w.h})),
 {kind:'bench',x:904,y:1250,depth:1254},{kind:'bench',x:505,y:1303,depth:1310},
 {kind:'table',x:360,y:1137,depth:1143},
 ...[[552,723],[1013,723],[552,1114],[1013,1114],[781,732],[781,1088],[543,1165],[831,1280],[1009,522],[745,498]].map(([x,y])=>({kind:'lamp',x,y,depth:y})),
 ...[[1150,169],[1138,427],[1124,697]].map(([x,y])=>({kind:'utility',x,y,depth:y})),
 ...CARS.map(([x,y,variant])=>({kind:'car',x,y,variant,depth:y+33})),
];
const treeCells=new Map();for(const tree of TREES){const key=`${Math.floor(tree.x/64)},${Math.floor(tree.y/64)}`;if(!treeCells.has(key))treeCells.set(key,[]);treeCells.get(key).push(tree);}
export function treeCollision(x,y,radius=5){for(let yy=Math.floor((y-radius-12)/64);yy<=Math.floor((y+radius+12)/64);yy++)for(let xx=Math.floor((x-radius-12)/64);xx<=Math.floor((x+radius+12)/64);xx++)for(const t of treeCells.get(`${xx},${yy}`)||[])if(Math.hypot(x-t.x,y-t.y)<t.radius+radius)return true;return false;}
export function walkSurface(x,y,radius=5){
 if(x<12||y<12||x>WORLD_SIZE-12||y>WORLD_SIZE-12||waterAt(x,y))return false;
 if(RECT_SOLIDS.some(r=>inRect(x,y,r,radius))||treeCollision(x,y,radius))return false;
 if(DECOR.some(o=>o.kind==='bench'?inRect(x,y,[o.x-21,o.y-4,44,10],radius):o.kind==='table'?inRect(x,y,[o.x-20,o.y-20,40,40],radius):o.kind==='lamp'||o.kind==='umbrella'||o.kind==='utility'?Math.hypot(x-o.x,y-o.y)<radius+(o.kind==='umbrella'?15:3):false))return false;
 return inRect(x,y,[ABANDONED_COURT.x,ABANDONED_COURT.y,ABANDONED_COURT.w,ABANDONED_COURT.h],-radius)||EDGES.some(([a,b,w])=>segmentDistance(x,y,NODES[a],NODES[b])<=w-radius)||GARDENS.some(r=>inRect(x,y,r,-radius))||SOCIAL_SURFACES.some(r=>inRect(x,y,r,-radius))||inRect(x,y,PARKING,-radius)||inRect(x,y,ENTRY_PARKING,-radius)||gravelAt(x,y);
}
export function locationAt({x,y}){
 if(inRect(x,y,[ABANDONED_COURT.x,ABANDONED_COURT.y,ABANDONED_COURT.w,ABANDONED_COURT.h],12))return 'Quadra abandonada';
 if(inRect(x,y,PARKING,20))return 'Estacionamento do clube';
 if(x>1090&&y>690&&y<940)return 'Casa mal-assombrada';
 if(streetDistance(x,y)<44)return y<420?'Rua de acesso ao clube':'Rua lateral das quadras';
 if(x>914&&y>350&&y<432)return 'Entrada do clube';
 if(SOCIAL_SURFACES.some(r=>inRect(x,y,r,20)))return 'Bar e deck do Ilha';
 if(y>1110&&x>530&&x<970)return 'Quadra de pickleball';
 if(y>1180&&x>920)return 'Beira do rio';
 if(y>1110)return 'Jardim do clube';
 if(y<650)return 'Passagem do clube';
 return 'Alameda das quadras de tênis';
}
