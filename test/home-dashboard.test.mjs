import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});
vm.runInContext(readFileSync(new URL('../adm/home-dashboard.js',import.meta.url),'utf8'),context);
const classify=(clients,invoices,dismissed=[],today='2026-11-11')=>JSON.parse(JSON.stringify(context.IlhaHomeDashboard.classify(clients,invoices,dismissed,today)));
const invoice=(id,changes={})=>({id,client_id:'payer',amount:350,status:'VENCIDA',due_date:'2026-11-10',invoice_month:'2026-11-01',...changes});
test('somente cadastros pendentes não excluídos precisam de ativação',()=>{
 assert.deepEqual(classify([{id:'new',status:'PENDENTE'},{id:'active',status:'ATIVO'},{id:'blocked',status:'BLOQUEADO'},{id:'deleted',status:'PENDENTE',registration_deleted_at:'now'}],[]).students.map(x=>x.id),['new']);
});
test('inadimplência inclui ontem, exclui hoje e futuro, sem esconder bloqueados por perfil',()=>{
 const rows=[invoice('yesterday'),invoice('today',{due_date:'2026-11-11'}),invoice('future',{due_date:'2026-11-12'}),invoice('unknown',{due_date:null}),invoice('zero',{amount:0}),invoice('old',{due_date:'2026-09-30'})];
 assert.deepEqual(classify([],rows).overdue.map(x=>x.id),['yesterday','old']);
});
test('pagamento Asaas move a fatura de inadimplentes para confirmados sem duplicação',()=>{
 const row=invoice('a');assert.equal(classify([],[row]).overdue.length,1);
 row.provider_status='CONFIRMED';let result=classify([],[row,row]);assert.equal(result.overdue.length,0);assert.equal(result.payments.length,1);
 row.provider_status='RECEIVED';row.status='PAGA';row.paid_at='2026-11-11';result=classify([],[row],[{invoice_id:'a'}]);assert.equal(result.overdue.length,0);assert.equal(result.payments.length,0);
});
test('canceladas e substituídas não voltam como dívida nem aviso',()=>{
 for(const changes of [{status:'CANCELADA'},{provider_status:'CANCELLED'},{provider_status:'REFUNDED'},{superseded_at:'now'}]){
  const result=classify([],[invoice('a',changes)]);assert.equal(result.overdue.length,0);assert.equal(result.payments.length,0);
 }
});
test('baixa manual não aparece como recebimento Asaas nem permanece vencida',()=>{
 for(const changes of [{status:'PAGA'},{paid_at:'2026-11-11'},{provider_status:'RECEIVED_IN_CASH'}]){
  const result=classify([],[invoice('a',changes)]);assert.equal(result.overdue.length,0);assert.equal(result.payments.length,0);
 }
});
test('estorno de confirmação volta à inadimplência independentemente do aviso dispensado',()=>{
 const result=classify([],[invoice('a',{provider_status:'OVERDUE'})],[{invoice_id:'a'}]);assert.equal(result.payments.length,0);assert.equal(result.overdue.length,1);
});
test('a virada do dia inclui o vencimento anterior sem depender do fuso do navegador',()=>{
 const row=invoice('a',{due_date:'2026-11-11'});assert.equal(classify([],[row],[],'2026-11-11').overdue.length,0);assert.equal(classify([],[row],[],'2026-11-12').overdue.length,1);
});
function controllerFixture(overrides={}) {
 const elements=new Map();
 const document={getElementById:id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',disabled:false});return elements.get(id);}};
 const scope=vm.createContext({document,console,setInterval,clearInterval});
 vm.runInContext(readFileSync(new URL('../adm/home-dashboard.js',import.meta.url),'utf8'),scope);
 const calls=[];
 const ctx={userId:()=> 'admin',epoch:()=>1,visible:()=>true,can:()=>true,today:()=> '2026-11-11',escape:String,money:String,error:()=>{},read:async path=>{calls.push(path);return [];},...overrides};
 return {board:scope.IlhaHomeDashboard.create(ctx),elements,calls};
}
test('erro de consulta não anuncia ausência de inadimplentes',async()=>{
 const f=controllerFixture({read:async()=>{throw Error('offline');}});await f.board.refresh();
 assert.match(f.elements.get('homeOverdueInvoices').innerHTML,/Falha ao carregar/);
 assert.doesNotMatch(f.elements.get('homeOverdueInvoices').innerHTML,/Nenhuma fatura/);
 assert.equal(f.elements.get('homeOverdueTotal').textContent,'—');
});
test('perfil sem financeiro não consulta faturas nem avisos de pagamento',async()=>{
 const f=controllerFixture({can:p=>p==='clients.read'});await f.board.refresh();
 assert.equal(f.calls.length,1);assert.match(f.calls[0],/^app_clients\?/);
});
test('logout durante leitura descarta dados da sessão anterior',async()=>{
 let finish;
 const data=new Promise(resolve=>{finish=resolve;});
 const f=controllerFixture({read:async path=>path.startsWith('app_clients?')?data:[]});
 const pending=f.board.refresh();f.board.reset();finish([{id:'old',full_name:'Private old session',status:'PENDENTE'}]);await pending;
 assert.doesNotMatch(f.elements.get('homeNewStudents').innerHTML,/Private old session/);
});

test('falha sem emissão não é fatura vencida; cobranças emitidas e manuais continuam visíveis',()=>{
 const failed={provider_status:'FAILED',issued_at:null};
 const rows=[invoice('unissued',failed),invoice('issued',{...failed,issued_at:'2026-11-01T12:00:00Z'}),invoice('unknown',{provider_status:'FAILED'}),invoice('manual'),invoice('pending',{issued_at:null,provider_status:'PENDING'})];
 assert.deepEqual(classify([],rows).overdue.map(x=>x.id),['issued','manual','pending','unknown']);
 assert.equal(classify([],rows).payments.length,0);
});
test('consulta carrega a data de emissão para distinguir tentativas com falha',async()=>{
 const f=controllerFixture();await f.board.refresh();
 assert.match(f.calls.find(p=>p.startsWith('app_payment_invoices?')),/issued_at/);
});

test('total soma somente faturas vencidas únicas e acompanha o pagamento',async()=>{
 const a=invoice('a',{amount:'170.15'}),b=invoice('b',{amount:'350.10'});
 const rows=[a,a,b,invoice('paid',{status:'PAGA'}),invoice('cancelled',{status:'CANCELADA'}),invoice('future',{due_date:'2026-11-25'})];
 const f=controllerFixture({read:async p=>p.startsWith('app_payment_invoices?')?rows:[]});
 await f.board.refresh();assert.equal(f.elements.get('homeOverdueTotal').textContent,'520.25');
 a.status='PAGA';await f.board.refresh();assert.equal(f.elements.get('homeOverdueTotal').textContent,'350.1');
});
