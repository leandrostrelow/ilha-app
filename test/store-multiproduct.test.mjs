import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
const read = file => readFileSync(new URL('../'+file,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261009142242_store_multi_product_orders.sql');
const actor='11111111-1111-4111-8111-111111111111';
const jacket='22222222-2222-4222-8222-222222222222';
const shirt='33333333-3333-4333-8333-333333333333';
const untracked='44444444-4444-4444-8444-444444444444';
test('multi-product checkout uses server prices, one request and detailed items',()=>{
  const edge=read('supabase/functions/store-checkout/index.ts'),ui=read('store-commerce.js');
  assert.match(edge,/store_reserve_cart/);
  assert.match(edge,/items:app_store_order_items/);
  assert.equal((edge.match(/storeProvider\("\/payments", "POST"/g)||[]).length,1);
  assert.equal((edge.match(/storeProvider\("\/pix\/qrCodes\/static", "POST"/g)||[]).length,1);
  assert.doesNotMatch(edge,/body\.(?:total|amount|price)/);
  assert.match(ui,/data-add-product/);assert.match(ui,/data-remove-product/);
  assert.match(ui,/items: cart.map/);assert.match(ui,/itemSummary\(order\)/);
  assert.match(migration,/order by product_id/);
});

test('Postgres carts: atomic stock, immutable totals, legacy orders, retries, all cancellation paths and RLS', {skip:!process.env.ILHA_PGLITE_PATH},async()=>{
  const {PGlite}=await import(process.env.ILHA_PGLITE_PATH);const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create function auth.uid() returns uuid language sql as 'select null::uuid';
      create function public.has_club_permission(text) returns boolean language sql as 'select false';
      create table auth.users(id uuid primary key);create table public.app_clients(id uuid primary key);
      create table public.app_store_products(id uuid primary key,name text,active boolean default true,sale_price numeric,
        stock_quantity integer check(stock_quantity>=0),track_stock boolean,updated_at timestamptz);
      grant usage on schema public,auth to authenticated,service_role;
      grant all on all tables in schema public,auth to service_role;
      insert into auth.users values('${actor}');insert into public.app_clients values('${actor}');
      insert into public.app_store_products values('${jacket}','Jaqueta',true,150.50,20,true,now()),
        ('${shirt}','Camisa',true,60,20,true,now()),('${untracked}','Serviço',true,10,0,false,now());`);
    await db.exec(read('supabase/migrations/20260915132116_ilha_store_pix_orders.sql')+'\n'+read('supabase/migrations/20260919133002_store_guest_static_pix.sql'));
    const old=(await db.query(`select * from public.store_reserve_order('${actor}','${actor}','Teste','APP',$1,'${jacket}',1,'SANDBOX')`,[randomUUID()])).rows[0];
    await db.exec(migration);
    assert.equal((await db.query('select * from public.app_store_order_items where order_id=$1',[old.id])).rows.length,1,'legacy backfill');
    await db.query('select public.store_cancel_unattempted($1)',[old.id]);
    const stock=async()=> (await db.query('select id,stock_quantity from public.app_store_products order by id')).rows.map(r=>r.stock_quantity);
    const reserve=async(items,request=randomUUID(),client=actor,name='Teste')=>(await db.query(
      `select * from public.store_reserve_cart($1,$2,$3,'PRESENCIAL',$4,$5,'SANDBOX')`,[actor,client,name,request,JSON.stringify(items)])).rows[0];
    const reconcile=async(o,status,amount=o.total)=>(await db.query('select * from public.store_reconcile_payment($1,$2,$3,$4,$5,$6)',
      [o.id,'pay_'+o.id,'SANDBOX','ilha-store:'+o.id,amount,status])).rows[0];
    const lines=[{product_id:jacket,quantity:1,price:0.01},{product_id:shirt,quantity:2,total:0.01},{product_id:untracked,quantity:1}];
    const request=randomUUID(),o=await reserve(lines,request);
    assert.equal(Number(o.total),280.50);assert.equal(o.quantity,4);assert.equal(o.product_id,null);
    assert.deepEqual(await stock(),[19,18,0]);
    assert.equal((await reserve([...lines].reverse(),request)).id,o.id);assert.deepEqual(await stock(),[19,18,0]);
    await assert.rejects(reserve(lines.slice(1),request),/outros dados/);
    await assert.rejects(reserve(lines,request,null),/outros dados/);
    await assert.rejects(reserve(lines,request,actor,'Outra pessoa'),/outros dados/);
    for(const invalid of [[],null,{},[{product_id:jacket,quantity:0}],[{product_id:jacket,quantity:1.5}],[{product_id:jacket,quantity:'1'}],
      [{product_id:jacket,quantity:30},{product_id:jacket,quantity:21}]]) await assert.rejects(reserve(invalid));
    await assert.rejects(reserve([{product_id:jacket,quantity:1},{product_id:shirt,quantity:50}]),/50 unidades/);
    await assert.rejects(reserve([{product_id:jacket,quantity:1},{product_id:shirt,quantity:20}]),/Estoque insuficiente/);
    await assert.rejects(reserve([{product_id:jacket,quantity:1},{product_id:randomUUID(),quantity:1}]),/indisponível/);
    assert.deepEqual(await stock(),[19,18,0],'invalid cart must not reserve any SKU');
    await db.query('update public.app_store_products set sale_price=999 where id=$1',[jacket]);
    assert.equal(Number((await reserve(lines,request)).total),280.50,'retry retains price snapshot');
    await assert.rejects(reconcile(o,'RECEIVED',1),/não corresponde/);
    assert.equal((await reconcile(o,'CONFIRMED')).status,'PENDING');
    assert.equal((await reconcile(o,'RECEIVED')).status,'PAID');
    assert.equal((await reconcile(o,'RECEIVED')).status,'PAID');
    await reconcile(o,'REFUNDED');await reconcile(o,'REFUNDED');assert.deepEqual(await stock(),[20,20,0]);
    assert.equal((await reconcile(o,'RECEIVED')).status,'REVIEW','late receipt must not resell returned stock');
    const delivered=await reserve(lines);await reconcile(delivered,'RECEIVED');
    await db.query('update public.app_store_orders set delivered_at=now() where id=$1',[delivered.id]);
    await reconcile(delivered,'REFUNDED');assert.deepEqual(await stock(),[19,18,0],'delivered goods are not restocked');
    const unpaid=await reserve(lines);await db.query('select public.store_cancel_unattempted($1)',[unpaid.id]);
    assert.deepEqual(await stock(),[19,18,0]);
    const deleted=await reserve(lines);await reconcile(deleted,'DELETED');await reconcile(deleted,'DELETED');assert.deepEqual(await stock(),[19,18,0]);
    const guest=await reserve(lines,randomUUID(),null);assert.equal(guest.payment_flow,'STATIC_QR');
    await db.query("select public.store_attach_static_qr($1,'qr_test','payload','image','')",[guest.id]);
    await db.query("select public.store_cancel_static_qr($1,'qr_test')",[guest.id]);assert.deepEqual(await stock(),[19,18,0]);
    const merged=await reserve([{product_id:shirt,quantity:1},{product_id:shirt,quantity:2}]);
    const mergedItems=(await db.query('select * from public.app_store_order_items where order_id=$1',[merged.id])).rows;
    assert.equal(mergedItems.length,1);assert.equal(mergedItems[0].quantity,3);
    await db.query('select public.store_cancel_unattempted($1)',[merged.id]);
    const legacy=(await db.query(`select * from public.store_reserve_order('${actor}','${actor}','Teste','APP',$1,'${shirt}',1,'SANDBOX')`,[randomUUID()])).rows[0];
    assert.equal(legacy.product_id,shirt);assert.equal(Number(legacy.total),60);
    await db.query('select public.store_cancel_unattempted($1)',[legacy.id]);assert.deepEqual(await stock(),[19,18,0]);
    await assert.rejects(db.query('delete from public.app_store_products where id=$1',[shirt]),/foreign key/);
    await db.exec('set role authenticated');
    assert.equal((await db.query('select * from public.app_store_order_items')).rows.length,0);
    await assert.rejects(db.query('update public.app_store_order_items set quantity=1'),/permission denied/);
    await assert.rejects(reserve(lines),/permission denied/);
    await assert.rejects(db.query("select public.store_release_cart_stock($1,'TEST')",[guest.id]),/permission denied/);
  }finally{await db.close();}
});
