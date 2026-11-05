import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameTelemetry} from '../games/telemetry.js';

function memoryStorage(){
 const values=new Map();
 return {get:(key,fallback=null)=>values.has(key)?values.get(key):fallback,set:(key,value)=>{values.set(key,value);return true;}};
}

test('telemetria envia somente eventos e propriedades permitidos',async()=>{
 const requests=[],storage=memoryStorage();
 const telemetry=createGameTelemetry({endpoint:'https://example.test/telemetry',key:'public',identity:'a'.repeat(64),version:'tennis-rpg-v2',storage,
  uuid:()=> '11111111-1111-4111-8111-111111111111',online:()=>true,listenOnline:()=>{},
  fetcher:async(_url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,status:200};},
 });
 await telemetry.track('match_started',{mode:'quick',sport:'tennis',ignored:'third',Bad:'no'});
 assert.equal(requests.length,1);
 assert.deepEqual(requests[0],{action:'telemetry',version:'tennis-rpg-v2',identity:'a'.repeat(64),event_id:'11111111-1111-4111-8111-111111111111',event:'match_started',properties:{mode:'quick',sport:'tennis'}});
 assert.deepEqual(storage.get('telemetry-queue-v1'),[]);
});

test('evento unico de zeramento nao duplica no mesmo navegador',async()=>{
 const requests=[],storage=memoryStorage();let sequence=0;
 const telemetry=createGameTelemetry({endpoint:'https://example.test/telemetry',key:'public',identity:'b'.repeat(64),version:'tennis-rpg-v2',storage,
  uuid:()=>`22222222-2222-4222-8222-${String(++sequence).padStart(12,'0')}`,online:()=>true,listenOnline:()=>{},
  fetcher:async(_url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,status:200};},
 });
 await telemetry.trackOnce('campaign_completed');
 await telemetry.trackOnce('campaign_completed');
 assert.equal(requests.length,1);
});

test('fila preserva eventos novos enquanto um envio esta em andamento',async()=>{
 const requests=[],storage=memoryStorage();let releaseFirst,sequence=0;
 const telemetry=createGameTelemetry({endpoint:'https://example.test/telemetry',key:'public',identity:'c'.repeat(64),version:'tennis-rpg-v2',storage,
  uuid:()=>`33333333-3333-4333-8333-${String(++sequence).padStart(12,'0')}`,online:()=>true,listenOnline:()=>{},
  fetcher:async(_url,options)=>{requests.push(JSON.parse(options.body));if(requests.length===1)await new Promise(resolve=>{releaseFirst=resolve;});return {ok:true,status:200};},
 });
 const first=telemetry.track('game_opened');
 telemetry.track('campaign_started');
 releaseFirst();await first;await telemetry.flush();
 assert.deepEqual(requests.map(request=>request.event),['game_opened','campaign_started']);
 assert.deepEqual(storage.get('telemetry-queue-v1'),[]);
});
