import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validCpf,validateEventCheckout,safeEventOrder} from '../supabase/functions/_shared/event-tickets.js';
const lot='11111111-1111-4111-8111-111111111111';
const body=()=>({request_id:'22222222-2222-4222-8222-222222222222',access_token:'a'.repeat(64),accepted:true,buyer:{name:'Pessoa Teste',email:'TESTE@example.com',phone:'(27) 99999-9999',cpf:'529.982.247-25'},items:[{ticket_type_id:lot,quantity:2}],attendees:[{ticket_type_id:lot,name:'Convidado A'},{ticket_type_id:lot,name:'Convidado B'}]});
test('age is normalized only as an integer; values and boundary ages are preserved for server pricing',()=>{
  for(const age of [0,8,9,14,15,120]){const b=body();b.attendees[0].age=age;assert.equal(validateEventCheckout(b).attendees[0].age,age);}
  for(const age of [-1,121,8.5,'8',NaN]){const b=body();b.attendees[0].age=age;assert.throws(()=>validateEventCheckout(b));}
});
test('free ticket guard precedes any payment provider access',async()=>{
  const s=await readFile(new URL('../supabase/functions/event-ticketing/index.ts',import.meta.url),'utf8');
  const payment=s.slice(s.indexOf('async function ensurePayment'));
  assert.ok(payment.indexOf('if(order.total_cents===0)return order;')<payment.indexOf('await paymentFor(order)'));
});
test('checkout normalizes buyer and ignores client-provided price',()=>{const b=body();b.total_cents=1;b.items[0].price_cents=1;const checked=validateEventCheckout(b);assert.equal(checked.buyer.email,'teste@example.com');assert.equal(checked.buyer.cpf,'52998224725');assert.deepEqual(checked.items,[{ticket_type_id:lot,quantity:2}]);assert.equal(checked.total_cents,undefined);});
test('CPF validates both digits and disallows repeated values',()=>{assert.equal(validCpf('52998224725'),true);for(const c of ['52998224726','11111111111','123','00000000000'])assert.equal(validCpf(c),false);});
test('checkout requires bounded quantities, matching named attendees, token and consent',()=>{for(const mutate of [b=>b.accepted=false,b=>b.access_token='123',b=>b.items[0].quantity=1.5,b=>b.items[0].quantity=0,b=>b.items[0].quantity=21,b=>b.items.push({...b.items[0]}),b=>b.attendees.pop(),b=>b.attendees[0].ticket_type_id='other',b=>b.attendees[0].name='',b=>b.buyer.email='bad',b=>b.buyer.cpf='11111111111']){const b=body();mutate(b);assert.throws(()=>validateEventCheckout(b));}});
test('wallet never exposes CPF or access hashes and hides unusable Pix',()=>{for(const status of ['CREATED','PENDING','PAID','CANCELLED','REFUNDED','REVIEW']){const o=safeEventOrder({status,buyer_cpf:'private',access_token_hash:'secret',request_hash:'secret',provider_payment_id:'private',pix_payload:'pix',pix_image:'image'});assert.equal(o.buyer_cpf,undefined);assert.equal(o.access_token_hash,undefined);assert.equal(o.request_hash,undefined);assert.equal(o.provider_payment_id,undefined);assert.equal(o.pix_payload,['CREATED','PENDING'].includes(status)?'pix':null);}});
test('server claims charge before POST and recovers ambiguous retries by reference',async()=>{const s=await readFile(new URL('../supabase/functions/event-ticketing/index.ts',import.meta.url),'utf8');assert.ok(s.indexOf('payment_attempted_at:new Date')<s.indexOf('storeProvider("/payments","POST"'));assert.match(s,/externalReference=/);assert.match(s,/body\.order_id\?"id":"request_id"/);assert.match(s,/event_metrics/);assert.match(s,/event_reserve_order/);assert.match(s,/result\.action!=="event_tickets"/);assert.match(s,/auth\.getUser\(token\)/);});
test('public checkout does not discard a previous order on an unknown network error',async()=>{const s=await readFile(new URL('../eventos/public.js',import.meta.url),'utf8');assert.match(s,/error\.status!==404/);assert.match(s,/crypto\.getRandomValues/);assert.match(s,/ILHA-EVENT:/);assert.match(s,/startPolling/);});
