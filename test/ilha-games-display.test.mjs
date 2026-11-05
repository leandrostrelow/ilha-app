import test from 'node:test';
import assert from 'node:assert/strict';
import {fitGameView,createGameFullscreen,isGameApp,gameDisplayHelp} from '../games/game-display.js';
import {readFileSync} from 'node:fs';
import {heroFrame} from '../games/sprite-frames.js';

test('tennis and pickleball fit portrait/landscape without stretching touch coordinates',()=>{
 for(const [w,h] of [[320,310],[390,600],[500,280],[900,750],[0,0]])for(const ratio of [.8,1.36]){
  const size=fitGameView(w,h,ratio);
  assert.ok(size.width<=w&&size.height<=h);assert.ok(Math.abs(size.width-size.height*ratio)<1.5);
 }
});
test('front avatars remain on the original atlas; sides and backs alternate four frames',()=>{
 for(const id of ['player-m','player-f']){
  assert.equal(heroFrame(id,'down').atlas,'players');
  for(const dir of ['up','right','left']){
   const idle=heroFrame(id,dir),frames=[.1,.6,1.1,1.6].map(s=>heroFrame(id,dir,s));
   assert.equal(idle.atlas,'walk');assert.equal(idle.index%4,0);
   assert.equal(new Set(frames.map(f=>f.index)).size,4);
   assert.ok(frames.every(f=>f.reference===idle.index));
   assert.equal(idle.flip,dir==='left');
  }
 }
});
test('all twelve ranked NPCs face away at the bottom and keep their identity',()=>{
 const ids=['gael','lourenco','gabriel','emerson','davi','evandro','romulo','andre','renato','beto','felipe','leandro'];
 ids.forEach((id,index)=>{
  assert.deepEqual(heroFrame(id,'up'),{atlas:'backs',index,flip:false});
  assert.equal(heroFrame(id,'down').atlas,'npcs');
 });
 assert.equal(heroFrame('alexandre','up').index,2);
});
function fakeDocument({request,enabled=true,external=false}={}){
 const listeners={};
 const doc={documentElement:{},fullscreenEnabled:enabled,fullscreenElement:external?{}:null,
  addEventListener:(name,fn)=>listeners[name]=fn,
  async exitFullscreen(){doc.exits=(doc.exits||0)+1;doc.fullscreenElement=null;listeners.fullscreenchange?.();},
 };
 if(request!==false)doc.documentElement.requestFullscreen=async options=>{
  doc.requests=(doc.requests||0)+1;doc.options=options;if(request)await request();
  doc.fullscreenElement=doc.documentElement;listeners.fullscreenchange?.();
 };
 return doc;
}
test('play requests native fullscreen and close exits only its own session',async()=>{
 const doc=fakeDocument(),changes=[],screen=createGameFullscreen(doc,state=>changes.push(state));
 assert.equal(await screen.enter(),true);assert.equal(doc.requests,1);assert.equal(doc.options.navigationUI,'hide');
 assert.equal(changes.at(-1).fullscreen,true);await screen.close();assert.equal(doc.exits,1);
});
test('unsupported/denied fullscreen is a handled fallback, never a broken launch',async()=>{
 for(const doc of [fakeDocument({request:false}),fakeDocument({enabled:false}),fakeDocument({request:()=>Promise.reject(new Error('denied'))})]){
  const screen=createGameFullscreen(doc);assert.equal(await screen.enter(),false);await screen.close();assert.equal(doc.exits,undefined);
 }
});
test('closing while fullscreen is pending releases the eventual fullscreen',async()=>{
 let resolve;const doc=fakeDocument({request:()=>new Promise(r=>resolve=r)}),screen=createGameFullscreen(doc);
 const pending=screen.enter();await screen.close();resolve();await pending;
 assert.equal(doc.fullscreenElement,null);assert.equal(doc.exits,1);
});
test('double taps request once and existing external fullscreen is preserved',async()=>{
 let resolve;const doc=fakeDocument({request:()=>new Promise(r=>resolve=r)}),screen=createGameFullscreen(doc);
 const pending=screen.enter();await screen.enter();assert.equal(doc.requests,1);resolve();await pending;await screen.close();
 const external=fakeDocument({external:true}),other=createGameFullscreen(external);await other.enter();await other.close();assert.equal(external.exits,undefined);
});
test('fullscreen toggle can leave and re-enter without reopening the game',async()=>{
 const doc=fakeDocument(),screen=createGameFullscreen(doc);await screen.enter();await screen.toggle();assert.equal(doc.fullscreenElement,null);
 await screen.toggle();assert.equal(doc.fullscreenElement,doc.documentElement);await screen.close();
});
test('installed display modes work on Apple and standard standalone browsers',()=>{
 assert.equal(isGameApp({navigator:{standalone:true}}),true);
 for(const mode of ['standalone','fullscreen'])assert.equal(isGameApp({matchMedia:query=>({matches:query===`(display-mode: ${mode})`})}),true);
 assert.equal(isGameApp({navigator:{},matchMedia:()=>({matches:false})}),false);
 assert.equal(isGameApp({document:{fullscreenElement:{}},matchMedia:query=>({matches:query==='(display-mode: fullscreen)'})}),false);
});
test('Apple fallback provides actionable home-screen steps, not a fake fullscreen success',()=>{
 for(const navigator of [{userAgent:'iPhone'},{platform:'MacIntel',maxTouchPoints:5}]){
  const help=gameDisplayHelp({navigator});assert.match(help.steps.join(' '),/Safari.*Compartilhar.*Tela de Início.*Abrir como App/);
 }
 const help=gameDisplayHelp({navigator:{userAgent:'Android'}});assert.match(help.text,/instalação dependem/);assert.ok(help.steps.length);
 const installed=gameDisplayHelp({navigator:{standalone:true}});assert.equal(installed.steps.length,0);assert.match(installed.title,/já está/);
});
test('fullscreen toggle reports rejection and success for the visible fallback button',async()=>{
 const denied=createGameFullscreen(fakeDocument({request:()=>Promise.reject(new Error('no gesture'))}));
 assert.equal(await denied.toggle(),false);
 const success=createGameFullscreen(fakeDocument());assert.equal(await success.toggle(),true);assert.equal(await success.toggle(),false);
});
test('game installation launches the game, separate from the main club app',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../games/manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.id,'/games');assert.equal(manifest.scope,'/games');assert.match(manifest.start_url,/^\/games\?/);assert.equal(manifest.display,'fullscreen');
 // Production removes trailing slashes; the canonical launch must remain in scope.
 assert.ok(new URL(manifest.start_url,'https://app.ilhatenis.com').pathname.startsWith(manifest.scope));
 const html=readFileSync(new URL('../games/index.html',import.meta.url),'utf8');
 assert.match(html,/apple-mobile-web-app-capable/);assert.match(html,/\/games\/manifest.json/);assert.match(html,/id="displayHelp"/);assert.match(html,/id="fullscreenButton"[^>]*><svg/);
 assert.equal((html.match(/data-club-preview="cover"/g)||[]).length,3);
});
