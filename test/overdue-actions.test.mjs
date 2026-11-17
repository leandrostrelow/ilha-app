import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const scope=vm.createContext({});
vm.runInContext(readFileSync(new URL('../adm/overdue-actions.js',import.meta.url),'utf8'),scope);
const run=scope.IlhaOverdueActions.suspend;
function fixture(managed=true){
 const calls=[];
 return {calls,ctx:{managed:()=>managed,prepare:async()=>{calls.push('prepare');return {state:'PREPARED'};},cancel:async()=>calls.push('cancel'),finish:async()=>{calls.push('finish');return {state:'COMPLETED'};}}};
}
test('suspensão valida a seleção antes do cancelamento e só depois inativa',async()=>{
 const {ctx,calls}=fixture();await run(ctx,{},{});assert.deepEqual(calls,['prepare','cancel','finish']);
});
test('recusa financeira não inativa nem afirma conclusão',async()=>{
 const {ctx,calls}=fixture();ctx.cancel=async()=>{throw Error('Asaas recusou');};
 await assert.rejects(run(ctx,{},{}),/Asaas recusou/);assert.deepEqual(calls,['prepare']);
});
test('seleção inválida não cancela e permite revisar antes da mutação',async()=>{
 const {ctx,calls}=fixture();ctx.prepare=async()=>{throw Error('cadastro alterado');};
 await assert.rejects(run(ctx,{},{}),e=>e.beforeMutation===true);assert.deepEqual(calls,[]);
});
test('fatura manual é tratada na transação local, sem chamar Asaas',async()=>{
 const {ctx,calls}=fixture(false);await run(ctx,{},{});assert.deepEqual(calls,['prepare','finish']);
});
test('retentativa concluída não repete cancelamento nem suspensão',async()=>{
 const {ctx,calls}=fixture();ctx.prepare=async()=>({state:'COMPLETED'});await run(ctx,{},{});assert.deepEqual(calls,[]);
});
