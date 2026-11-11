import * as T from './vendor/three.module.min.js';
import {setPeopleColliders} from './navigation.js';

export const CLUB_PEOPLE=[
 {x:22.2,z:-47,yaw:1.2,role:'welcome'},
 {x:26.4,z:-37,end:[26.4,-17],role:'walk'},
 {x:23.2,z:-29,end:[23.2,-7],role:'walk'},
 {x:-8.9,z:-26.1,yaw:1.1,role:'bar'},
 {x:-13,z:-24.1,yaw:-1.4,role:'drink'},
 {x:-14.5,z:-23.7,yaw:1.6,role:'chat'},
 {x:14.8,z:-2.5,yaw:Math.PI,role:'tennis'},
 {x:14.8,z:-22.5,yaw:0,role:'tennis'},
 {x:-1.8,z:-45.2,yaw:0,role:'beach'},
 {x:-5.5,z:-32,yaw:.4,role:'chat'},
 {x:-1.8,z:12,yaw:Math.PI/2,role:'pickle'},
 {x:-7.9,z:-17,y:.34,yaw:1.3,role:'watch'}
];
export function personPosition(person,seconds){
 if(!person.end)return {x:person.x,z:person.z,yaw:person.yaw||0};
 const dx=person.end[0]-person.x,dz=person.end[1]-person.z,length=Math.hypot(dx,dz),distance=(seconds*.65)%(length*2),returning=distance>length,t=(returning?2*length-distance:distance)/length;
 return {x:person.x+dx*t,z:person.z+dz*t,yaw:Math.atan2(dx,dz)+(returning?Math.PI:0)};
}
export function createClubLife(parent){
 const group=new T.Group();group.name='Vida no Ilha';parent.add(group);
 const mat=new T.MeshStandardMaterial({color:0xffffff,roughness:.88}),geometries={sphere:new T.SphereGeometry(.5,10,8),body:new T.CylinderGeometry(.44,.5,1,8),box:new T.BoxGeometry(1,1,1),racket:new T.TorusGeometry(.125,.009,6,22)};
 const batches={};for(const [name,geometry]of Object.entries(geometries)){const batch=new T.InstancedMesh(geometry,mat,512);batch.instanceMatrix.setUsage(T.DynamicDrawUsage);batch.frustumCulled=false;group.add(batch);batches[name]={mesh:batch,count:0};}
 const root=new T.Object3D(),part=new T.Object3D(),matrix=new T.Matrix4(),color=new T.Color(),up=new T.Vector3(0,1,0),a=new T.Vector3(),b=new T.Vector3(),direction=new T.Vector3();
 const people=CLUB_PEOPLE.map((p,i)=>({...p,time:i*4.1}));
 const skins=[0xb77951,0xe5b892,0x8d583e,0xc99471],shirts=[0xf0eee1,0x427a69,0xe7b15b,0x6c91ac,0xd77c62,0x776b9c],hair=[0x292621,0x4c3525,0x252428];
 function emit(kind,position,scale,tint,quaternion=null){
  const batch=batches[kind];part.position.fromArray(position);part.scale.fromArray(scale);if(quaternion)part.quaternion.copy(quaternion);else part.rotation.set(0,0,0);part.updateMatrix();matrix.multiplyMatrices(root.matrix,part.matrix);batch.mesh.setMatrixAt(batch.count,matrix);batch.mesh.setColorAt(batch.count,color.setHex(tint));batch.count++;
 }
 function limb(from,to,r,tint){a.fromArray(from);b.fromArray(to);direction.copy(b).sub(a);part.quaternion.setFromUnitVectors(up,direction.clone().normalize());emit('body',a.add(b).multiplyScalar(.5).toArray(),[r*2,direction.length(),r*2],tint,part.quaternion);}
 function update(dt,head){
  if(!parent.visible)return;for(const batch of Object.values(batches))batch.count=0;const colliders=[];
  people.forEach((p,index)=>{
   let pos=personPosition(p,p.time),distance=Math.hypot(pos.x-head.x,pos.z-head.z);const moving=p.role==='walk'&&distance>1.4;
   if(p.role!=='walk'||moving)p.time+=dt;pos=personPosition(p,p.time);const phase=p.time*5.2+index,wave=distance<3.7&&!['tennis','beach','pickle'].includes(p.role);
   root.position.set(pos.x,p.y||0,pos.z);root.rotation.set(0,wave?Math.atan2(head.x-pos.x,head.z-pos.z):pos.yaw,0);root.scale.setScalar(.94+(index%3)*.035);root.updateMatrix();colliders.push({x:pos.x,z:pos.z,radius:.27});
   const skin=skins[index%skins.length],shirt=shirts[index%shirts.length],swing=moving?Math.sin(phase)*.24:0;
   emit('body',[0,1.18,0],[.38,.48,.25],shirt);emit('body',[0,.88,0],[.31,.19,.24],0x263c43);
   emit('body',[0,1.465,0],[.095,.09,.1],skin);emit('sphere',[0,1.64,.015],[.265,.32,.255],skin);emit('sphere',[0,1.75,-.006],[.28,.14,.262],hair[index%hair.length]);
   if(index%3===0){emit('sphere',[0,1.77,0],[.292,.14,.275],shirt);emit('box',[0,1.745,.15],[.27,.025,.13],shirt);}
   for(const x of [-.046,.046])emit('sphere',[x,1.665,.135],[.023,.019,.013],0x282b28);
   emit('sphere',[0,1.625,.143],[.033,.049,.035],skin);
   for(const side of [-1,1]){
    const stride=side*swing,hip=[side*.1,.86,0],knee=[side*.105,.48,stride*.45],ankle=[side*.105,.11,stride];limb(hip,knee,.072,0x263c43);limb(knee,ankle,.052,skin);emit('box',[side*.105,.065,stride+.045],[.13,.10,.23],0xeeeada);
    const shoulder=[side*.215,1.36,0],elbow=[side*.29,1.09,-stride*.6],wrist=[side*.27,.87,-stride];
    if(side===1&&wave){elbow.splice(0,3,.34,1.53,.04);wrist.splice(0,3,.38+Math.sin(phase)*.06,1.87,.07);}
    else if(side===1&&['tennis','beach','pickle'].includes(p.role)){elbow.splice(0,3,.31,1.16,.1);wrist.splice(0,3,.32+Math.sin(p.time*2)*.18,1.10+Math.cos(p.time*2)*.1,.35);}
    else if(side===1&&p.role==='drink'){elbow.splice(0,3,.28,1.12,.08);wrist.splice(0,3,.16,1.37+Math.sin(p.time)*.04,.2);emit('body',[wrist[0],wrist[1]+.06,wrist[2]+.02],[.075,.13,.075],0xf0d588);}
    limb(shoulder,elbow,.065,shirt);limb(elbow,wrist,.044,skin);emit('sphere',wrist,[.085,.105,.075],skin);
    if(side===1&&['tennis','beach','pickle'].includes(p.role)){
     limb(wrist,[wrist[0],wrist[1]+.16,wrist[2]],.015,0xe9e6d6);
     if(p.role==='tennis')emit('racket',[wrist[0],wrist[1]+.31,wrist[2]],[1,1.25,1],0x294d42);
     else emit('sphere',[wrist[0],wrist[1]+.25,wrist[2]],[.20,.27,.025],p.role==='beach'?0x34594a:0x39728e);
    }
   }
  });
  root.position.set(0,0,0);root.rotation.set(0,0,0);root.scale.setScalar(1);root.updateMatrix();const t=(people[6].time*.28)%2,u=t<1?t:2-t;emit('sphere',[14.8,1.1+2.3*Math.sin(u*Math.PI),-2.5-u*20],[.075,.075,.075],0xd7ee72);
  for(const batch of Object.values(batches)){batch.mesh.count=batch.count;batch.mesh.instanceMatrix.needsUpdate=true;if(batch.mesh.instanceColor)batch.mesh.instanceColor.needsUpdate=true;}
  setPeopleColliders(colliders);
 }
 update(0,{x:100,z:100});return {update};
}
