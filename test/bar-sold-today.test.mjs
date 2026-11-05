import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../adm/index.html',import.meta.url),'utf8');
function source(name){const start=html.indexOf('    function '+name+'(');assert.ok(start>=0,name);return html.slice(start,html.indexOf('\n    }',start)+6);}
function setup(){
 const state={barFinancePeriod:'monthly',barFinanceReportDate:'2000-01-01',barFinanceReportMonth:'2000-01'};
 const data={barOrders:[],barOrderItems:[],barProducts:[]},metric={textContent:''};
 const sandbox={Date,Intl,Map,Set,CLUB_TIME_ZONE:'America/Sao_Paulo',BAR_OPERATION_DAY_START_HOUR:6,opsState:state,opsData:data,
  pad2:n=>String(n).padStart(2,'0'),normalizeMatchText:s=>String(s).toLowerCase(),barProductById:()=>null,barOrderById:id=>data.barOrders.find(o=>o.id===id),
  money:n=>Number(n).toFixed(2),$:()=>metric};
 vm.createContext(sandbox);
 for(const name of ['clubDateTimeParts','shiftDateKey','barOperationalDateString','barOperationalDateKey','barFinanceProductGroup','barFinanceSalePeriodMatches','barFinanceActiveSaleGroups','barFinanceSoldInPeriod','renderBarSoldToday'])vm.runInContext(source(name),sandbox);
 const order=(id,extra={})=>data.barOrders.push({id,status:'ABERTA',source:'COMANDA',...extra});
 const item=(id,orderId,amount,created,extra={})=>data.barOrderItems.push({id,orderId,quantity:1,unitPrice:amount,status:'ENTREGUE',created,productCategory:'Bebidas',...extra});
 return {sandbox,state,data,metric,order,item};
}
test('vendidos hoje conta itens do dia em comandas abertas/fechadas e balcão, não recebimentos antigos',()=>{
 const t=setup(),now='2026-10-01T12:00:00-03:00',yesterday='2026-09-30T20:00:00-03:00';
 t.order('open',{openedAt:yesterday});t.order('closed',{status:'FECHADA',closedAt:now});t.order('counter',{status:'FECHADA',source:'BALCAO',closedAt:now});t.order('cancelled',{status:'CANCELADA'});
 t.item('new','open',10,now);t.item('old-open','open',100,yesterday);t.item('new-closed','closed',20,now);t.item('old-paid-today','closed',200,yesterday);
 t.item('counter-revision','counter',30,'2026-10-02T12:00:00-03:00');t.item('cancel-item','open',50,now,{status:'CANCELADO'});t.item('cancel-order','cancelled',80,now);
 const result=t.sandbox.barFinanceSoldInPeriod('daily','2026-10-01');assert.equal(result.amount,60);assert.equal(result.orderCount,3);
 const original=t.sandbox.barOperationalDateString;t.sandbox.barOperationalDateString=value=>value?original(value):'2026-10-01';t.sandbox.renderBarSoldToday();assert.equal(t.metric.textContent,'60.00');
});
test('parcelas de item dividido não duplicam venda nem mudam sua data original',()=>{
 const t=setup();t.order('a');t.order('b',{status:'FECHADA'});
 t.item('original','a',12,'2026-10-01T12:00:00-03:00',{quantity:.5});
 t.item('split','b',12,'2026-10-02T12:00:00-03:00',{quantity:.5,splitSourceItemId:'original'});
 assert.equal(t.sandbox.barFinanceSoldInPeriod('daily','2026-10-01').amount,12);
 assert.equal(t.sandbox.barFinanceSoldInPeriod('daily','2026-10-02').amount,0);
});
test('dia do Bar vira às 06h no fuso do clube e zera sem novas vendas',()=>{
 const t=setup();assert.equal(t.sandbox.barOperationalDateString('2026-10-02T08:59:59Z'),'2026-10-01');assert.equal(t.sandbox.barOperationalDateString('2026-10-02T09:00:00Z'),'2026-10-02');
 t.order('a');t.item('item','a',25,'2026-10-02T08:59:59Z');
 let day='2026-10-01';const original=t.sandbox.barOperationalDateString;t.sandbox.barOperationalDateString=value=>value?original(value):day;
 t.sandbox.renderBarSoldToday();assert.equal(t.metric.textContent,'25.00');day='2026-10-02';t.sandbox.renderBarSoldToday();assert.equal(t.metric.textContent,'0.00');
 assert.match(source('openBarModule'),/renderBarSoldToday\(\);\s*if \(!changed\) return/);
});
test('resumo preserva Previsto, compartilha o olhinho e não depende dos filtros de busca ou financeiro',()=>{
 const toolbar=html.slice(html.indexOf('<div class="bar-command-board-actions">'),html.indexOf('<section class="bar-command-board-section"',html.indexOf('<div class="bar-command-board-actions">')));
 assert.match(toolbar,/Previsto[\s\S]*Vendidos hoje[\s\S]*barCommandScreenBtn/);
 assert.match(toolbar,/bar-command-day-closing bar-command-sold-today/);
 assert.match(html,/not\(\.bar-values-visible\) \.bar-command-day-closing strong/);
 assert.match(source('renderBarSoldToday'),/barFinanceSoldInPeriod\('daily', barOperationalDateString\(\)\)/);
 assert.doesNotMatch(source('renderBarSoldToday'),/barCommandSearch|PaymentFilter|ReportDate/);
 assert.match(source('renderBarModule'),/renderBarSoldToday\(\)/);
});
test('snapshots inicial e ao vivo paginam todas as comandas de hoje, sem truncar em 200',()=>{
 const closed=html.split('\n').filter(l=>l.includes("barDatasetRequest('orders'")&&l.includes('status=eq.FECHADA&closed_at=gte.'));
 assert.equal(closed.length,2);for(const line of closed){assert.doesNotMatch(line,/limit=/);assert.match(line,/, true\)/);}
});
