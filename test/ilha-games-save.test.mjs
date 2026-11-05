import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignSaves,saveRecord,parseSave,exportSave,SAVE_KEY,HISTORY_KEY,browserSaveMirror} from '../games/campaign-save.js';
import {readAdventure,RIVALS,EXPLORE} from '../games/adventure.js';
const adventure=(name='Leandro')=>readAdventure({version:6,name,avatar:'player-f',begun:true,welcomed:true,history:true,met:true,trained:true,cup:true,barVisited:true,places:EXPLORE,wins:RIVALS,champion:true,creditsSeen:true,betoStory:true,rainStage:'cleared',rainChats:['malu','kalinca','felipe','vanessa']});
function storage(){const data=new Map();return {data,getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};}
function mirror(){let rows=[];return {read:async()=>structuredClone(rows),write:async value=>{rows=structuredClone(value);return true;}};}
test('portable backup retains name, avatar, medals, rain and completion; never exports unrelated credentials',()=>{
 const state=adventure(),packet=exportSave({...state,identity:'secret',token:'secret'});assert.deepEqual(parseSave(packet).campaign,state);assert.ok(!packet.includes('secret'));
 for(const packet of ['{}','null','[1]','bad','x'.repeat(128*1024+1)])assert.throws(()=>parseSave(packet));
 const altered=JSON.parse(exportSave(state));altered.campaign.name='Other';assert.throws(()=>parseSave(JSON.stringify(altered)),/danificado/);
 altered.campaign=state;altered.version=999;assert.throws(()=>parseSave(JSON.stringify(altered)));
});
test('migrates existing primary saves without losing progression and maintains four distinct recovery versions',async()=>{
 const local=storage(),copy=mirror();local.setItem(SAVE_KEY,JSON.stringify(adventure()));
 const save=createCampaignSaves({local,mirror:copy,now:()=>100});assert.deepEqual(await save.ready(),adventure());
 for(let i=0;i<6;i++)assert.equal(save.save(adventure('Nome '+i)),true);await save.flush();
 assert.equal(save.history().length,4);assert.equal(save.history()[0].campaign.name,'Nome 5');
 assert.equal(save.history().at(-1).campaign.name,'Nome 2');
 const same=save.history()[0].savedAt;save.save(adventure('Nome 5'));assert.equal(save.history()[0].savedAt,same);
 assert.equal((await copy.read())[0].campaign.name,'Nome 5');
 assert.equal((await createCampaignSaves({local,mirror:copy}).ready()).name,'Nome 5');
});
test('damaged primary and journal recover from independent IndexedDB mirror',async()=>{
 const local=storage(),copy=mirror();const save=createCampaignSaves({local,mirror:copy});await save.ready();save.save(adventure());await save.flush();
 local.setItem(SAVE_KEY,'{broken');local.setItem(HISTORY_KEY,'[]');
 const reloaded=createCampaignSaves({local,mirror:copy});assert.deepEqual(await reloaded.ready(),adventure());assert.equal(reloaded.status().recovered,true);
 assert.equal(JSON.parse(local.getItem(SAVE_KEY)).name,'Leandro');
});
test('newest valid journal wins over stale primary and damaged backup records are ignored',async()=>{
 const local=storage();local.setItem(SAVE_KEY,JSON.stringify(adventure('Antigo')));
 const old=saveRecord(adventure('Velho'),1),fresh=saveRecord(adventure('Novo'),2),broken={...fresh,checksum:'bad'};
 local.setItem(HISTORY_KEY,JSON.stringify([broken,fresh,old]));
 const save=createCampaignSaves({local,mirror:null});assert.equal((await save.ready()).name,'Novo');assert.equal(save.history().length,2);assert.equal(save.status().recovered,true);
});
test('local storage denial falls back to mirror, and total write failure is reported honestly',async()=>{
 const denied={getItem(){throw Error('Denied');},setItem(){throw Error('Quota');}},copy=mirror();
 const save=createCampaignSaves({local:denied,mirror:copy});await save.ready();assert.equal(save.save(adventure()),false);await save.flush();assert.equal(save.status().saved,true);
 assert.deepEqual(await createCampaignSaves({local:denied,mirror:copy}).ready(),adventure());
 const failed=createCampaignSaves({local:denied,mirror:{read:async()=>[],write:async()=>{throw Error('Denied');}}});await failed.ready();failed.save(adventure());await failed.flush();assert.equal(failed.status().saved,false);
 const unsupported=browserSaveMirror(null);assert.deepEqual(await unsupported.read(),[]);assert.equal(await unsupported.write([]),false);
});
test('other-tab changes cannot silently overwrite a newer save; explicit restore retains previous version',async()=>{
 const local=storage(),a=createCampaignSaves({local,mirror:null,now:()=>100});await a.ready();a.save(adventure('Primeiro'));
 const b=createCampaignSaves({local,mirror:null,now:()=>200});await b.ready();b.save(adventure('Outra aba'));
 assert.equal(a.save(adventure('Desatualizado')),false);assert.equal(a.status().conflict,true);assert.equal(JSON.parse(local.getItem(SAVE_KEY)).name,'Outra aba');
 b.restore(saveRecord(adventure('Restaurado'),1));await b.flush();assert.equal(b.status().saved,true);assert.ok(b.history().some(r=>r.campaign.name==='Outra aba'));
 assert.equal(b.history()[0].campaign.name,'Restaurado');
});
test('invalid restoration never modifies the existing save',async()=>{
 const local=storage(),save=createCampaignSaves({local,mirror:null});await save.ready();save.save(adventure());
 const before=local.getItem(SAVE_KEY);assert.throws(()=>save.restore({campaign:{name:'Corrupt'}}));assert.equal(local.getItem(SAVE_KEY),before);
});
