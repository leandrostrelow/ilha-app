const EVENTS=new Set(['game_opened','campaign_started','match_started','match_finished','campaign_completed']);
const QUEUE_KEY='telemetry-queue-v1';
const ONCE_PREFIX='telemetry-once:';

function safeProperties(value){
 const output={};
 for(const [key,raw] of Object.entries(value||{}).slice(0,2)){
  if(!/^[a-z][a-z0-9_]{0,31}$/.test(key))continue;
  if(['string','number','boolean'].includes(typeof raw))output[key]=typeof raw==='string'?raw.slice(0,80):raw;
 }
 return output;
}

export function createGameTelemetry({endpoint,key,identity,version,storage,fetcher=fetch,uuid=()=>crypto.randomUUID(),online=()=>navigator.onLine,listenOnline=handler=>window.addEventListener('online',handler)}){
 let flushing=false;
 const read=()=>storage.get(QUEUE_KEY,[]).filter(item=>item&&EVENTS.has(item.event)).slice(-40);
 const write=queue=>storage.set(QUEUE_KEY,queue.slice(-40));
 async function flush(){
  if(flushing||!online())return;
  flushing=true;
  try{
   let queue=read();
   while(queue.length){
    const item=queue[0];
    let response;
    try{
     response=await fetcher(endpoint,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({action:'telemetry',version,identity,...item}),keepalive:true});
    }catch{return;}
    if(response.ok||[400,401,409,413].includes(response.status)){
     queue=read().filter(candidate=>candidate.event_id!==item.event_id);write(queue);continue;
    }
    return;
   }
  }finally{flushing=false;}
 }
 function track(event,properties={}){
  if(!EVENTS.has(event))return;
  const queue=read();queue.push({event_id:uuid(),event,properties:safeProperties(properties)});write(queue);return flush();
 }
 function trackOnce(event,properties={}){
  if(storage.get(`${ONCE_PREFIX}${event}`,false))return;
  storage.set(`${ONCE_PREFIX}${event}`,true);return track(event,properties);
 }
 listenOnline(flush);
 return {track,trackOnce,flush};
}
