import * as T from './vendor/three.module.min.js';
import {registerTrunk,clearTrunks} from './navigation.js';
const detailMaps=new Map();
const cache=new Map(),cube=new T.BoxGeometry(1,1,1),crown=new T.IcosahedronGeometry(1,2),cylinders=new Map();
function detailMap(kind){
 if(detailMaps.has(kind))return detailMaps.get(kind);const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');let seed=3321;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};ctx.fillStyle=kind==='leaves'?'#dce3c6':'#eee2cc';ctx.fillRect(0,0,256,256);
 for(let i=0;i<(kind==='leaves'?1800:450);i++){const x=random()*256,y=random()*256;ctx.fillStyle=i%2?'#3a3d2640':'#ffffff45';if(kind==='leaves'){ctx.beginPath();ctx.ellipse(x,y,2+random()*4,1+random()*2,random()*3,0,Math.PI*2);ctx.fill();}else ctx.fillRect(x,y,25+random()*120,.5+random());}
 const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.anisotropy=4;detailMaps.set(kind,map);return map;
}
function mat(color){if(!cache.has(color)){const leaves=[0x315f38,0x477448,0x658747].includes(color),wood=[0x795139,0xb48b58,0x9b764f,0x90704c,0xb39467,0x8e7251,0x93816a,0x817158].includes(color);const map=leaves||wood?detailMap(leaves?'leaves':'wood'):null;cache.set(color,new T.MeshStandardMaterial({color,map,bumpMap:map,bumpScale:leaves?.04:.015,roughness:.95,flatShading:false}));}return cache.get(color);}
export function box(parent,w,h,d,color,x=0,y=0,z=0){const m=new T.Mesh(cube,mat(color));m.scale.set(w,h,d);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m;}
function cyl(parent,r1,r2,h,color,x,y,z,n=8){const key=`${r1/r2}:${n}`;if(!cylinders.has(key))cylinders.set(key,new T.CylinderGeometry(r1/r2,1,1,n));const m=new T.Mesh(cylinders.get(key),mat(color));m.scale.set(r2,h,r2);m.position.set(x,y,z);m.castShadow=true;parent.add(m);return m;}
function lines(parent,points,color,opacity=1){const g=new T.BufferGeometry().setFromPoints(points.map(p=>new T.Vector3(...p)));const m=new T.LineSegments(g,new T.LineBasicMaterial({color,transparent:opacity<1,opacity}));parent.add(m);return m;}
export function board(parent,text,sub,w,h,x,y,z,bg='#173e30',fg='#f3f0db'){
 const c=document.createElement('canvas');c.width=1024;c.height=Math.round(1024*h/w);const ctx=c.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);ctx.textAlign='center';ctx.fillStyle=fg;ctx.font=`700 ${Math.min(110,c.height*.31)}px sans-serif`;ctx.fillText(text,512,c.height*.46);ctx.font=`500 ${Math.min(42,c.height*.13)}px sans-serif`;ctx.fillText(sub,512,c.height*.74);
 const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;const m=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map:texture}));m.position.set(x,y,z);const back=new T.Mesh(m.geometry,m.material);back.rotation.y=Math.PI;back.position.z=-.01;m.add(back);parent.add(m);return m;
}
function tree(parent,x,z,s=1,seed=0){
 registerTrunk(x,z,.28*s);
 const g=new T.Group();g.position.set(x,0,z);g.scale.setScalar(s);parent.add(g);cyl(g,.16,.27,3.3,0x817158,0,1.65,0);
 for(let i=0;i<5;i++){const m=new T.Mesh(crown,mat([0x315f38,0x477448,0x658747][(i+seed)%3]));m.position.set(Math.cos(i*2.1)*1.05,3.6+(i%3)*.5,Math.sin(i*2.1)*.9);m.scale.set(1.8,1.6,1.75);m.castShadow=true;g.add(m);}
 const shadow=new T.Mesh(new T.CircleGeometry(2,18),new T.MeshBasicMaterial({color:0x355140,transparent:true,opacity:.12,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.028;g.add(shadow);
}
let palmLeafGeometry;
function palm(parent,x,z,s=1){
 registerTrunk(x,z,.24*s);
 const g=new T.Group();g.position.set(x,0,z);g.scale.setScalar(s);parent.add(g);
 for(let i=0;i<8;i++){const trunk=cyl(g,.17-i*.008,.19-i*.008,.65,0x93816a,Math.sin(i*.12)*.34,.32+i*.63,0,10);trunk.rotation.z=-.04;}
 if(!palmLeafGeometry){const vertices=[];for(let i=1;i<=12;i++){const t=i/13,zz=t*3.6,yy=1.1*Math.sin(t*Math.PI)-t*.8,w=.52*Math.sin(t*Math.PI);for(const side of [-1,1])vertices.push(0,yy,zz,side*w,yy-.25,zz+.38,0,yy-.06,zz+.3);}palmLeafGeometry=new T.BufferGeometry();palmLeafGeometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));palmLeafGeometry.computeVertexNormals();}
 const leafMaterial=mat(0x557f3c);leafMaterial.side=T.DoubleSide;
 for(let i=0;i<9;i++){const leaf=new T.Mesh(palmLeafGeometry,leafMaterial);leaf.position.set(.25,5.15,0);leaf.rotation.y=i*Math.PI*2/9;leaf.rotation.z=(i%3)*.06;leaf.castShadow=true;leaf.userData.frond=true;g.add(leaf);}
 for(let i=0;i<4;i++){const fruit=new T.Mesh(crown,mat(0x798348));fruit.position.set(.25+Math.cos(i*1.5)*.23,4.95,Math.sin(i*1.5)*.23);fruit.scale.set(.14,.2,.14);g.add(fruit);}
}
export function makeSky(){
 const c=document.createElement('canvas');c.width=2048;c.height=1024;const ctx=c.getContext('2d');const gradient=ctx.createLinearGradient(0,0,0,1024);gradient.addColorStop(0,'#73acd4');gradient.addColorStop(.38,'#b2d3df');gradient.addColorStop(.52,'#dce4d8');gradient.addColorStop(1,'#a9b6a0');ctx.fillStyle=gradient;ctx.fillRect(0,0,2048,1024);
 for(const [x,y,w]of [[220,325,160],[700,285,200],[1120,350,170],[1600,295,210],[1980,340,160]]){for(let i=0;i<5;i++)for(const wrap of [-2048,0,2048]){const xx=x+(i-2)*w*.3+wrap,yy=y-Math.sin(i)*15;const cloud=ctx.createRadialGradient(xx,yy,0,xx,yy,w*.65);cloud.addColorStop(0,'#ffffff88');cloud.addColorStop(1,'#ffffff00');ctx.fillStyle=cloud;ctx.fillRect(xx-w,yy-w,w*2,w*2);}}
 const texture=new T.CanvasTexture(c);texture.mapping=T.EquirectangularReflectionMapping;texture.wrapS=T.RepeatWrapping;texture.colorSpace=T.SRGBColorSpace;return texture;
}
function fence(parent,x1,z1,x2,z2,h=2.7){
 const len=Math.hypot(x2-x1,z2-z1),n=Math.ceil(len/3),pts=[];
 for(let i=0;i<=n;i++){const t=i/n;box(parent,.06,h,.06,0x43564a,x1+(x2-x1)*t,h/2,z1+(z2-z1)*t);}
 for(let y=.1;y<h;y+=.3)pts.push([x1,y,z1],[x2,y,z2]);
 for(let i=0;i<=len/.33;i++){const t=i*.33/len;pts.push([x1+(x2-x1)*t,.05,z1+(z2-z1)*t],[x1+(x2-x1)*t,h,z1+(z2-z1)*t]);}
 lines(parent,pts,0x536353,.28);lines(parent,[[x1,h,z1],[x2,h,z2]],0x536353);
}
// Layout reconciled with the club's drone photos and the owner's corrected plan.
// North is -Z. The public lane/entrance and river run along the east (+X).
function surface(parent,w,d,color,x,z,kind='grain',y=.014){
 const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,256,256);
 let seed=817;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<5200;i++){ctx.fillStyle=i%2?'#ffffff18':'#261b1420';ctx.fillRect(rand()*256,rand()*256,1+rand()*2,1);}
 if(kind==='paving'){ctx.strokeStyle='#6d6b6060';ctx.lineWidth=2;for(let row=0;row<8;row++){const yy=row*32;ctx.beginPath();ctx.moveTo(0,yy);ctx.lineTo(256,yy);for(let col=-1;col<8;col++){const xx=col*42+(row%2)*21;ctx.moveTo(xx,yy);ctx.lineTo(xx,yy+32);}ctx.stroke();}}
 const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.repeat.set(w/3,d/3);map.anisotropy=4;
 const m=new T.Mesh(new T.PlaneGeometry(w,d),new T.MeshStandardMaterial({map,bumpMap:map,bumpScale:kind==='paving'?.035:.012,roughness:1}));m.rotation.x=-Math.PI/2;m.position.set(x,y,z);m.receiveShadow=true;parent.add(m);return m;
}
function court(parent,offset=0){
 const g=new T.Group();g.position.x=offset;parent.add(g);
 surface(g,14.4,30.6,'#b94d27',0,-10.885);
 const cream=0xeee4cc;
 for(const x of [-5.485,-4.115,4.115,5.485])box(g,.045,.012,23.77,cream,x,.035,-10.885);
 for(const z of [1,-22.77])box(g,10.97,.012,.05,cream,0,.035,z);
 for(const z of [-4.485,-17.285])box(g,8.23,.012,.045,cream,0,.035,z);
 box(g,.045,.012,12.8,cream,0,.035,-10.885);box(g,.05,.012,.18,cream,0,.035,.85);
 for(const x of [-6.2,6.2])cyl(g,.055,.055,1.07,0x263b33,x,.535,-10.885);
 const p=[];for(let x=-6.2;x<=6.2;x+=.15)p.push([x,.05,-10.885],[x,.914+Math.abs(x)/6.2*.156,-10.885]);for(let y=.12;y<1;y+=.1)p.push([-6.2,y,-10.885],[6.2,y,-10.885]);lines(g,p,0x102a24,.8);
 const top=[];for(let i=0;i<24;i++){const a=-6.2+i*12.4/24,b=a+12.4/24;top.push([a,.914+Math.abs(a)/6.2*.156,-10.885],[b,.914+Math.abs(b)/6.2*.156,-10.885]);}lines(g,top,cream);box(g,.04,.914,.035,cream,0,.457,-10.885);
 board(g,offset?'QUADRA 02':'QUADRA 01','ILHA TÊNIS · COLATINA',3,.8,0,1.65,-26.2,'#233b32');
 for(const x of [-4.7,4.7])board(g,'ILHA TÊNIS','O NOSSO CLUBE',3.5,.7,x,.65,-26.21,'#222c28');
 return g;
}
function floodlight(g,x,z){
 cyl(g,.07,.11,7.2,0x32423a,x,3.6,z);box(g,1.9,.12,.15,0x26352e,x,7.15,z);
 for(let i=0;i<4;i++){box(g,.4,.36,.22,0x26352e,x-.72+i*.48,7.23,z);box(g,.32,.26,.02,0xe6e9d5,x-.72+i*.48,7.23,z+.12);}
}
function umbrella(g,x,z){
 cyl(g,.035,.035,2.6,0xbab6a1,x,1.3,z);cyl(g,0,1.65,.65,0x2868a5,x,2.75,z,10);
 for(let i=0;i<10;i++){const a=i*Math.PI/5;box(g,.1,.17,.1,0x285f91,x+Math.cos(a)*1.56,2.39,z+Math.sin(a)*1.56);}
 box(g,1.8,.12,.45,0x91704e,x, .48,z+.8);for(const xx of [-.65,.65])box(g,.1,.45,.4,0x363f36,x+xx,.23,z+.8);
}
function cottage(g,x,z,w=5,d=5,roof=0x8e5034){
 box(g,w,2.6,d,0xded7bd,x,1.3,z);box(g,w,.65,d+.02,0x5e8591,x,.33,z);
 for(const side of [-1,1]){const panel=box(g,w/2+.35,.14,d+.5,roof,x+side*w/4,2.95,z);panel.rotation.z=-side*.24;}
 box(g,1,1.95,.04,0x4a5149,x+.7,1,z+d/2+.025);box(g,1,.9,.04,0x83b4bd,x-1.35,1.7,z+d/2+.025);
 for(const xx of [-1.8,-1.5,-1.2,-.9])box(g,.035,.9,.05,0xd9dacd,x+xx,1.7,z+d/2+.06);
}
function bar(g){
 const warm=new T.PointLight(0xffcd85,7,11,2);warm.position.set(-12.3,2.5,-26.3);g.add(warm);
 // Compact bar across the northwest corner, deck facing the tennis courts.
 box(g,8.2,2.9,3.2,0x222b29,-12.3,1.45,-29.8);box(g,9,.16,5,0x303937,-12.3,3,-29.1);
 for(let x=-16.5;x<-7.9;x+=.28)box(g,.035,.045,5,0x424a43,x,3.1,-29.1);
 for(let x=-16.25;x<-8.3;x+=.16)box(g,.035,2.78,.035,0x3b423d,x,1.4,-28.17);
 box(g,7.5,1.1,.3,0x795139,-12.3,.55,-28.15);box(g,7.9,.12,.65,0xb48b58,-12.3,1.12,-28.02);
 box(g,7.8,1.5,.02,0x0d1d1b,-12.3,1.95,-28.18);
 board(g,'ILHA BAR','UM ENCONTRO DEPOIS DA QUADRA',3.3,.8,-12.1,2.15,-28.12,'#202825','#e5d57b');
 box(g,.95,1.9,.7,0x427da1,-15.6,.96,-27.9);box(g,.78,1.38,.02,0x8bc2cf,-15.6,1.13,-27.53);
 for(let y=.6;y<1.8;y+=.32){box(g,.75,.03,.04,0xc6e1cf,-15.6,y,-27.5);for(let x=-15.88;x<-15.3;x+=.17){cyl(g,.035,.045,.2,0xa4c76b,x,y+.12,-27.48,8);cyl(g,.018,.02,.05,0xe0dda7,x,y+.24,-27.48,8);}}
 for(let x=-16.1;x<-8.2;x+=3.8)box(g,.12,2.9,.12,0x555242,x,1.45,-26.65);
 for(let x=-14.6;x<-9;x+=1.15){const racket=makeRacket();racket.scale.setScalar(.8);racket.rotation.z=Math.PI;racket.position.set(x,2.82,-27.5);g.add(racket);cyl(g,.09,.17,.2,0xedca83,x,2.52,-26.9);}
 surface(g,9.4,3.6,'#948572',-12.3,-25.1,'paving',.025);
 for(let z=-23.1;z<-19.3;z+=.22)box(g,9.4,.12,.19,0x9b764f,-12.3,.1,z);
 for(const x of [-15.1,-10.6]){box(g,1.3,.1,1.1,0xb39467,x,.8,-21.3);for(const dx of [-.48,.48])box(g,.08,.8,.8,0x66634b,x+dx,.4,-21.3);for(const dz of [-1.05,1.05]){box(g,1.3,.1,.36,0x8e7251,x,.45,-21.3+dz);box(g,1.2,.4,.06,0x8e7251,x,.7,-21.3+dz*1.15);}}
 tree(g,-17,-22,1.2,1);cottage(g,-14,-12,5.5,7);
 // Raised grass bank and three timber/concrete tiers along court one.
 box(g,3.3,.45,19,0x71845b,-9.8,.1,-9);
 for(let step=0;step<3;step++){const x=-7.7-step*.65,y=.17+step*.23;box(g,.65,y*2,21,0x9b9781,x,y,-7.5);box(g,.58,.07,21,0x90704c,x,y*2+.04,-7.5);}
 for(let z=-17;z<3;z+=3.3)box(g,.12,.85,.12,0x314138,-9.6,1.07,z);
 box(g,.08,.08,21,0x314138,-9.6,1.5,-7.5);
}
function beach(g,x,z,name){
 surface(g,13.8,17,'#d5bf92',x,z);
 for(const xx of [-4,4])box(g,.045,.01,16,0xd9dbbf,x+xx,.033,z);
 for(const zz of [-8,8])box(g,8,.01,.045,0xd9dbbf,x,.033,z+zz);
 const top=name==='BEACH TÊNIS'?1.7:2.2;for(const xx of [-4.7,4.7])cyl(g,.05,.06,top+.15,0x35604b,x+xx,(top+.15)/2,z);
 const pts=[];for(let yy=top-.75;yy<top;yy+=.1)pts.push([x-4.7,yy,z],[x+4.7,yy,z]);for(let xx=-4.7;xx<=4.7;xx+=.23)pts.push([x+xx,top-.75,z],[x+xx,top,z]);lines(g,pts,0x283e32,.8);box(g,9.4,.045,.025,0xe7e7cf,x,top,z);
 board(g,name,'ILHA TÊNIS',2.4,.6,x,1.2,z-8.4);
}
function pickleball(g){
 const s=new T.Group();s.position.set(6,.01,12);s.rotation.y=Math.PI/2;g.add(s);
 surface(s,9,18,'#358c8e',0,0);surface(s,6.1,13.41,'#346278',0,0,'grain',.025);
 for(const x of [-3.05,3.05])box(s,.04,.012,13.41,0xe8e5cd,x,.04,0);
 for(const z of [-6.705,-2.13,2.13,6.705])box(s,6.1,.012,.04,0xe8e5cd,0,.04,z);
 for(const z of [-4.4175,4.4175])box(s,.04,.012,4.575,0xe8e5cd,0,.04,z);
 for(const x of [-3.4,3.4])cyl(s,.04,.04,.91,0x31423b,x,.455,0);
 const pts=[];for(let y=.12;y<.9;y+=.12)pts.push([-3.4,y,0],[3.4,y,0]);for(let x=-3.4;x<3.4;x+=.16)pts.push([x,.1,0],[x,.9,0]);lines(s,pts,0x26352d,.8);box(s,6.8,.035,.025,0xeee9d4,0,.9,0);
}
function entrance(g){
 surface(g,4.5,79,'#a3a090',28,-17,'paving');surface(g,38,3,'#b2a38b',7,-47,'paving');
 // The reference has a low wall and roadside sign, not an archway.
 box(g,.22,1.25,11,0xb8b19d,24.4,.625,-55.7);box(g,.22,1.25,13,0xb8b19d,24.4,.625,-38);
 for(const z of [-49.9,-44.5])box(g,.4,1.6,.4,0xc4bba6,24.4,.8,z);
 const sign=new T.Group();sign.position.set(23.8,0,-44.7);sign.rotation.y=1.02;g.add(sign);
 for(const x of [-.9,.9])box(sign,.07,2.8,.07,0x414c3e,x,1.4,0);
 board(sign,'ILHA TÊNIS','E BEACH · COLATINA',2.3,1.1,0,2.1,.02,'#f4efda','#294c37');board(sign,'ENTRADA ←','BEM-VINDO AO CLUBE',2.3,.65,0,1.2,.02,'#234733','#eff1d8');
 cottage(g,19.3,-52,4.8,4.7,0x737c76);cyl(g,.65,.6,.75,0x3e7d9d,19.8,3.6,-52);cottage(g,11.8,-52.7,4.7,4.5,0x9a6c50);
 for(const [x,z,s]of [[22,-49.5,1], [19.5,-44.5,.9],[7.3,-37,1.1],[-6.5,-42,1.05]])palm(g,x,z,s);
 // Six simple parked cars, kept outside the playing areas.
 surface(g,16,7,'#ab9e88',-12,-48,'paving');
 for(let i=0;i<6;i++){const x=-18.5+i*2.5;box(g,1.7,.65,3.5,[0xc7c7bb,0x41535b,0xb6bdba][i%3],x,.65,-48);box(g,1.45,.55,1.8,0x5b7072,x,1.22,-48.2);for(const z of [-49.05,-46.95])for(const xx of [-.85,.85]){const wheel=cyl(g,.29,.29,.13,0x28302c,x+xx,.37,z,10);wheel.rotation.z=Math.PI/2;}}
}
function surroundings(g){
 // Narrow channel bends round the south end; the club is not an ocean island.
 const river=new T.Shape();river.moveTo(34,-70);river.lineTo(44,-70);river.lineTo(44,10);river.quadraticCurveTo(43,31,20,33);river.lineTo(-50,33);river.lineTo(-50,24);river.lineTo(17,24);river.quadraticCurveTo(34,24,34,10);river.closePath();
 const geo=new T.ShapeGeometry(river,18);geo.rotateX(Math.PI/2);const water=new T.Mesh(geo,new T.MeshStandardMaterial({color:0x648e85,roughness:.62,side:T.DoubleSide}));water.position.y=-.055;g.add(water);
 for(let i=0;i<23;i++){const z=-57+i*3.6;tree(g,32+(i%2)*1.8,z,.7+(i%3)*.16,i%3);}
 for(let i=0;i<13;i++)tree(g,-28+(i%2)*2,-47+i*5.4,1.1+(i%3)*.15,i%3);
 for(let i=0;i<10;i++)tree(g,-27+i*5,21,.9+(i%3)*.2,i%3);
 for(let i=0;i<9;i++)tree(g,-25+i*6.8,-59,1.3+(i%2)*.2,i%3);
 for(let i=0;i<12;i++){const hill=new T.Mesh(crown,mat(i%2?0x66856a:0x758b72));hill.position.set(-100+i*20,4+(i%3)*3,-110);hill.scale.set(22,12+(i%4)*5,18);g.add(hill);}
 for(let i=0;i<16;i++){const x=53+(i%4)*7,z=-55+Math.floor(i/4)*13,h=3+(i%5)*1.2;box(g,4.3,h,5,[0xc5bb9f,0xb4b8aa,0xcbb99d][i%3],x,h/2,z);box(g,4.7,.3,5.4,0x9b7154,x,h+.15,z);}
 box(g,61,.45,5,0x92998d,20,3.4,-70);for(let x=-8;x<49;x+=12)box(g,.7,3.6,1.8,0x92998d,x,1.55,-70);
}
// Merge repeated static geometry into instanced draws to keep headset cost low.
function instanceScenery(g){
 g.updateMatrixWorld(true);const batches=new Map();
 g.traverse(m=>{for(let p=m;p;p=p.parent)if(!p.visible)return;if(!m.isMesh||(!m.userData.frond&&!['BoxGeometry','CylinderGeometry','IcosahedronGeometry'].includes(m.geometry.type)))return;const key=`${m.geometry.uuid}:${m.material.uuid}`;if(!batches.has(key))batches.set(key,[]);batches.get(key).push(m);});
 for(const meshes of batches.values()){if(meshes.length<3)continue;const first=meshes[0],batch=new T.InstancedMesh(first.geometry,first.material,meshes.length);meshes.forEach((m,i)=>{batch.setMatrixAt(i,m.matrixWorld);m.removeFromParent();});batch.castShadow=first.castShadow;batch.receiveShadow=first.receiveShadow;batch.instanceMatrix.needsUpdate=true;batch.computeBoundingSphere();g.add(batch);}
}
export function buildWorld(scene){
 clearTrunks();const g=new T.Group();scene.add(g);box(g,280,.3,280,0x7f956b,0,-.23,-30);surface(g,53,69,'#9a9c76',-1,-15,'grain',-.01);
 court(g,0);court(g,14.8);
 fence(g,-7.3,-26.4,22.1,-26.4,3);fence(g,-7.3,-26.4,-7.3,4.5,2.4);fence(g,22.1,-26.4,22.1,4.5,3);
 fence(g,7.4,-26.4,7.4,4.5,1.05);fence(g,-7.3,4.5,-1.5,4.5,1.2);fence(g,1.5,4.5,13.3,4.5,1.2);fence(g,16.3,4.5,22.1,4.5,1.2);
 for(const x of [-7.6,22.5])for(const z of [-23,-1])floodlight(g,x,z);
 umbrella(g,7.4,-10.8);bar(g);beach(g,0,-36.5,'BEACH TÊNIS');beach(g,14.8,-36.5,'FUTEVÔLEI');pickleball(g);entrance(g);surroundings(g);
 surface(g,9,18,'#647563',-23,-10);fence(g,-27.5,-19,-18.5,-19,2.2);fence(g,-27.5,-19,-27.5,-1,2.2);
 for(const [x,z,s]of [[-18,-4,1.2],[-18,9,1.3],[23.5,11,.9],[-5,18,.9]])tree(g,x,z,s,1);
 instanceScenery(g);return g;
}

