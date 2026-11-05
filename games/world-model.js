import {WORLD_SIZE,NODES,PLACES,walkSurface} from './scenery-data.js';
export {WORLD_SIZE,SPAWN,ENTRY,NODES,EDGES,PLACES,NPC_SPOTS} from './scenery-data.js';
export const WALK_SPEED=120;
// A footfall every 24 actual world pixels, not every frame or held key.
export function advanceWalkCycle(player,traveled){
 if(traveled<=.01){player.stride=0;return false;}
 const previous=Math.floor(player.stride||0);player.stride=(player.stride||0)+traveled/24;
 return Math.floor(player.stride)>previous;
}
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const isWalkable=walkSurface;
export function clearPath(a,b){const length=distance(a,b),steps=Math.max(1,Math.ceil(length));for(let i=0;i<=steps;i++){const edge=i<2||i>steps-2,radius=edge?5:6;if(!isWalkable(a.x+(b.x-a.x)*i/steps,a.y+(b.y-a.y)*i/steps,radius))return false;}return true;}
// Swept small steps prevent tunneling; try the full vector before wall sliding.
export function moveWalker(player,dx,dy,dt){
 const length=Math.hypot(dx,dy);if(length<.0001)return false;
 const amount=WALK_SPEED*clamp(dt,0,.05)/Math.max(1,length),steps=Math.max(1,Math.ceil(amount*length/2));
 const sx=dx*amount/steps,sy=dy*amount/steps,before={x:player.x,y:player.y};
 for(let i=0;i<steps;i++){
  if(isWalkable(player.x+sx,player.y+sy)){player.x+=sx;player.y+=sy;}
  else{if(isWalkable(player.x+sx,player.y))player.x+=sx;if(isWalkable(player.x,player.y+sy))player.y+=sy;}
 }
 if(Math.abs(dx)>Math.abs(dy)*1.12)player.facing=dx>0?'right':'left';
 else if(Math.abs(dy)>Math.abs(dx)*1.12)player.facing=dy>0?'down':'up';
 else player.facing||='down';
 return distance(before,player)>.01;
}
export function steerWalker(player,dx,dy,dt){
 const len=Math.max(1,Math.hypot(dx,dy)),blend=1-Math.exp(-(dx||dy?18:30)*Math.min(.05,dt));
 player.vx=(player.vx||0)+(dx/len-(player.vx||0))*blend;player.vy=(player.vy||0)+(dy/len-(player.vy||0))*blend;
 if(Math.hypot(player.vx,player.vy)<.015){player.vx=0;player.vy=0;}
 return moveWalker(player,player.vx,player.vy,dt);
}
export function followRoute(player,route,dt){
 while(route.length&&distance(player,route[0])<3){Object.assign(player,route.shift());}
 if(!route.length)return false;
 const next=route[0],d=distance(player,next),speed=Math.min(1,d/10);
 return moveWalker(player,(next.x-player.x)/d*speed,(next.y-player.y)/d*speed,dt);
}
export function joystickVector(dx,dy,radius=38){const length=Math.hypot(dx,dy);if(length<7)return {x:0,y:0};const strength=Math.min(1,(length-7)/(radius-7));return {x:dx/length*strength,y:dy/length*strength};}
export function nearestWalkable(point,maxDistance=32){
 if(isWalkable(point.x,point.y))return {...point};
 for(let r=4;r<=maxDistance;r+=4)for(let a=0;a<Math.PI*2;a+=Math.PI/16){const p={x:point.x+Math.cos(a)*r,y:point.y+Math.sin(a)*r};if(isWalkable(p.x,p.y))return p;}
 return null;
}
export function nearestNode(point){let best=0;for(let i=1;i<NODES.length;i++)if(distance(point,{x:NODES[i][0],y:NODES[i][1]})<distance(point,{x:NODES[best][0],y:NODES[best][1]}))best=i;return best;}
// Cached eight-direction A*: routes over the lawn around trees, without corner cutting.
const CELL=8,COLS=Math.ceil(WORLD_SIZE/CELL),COUNT=COLS*COLS;
let grid;
const gridPoint=id=>({x:(id%COLS)*CELL,y:Math.floor(id/COLS)*CELL});
function walkGrid(){if(!grid){grid=new Uint8Array(COUNT);for(let id=0;id<COUNT;id++){const p=gridPoint(id);grid[id]=Number(isWalkable(p.x,p.y));}}return grid;}
function gridAnchor(point){
 const candidates=[],gx=Math.round(point.x/CELL),gy=Math.round(point.y/CELL),g=walkGrid();
 for(let y=gy-3;y<=gy+3;y++)for(let x=gx-3;x<=gx+3;x++){const id=y*COLS+x;if(x>=0&&x<COLS&&y>=0&&y<COLS&&g[id])candidates.push(id);}
 return candidates.sort((a,b)=>distance(point,gridPoint(a))-distance(point,gridPoint(b))).find(id=>clearPath(point,gridPoint(id)));
}
export function routeTo(from,target){
 if(!isWalkable(from.x,from.y)||!isWalkable(target.x,target.y))return [];
 if(clearPath(from,target))return [{...target}];
 const start=gridAnchor(from),end=gridAnchor(target);if(start===undefined||end===undefined)return [];
 const cost=new Float64Array(COUNT);cost.fill(Infinity);cost[start]=0;
 const previous=new Int32Array(COUNT);previous.fill(-1);const visited=new Uint8Array(COUNT),heap=[];
 function push(id,priority){let i=heap.length;heap.push({id,priority});while(i){const parent=(i-1)>>1;if(heap[parent].priority<=priority)break;[heap[parent],heap[i]]=[heap[i],heap[parent]];i=parent;}}
 function pop(){const first=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let i=0;while(true){let next=i,left=i*2+1,right=left+1;if(left<heap.length&&heap[left].priority<heap[next].priority)next=left;if(right<heap.length&&heap[right].priority<heap[next].priority)next=right;if(next===i)break;[heap[i],heap[next]]=[heap[next],heap[i]];i=next;}}return first.id;}
 const g=walkGrid();push(start,0);
 while(heap.length){
  const at=pop();if(visited[at])continue;if(at===end)break;visited[at]=1;
  const x=at%COLS,y=Math.floor(at/COLS),p=gridPoint(at);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy,next=ny*COLS+nx;
   if(nx<0||nx>=COLS||ny<0||ny>=COLS||!g[next]||visited[next])continue;
   if(dx&&dy&&(!g[at+dx]||!g[at+dy*COLS]))continue;
   const candidate=cost[at]+Math.hypot(dx,dy)*CELL;
   if(candidate>=cost[next]||!clearPath(p,gridPoint(next)))continue;
   cost[next]=candidate;previous[next]=at;push(next,candidate+distance(gridPoint(next),target));
  }
 }
 if(!Number.isFinite(cost[end]))return [];
 const path=[{...target}];for(let id=end;id!==-1;id=previous[id]){path.unshift(gridPoint(id));if(id===start)break;}
 const smooth=[];let anchor=from;
 for(let i=0;i<path.length;){let next=i;while(next+1<path.length&&clearPath(anchor,path[next+1]))next++;smooth.push(path[next]);anchor=path[next];i=next+1;}
 return smooth;
}
export function nearbyTarget(player,npcs=[],items=[],objectiveId=null){
 // The abandoned court remains walkable scenery for future missions, but its
 // generic hotspot is disabled for now so it never steals interaction from
 // Gabriel's collectible balls.
 const interactivePlaces=PLACES.filter(place=>place.id!=='abandoned-court');
 const candidates=[...items,...npcs.map(n=>({...n,kind:'npc',radius:38,label:n.name})),...interactivePlaces];
 return candidates.filter(p=>distance(player,p)<=p.radius).sort((a,b)=>{
  if(a.id===objectiveId&&b.id!==objectiveId)return -1;if(b.id===objectiveId&&a.id!==objectiveId)return 1;
  if(a.kind==='item'&&b.kind!=='item')return -1;if(b.kind==='item'&&a.kind!=='item')return 1;
  if(a.kind==='npc'&&b.kind!=='npc')return -1;if(b.kind==='npc'&&a.kind!=='npc')return 1;
  return distance(player,a)-distance(player,b);
 })[0]||null;
}
