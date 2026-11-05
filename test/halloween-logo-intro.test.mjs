import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {drawGameLogo,LOGO_SIZE} from '../game2/game-brand.js';
import {createGameAudio,MUSIC_TRACKS} from '../game2/audio.js';

test('stacked mystery mark, pumpkin and subtitle stay within all canvas sizes',()=>{
 for(const [width,height]of [[390,264],[41,35],[180,180],[1088,880]]){
  let transform=[0,0,1,1];const stack=[],rects=[];
  const c={fillStyle:'',save(){stack.push([...transform]);},restore(){transform=stack.pop();},translate(x,y){transform[0]+=x;transform[1]+=y;},scale(x,y){transform[2]*=x;transform[3]*=y;},fillRect(x,y,w,h){rects.push({x:transform[0]+x*transform[2],y:transform[1]+y*transform[3],w:w*transform[2],h:h*transform[3],color:this.fillStyle});}};
  drawGameLogo(c,0,0,width,height);
  assert.ok(rects.length>300);
  for(const r of rects)assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=width+.001&&r.y+r.h<=height+.001,JSON.stringify(r));
  for(const color of ['#fff3ca','#dbc4f4','#d4ef65','#ed973e'])assert.ok(rects.some(r=>r.color===color));
  assert.deepEqual(transform,[0,0,1,1]);
 }
 assert.deepEqual(LOGO_SIZE,{width:68,height:60});
});

test('opening switches the single music player to map, pauses and continues without restarting on arrival',async()=>{
 let created=0;
 const media={paused:true,currentTime:0,readyState:1,duration:180,dataset:{},addEventListener(){},removeEventListener(){},play(){this.paused=false;return Promise.resolve();},pause(){this.paused=true;},remove(){}};
 const audio=createGameAudio({createMedia:()=>{created++;return media;},createContext:()=>{throw new Error('No audio device in test');}});
 audio.unlock();audio.setScene('menu');assert.equal(media.src,MUSIC_TRACKS.menu);
 audio.setScene('map',{restart:true});assert.equal(media.src,MUSIC_TRACKS.map);assert.equal(media.dataset.gameMusic,'map');
 media.currentTime=12;audio.setPaused(true);assert.equal(media.paused,true);
 audio.setPaused(false);assert.equal(media.paused,false);assert.equal(media.currentTime,12);
 audio.setScene('map');assert.equal(media.currentTime,12);assert.equal(created,1);
 audio.setScene(null);assert.equal(media.paused,true);audio.destroy();
 const app=await readFile(new URL('../game2/app.js',import.meta.url),'utf8');
 assert.match(app,/createHalloweenIntro\(\{[^\n]+onStart:\(\)=>audio\.setScene\('map',\{restart:true\}\),onPause:value=>audio\.setPaused\(value\)/);
 const intro=await readFile(new URL('../game2/halloween-intro.js',import.meta.url),'utf8');
 assert.match(intro,/onStart\(\);onPause\(paused\)/);
 assert.match(intro,/!paused&&!document\.hidden&&ready/);
 assert.match(intro,/prefers-reduced-motion: reduce/);
 assert.match(intro,/settled\.has\(shot\.image\)/);
});
