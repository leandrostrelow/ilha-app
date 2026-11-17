// Brand artwork is always the original PNG, rendered in white via CSS.
// The image model prepares blank fabric only; it never supplies the displayed logo.
export const LOGO_SOURCE = '/cresol/assets/cresol-original.png';
const LOGO_WIDTH = 1664;
const LOGO_HEIGHT = 1080;
const REFERENCE_WIDTH = 1774;
const REFERENCE_HEIGHT = 887;
const placements = [
  [[135,478],[168,472],[168,493],[135,499]],
  [[601,448],[635,448],[635,470],[601,470]],
  [[714,448],[748,448],[748,470],[714,470]],
  [[826,450],[860,450],[860,472],[826,472]],
  [[1652,487],[1698,490],[1698,520],[1652,517]],
  [[1136,424],[1156,424],[1153,437],[1133,437]],
  [[1329,426],[1349,426],[1346,439],[1326,439]]
];
// Small fabric-only patches from the edited panorama. All surrounding scenery
// continues to use the high-resolution, unmodified camera photograph.
const fabrics = [
  [[0,483],[238,443],[240,478],[0,525]],
  [[562,440],[782,441],[782,474],[562,475]],
  [[800,446],[1035,452],[1035,483],[800,477]],
  [[1560,478],[1774,484],[1774,529],[1560,520]],
  [[1167,392],[1152,392],[1140,399],[1134,409],[1130,424],[1127,482],[1126,507],[1120,509],[1118,512],[1123,514],[1131,514],[1136,512],[1133,508],[1128,507],[1129,483],[1146,476]],
  [[1361,391],[1348,389],[1335,395],[1325,407],[1321,421],[1316,503],[1314,531],[1307,533],[1304,538],[1314,540],[1322,538],[1325,534],[1316,531],[1318,504],[1339,491]]
];

export function sphericalPoint(x, y) {
  const longitude = (x / REFERENCE_WIDTH - .5) * 2 * Math.PI;
  const latitude = (.5 - y / REFERENCE_HEIGHT) * Math.PI;
  return [Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude), Math.cos(latitude) * Math.cos(longitude)];
}
export function projectPoint(point, view) {
  const yaw = view.yaw * Math.PI / 180;
  const pitch = view.pitch * Math.PI / 180;
  const [x,y,z] = point;
  const side = x * Math.cos(yaw) - z * Math.sin(yaw);
  const up = -x * Math.sin(yaw) * Math.sin(pitch) + y * Math.cos(pitch) - z * Math.cos(yaw) * Math.sin(pitch);
  const depth = x * Math.sin(yaw) * Math.cos(pitch) + y * Math.sin(pitch) + z * Math.cos(yaw) * Math.cos(pitch);
  if (depth <= .05) return null;
  const focal = view.width / (2 * Math.tan(view.hfov * Math.PI / 360));
  return [view.width / 2 + focal * side / depth, view.height / 2 - focal * up / depth];
}
// Homography maps the exact rectangular PNG onto a physical banner quadrilateral.
export function projectiveMatrix(corners, width = LOGO_WIDTH, height = LOGO_HEIGHT) {
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]] = corners;
  const dx1=x1-x2, dx2=x3-x2, dx3=x0-x1+x2-x3;
  const dy1=y1-y2, dy2=y3-y2, dy3=y0-y1+y2-y3;
  const denominator=dx1*dy2-dx2*dy1;
  if (Math.abs(denominator)<1e-8) return null;
  const g=(dx3*dy2-dx2*dy3)/denominator;
  const h=(dx1*dy3-dx3*dy1)/denominator;
  const a=x1-x0+g*x1, b=x3-x0+h*x3;
  const d=y1-y0+g*y1, e=y3-y0+h*y3;
  return [a/width,d/width,0,g/width,b/height,e/height,0,h/height,0,0,1,0,x0,y0,0,1];
}
export function createBrandingLayer(container, viewer) {
  const layer=document.createElement('div');
  layer.className='tour-branding-layer';
  layer.setAttribute('aria-hidden','true');
  layer.hidden=true;
  const fabricPlanes=fabrics.map(corners=>{
    const x=Math.min(...corners.map(p=>p[0])), y=Math.min(...corners.map(p=>p[1]));
    const width=Math.max(...corners.map(p=>p[0]))-x, height=Math.max(...corners.map(p=>p[1]))-y;
    const patch=document.createElement('div');
    patch.className='tour-branding-fabric';
    patch.style.width=`${width}px`;
    patch.style.height=`${height}px`;
    patch.style.clipPath=`polygon(${corners.map(p=>`${(p[0]-x)/width*100}% ${(p[1]-y)/height*100}%`).join(',')})`;
    const texture=document.createElement('img');
    texture.src='/cresol/assets/tour/ponto-1-cresol-base.webp';
    texture.alt=''; texture.width=REFERENCE_WIDTH; texture.height=REFERENCE_HEIGHT;
    texture.style.left=`${-x}px`; texture.style.top=`${-y}px`;
    patch.append(texture); layer.append(patch);
    return { image:patch,width,height,points:[[x,y],[x+width,y],[x+width,y+height],[x,y+height]].map(([u,v])=>sphericalPoint(u,v)) };
  });
  const logoPlanes=placements.map(corners=>{
    const image=document.createElement('img');
    image.src=LOGO_SOURCE;
    image.alt='';
    image.width=LOGO_WIDTH;
    image.height=LOGO_HEIGHT;
    image.className='tour-branding-logo';
    layer.append(image);
    return {image,width:LOGO_WIDTH,height:LOGO_HEIGHT,points:corners.map(([x,y])=>sphericalPoint(x,y))};
  });
  const planes=[...fabricPlanes,...logoPlanes];
  container.append(layer);
  let active=false, frame=0, previous='';
  function draw() {
    if (!active) return;
    const view={yaw:viewer.getYaw(),pitch:viewer.getPitch(),hfov:viewer.getHfov(),width:container.clientWidth,height:container.clientHeight};
    const signature=Object.values(view).join(',');
    if (signature!==previous) {
      previous=signature;
      planes.forEach(({image,points,width,height})=>{
        const corners=points.map(point=>projectPoint(point,view));
        const matrix=corners.every(Boolean) ? projectiveMatrix(corners,width,height) : null;
        image.hidden=!matrix;
        if (matrix) image.style.transform=`matrix3d(${matrix.join(',')})`;
      });
    }
    frame=requestAnimationFrame(draw);
  }
  return {
    show() { if (active) return; active=true; previous=''; layer.hidden=false; draw(); },
    hide() { active=false; cancelAnimationFrame(frame); layer.hidden=true; },
    destroy() { active=false; cancelAnimationFrame(frame); layer.remove(); }
  };
}
