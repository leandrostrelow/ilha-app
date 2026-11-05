// Browser-only local QA fixture. Never included by scripts/build.mjs.
if(typeof location!=='undefined'&&(location.hostname==='localhost'||location.hostname==='127.0.0.1')){
 const scenario=new URL(location.href).searchParams.get('display-test');
 if(scenario==='unsupported'||scenario==='standalone'){
  // Chromium would otherwise emit its real install event under the fake Apple UA.
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();event.stopImmediatePropagation();},{capture:true});
  const matchMedia=window.matchMedia.bind(window);
  window.matchMedia=query=>query==='(display-mode: fullscreen)'?{matches:false,media:query}:matchMedia(query);
  Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:undefined});
  Object.defineProperty(Element.prototype,'webkitRequestFullscreen',{configurable:true,value:undefined});
  Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile Safari/604.1'});
 }
 if(scenario==='standalone')Object.defineProperty(navigator,'standalone',{configurable:true,value:true});
}
