const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Rotate screen axes for both pickleball and the old horizontal tennis court.
export function gestureShot(start,end,rect,sport='tennis',shot=null,serving=false){
 const dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy);
 const horizontal=sport==='pickleball'||sport==='horizontal',lateral=horizontal?dy:dx;
 const tap=length<12;
 const forward=horizontal?dx:-dy;
 const type=serving?'serve':shot||(tap?'drop':Math.abs(lateral)>Math.abs(forward)*1.15?'slice':'normal');
 return {shot:type,validServe:serving&&forward>=18,aim:tap?clamp((horizontal?(end.y-rect.top)/rect.height:(end.x-rect.left)/rect.width)*2-1,-.65,.65):clamp(lateral/Math.max(115,length*1.08),-1,1),power:tap?.35:clamp(length/Math.max(100,Math.min(rect.width,rect.height)*.5),.15,1)};
}
export function createAssistedInput(canvas,buttons,getState,isActive){
 let pointer=null,start=null,end=null,pending=null;
 function reset(){pointer=null;start=end=pending=null;for(const [b] of buttons)b.classList.remove('is-pressing');}
 function choose(value){if(!isActive())return;const s=getState();if(value==='serve'){pending={serve:true};return;}pending=s.awaitingServe?{serve:true}:{stroke:{shot:value,aim:s.cpu.x<.5?.75:-.75,power:.55}};canvas.focus({preventScroll:true});}
 canvas.addEventListener('pointerdown',e=>{if(!isActive()||pointer!==null)return;e.preventDefault();pointer=e.pointerId;start=end={x:e.clientX,y:e.clientY};canvas.setPointerCapture(pointer);canvas.focus({preventScroll:true});});
 canvas.addEventListener('pointermove',e=>{if(e.pointerId===pointer)end={x:e.clientX,y:e.clientY};});
 canvas.addEventListener('pointerup',e=>{if(e.pointerId!==pointer)return;if(isActive()){end={x:e.clientX,y:e.clientY};const s=getState(),g=gestureShot(start,end,canvas.getBoundingClientRect(),s.horizontal?'horizontal':s.sport,null,s.awaitingServe);pending=s.awaitingServe?(g.validServe?{serve:true,serveGesture:g}:{invalidServe:true}):{stroke:g};}pointer=null;start=end=null;});
 for(const name of ['pointercancel','lostpointercapture'])canvas.addEventListener(name,e=>{if(e.pointerId===pointer){pointer=null;start=end=null;}});
 for(const [button,value] of buttons){button.addEventListener('pointerdown',e=>{if(!isActive()||button.disabled)return;e.preventDefault();button.setPointerCapture(e.pointerId);button.classList.add('is-pressing');choose(value);});for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>button.classList.remove('is-pressing'));button.addEventListener('click',e=>{if(e.detail===0&&!button.disabled)choose(value);});}
 document.addEventListener('keydown',e=>{if(!isActive()||e.target!==canvas||e.repeat)return;const action={y:'normal',a:'slice',x:'drop',b:'serve',Enter:'serve'}[e.key.length===1?e.key.toLowerCase():e.key];if(action){e.preventDefault();choose(action);}});
 window.addEventListener('blur',reset);document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});
 return {reset,read(){const input=pending||{};pending=null;if(pointer!==null)input.aiming=true;return input;},preview(){if(!start||!end)return null;const r=canvas.getBoundingClientRect(),s=getState();return {...gestureShot(start,end,r,s.horizontal?'horizontal':s.sport,null,s.awaitingServe),x:(start.x-r.left)/r.width,y:(start.y-r.top)/r.height,dx:(end.x-start.x)/r.width,dy:(end.y-start.y)/r.height};}};
}
