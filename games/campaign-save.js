import {ADVENTURE_KEY,readAdventure} from './adventure.js';

export const SAVE_KEY=`ilha-games:${ADVENTURE_KEY}`;
export const HISTORY_KEY='ilha-games:save-history:v1';
const FORMAT='ilha-legado-backup',LIMIT=128*1024;
const checksum=text=>{let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return (h>>>0).toString(16).padStart(8,'0');};
function validState(value){return value&&typeof value==='object'&&!Array.isArray(value)&&[1,2,3,4,5,6].includes(value.version)&&typeof value.name==='string';}
export function saveRecord(state,savedAt=Date.now()){
 const campaign=readAdventure(state);
 return {format:FORMAT,version:1,savedAt,campaign,checksum:checksum(JSON.stringify(campaign))};
}
export function parseSave(text){
 if(typeof text!=='string'||text.length>LIMIT)throw new Error('O arquivo de backup é grande demais.');
 let value;try{value=JSON.parse(text);}catch{throw new Error('Este arquivo não é um backup válido.');}
 if(value?.format!==FORMAT||value.version!==1||!validState(value.campaign)||!Number.isFinite(value.savedAt)||value.savedAt<=0||value.checksum!==checksum(JSON.stringify(value.campaign)))throw new Error('Backup incompatível ou danificado. Seu save atual não foi alterado.');
 return saveRecord(value.campaign,value.savedAt);
}
export const exportSave=state=>JSON.stringify(saveRecord(state),null,2);
function readRecords(value){
 if(!Array.isArray(value))return [];
 return value.slice(0,4).flatMap(v=>{try{return [parseSave(JSON.stringify(v))];}catch{return [];}});
}

// Different browser storage engine, same device/origin. This is recovery from
// a damaged key, NOT cloud backup or protection against clearing browser data.
function availableIndexed(){try{return globalThis.indexedDB;}catch{return null;}}
export function browserSaveMirror(indexed=availableIndexed()){
 let database;
 function open(){return database||=new Promise(resolve=>{
  if(!indexed){resolve(null);return;}let finished=false;
  const finish=db=>{if(finished){db?.close();return;}finished=true;clearTimeout(timer);resolve(db);};
  const timer=setTimeout(()=>finish(null),1200);
  try{const request=indexed.open('ilha-legado-saves',1);
   request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('backups'))request.result.createObjectStore('backups');};
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();finish(db);};request.onerror=request.onblocked=()=>finish(null);
  }catch{finish(null);}
 });}
 async function transact(value){
  const db=await open();if(!db)return value===undefined?[]:false;
  return new Promise(resolve=>{let result=value===undefined?[]:false,done=false;
   const finish=v=>{if(done)return;done=true;clearTimeout(timer);resolve(v);},timer=setTimeout(()=>finish(value===undefined?[]:false),1500);
   try{const tx=db.transaction('backups',value===undefined?'readonly':'readwrite'),store=tx.objectStore('backups');
    const request=value===undefined?store.get('campaign'):store.put(value,'campaign');request.onsuccess=()=>{result=value===undefined?request.result||[]:true;};
    tx.oncomplete=()=>finish(result);tx.onerror=tx.onabort=()=>finish(value===undefined?[]:false);
   }catch{finish(value===undefined?[]:false);}
  });
 }
 return {read:()=>transact(),write:value=>transact(value)};
}

function availableLocal(){try{return globalThis.localStorage;}catch{return null;}}
export function createCampaignSaves({local=availableLocal(),mirror=browserSaveMirror(),now=Date.now,onStatus=()=>{}}={}){
 let records=[],current=null,queue=Promise.resolve(),saved=true,recovered=false,persistedAt=0,conflict=false;
 const get=key=>{try{return JSON.parse(local?.getItem(key)||'null');}catch{return null;}};
 const put=(key,value)=>{try{if(!local)return false;local.setItem(key,JSON.stringify(value));return true;}catch{return false;}};
 const notify=()=>onStatus({saved,recovered,conflict,savedAt:current?.savedAt||null});
 const merge=rows=>{const seen=new Set();return rows.sort((a,b)=>b.savedAt-a.savedAt).filter(r=>{if(seen.has(r.checksum))return false;seen.add(r.checksum);return true;}).slice(0,4);};
 function mirrorWrite(snapshot,localOk){
  queue=queue.then(async()=>{let ok=false;try{ok=await mirror?.write(snapshot)||false;}catch{/* Local copy remains usable. */}
   if(current?.savedAt===snapshot[0]?.savedAt){saved=localOk||ok;if(saved)persistedAt=current.savedAt;notify();}
  });return queue;
 }
 function save(state,{replace=false}={}){
  const latest=readRecords(get(HISTORY_KEY))[0];
  if(!replace&&(conflict||latest&&latest.savedAt>persistedAt&&latest.checksum!==current?.checksum)){
   conflict=true;saved=false;notify();return false;
  }
  const record=saveRecord(state,Math.max(now(),(current?.savedAt||0)+1));
  if(record.checksum===current?.checksum&&saved&&!replace)return true;
  conflict=false;current=record;records=merge([record,...records]);
  // Journal is written before the legacy-compatible primary key. Each setItem
  // is atomic; a failed second write does not erase the previous good record.
  const journalOk=put(HISTORY_KEY,records),primaryOk=put(SAVE_KEY,record.campaign);
  saved=journalOk||primaryOk;if(saved)persistedAt=record.savedAt;notify();mirrorWrite([...records],saved);return saved;
 }
 async function ready(){
  let other=[];
  try{other=readRecords(await mirror?.read());}catch{/* Continue with local data. */}
  // Another tab may have saved while IndexedDB was opening. Re-read the
  // synchronous journal immediately before selecting/repairing the winner.
  const primary=get(SAVE_KEY),localRecords=readRecords(get(HISTORY_KEY));
  records=merge([...localRecords,...other]);
  if(!records.length&&validState(primary))records=[saveRecord(primary,now())];
  current=records[0]||null;persistedAt=current?.savedAt||0;
  if(current){recovered=!validState(primary)||JSON.stringify(readAdventure(primary))!==JSON.stringify(current.campaign);const journalOk=put(HISTORY_KEY,records),primaryOk=put(SAVE_KEY,current.campaign),ok=journalOk||primaryOk;saved=true;await mirrorWrite([...records],Boolean(ok)||other.length>0);}
  notify();return readAdventure(current?.campaign);
 }
 return {ready,save,flush:()=>queue,history:()=>records.map(r=>structuredClone(r)),restore:record=>save(parseSave(JSON.stringify(record)).campaign,{replace:true}),status:()=>({saved,recovered,conflict,savedAt:current?.savedAt||null})};
}
