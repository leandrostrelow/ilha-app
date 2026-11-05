// Versioned, transparent prop. Only this building is raster art; the world,
// courtyard, walkable deck, courts and all collision footprints remain native.
export const BAR_SPRITE_URL='/games/assets/ilha-bar-premium-v1.webp';
let sprite=null;
// Fit uniformly inside the existing footprint. Keep the front step on the same
// ground line so the terrace, NPCs and collision geometry do not move.
export function barSpriteBounds({x,y,w,h},{w:sourceWidth,h:sourceHeight}){
 if(sourceWidth<=0||sourceHeight<=0||w<=0||h<=0)return null;
 const scale=Math.min((w+16)/sourceWidth,h/sourceHeight);
 const width=sourceWidth*scale,height=sourceHeight*scale;
 return {x:x+(w-width)/2,y:y+h-height,w:width,h:height};
}
async function loadBar(){
 if(typeof Image==='undefined')return false;
 try{
  const image=new Image();image.decoding='async';image.src=BAR_SPRITE_URL;await image.decode();
  const source=document.createElement('canvas');source.width=image.naturalWidth;source.height=image.naturalHeight;
  const c=source.getContext('2d',{willReadFrequently:true});c.drawImage(image,0,0);
  const {data,width,height}=c.getImageData(0,0,source.width,source.height);
  let x0=width,y0=height,x1=0,y1=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>100){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  if(x1<=x0||y1<=y0)return false;
  // Keep the original cropped dimensions: the former 280×148 cache stretched
  // the art once here and a second time when fitted to the world rectangle.
  sprite={image,x:x0,y:y0,w:x1-x0+1,h:y1-y0+1};
  return true;
 }catch{return false;}
}
export const buildingsReady=loadBar();
export function drawBar(ctx,building){
 if(!sprite)return false;
 const box=barSpriteBounds(building,sprite);if(!box)return false;
 ctx.drawImage(sprite.image,sprite.x,sprite.y,sprite.w,sprite.h,box.x,box.y,box.w,box.h);
 return true;
}
