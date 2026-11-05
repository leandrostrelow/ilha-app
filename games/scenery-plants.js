// Individual transparent props, never a flattened map. Terrain and depth stay native.
export const FOLIAGE_ATLAS_URL='/games/assets/tropical-foliage-premium-v1.webp';
export const PLANT_HEIGHTS=[122,130,118,108,148,146,90,42];
const sprites=[];

// Find the empty gutters instead of assuming the artist placed every leaf on a grid.
export function indexPlantFrames({data,width,height}){
 const opaque=(x,y)=>data[(y*width+x)*4+3]>100;
 const gutter=(center,span,density)=>{
  let best=Math.round(center),score=Infinity;
  for(let n=Math.max(1,Math.floor(center-span));n<Math.min(density.length-1,center+span);n++){
   const value=density[n]*1000+Math.abs(n-center);
   if(value<score){best=n;score=value;}
  }
  return best;
 };
 const yd=new Uint32Array(height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(opaque(x,y))yd[y]++;
 const rows=[0,gutter(height/2,height*.06,yd),height],frames=[];
 for(let row=0;row<2;row++){
  const xd=new Uint32Array(width);
  for(let y=rows[row];y<rows[row+1];y++)for(let x=0;x<width;x++)if(opaque(x,y))xd[x]++;
  const cuts=[0,...[1,2,3].map(i=>gutter(width*i/4,width*.07,xd)),width];
  for(let col=0;col<4;col++){
   let x0=cuts[col+1],x1=-1,y0=rows[row+1],y1=-1;
   for(let y=rows[row];y<rows[row+1];y++)for(let x=cuts[col];x<cuts[col+1];x++)if(opaque(x,y)){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
   if(x1<0||y1<0){frames.push(null);continue;}
   let sum=0,count=0;
   for(let y=Math.ceil(y1-(y1-y0)*.055);y<=y1;y++)for(let x=x0;x<=x1;x++)if(opaque(x,y)){sum+=x;count++;}
   frames.push({x:x0,y:y0,w:x1-x0+1,h:y1-y0+1,anchor:count?sum/count-x0:(x1-x0)/2});
  }
 }
 return frames;
}

async function loadPlants(){
 if(typeof Image==='undefined')return false;
 const atlas=new Image();atlas.decoding='async';atlas.src=FOLIAGE_ATLAS_URL;
 try{
  await atlas.decode();
  const source=document.createElement('canvas');source.width=atlas.naturalWidth;source.height=atlas.naturalHeight;
  const ctx=source.getContext('2d',{willReadFrequently:true});ctx.drawImage(atlas,0,0);
  const frames=indexPlantFrames(ctx.getImageData(0,0,source.width,source.height));
  if(frames.some(frame=>!frame))return false;
  frames.forEach((frame,index)=>{
   const canvas=document.createElement('canvas');canvas.height=PLANT_HEIGHTS[index];canvas.width=Math.ceil(canvas.height*frame.w/frame.h);
   const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;c.drawImage(atlas,frame.x,frame.y,frame.w,frame.h,0,0,canvas.width,canvas.height);
   sprites[index]={canvas,anchor:frame.anchor*canvas.width/frame.w};
  });
  return true;
 }catch{return false;}// Keep the native fallback available offline or on decode failure.
}
export const plantsReady=loadPlants();
export function plantIndex(object){return object.kind==='palm'?4+(object.variant%2):object.variant%4;}
export function plantBounds(object){
 const index=plantIndex(object),sprite=sprites[index],s=object.scale||1;
 const h=sprite?.canvas.height||PLANT_HEIGHTS[index],w=sprite?.canvas.width||h,anchor=sprite?.anchor||w/2;
 return {x:object.x-anchor*s,y:object.y-h*s,w:w*s,h:h*s};
}
export function drawPlant(ctx,object){
 const sprite=sprites[plantIndex(object)];if(!sprite)return false;
 const {canvas,anchor}=sprite,s=object.scale||1;
 ctx.drawImage(canvas,Math.round(object.x-anchor*s),Math.round(object.y-canvas.height*s),Math.round(canvas.width*s),Math.round(canvas.height*s));
 return true;
}
export function drawUnderstory(ctx,x,y,variant=0,scale=1){
 const sprite=sprites[6+variant%2];if(!sprite)return;
 const {canvas,anchor}=sprite;ctx.drawImage(canvas,Math.round(x-anchor*scale),Math.round(y-canvas.height*scale),Math.round(canvas.width*scale),Math.round(canvas.height*scale));
}
