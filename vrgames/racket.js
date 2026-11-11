import * as T from './vendor/three.module.min.js';

// Metres; keep the grip origin and .40 m contact centre used by the lessons/XR.
// Geometry and materials are shared by the desktop, controllers and bar display.
let template;
const up=new T.Vector3(0,1,0);
const materials={};
function material(name,color,roughness=.4,metalness=.1){
 return materials[name]??=new T.MeshStandardMaterial({color,roughness,metalness});
}
function mesh(parent,geometry,mat){const m=new T.Mesh(geometry,mat);parent.add(m);return m;}
function tube(parent,points,radius,mat,segments=32,sides=8){
 const path=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));
 return mesh(parent,new T.TubeGeometry(path,segments,radius,sides,false),mat);
}
function cylinder(parent,top,bottom,length,y,mat,sides=8){
 const m=mesh(parent,new T.CylinderGeometry(top,bottom,length,sides),mat);m.position.y=y;m.rotation.y=Math.PI/8;return m;
}
function texture(kind){
 const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');
 if(kind==='carbon'){
  ctx.fillStyle='#3c4245';ctx.fillRect(0,0,256,256);
  for(let y=0;y<256;y+=8)for(let x=0;x<256;x+=8){ctx.fillStyle=(x/8+y/8)%2?'#474d50':'#282e31';ctx.fillRect(x,y,8,8);ctx.strokeStyle='#62676a';ctx.lineWidth=.7;for(let i=1;i<8;i+=2){ctx.beginPath();if((x/8+y/8)%2){ctx.moveTo(x+i,y);ctx.lineTo(x+i,y+8);}else{ctx.moveTo(x,y+i);ctx.lineTo(x+8,y+i);}ctx.stroke();}}
 }else{
  ctx.fillStyle='#efeee7';ctx.fillRect(0,0,256,256);
  for(let y=4;y<256;y+=12)for(let x=4;x<256;x+=12){ctx.fillStyle='#b8b9b1';ctx.beginPath();ctx.arc(x+(y%24?3:0),y,.7,0,Math.PI*2);ctx.fill();}
 }
 const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.anisotropy=4;if(kind==='carbon')map.repeat.set(8,8);return map;
}
function label(parent,text,w,h,x,y,z,angle=0,color='#e3efc6'){
 const c=document.createElement('canvas');c.width=512;c.height=96;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.font='700 68px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,49,500);
 const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;
 const mat=new T.MeshBasicMaterial({map,transparent:true,depthWrite:false,side:T.DoubleSide});
 for(const side of [-1,1]){const m=mesh(parent,new T.PlaneGeometry(w,h),mat);m.position.set(x,y,z*side);m.rotation.set(0,side<0?Math.PI:0,angle*side);}
}
// A thin, oval beam section rather than a scaled torus: 27-inch overall silhouette.
function hoop(parent,mat,start=0,end=Math.PI*2,rx=.137,ry=.175,width=.0085,depth=.0115){
 const steps=Math.ceil((end-start)/Math.PI*48),sides=10,pos=[],normal=[],uv=[],indices=[];
 for(let i=0;i<=steps;i++){
  const a=start+(end-start)*i/steps,nx=Math.cos(a)/rx,ny=Math.sin(a)/ry,n=Math.hypot(nx,ny);
  for(let j=0;j<=sides;j++){
   const b=j*Math.PI*2/sides,radial=Math.cos(b),z=Math.sin(b);
   pos.push(rx*Math.cos(a)+nx/n*width*radial,.4+ry*Math.sin(a)+ny/n*width*radial,depth*z);
   const normalLength=Math.hypot(radial/width,z/depth);normal.push(nx/n*radial/width/normalLength,ny/n*radial/width/normalLength,z/depth/normalLength);uv.push(i/steps,j/sides);
   if(i<steps&&j<sides){const k=i*(sides+1)+j;indices.push(k,k+sides+1,k+1,k+1,k+sides+1,k+sides+2);}
  }
 }
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('normal',new T.Float32BufferAttribute(normal,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(indices);return mesh(parent,geo,mat);
}
function makeTennis(parent,paint,carbon,black,lime){
 const g=new T.Group();g.name='tennis';parent.add(g);
 hoop(g,paint);
 // Protective bumper across the crown, plus restrained paint accents.
 hoop(g,black,.12,Math.PI-.12,.143,.181,.003,.0122);
 for(const [a,b]of [[3.35,4.02],[5.4,6.07]])hoop(g,lime,a,b,.137,.175,.0088,.0118);
 for(const side of [-1,1]){
  tube(g,[[side*.009,.083,0],[side*.021,.143,0],[side*.060,.210,0],[side*.108,.287,0]],.0084,carbon,24,10);
  tube(g,[[side*.025,.151,.007],[side*.049,.193,.007],[side*.071,.231,.007]],.0016,lime,14,5);
 }
 cylinder(g,.013,.015,.052,.095,carbon);
 const stringMat=material('strings',0xeeeadd,.7,0),grommetMat=material('grommets',0x121a1c,.66,0);
 const segments=[],ends=[],rx=.1285,ry=.166;
 for(let i=0;i<16;i++){const x=(i-7.5)*.0153,y=ry*Math.sqrt(1-x*x/(rx*rx));segments.push([[x,.4-y,.0008],[x,.4+y,.0008]]);ends.push([x,.4-y],[x,.4+y]);}
 for(let i=0;i<19;i++){const y=(i-9)*.0171,x=rx*Math.sqrt(1-y*y/(ry*ry));segments.push([[-x,.4+y,-.0008],[x,.4+y,-.0008]]);ends.push([-x,.4+y],[x,.4+y]);}
 const strings=new T.InstancedMesh(new T.CylinderGeometry(.00072,.00072,1,5),stringMat,segments.length),dummy=new T.Object3D();strings.name='16x19-strings';
 segments.forEach(([a,b],i)=>{const from=new T.Vector3(...a),to=new T.Vector3(...b),direction=to.clone().sub(from);dummy.position.copy(from).add(to).multiplyScalar(.5);dummy.quaternion.setFromUnitVectors(up,direction.clone().normalize());dummy.scale.set(1,direction.length(),1);dummy.updateMatrix();strings.setMatrixAt(i,dummy.matrix);});strings.computeBoundingSphere();g.add(strings);
 const eyelets=new T.InstancedMesh(new T.CylinderGeometry(.0021,.0021,.016,6),grommetMat,ends.length);
 ends.forEach(([x,y],i)=>{dummy.position.set(x*1.035,.4+(y-.4)*1.035,0);dummy.rotation.set(Math.PI/2,0,0);dummy.scale.set(1,1,1);dummy.updateMatrix();eyelets.setMatrixAt(i,dummy.matrix);});eyelets.computeBoundingSphere();g.add(eyelets);
 label(g,'ILHA',.056,.009,-.064,.218,.009,1.03);
 label(g,'TOUR 98',.048,.007,.067,.220,.009,-1.03);
 label(g,'16 × 19',.033,.006,0,.228,.012);
 return g;
}
function paddleShape(kind){
 const s=new T.Shape();
 if(kind==='beach'){
  s.moveTo(-.045,.229);s.bezierCurveTo(-.083,.251,-.131,.287,-.135,.397);s.bezierCurveTo(-.141,.515,-.089,.573,0,.576);s.bezierCurveTo(.089,.573,.141,.515,.135,.397);s.bezierCurveTo(.131,.287,.083,.251,.045,.229);s.closePath();
  for(let row=0;row<5;row++)for(let col=-2;col<=2;col++){const x=col*.037,y=.319+row*.044;if(row===0&&Math.abs(col)===2)continue;const hole=new T.Path();hole.absarc(x,y,.0078,0,Math.PI*2,true);s.holes.push(hole);}
 }else{
  s.moveTo(-.032,.233);s.lineTo(-.091,.276);s.quadraticCurveTo(-.108,.29,-.108,.322);s.lineTo(-.108,.513);s.quadraticCurveTo(-.108,.550,-.071,.550);s.lineTo(.071,.550);s.quadraticCurveTo(.108,.550,.108,.513);s.lineTo(.108,.322);s.quadraticCurveTo(.108,.29,.091,.276);s.lineTo(.032,.233);s.closePath();
 }
 return s;
}
function makePaddle(parent,kind,carbon,black,lime){
 const g=new T.Group();g.name=kind;parent.add(g);const shape=paddleShape(kind);
 cylinder(g,.018,.014,.15,.154,carbon);
 const body=mesh(g,new T.ExtrudeGeometry(shape,{depth:.013,steps:1,bevelEnabled:true,bevelSegments:2,bevelSize:.003,bevelThickness:.002,curveSegments:18}),black);body.position.z=-.0065;
 const surface=new T.ShapeGeometry(shape,18);for(const side of [-1,1]){const face=mesh(g,surface,carbon);face.position.z=side*.009;face.material.side=T.DoubleSide;}
 // Colour at the shoulders and a printed club identity, leaving actual beach holes open.
 for(const side of [-1,1])tube(g,[[side*.087,.293,.010],[side*.100,.329,.010],[side*.103,.367,.010]],.0025,kind==='beach'?lime:material('blue',0x5ba6c5,.35),12,5);
 label(g,'ILHA',.089,.018,0,kind==='beach'?.548:.463,.010);
 label(g,kind==='beach'?'BEACH':'PICKLEBALL',.068,.010,0,kind==='beach'?.270:.431,.010);
 return g;
}
function buildTemplate(){
 const g=new T.Group();g.name='Ilha Tour racket';
 const paint=material('paint',0x234b43,.28,.3),black=material('rubber',0x172024,.63,0),lime=material('accent',0xc2d787,.34,.1);
 const carbon=new T.MeshStandardMaterial({color:0x909b9b,map:texture('carbon'),roughness:.42,metalness:.22});
 const gripMap=texture('grip'),grip=new T.MeshStandardMaterial({color:0xf4f1e7,map:gripMap,bumpMap:gripMap,bumpScale:.0004,roughness:.9});
 cylinder(g,.0163,.0176,.174,-.003,grip);
 cylinder(g,.018,.0218,.019,-.0995,black);
 cylinder(g,.0182,.0182,.006,.087,black);
 cylinder(g,.0219,.0219,.003,-.103,lime);
 // Helical overgrip seam follows the eight flat faces of the handle.
 const pts=[];for(let i=0;i<=280;i++){const t=i/280,a=t*Math.PI*2*7.6,y=-.088+t*.172,r=.0176-(y+.09)/.18*.0013,oct=r*Math.cos(Math.PI/8)/Math.cos(((a+Math.PI/8)%(Math.PI/4))-Math.PI/8);pts.push([Math.cos(a)*oct,y,Math.sin(a)*oct]);}
 tube(g,pts,.00055,material('grip-seam',0xa5aaa0,.85,0),280,4);
 label(g,'ILHA',.022,.006,0,.086,.0185);
 makeTennis(g,paint,carbon,black,lime);makePaddle(g,'beach',carbon,black,lime);makePaddle(g,'pickle',carbon,black,lime);
 g.getObjectByName('beach').visible=g.getObjectByName('pickle').visible=false;
 const head=new T.Object3D();head.name='contact-centre';head.position.y=.4;g.add(head);return g;
}
export function makeRacket(){
 template??=buildTemplate();const g=template.clone(true);g.userData.head=g.getObjectByName('contact-centre');g.userData.kind='tennis';return g;
}
export function setRacketStyle(racket,kind){
 const next=kind==='beach'||kind==='pickle'?kind:'tennis';if(racket.userData.kind===next)return;
 racket.userData.kind=next;for(const style of ['tennis','beach','pickle'])racket.getObjectByName(style).visible=style===next;
}
