import {indexAtlasFrames} from './sprite-frames.js';
let sheet=null;
export const hauntedTreesReady=(async()=>{
 if(typeof Image==='undefined')return;
 try{const image=new Image();image.src='/game2/assets/haunted-trees-v1.png';await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const c=canvas.getContext('2d');c.drawImage(image,0,0);sheet={image,frames:indexAtlasFrames(c.getImageData(0,0,canvas.width,canvas.height),2,1)};}catch{/* Existing trees remain visible if optional art fails. */}
})();
export function drawHauntedTree(c,o){
 if(!sheet||o.kind!=='tree')return false;
 const seed=Math.abs(Math.round(o.x*13+o.y*7));
 if(!['entry-shade','bar-shade','pickle-west-shade','court-plaza-shade'].includes(o.id)&&seed%9!==0)return false;
 const f=sheet.frames[seed%2],h=124*(o.scale||1),w=h*f.w/f.h;
 c.drawImage(sheet.image,f.x,f.y,f.w,f.h,o.x-w/2,o.y-h+5,w,h);return true;
}
