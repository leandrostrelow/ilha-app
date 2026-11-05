// A separate pointer per pad/button permits moving and swinging simultaneously.
export function createMatchInput(pad,buttons,canvas,isActive){
 const keys=new Set();let pointer=null,vector={x:0,y:0},shot=null,serve=false;
 const knob=pad.querySelector('.match-stick');
 function reset(){keys.clear();pointer=null;vector={x:0,y:0};shot=null;serve=false;for(const [button] of buttons)button.classList.remove('is-pressing');if(knob)knob.style.transform='';}
 function aim(e){const r=pad.getBoundingClientRect(),x=(e.clientX-r.left-r.width/2)/(r.width*.34),y=(e.clientY-r.top-r.height/2)/(r.height*.34),n=Math.max(1,Math.hypot(x,y));vector={x:Math.abs(x)>.13?x/n:0,y:Math.abs(y)>.13?y/n:0};if(knob)knob.style.transform=`translate(${vector.x*22}px,${vector.y*22}px)`;}
 pad.addEventListener('pointerdown',e=>{if(!isActive())return;e.preventDefault();pointer=e.pointerId;pad.setPointerCapture(pointer);aim(e);canvas.focus({preventScroll:true});});
 pad.addEventListener('pointermove',e=>{if(e.pointerId===pointer)aim(e);});
 for(const name of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(name,e=>{if(e.pointerId===pointer){pointer=null;vector={x:0,y:0};if(knob)knob.style.transform='';}});
 const fire=value=>{if(!isActive())return;if(value==='serve')serve=true;else shot=value;canvas.focus({preventScroll:true});};
 for(const [button,value] of buttons){
  button.addEventListener('pointerdown',e=>{if(!isActive()||button.disabled)return;e.preventDefault();button.setPointerCapture(e.pointerId);button.classList.add('is-pressing');fire(value);});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>button.classList.remove('is-pressing'));
  button.addEventListener('click',e=>{if(e.detail===0&&!button.disabled)fire(value);});
 }
 document.addEventListener('keydown',e=>{if(!isActive()||e.target!==canvas)return;
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();keys.add(e.key);}
  const action={y:'normal',a:'slice',x:'drop',b:'serve',Enter:'serve'}[e.key.length===1?e.key.toLowerCase():e.key];
  if(action&&!e.repeat){e.preventDefault();fire(action);}
 });
 document.addEventListener('keyup',e=>keys.delete(e.key));
 window.addEventListener('blur',reset);document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});
 return {reset,read(){const input={moveX:vector.x+(keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0),moveY:vector.y+(keys.has('ArrowDown')?1:0)-(keys.has('ArrowUp')?1:0),shot,serve};shot=null;serve=false;return input;}};
}
