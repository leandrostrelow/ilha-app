import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const [admin,client,sql]=await Promise.all(['adm/index.html','adm/day-use.js','supabase/migrations/20261007224027_bar_beach_day_use.sql'].map(p=>readFile(new URL('../'+p,import.meta.url),'utf8')));
test('command report includes only Day Use items, preserves open/partial status and avoids duplicate split quantities',()=>{
 const sandbox={window:{},document:{addEventListener(){}},setInterval(){}};vm.runInNewContext(client,sandbox);
 const report=sandbox.window.IlhaDayUse.commandReport;
 const orders=[{id:'a',customerName:'Ana',status:'ABERTA',paymentStatus:'ABERTO',total:200},{id:'b',customerName:'Bia',status:'FECHADA',paymentStatus:'PAGO',total:100},{id:'c',status:'CANCELADA'}];
 const item=(id,orderId,price,extra={})=>({id,orderId,productId:'daily',quantity:1,unitPrice:price,created:'2026-10-07',status:'ENTREGUE',...extra});
 const first=item('x','a',15);
 const snapshot={orders,items:[first,first,item('copy','b',15,{billingOnly:true,splitSourceItemId:'x'}),item('drink','a',100,{productId:'beer'}),item('cancel','c',30),item('removed','a',30,{status:'CANCELADO'}),item('old','b',30,{created:'2026-10-06'}),item('monthly','b',100,{productId:'monthly'})],finance:[],day:'2026-10-07',dateKey:x=>x};
 const result=report(snapshot,[{product_id:'daily',kind:'DIARIO'},{product_id:'monthly',kind:'MENSAL'}]);
 assert.equal(result.length,2);assert.equal(result[0].quantity,1);assert.equal(result[0].amount,30);
 assert.equal(result[0].payment,'Pagamento parcial');assert.equal(result[1].payment,'Comanda paga');
 assert.equal(result.reduce((s,r)=>s+r.amount,0),130,'only Day Use, not entire mixed command');
 orders[1].paymentStatus='ABERTO';assert.equal(report(snapshot,[{product_id:'daily',kind:'DIARIO'}])[0].payment,'Em aberto');
 snapshot.finance=[{orderId:'a',type:'RECEITA',status:'RECEBIDO',amount:5}];assert.equal(report(snapshot,[{product_id:'daily',kind:'DIARIO'}])[0].payment,'Pagamento parcial');
 assert.equal(report(snapshot,[]).length,0,'unknown products never classified as Day Use');
});
test('Day Use is adjacent to counter and has dedicated daily/monthly finance filters',()=>{
 assert.match(admin,/barCounterCommandCard\(\) \+ barDayUseCommandCard\(\)/);
 assert.match(admin,/dayUsePassId: row.day_use_pass_id/);
 assert.match(admin,/\['day-use-mensal', 'Day Use mensal'\]/);
 assert.match(admin,/\['day-use-diario', 'Day Use diário'\]/);
 assert.match(admin,/function clearAdminSession\(\) \{\s+if \(window.IlhaDayUse\) window.IlhaDayUse.reset\(\)/);
});
test('period filters use inclusive seven-day/month bounds and received commands use final payment date',()=>{
 const sandbox={window:{},document:{addEventListener(){}},setInterval(){}};vm.runInNewContext(client,sandbox);
 const {periodBounds,commandReport}=sandbox.window.IlhaDayUse;
 assert.equal(periodBounds('SEMANA','2026-10-07').from,'2026-10-01');
 assert.equal(periodBounds('MES','2026-10-07','2024-02').to,'2024-02-29');
 const snapshot={day:'2026-10-07',dateKey:v=>String(v||'').slice(0,10),orders:[{id:'a',status:'FECHADA',paymentStatus:'PAGO',closedAt:'2026-10-07'}],items:[{id:'i',orderId:'a',productId:'daily',quantity:1,unitPrice:30,status:'ENTREGUE',created:'2026-09-28'}],finance:[{orderId:'a',type:'RECEITA',status:'RECEBIDO',amount:30,paidAt:'2026-10-07T18:00:00Z'}]};
 const plans=[{product_id:'daily',kind:'DIARIO'}];
 assert.equal(commandReport(snapshot,plans).length,0,'old sale is not today sale');
 assert.equal(commandReport(snapshot,plans,{receivedOnly:true}).length,1,'old sale paid today must appear');
 snapshot.orders[0].paymentStatus='PARCIAL';
 assert.equal(commandReport(snapshot,plans,{receivedOnly:true}).length,0,'partial receipt is not full product payment');
});
test('UI requires named contacts, payment date/method and handles uncertain replies',()=>{
 assert.match(client,/Nome completo/);assert.match(client,/Telefone com DDD/);
 assert.match(client,/Confirmar pagamento recebido/);assert.match(client,/p_request_id=request.id/);
 assert.match(client,/if\(!saved\?\.id\)throw Error/);assert.match(client,/if\(epoch!==key\)return/);
 assert.match(client,/today\(\)>=row.expires_on/);
});
test('server controls price, day-based validity and writes one receipt atomically',()=>{
 assert.match(sql,/v_product.sale_price,p_paid_on,p_paid_on\+v_plan.duration_days/);
 assert.match(sql,/DIARIO' and duration_days=1/);assert.match(sql,/MENSAL' and duration_days=30/);
 assert.match(sql,/day_use_pass_id uuid unique/);assert.match(sql,/request_id uuid not null unique/);
 assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/bar_day_use_one_payment_per_day/);
 assert.doesNotMatch(sql,/update public.bar_products\s+set stock_quantity/);
});
test('PII and financial writes are permission-scoped and history cannot be directly altered',()=>{
 assert.equal((sql.match(/enable row level security/g)||[]).length,3);
 assert.match(sql,/revoke all on public.bar_day_use_plans,public.bar_day_use_customers,public.bar_day_use_passes from public,anon,authenticated/);
 assert.match(sql,/auth.uid\(\) is null or not public.has_bar_permission\('bar.orders'\)/);
 assert.match(sql,/create function public.bar_record_day_use[\s\S]*?language sql security invoker/);
 assert.match(sql,/create function private.bar_record_day_use[\s\S]*?security definer set search_path=''/);
 assert.match(sql,/set status='CANCELADO',updated_at=now\(\) where day_use_pass_id=p_id/);
});
