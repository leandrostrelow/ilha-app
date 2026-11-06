import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context={window:{}};
vm.runInNewContext(readFileSync(new URL('../adm/monthly-reconciliation.js',import.meta.url),'utf8'),context);
const build=(v,c)=>JSON.parse(JSON.stringify(context.window.IlhaMonthlyReconciliation.payload(v,c)));
const config={canWrite:true,clientId:'synthetic-client',today:'2026-11-06',invoices:[{id:'synthetic-invoice',status:'PAGA',providerStatus:'RECEIVED',amount:250,invoiceMonth:'2026-11-01',dueDate:'2026-11-03'}]};
const values={action:'historical_receipt',month:'2026-10',amount:'230',dueDate:'2026-10-05',receivedOn:'2026-10-06',reason:'Pix do clube conferido no extrato.',confirmed:true};
test('histórico mantém valor e datas reais explicitamente informados',()=>{
 assert.deepEqual(build(values,config),{action:'historical_receipt',clientId:'synthetic-client',invoiceMonth:'2026-10-01',amount:230,dueDate:'2026-10-05',receivedOn:'2026-10-06',reason:values.reason});
});
test('não inventa datas nem aceita competência atual ou valor inválido',()=>{
 for(const change of [{receivedOn:''},{receivedOn:'2026-11-07'},{receivedOn:'2026-09-30'},{dueDate:'2026-10-32'},{month:'2026-11'},{amount:'0'},{amount:'230.001'},{dueDate:'2026-11-05'}]) assert.throws(()=>build({...values,...change},config));
});
test('reversão envia valores emitidos da fatura e nunca outra baixa',()=>{
 assert.deepEqual(build({action:'review_reversal',invoiceId:'synthetic-invoice',expectedAmount:999,receivedOn:'2026-10-30',reason:values.reason,confirmed:true},config),{action:'review_reversal',invoiceId:'synthetic-invoice',expectedAmount:250,invoiceMonth:'2026-11-01',dueDate:'2026-11-03',reason:values.reason});
});
test('exige permissão, confirmação e motivo e bloqueia fatura substituída',()=>{
 assert.throws(()=>build(values,{...config,canWrite:false}));
 assert.throws(()=>build({...values,confirmed:false},config));
 assert.throws(()=>build({...values,reason:''},config));
 assert.throws(()=>build({...values,action:'review_reversal',invoiceId:'synthetic-invoice'},{...config,invoices:[{...config.invoices[0],supersededAt:'2026-11-06'}]}));
});
test('reemissão usa dados da fatura original e exige novo vencimento explícito',()=>{
 const c={...config,invoices:[{...config.invoices[0],status:'AGUARDANDO',providerStatus:'REVIEW_REQUIRED'}]};
 const v={action:'audited_reissue',invoiceId:'synthetic-invoice',newDueDate:'2026-11-05',reason:values.reason,confirmed:true};
 assert.deepEqual(build(v,c),{action:'audited_reissue',invoiceId:'synthetic-invoice',expectedAmount:250,invoiceMonth:'2026-11-01',oldDueDate:'2026-11-03',newDueDate:'2026-11-05',reason:values.reason});
 assert.throws(()=>build({...v,newDueDate:''},c));
 assert.throws(()=>build(v,config));
 assert.throws(()=>build(v,{...c,invoices:[{...c.invoices[0],supersededAt:'2026-11-06'}]}));
});
test('reagendamento exige substituta recusada e data explícita sem registrar recebimento',()=>{
 const c={...config,invoices:[{...config.invoices[0],status:'ABERTA',providerStatus:'FAILED'}]};
 const v={action:'reschedule_failed',invoiceId:'synthetic-invoice',newDueDate:'2026-11-06',reason:values.reason,confirmed:true};
 assert.deepEqual(build(v,c),{action:'reschedule_failed',invoiceId:'synthetic-invoice',expectedAmount:250,invoiceMonth:'2026-11-01',oldDueDate:'2026-11-03',newDueDate:'2026-11-06',reason:values.reason});
 assert.throws(()=>build(v,config)); assert.throws(()=>build({...v,confirmed:false},c));
});
