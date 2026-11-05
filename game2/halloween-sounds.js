import {halloweenProps,halloweenBatPosition} from './halloween-art.js';
import {LANDMARK_TREES} from './scenery-data.js';
// One short cue per slot, only from a nearby visible decoration. No audio loop.
export function halloweenAmbientCue(time,player,camera){
 const slot=Math.floor(time/7);
 if(time<7)return null;
 const nearby=o=>Math.hypot(o.x-player.x,o.y-player.y)<210&&o.x>=camera.x&&o.x<=camera.x+camera.w&&o.y>=camera.y&&o.y<=camera.y+camera.h;
 const kinds=['ghost','bat','tree-creak'];
 for(let offset=0;offset<3;offset++){
  const kind=kinds[(slot+offset)%3];
  const sources=kind==='ghost'?halloweenProps(camera).filter(o=>o.propType==='ghost'):
   kind==='bat'?Array.from({length:6},(_,i)=>halloweenBatPosition(time,i)):LANDMARK_TREES;
  if(sources.some(nearby))return {kind,key:slot};
 }
 return null;
}
