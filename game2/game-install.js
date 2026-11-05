import {isGameApp} from './game-display.js';

// Installation is offered only after a gesture; accepting the prompt is not
// treated as an installed app until the browser emits appinstalled.
export function createGameInstall(win,onChange=()=>{}){
 let deferred=null,pending=false,installed=false,outcome='';
 const state=()=>({appMode:isGameApp(win),installed,pending,outcome,canPrompt:Boolean(deferred)&&!pending&&!installed&&!isGameApp(win)});
 const notify=()=>onChange(state());
 function available(event){
  event.preventDefault();
  if(installed||isGameApp(win))return;
  deferred=event;outcome='';notify();
 }
 function completed(){installed=true;deferred=null;outcome='installed';notify();}
 win.addEventListener('beforeinstallprompt',available);
 win.addEventListener('appinstalled',completed);
 const modes=['standalone','fullscreen'].map(mode=>win.matchMedia?.(`(display-mode: ${mode})`));
 modes.forEach(mode=>mode?.addEventListener?.('change',notify));
 win.document?.addEventListener?.('fullscreenchange',notify);
 win.document?.addEventListener?.('webkitfullscreenchange',notify);
 notify();
 return {
  state,
  async prompt(){
   if(!state().canPrompt)return 'unavailable';
   const event=deferred;deferred=null;pending=true;outcome='';notify();
   try{
    // Keep this call before the first await to preserve user activation.
    const request=event.prompt();
    const result=await request;
    const choice=await (event.userChoice||result);
    if(!installed)outcome=choice?.outcome==='accepted'?'accepted':'dismissed';
   }catch{if(!installed)outcome='error';}
   finally{pending=false;notify();}
   return outcome;
  },
  destroy(){
   win.removeEventListener('beforeinstallprompt',available);
   win.removeEventListener('appinstalled',completed);
   modes.forEach(mode=>mode?.removeEventListener?.('change',notify));
   win.document?.removeEventListener?.('fullscreenchange',notify);
   win.document?.removeEventListener?.('webkitfullscreenchange',notify);
  },
 };
}
