import * as T from './vendor/three.module.min.js';

export const EQUIPMENT={
 tennis:{name:'Tênis',head:.4,grip:'semiwestern'},
 beach:{name:'Beach tennis',head:.25,grip:'continental'},
 pickle:{name:'Pickleball',head:.205,grip:'continental'}
};
const limit=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(Number(n))?Number(n):0));
export function questSettings(value={}){
 const result={hand:value.hand==='left'?'left':'right',grips:{},adjustments:{}};
 for(const [kind,spec]of Object.entries(EQUIPMENT)){
  result.grips[kind]=kind==='tennis'&&value.grips?.tennis==='continental'?'continental':spec.grip;
  const a=value.adjustments?.[kind]||{};result.adjustments[kind]={pitch:limit(a.pitch,-35,35),roll:limit(a.roll,-45,45),offset:limit(a.offset,-4,4)};
 }
 return result;
}
const axisX=new T.Vector3(1,0,0),axisY=new T.Vector3(0,1,0);
// WebXR grip-space -Z follows the held handle towards the thumb. Model +Y
// points towards the racket head. Align those axes before applying the bevel.
export function racketMount(settings,kind,hand){
 const a=settings.adjustments[kind],sign=hand==='left'?-1:1;
 const align=new T.Quaternion().setFromAxisAngle(axisX,-Math.PI/2);
 const bevel=(settings.grips[kind]==='semiwestern'?Math.PI/2:0)*sign;
 const q=align.multiply(new T.Quaternion().setFromAxisAngle(axisY,bevel+a.roll*Math.PI/180*sign));
 q.premultiply(new T.Quaternion().setFromAxisAngle(axisX,a.pitch*Math.PI/180));
 return {quaternion:q,position:new T.Vector3(0,0,-a.offset/100)};
}
export function trackedController(source,pose,visible=true){
 return Boolean(visible&&source?.targetRayMode==='tracked-pointer'&&source.gripSpace&&!source.hand&&pose&&!pose.emulatedPosition);
}
// Copy individual values: WebXR mutates the same Gamepad object each frame.
// Button indices follow the Meta Touch Plus / Oculus Touch registry profiles.
export function createQuestButtons(){
 const states=new Map();
 return {
  clear(){states.clear();},
  sample(source,time,enabled=true){
   const touch=source?.profiles?.some(p=>/^(meta-quest-touch|oculus-touch)/.test(p));
   if(!enabled||!touch||source.gamepad?.mapping!=='xr-standard'){states.delete(source);return [];}
   const buttons=source.gamepad.buttons,values=[Boolean(buttons[4]?.pressed),Boolean(buttons[5]?.pressed)];
   let previous=states.get(source);if(!previous){states.set(source,{values,heldAt:null,fired:false});return [];}
   const events=[],left=source.handedness==='left';
   if(values[0]&&!previous.values[0])events.push(left?'menu':'action');
   if(left){
    if(values[1]&&!previous.values[1]){previous.heldAt=time;previous.fired=false;}
    if(values[1]&&previous.heldAt!==null&&!previous.fired&&time-previous.heldAt>=.8){events.push('recenter');previous.fired=true;}
    if(!values[1]){previous.heldAt=null;previous.fired=false;}
   }else if(values[1]&&!previous.values[1])events.push('back');
   previous.values=values;return events;
  }
 };
}

// XR ArrayCamera world matrices may be refreshed by Three after input handling.
// Derive the current world pose from the XR frame and locomotion rig instead.
export function worldViewer(pose,rig,camera,head,forward){
 if(pose){rig.updateMatrixWorld(true);const p=pose.transform.position,q=pose.transform.orientation;head.set(p.x,p.y,p.z).applyMatrix4(rig.matrixWorld);forward.set(0,0,-1).applyQuaternion(new T.Quaternion(q.x,q.y,q.z,q.w)).transformDirection(rig.matrixWorld);}
 else{camera.getWorldPosition(head);camera.getWorldDirection(forward);}
 return {head,forward};
}
