import {COURTS,COURT_OVERVIEW,courtPoint} from './club-scene.js';
import {PICKLEBALL,PICKLEBALL_CAMERA,WORLD_SIZE} from './scenery-data.js';
export const COURT_VIEW=Object.freeze({width:480,height:600});
// Local arrow movement stays anchored to the athlete, not a cursor that races
// ahead and keeps pulling them after release. Touch still uses viewToCourtX.
export function keyboardTarget(playerX,direction=0){return Math.max(0,Math.min(255,(playerX-94)/292*255+direction*5));}
export function courtCamera(court=1,overview=false){return {...(overview?COURT_OVERVIEW:(COURTS[court-1]||COURTS[0]).focus)};}
export function pickleballCamera(width,height){
 const ratio=Math.max(1,width)/Math.max(1,height);
 const w=Math.max(PICKLEBALL_CAMERA.w,PICKLEBALL_CAMERA.h*ratio),h=w/ratio;
 return {w,h,x:Math.max(0,Math.min(WORLD_SIZE-w,PICKLEBALL.x+PICKLEBALL.w/2-w/2)),y:Math.max(0,Math.min(WORLD_SIZE-h,PICKLEBALL.y+PICKLEBALL.h/2-h/2))};
}
export function projectCourt(x,y,court=1,camera=courtCamera(court)){const p=courtPoint(x,y,court);return {x:(p.x-camera.x)*COURT_VIEW.width/camera.w,y:(p.y-camera.y)*COURT_VIEW.height/camera.h};}
export function viewToCourtX(viewX,court=1,overview=false){const camera=courtCamera(court,overview),c=COURTS[court-1]||COURTS[0];return 100+(camera.x+viewX/COURT_VIEW.width*camera.w-c.x)*280/c.width;}
export function blendCamera(from,to,t){const eased=t*t*(3-2*t);return Object.fromEntries(['x','y','w','h'].map(key=>[key,from[key]+(to[key]-from[key])*eased]));}
