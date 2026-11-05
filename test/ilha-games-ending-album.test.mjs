import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {ALBUM_CAST,ALBUM_PHOTOS,ALBUM_DURATION,albumStart,albumFrame,albumImage,albumCredit,createAlbumLoader} from '../games/ending-album.js';

test('album features all 21 NPCs, the crutches and Vanessa with the boys',()=>{
 assert.equal(ALBUM_CAST.length,21);assert.equal(ALBUM_PHOTOS.length,22);
 assert.deepEqual(new Set(ALBUM_PHOTOS.flatMap(p=>p.cast)),new Set(ALBUM_CAST.map(n=>n.id)));
 assert.equal(ALBUM_PHOTOS.at(-1).id,'group');
 assert.match(ALBUM_PHOTOS.find(p=>p.id==='higor').text,/muletas/);
 assert.match(ALBUM_PHOTOS.find(p=>p.id==='vanessa').text,/tia/);
});
test('timeline, avatar and custom nickname are preserved',()=>{
 assert.ok(ALBUM_DURATION>=180&&ALBUM_DURATION<=240);
 for(const [i,p]of ALBUM_PHOTOS.entries()){
  assert.equal(albumFrame(albumStart(i)).id,p.id);
  assert.equal(albumFrame(albumStart(i)+p.duration-.001).index,i);
  assert.equal(albumFrame(albumStart(i)+1).opacity,1);
 }
 assert.equal(albumFrame(ALBUM_DURATION),null);
 assert.match(albumImage(ALBUM_PHOTOS[0],{id:'player-f'}),/award-f/);
 assert.match(albumImage(ALBUM_PHOTOS[0],{avatar:'player-f'}),/award-f/);
 assert.match(albumImage(ALBUM_PHOTOS[0],{id:'player-m'}),/award-m/);
 assert.match(albumCredit(ALBUM_PHOTOS[0],{name:'Bia <3'}).names,/Bia <3/);
});
test('loader is lazy, deduplicates and retries failure',async()=>{
 let calls=0,fail=true;const load=createAlbumLoader(async()=>{calls++;if(fail)throw Error('offline');});
 assert.equal(calls,0);const first=load('one');assert.equal(load('one'),first);assert.equal(await first,false);
 fail=false;assert.equal(await load('one'),true);assert.equal(calls,2);assert.equal(await load('one'),true);assert.equal(calls,2);
});
function harness({reduced=false,load=async()=>true}={}){
 const els=new Map(),events={awards:0,finishes:0,exits:0,sounds:[],pauses:[]};
 const make=()=>({hidden:false,disabled:false,textContent:'',dataset:{},children:[],clientHeight:230,attrs:{},
  style:{setProperty(k,v){this[k]=v;}},classList:{add(){}},handlers:{},focus(){},
  replaceChildren(){this.children=[];},append(el){this.children.push(el);},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this.handlers[k]=v;}});
 const get=id=>{if(!els.has(id))els.set(id,make());return els.get(id);};
 const document={hidden:false,getElementById:get,createElement:make};let tick=()=>{},now=0;
 const source=readFileSync(new URL('../games/campaign-ending.js',import.meta.url),'utf8').replace(/^import .*;\n/,'').replace('export function','function');
 const factory=runInNewContext(source+';createCampaignEnding',{ALBUM_PHOTOS,ALBUM_DURATION,albumStart,albumFrame,albumImage,albumCredit,
  createAlbumLoader:()=>load,document,matchMedia:()=>({matches:reduced}),performance:{now:()=>now},ResizeObserver:class{observe(){}},
  requestAnimationFrame:cb=>{tick=cb;return 1;},cancelAnimationFrame:()=>{tick=()=>{};}});
 const api=factory({getPlayer:()=>({id:'player-f',name:'Bia <3'}),onAward:()=>events.awards++,onFinish:()=>events.finishes++,
  onExit:()=>events.exits++,onSound:s=>events.sounds.push(s),onPause:p=>events.pauses.push(p)});
 return {api,get,events,document,click:id=>get(id).handlers.click(),advance:seconds=>{for(let i=0;i<seconds*10;i++){now+=100;tick(now);}}};
}
test('pause, previous, every photo, finish, exit and replay',async()=>{
 const h=harness();await h.api.start();assert.equal(h.events.awards,1);
 assert.equal(h.get('endingCreditTrack').children.length,22);assert.match(h.get('endingPhoto').src,/award-f/);
 h.click('endingPause');const held=h.get('endingCreditTrack').style.transform;h.advance(3);assert.equal(h.get('endingCreditTrack').style.transform,held);
 h.click('endingNext');assert.match(h.get('endingPhoto').src,/renato/);assert.equal(h.get('endingPhoto').style.opacity,'1');
 h.click('endingPrev');assert.match(h.get('endingPhoto').src,/award-f/);h.click('endingPause');
 for(let i=1;i<22;i++){h.click('endingNext');assert.match(h.get('endingPhoto').src,new RegExp(ALBUM_PHOTOS[i].id));}
 h.click('endingNext');assert.equal(h.events.finishes,1);assert.equal(h.get('endingThanks').hidden,false);
 assert.match(h.get('endingTitle').textContent,/Bia <3/);h.advance(4);assert.equal(h.events.finishes,1);
 h.click('endingNext');assert.equal(h.events.exits,1);h.click('endingExit');await Promise.resolve();await Promise.resolve();
 assert.equal(h.events.awards,2);h.api.stop();
});
test('hidden tabs freeze and skip from pause finishes once',async()=>{
 const h=harness();await h.api.start();h.advance(2);const held=h.get('endingProgress').value;
 h.document.hidden=true;h.advance(20);assert.equal(h.get('endingProgress').value,held);
 h.document.hidden=false;h.click('endingPause');h.click('endingSkip');h.click('endingSkip');
 assert.equal(h.events.finishes,1);assert.equal(h.events.pauses.at(-1),false);h.api.stop();
});
test('reduced motion starts paused and does not scroll or fade',async()=>{
 const h=harness({reduced:true});await h.api.start();assert.equal(h.events.pauses.at(-1),true);
 const held=h.get('endingCreditTrack').style.transform;h.advance(10);assert.equal(h.get('endingCreditTrack').style.transform,held);
 h.click('endingNext');assert.equal(h.get('endingPhoto').style.opacity,'1');
 const next=h.get('endingCreditTrack').style.transform;h.click('endingPause');h.advance(3);
 assert.equal(h.get('endingCreditTrack').style.transform,next);h.api.stop();
});
test('missing photos and closing while loading do not lose achievements',async()=>{
 const h=harness({load:async()=>false});await h.api.start();
 assert.equal(h.get('endingPhoto').hidden,true);assert.equal(h.get('endingPhotoFallback').hidden,false);
 h.click('endingSkip');assert.equal(h.events.awards,1);assert.equal(h.events.finishes,1);h.api.stop();
 let resolve;const pending=new Promise(r=>{resolve=r;}),slow=harness({load:()=>pending});
 const started=slow.api.start();assert.equal(slow.events.awards,1);slow.api.stop();resolve(true);await started;
 assert.equal(slow.get('endingPhoto').hidden,true);assert.equal(slow.events.finishes,0);
});
test('automatic credits reach the end',async()=>{
 const h=harness();await h.api.start();h.advance(ALBUM_DURATION+2);assert.equal(h.events.finishes,1);assert.equal(h.get('endingThanks').hidden,false);h.api.stop();
});
test('a completed champion save can replay the ending from Leandro or Options',()=>{
 const app=readFileSync(new URL('../games/app.js',import.meta.url),'utf8');
 assert.match(app,/\['celebrate','champion'\]\.includes\(stageOf\(campaign\)\)/);
 assert.match(app,/onEnding:startParty/);
});
test('23 delivered WebP photographs are not stretched or panned',()=>{
 const paths=new Set(ALBUM_PHOTOS.map(p=>albumImage(p,{id:'player-m'})));paths.add(albumImage(ALBUM_PHOTOS[0],{id:'player-f'}));assert.equal(paths.size,23);
 for(const path of paths){const b=readFileSync(new URL('..'+path,import.meta.url));assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WEBP');}
 const css=readFileSync(new URL('../games/ending-album.css',import.meta.url),'utf8');assert.match(css,/object-fit:contain/);assert.doesNotMatch(css,/@keyframes|scale\(|rotate\(/);
});
