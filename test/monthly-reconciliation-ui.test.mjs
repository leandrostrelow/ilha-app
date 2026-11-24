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

const pendingInvoice={id:'synthetic-open',status:'AGUARDANDO',providerStatus:'PENDING',amount:351,invoiceMonth:'2026-12-01',dueDate:'2026-12-05'};
const adjustment={action:'adjust_amount',invoiceId:pendingInvoice.id,newAmount:'520',reason:'Correção do valor conforme composição familiar cadastrada.',confirmed:true};
const adjustmentConfig={...config,today:'2026-11-24',invoices:[pendingInvoice]};
test('corrige fatura futura com valores originais e sem transmitir recebimento ou novo vencimento',()=>{
 assert.deepEqual(build({...adjustment,expectedAmount:1,invoiceMonth:'2027-01-01',newDueDate:'2026-12-31',receivedOn:'2026-11-24'},adjustmentConfig),{
  action:'adjust_amount',invoiceId:pendingInvoice.id,expectedAmount:351,newAmount:520,invoiceMonth:'2026-12-01',oldDueDate:'2026-12-05',reason:adjustment.reason
 });
});
test('correção de valor bloqueia fatura paga, cancelada, substituída, em revisão e sem vínculo Asaas pendente',()=>{
 for(const change of [{status:'PAGA'},{status:'CANCELADA'},{status:'ESTORNADA'},{providerStatus:'RECEIVED'},{providerStatus:'CONFIRMED'},{providerStatus:'REVIEW_REQUIRED'},{providerStatus:''},{paidAt:'2026-11-24'},{supersededAt:'2026-11-24'}])
  assert.throws(()=>build(adjustment,{...adjustmentConfig,invoices:[{...pendingInvoice,...change}]}));
 assert.throws(()=>build({...adjustment,invoiceId:'another-invoice'},adjustmentConfig));
});
test('correção de valor exige permissão, conferência, motivo e valor monetário diferente válido',()=>{
 assert.throws(()=>build(adjustment,{...adjustmentConfig,canWrite:false}));
 for(const change of [{confirmed:false},{reason:''},{newAmount:''},{newAmount:'351'},{newAmount:'0'},{newAmount:'-1'},{newAmount:'520.001'},{newAmount:'NaN'},{newAmount:'Infinity'}])
  assert.throws(()=>build({...adjustment,...change},adjustmentConfig));
});

test('encerramento exige emissão falhada e transmite somente os dados originais sem pagamento',()=>{
 const c={...config,invoices:[{...config.invoices[0],status:'ABERTA',providerStatus:'FAILED'}]};
 const v={action:'close_failed_invoice',invoiceId:'synthetic-invoice',reason:values.reason,confirmed:true};
 assert.deepEqual(build({...v,expectedAmount:1,receivedOn:'2026-10-30',newDueDate:'2026-12-01'},c),{
  action:v.action,invoiceId:v.invoiceId,expectedAmount:250,invoiceMonth:'2026-11-01',oldDueDate:'2026-11-03',reason:v.reason
 });
 for(const change of [{status:'PAGA'},{providerStatus:'RECEIVED'},{providerStatus:'PENDING'},{paidAt:'2026-10-30'},{supersededAt:'2026-11-06'}])
  assert.throws(()=>build(v,{...c,invoices:[{...c.invoices[0],...change}]}));
 assert.throws(()=>build({...v,confirmed:false},c));
 assert.throws(()=>build(v,{...c,canWrite:false}));
});
