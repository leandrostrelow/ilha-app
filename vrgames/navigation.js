// Ground-level obstacles, in the same metres and axes as world.js.
const obstacles = [
 [-16.4,-8.2,-31.4,-27.65], [-16.75,-11.25,-15.5,-8.5],
 [16.9,21.7,-54.35,-49.65], [9.45,14.15,-54.95,-50.45],
 [24.29,24.51,-61.2,-50.2], [24.29,24.51,-44.5,-31.5],
 [-7.35,22.15,-26.45,-26.35], [-7.35,-7.25,-26.4,4.5],
 [22.05,22.15,-26.4,4.5], [7.35,7.45,-26.4,4.5],
 [-7.3,-1.5,4.45,4.55], [1.5,13.3,4.45,4.55], [16.3,22.1,4.45,4.55],
 [-6.2,6.2,-10.94,-10.83], [8.6,21,-10.94,-10.83],
 [-9.4,-7.5,-18,3], [-4.7,4.7,-36.55,-36.45], [10.1,19.5,-36.55,-36.45],
 [5.95,6.05,8.6,15.4], [-27.55,-18.45,-19.05,-18.95], [-27.55,-27.45,-19,-1]
];
const trunks=[];
let people=[];
export function setPeopleColliders(value){people=value;}
export function registerTrunk(x,z,radius){trunks.push({x,z,radius});}
export function clearTrunks(){trunks.length=0;}
for(let i=0;i<6;i++){const x=-18.5+i*2.5;obstacles.push([x-.85,x+.85,-49.75,-46.25]);}
obstacles.push([-15.75,-14.45,-21.85,-20.75],[-11.25,-9.95,-21.85,-20.75]);
export function canStand(x,z,radius=.23){
 if(x < -27 || x > 30.4 || z < -57 || z > 20.5)return false;
 if(trunks.some(t=>Math.hypot(t.x-x,t.z-z)<t.radius+radius))return false;
 if(people.some(p=>Math.hypot(p.x-x,p.z-z)<p.radius+radius))return false;
 return !obstacles.some(([left,right,back,front])=>{
  const px=Math.max(left,Math.min(right,x)),pz=Math.max(back,Math.min(front,z));
  return (x-px)**2+(z-pz)**2<radius**2;
 });
}
export function moveOnGround(position,dx,dz){
 let {x,z}=position;const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.08));
 for(let i=0;i<steps;i++){if(canStand(x+dx/steps,z))x+=dx/steps;if(canStand(x,z+dz/steps))z+=dz/steps;}
 return {x,z};
}
export function walkDelta(forward,input,seconds,speed=1.8){
 const length=Math.hypot(forward.x,forward.z)||1,scale=Math.max(1,Math.hypot(input.x,input.y));
 const x=input.x/scale,y=input.y/scale,fx=forward.x/length,fz=forward.z/length;
 return {x:(-fz*x+fx*y)*speed*seconds,z:(fx*x+fz*y)*speed*seconds};
}
export function thumbstick(source){
 const pad=source?.gamepad;if(!pad||pad.mapping!=='xr-standard')return {x:0,y:0};
 const axes=pad.axes,offset=axes.length>=4?2:0;
 const dead=v=>Math.abs(v||0)<.18?0:Math.sign(v)*Math.min(1,(Math.min(1,Math.abs(v))-.18)/.82);
 return {x:dead(axes[offset]),y:dead(-axes[offset+1])};
}
// Rotate the XR origin around the current head, not around the room's origin.
export function turnAroundHead(origin,head,angle){
 const x=origin.x-head.x,z=origin.z-head.z,c=Math.cos(angle),s=Math.sin(angle);
 return {x:head.x+c*x+s*z,z:head.z-s*x+c*z};
}
