// One versioned atlas, decoded once. Crops preserve alpha and proportions.
// Gameplay never waits indefinitely for decorative art: native props are the fallback.
export const HALLOWEEN_ATLAS_URL='/game2/assets/halloween-props-v1.webp';
export const HALLOWEEN_SPRITES=Object.freeze({
 pumpkin:{cell:0,w:34,h:38},gourd:{cell:1,w:33,h:36},
 candle:{cell:2,w:29,h:41},lantern:{cell:3,w:27,h:44},
 grave:{cell:4,w:35,h:46},ghost:{cell:5,w:30,h:43},
 'bat-up':{cell:6,w:33,h:22},'bat-down':{cell:7,w:33,h:22},
});
export function atlasCell(width,height,index){
 const col=index%4,row=Math.floor(index/4),x=Math.round(col*width/4),y=Math.round(row*height/2);
 return {x,y,w:Math.round((col+1)*width/4)-x,h:Math.round((row+1)*height/2)-y};
}
export function alphaBounds(data,width,height){
 let x0=width,y0=height,x1=-1,y1=-1;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>16){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
 return x1<x0||y1<y0?null:{x:x0,y:y0,w:x1-x0+1,h:y1-y0+1};
}
export function fitDecoration(source,box){
 if(!source||source.w<=0||source.h<=0)return null;
 const ratio=Math.min(box.w/source.w,box.h/source.h);
 return {w:source.w*ratio,h:source.h*ratio};
}
const sprites=new Map();
async function loadAtlas(){
 if(typeof Image==='undefined'||typeof document==='undefined')return false;
 let timer;
 try{
  const image=new Image();image.decoding='async';image.src=HALLOWEEN_ATLAS_URL;
  await Promise.race([image.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Decorative atlas timeout')),6000);})]);
  const atlas=document.createElement('canvas');atlas.width=image.naturalWidth;atlas.height=image.naturalHeight;
  const c=atlas.getContext('2d',{willReadFrequently:true});c.drawImage(image,0,0);
  const decoded=[];
  for(const [id,def]of Object.entries(HALLOWEEN_SPRITES)){
   const cell=atlasCell(atlas.width,atlas.height,def.cell),pixels=c.getImageData(cell.x,cell.y,cell.w,cell.h),trim=alphaBounds(pixels.data,cell.w,cell.h);
   // Opaque backgrounds or clipped sprites must not become rectangles on the map.
   if(!trim||trim.x<2||trim.y<2||trim.x+trim.w>cell.w-2||trim.y+trim.h>cell.h-2)throw new Error('Invalid transparent atlas cell');
   const fit=fitDecoration(trim,def),cached=document.createElement('canvas');
   cached.width=Math.ceil(fit.w*2);cached.height=Math.ceil(fit.h*2);
   const out=cached.getContext('2d');out.imageSmoothingEnabled=true;out.imageSmoothingQuality='high';
   out.drawImage(image,cell.x+trim.x,cell.y+trim.y,trim.w,trim.h,0,0,cached.width,cached.height);
   decoded.push([id,{image:cached,w:cached.width/2,h:cached.height/2}]);
  }
  for(const [id,sprite]of decoded)sprites.set(id,sprite);
  return true;
 }catch{return false;}finally{clearTimeout(timer);}
}
export const halloweenSpritesReady=loadAtlas();
export function drawHalloweenSprite(c,id,x,y,scale=1,{flip=false,alpha=1}={}){
 const sprite=sprites.get(id);if(!sprite)return false;
 const w=sprite.w*scale,h=sprite.h*scale;
 c.save();c.imageSmoothingEnabled=false;c.globalAlpha*=alpha;c.translate(Math.round(x),Math.round(y));if(flip)c.scale(-1,1);
 c.drawImage(sprite.image,-Math.round(w/2),-Math.round(h),w,h);c.restore();return true;
}
