import * as T from './vendor/three.module.min.js';

export function createQuestMenu({scene,renderer,items,pause,getView}){
 const dialog=document.getElementById('quest-dialog'),list=document.getElementById('quest-options');
 const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=1180;const ctx=canvas.getContext('2d');
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
 const panel=new T.Mesh(new T.PlaneGeometry(1,1.18),new T.MeshBasicMaterial({map:texture,transparent:true,depthTest:false}));panel.renderOrder=30;panel.visible=false;scene.add(panel);
 let open=false,selected=0,axisLatch=false,last='',lastEntries=[];
 function refresh(){
  const entries=items();selected=Math.min(selected,entries.length-1);const key=JSON.stringify([selected,entries.map(e=>e.label)]);if(last===key)return;last=key;lastEntries=entries;
  list.replaceChildren();entries.forEach((entry,index)=>{
   const row=document.createElement('div');row.className='quest-option';const b=document.createElement('button');b.type='button';b.textContent=entry.label;b.onclick=()=>choose(index,1);row.append(b);
   if(entry.adjust){for(const [direction,name]of [[-1,'Diminuir'],[1,'Aumentar']]){const button=document.createElement('button');button.type='button';button.textContent=direction<0?'−':'+';button.setAttribute('aria-label',name+' '+entry.name);button.onclick=()=>choose(index,direction);row.append(button);}}
   list.append(row);
  });
  ctx.clearRect(0,0,1000,1180);ctx.fillStyle='rgba(244,245,231,.98)';ctx.beginPath();ctx.roundRect(0,0,1000,1180,35);ctx.fill();ctx.fillStyle='#264635';ctx.font='700 41px sans-serif';ctx.fillText('SEU QUEST, SUA PEGADA',40,64);ctx.font='24px sans-serif';ctx.fillText('Esquerdo: escolher  •  Direito: ajustar',40,108);ctx.fillText('A ou gatilho: confirmar  •  B ou X: fechar',40,147);
  entries.forEach((entry,index)=>{const y=186+index*61;ctx.fillStyle=index===selected?'#244c3a':'#e3e8d5';ctx.beginPath();ctx.roundRect(28,y,944,53,9);ctx.fill();ctx.fillStyle=index===selected?'#f8f9ed':'#304b37';ctx.font='600 28px sans-serif';ctx.fillText((index===selected?'› ':'  ')+entry.label,45,y+35);});
  ctx.fillStyle='#54704b';ctx.font='22px sans-serif';ctx.fillText('Ajustes salvos neste navegador, separados por esporte.',40,1137);texture.needsUpdate=true;
 }
 function setOpen(value){
  open=value;axisLatch=true;panel.visible=value&&renderer.xr.isPresenting;
  if(value){pause();last='';refresh();if(renderer.xr.isPresenting){
   const {head,forward:viewForward}=getView(),forward=viewForward.clone();forward.y=0;if(forward.lengthSq()<.001)forward.set(0,0,-1);forward.normalize();panel.position.copy(head).addScaledVector(forward,1.45);panel.position.y-=.08;panel.lookAt(head.x,panel.position.y,head.z);
  }else if(!dialog.open)dialog.showModal();}
  else if(dialog.open)dialog.close();
 }
 function choose(index=selected,direction=1){const entry=lastEntries[index];if(!entry)return;selected=index;entry.run(direction);refresh();}
 function stick(left,right){
  if(!open)return;const y=left.y||right.y,x=right.x;
  if(Math.abs(y)<.25&&Math.abs(x)<.25){axisLatch=false;return;}
  if(axisLatch)return;
  if(Math.abs(y)>.6){selected=(selected+(y>0?-1:1)+lastEntries.length)%lastEntries.length;axisLatch=true;refresh();}
  else if(Math.abs(x)>.6&&lastEntries[selected]?.adjust){axisLatch=true;choose(selected,Math.sign(x));}
 }
 dialog.addEventListener('close',()=>{open=false;panel.visible=false;});document.getElementById('close-quest').onclick=()=>setOpen(false);
 return {get open(){return open;},setOpen,toggle(){setOpen(!open);},refresh,choose,stick};
}