export function makeRacket(){
 const g=new T.Group();cyl(g,.019,.025,.22,0x213c32,0,.035,0,10);cyl(g,.012,.012,.16,0xd9e4cd,0,.21,0,8);
 const frame=new T.Mesh(new T.TorusGeometry(.17,.016,6,32),mat(0xd4eb7c));frame.position.y=.40;frame.scale.y=1.26;g.add(frame);
 const pts=[];for(let x=-.135;x<.15;x+=.034){const y=.206*Math.sqrt(1-x*x/(.16*.16));pts.push([x,.40-y,0],[x,.40+y,0]);}for(let y=-.17;y<.19;y+=.034){const x=.16*Math.sqrt(1-y*y/(.206*.206));pts.push([-x,.40+y,0],[x,.40+y,0]);}const strings=lines(g,pts,0xecead7,.85);
 const face=new T.Mesh(new T.CircleGeometry(.153,40),new T.MeshStandardMaterial({color:0x30634c,roughness:.65,side:T.DoubleSide}));face.position.set(0,.4,0);face.scale.y=1.26;face.visible=false;g.add(face);const stripe=box(face,.16,.025,.003,0xe1eabd,0,.025,.004);stripe.rotation.z=-.25;g.userData.strings=strings;g.userData.face=face;g.userData.frame=frame;
 const head=new T.Object3D();head.position.y=.4;g.add(head);g.userData.head=head;return g;
}
export function makeCoach(parent){
 const g=new T.Group();parent.add(g);g.position.set(-3.3,0,-3.8);cyl(g,.27,.22,.63,0x35654b,0,1.12,0,7);const head=new T.Mesh(new T.IcosahedronGeometry(.18,2),mat(0xd3a779));head.position.y=1.64;g.add(head);cyl(g,.19,.2,.06,0xf5edcf,0,1.81,0,12);box(g,.24,.035,.18,0xf5edcf,0,1.8,.14);for(const x of [-.13,.13]){box(g,.19,.25,.21,0xeee5ce,x,.76,0);cyl(g,.065,.07,.52,0xc99d72,x,.42,0);box(g,.14,.12,.27,0xf4edda,x,.1,.07);const arm=cyl(g,.055,.07,.57,0xd3a779,x*2.55,1.1,0);arm.rotation.z=x>0?.16:-.16;}
 board(g,'RENATO','VAMOS COMEÇAR?',1.15,.43,0,2.18,0,'#f6f1df','#31513a');return g;
}

export function setRacketStyle(racket,kind){if(racket.userData.kind===kind)return;racket.userData.kind=kind;const paddle=kind==='beach'||kind==='pickle';racket.userData.strings.visible=!paddle;racket.userData.face.visible=paddle;racket.userData.face.material.color.setHex(kind==='beach'?0x244f44:0x446c9b);}
