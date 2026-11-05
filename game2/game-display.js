// Keep the canvas's CSS rectangle identical to its drawn image for touch aiming.
export function fitGameView(width,height,ratio){
 const w=Math.max(0,Math.min(width,height*ratio));
 return {width:Math.floor(w),height:Math.floor(w/ratio)};
}
export function observeGameView(stage,view,ratio){
 const observer=new ResizeObserver(([entry])=>{
  const size=fitGameView(entry.contentRect.width,entry.contentRect.height,ratio);
  view.style.width=`${size.width}px`;view.style.height=`${size.height}px`;
 });
 observer.observe(stage);return ()=>observer.disconnect();
}

// A dialog cannot request fullscreen. The document can, with a viewport fallback.
export function createGameFullscreen(doc,onChange=()=>{}){
 const root=doc.documentElement,request=root.requestFullscreen||root.webkitRequestFullscreen;
 let active=false,owned=false,pending=false;
 const current=()=>doc.fullscreenElement||doc.webkitFullscreenElement;
 const supported=typeof request==='function'&&doc.fullscreenEnabled!==false&&doc.webkitFullscreenEnabled!==false;
 const notify=()=>onChange({supported,fullscreen:current()===root});
 async function exitOwned(){
  if(!owned||current()!==root)return;
  owned=false;
  try{await (doc.exitFullscreen||doc.webkitExitFullscreen)?.call(doc);}catch{/* Browser may already have exited. */}
  notify();
 }
 async function enter(){
  active=true;
  if(!supported||current()||pending){notify();return current()===root;}
  pending=true;owned=true;
  try{await request.call(root,{navigationUI:'hide'});if(!active)await exitOwned();return current()===root;}
  catch{owned=false;return false;}
  finally{pending=false;notify();}
 }
 function changed(){if(!current()&&!pending)owned=false;notify();}
 doc.addEventListener('fullscreenchange',changed);doc.addEventListener('webkitfullscreenchange',changed);notify();
 return {enter,close(){active=false;return exitOwned();},async toggle(){if(current()===root){owned=true;await exitOwned();return false;}return enter();}};
}

export function isGameApp(win){
 const matches=mode=>Boolean(win.matchMedia?.(`(display-mode: ${mode})`).matches);
 // A native fullscreen request also changes display-mode. It is not an installation.
 const native=win.document?.fullscreenElement||win.document?.webkitFullscreenElement;
 return win.navigator?.standalone===true||matches('standalone')||(!native&&matches('fullscreen'));
}
export function gameDisplayHelp(win,{canPrompt=false,installed=false}={}){
 if(isGameApp(win))return {title:'Você já está no modo app.',text:'Seja pelo Ilha Play ou pelo ícone Ilha Legado, sua aventura já está aberta sem as barras do navegador. Não precisa instalar de novo.',steps:[]};
 if(installed)return {title:'Pronto para a próxima partida.',text:'O navegador confirmou a instalação. Abra o ícone Ilha Legado na Tela de Início ou na lista de aplicativos para entrar direto no jogo.',steps:[]};
 if(canPrompt)return {title:'Leve a Ilha com você.',text:'Um ícone só do jogo, direto na sua Tela de Início ou na lista de aplicativos. Toque em Instalar jogo e confirme na janela do navegador.',steps:[]};
 const nav=win.navigator||{},apple=/iPhone|iPad|iPod/.test(nav.userAgent||'')||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1);
 return apple?{
  title:'Sua aventura, a um toque.',
  text:'No iPhone e no iPad, adicione o jogo à Tela de Início pelo Safari. Ao abrir pelo novo ícone, você joga sem as barras de endereço e abas. Sem passar pela App Store.',
  steps:['Abra esta página no Safari. Se veio pelo WhatsApp, copie o link e cole no Safari.','Toque em Compartilhar e em Adicionar à Tela de Início. Se não encontrar, procure em Editar Ações.','Se aparecer “Abrir como App”, deixe ativado e toque em Adicionar.','Abra o ícone Ilha Legado na Tela de Início. O jogo entra direto no menu, sem a barra de endereço.'],
 }:{
  title:'Sua aventura, a um toque.',
  text:'Salve um ícone do Ilha Legado para voltar direto ao jogo. As opções de instalação dependem do seu navegador.',
  steps:['Abra esta página no Chrome, Edge ou no navegador do aparelho, fora de outros aplicativos.','Abra o menu do navegador e procure Instalar app ou Adicionar à tela inicial. Se houver uma escolha, prefira Instalar.','Confirme o nome Ilha Legado e abra o novo ícone. Um simples atalho pode continuar abrindo as barras do navegador.'],
 };
}
