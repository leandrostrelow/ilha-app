import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGameInstall} from '../games/game-install.js';
import {gameDisplayHelp} from '../games/game-display.js';

function browser(appMode=false){
 const win=new EventTarget();win.navigator={standalone:appMode};win.document=new EventTarget();
 win.matchMedia=()=>Object.assign(new EventTarget(),{matches:false});return win;
}
function available(win,prompt=async()=>({outcome:'accepted'})){
 const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=prompt;win.dispatchEvent(event);return event;
}
test('native install is gesture-only, single-use and waits for appinstalled',async()=>{
 const win=browser(),states=[],install=createGameInstall(win,state=>states.push(state));let calls=0;
 const event=available(win,async()=>{calls++;return {outcome:'accepted'};});
 assert.equal(event.defaultPrevented,true);assert.equal(calls,0);assert.equal(install.state().canPrompt,true);
 assert.equal(await install.prompt(),'accepted');assert.equal(calls,1);assert.equal(install.state().installed,false);
 assert.equal(await install.prompt(),'unavailable');assert.equal(calls,1);
 win.dispatchEvent(new Event('appinstalled'));assert.equal(install.state().installed,true);assert.equal(install.state().canPrompt,false);
 assert.equal(states.at(-1).outcome,'installed');install.destroy();
});
test('double taps never prompt twice and appinstalled during prompt wins',async()=>{
 const win=browser(),install=createGameInstall(win);let finish,calls=0;
 available(win,()=>{calls++;return new Promise(resolve=>finish=resolve);});
 const first=install.prompt();assert.equal(install.state().pending,true);assert.equal(await install.prompt(),'unavailable');
 win.dispatchEvent(new Event('appinstalled'));finish({outcome:'accepted'});
 assert.equal(await first,'installed');assert.equal(calls,1);assert.equal(install.state().pending,false);
});
test('dismissal and prompt rejection do not claim installation; a new prompt can retry',async()=>{
 for(const fail of [false,true]){
  const win=browser(),install=createGameInstall(win);
  available(win,()=>{if(fail)throw new Error('blocked');return Promise.resolve({outcome:'dismissed'});});
  assert.equal(await install.prompt(),fail?'error':'dismissed');assert.equal(install.state().installed,false);
  assert.equal(install.state().pending,false);assert.equal(install.state().canPrompt,false);
  available(win);assert.equal(install.state().canPrompt,true);
 }
});
test('separate userChoice is honored even if prompt resolves without a result',async()=>{
 const win=browser(),install=createGameInstall(win),event=available(win,async()=>{});
 event.userChoice=Promise.resolve({outcome:'accepted'});assert.equal(await install.prompt(),'accepted');
});
test('existing Ilha Play or game app never offers a duplicate installation',async()=>{
 const win=browser(true),install=createGameInstall(win);let calls=0;
 available(win,()=>calls++);assert.equal(install.state().appMode,true);assert.equal(await install.prompt(),'unavailable');assert.equal(calls,0);
 const help=gameDisplayHelp(win);assert.equal(help.steps.length,0);assert.match(help.text,/Ilha Play.*Não precisa instalar de novo/);
 install.destroy();win.navigator.standalone=false;available(win);assert.equal(install.state().canPrompt,false);
});
test('manual and direct install instructions are distinct and do not promise success',()=>{
 const win=browser(),manual=gameDisplayHelp(win),direct=gameDisplayHelp(win,{canPrompt:true});
 assert.ok(manual.steps.length);assert.equal(direct.steps.length,0);assert.match(direct.text,/confirme/);
 const installed=gameDisplayHelp(win,{installed:true});assert.match(installed.text,/confirmou a instalação/);assert.equal(installed.steps.length,0);
});
test('manifest and Apple metadata use game icons with real declared PNG dimensions',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../games/manifest.json',import.meta.url)));
 assert.equal(manifest.icons.length,3);assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'));
 for(const icon of manifest.icons){
  assert.ok(icon.src.startsWith('/games/assets/ilha-legado-icon-'));
  const file=readFileSync(new URL(`..${icon.src}`,import.meta.url));
  assert.equal(file.toString('ascii',1,4),'PNG');assert.equal(`${file.readUInt32BE(16)}x${file.readUInt32BE(20)}`,icon.sizes);
 }
 const html=readFileSync(new URL('../games/index.html',import.meta.url),'utf8');
 assert.match(html,/apple-touch-icon" sizes="180x180" href="\/games\/assets\/ilha-legado-icon-180-v2.png/);
 for(const id of ['installGame','copyGameLink','installStatus','installIlhaPlay'])assert.ok(html.includes(`id="${id}"`));
 const root=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url)));
 assert.equal(root.scope,'/');assert.equal(root.id,'/');assert.notEqual(root.icons[0].src,manifest.icons[0].src);
});
