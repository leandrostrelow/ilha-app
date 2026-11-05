import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20260915132116_ilha_store_pix_orders.sql');
const guestPixSql = read('supabase/migrations/20260919133002_store_guest_static_pix.sql');
const edge = read('supabase/functions/store-checkout/index.ts');
const provider = read('supabase/functions/_shared/store-payment.ts');
test('checkout authenticates identity, derives prices on server and claims before provider POST', () => {
  assert.match(edge, /auth.getUser\(token\)/);
  assert.match(edge, /has_club_permission/);
  assert.match(edge, /presencial && !staff/);
  assert.match(sql, /p.sale_price\*p_quantity/);
  assert.doesNotMatch(edge, /body\.(?:amount|price|total)/);
  const claimIndex = edge.indexOf('payment_attempted_at: attemptedAt');
  assert.ok(claimIndex >= 0 && claimIndex < edge.indexOf('storeProvider("/payments", "POST"'));
  assert.match(edge, /!order.payment_attempted_at/);
});
test('stock reservations and provider state changes are service-only and row-locked', () => {
  assert.match(sql, /revoke all on public.app_store_orders from public,anon,authenticated/);
  assert.match(sql, /revoke all on function public.store_reconcile_payment[^;]+from public,anon,authenticated/);
  assert.match(sql, /where id=p_product for update/);
  assert.match(sql, /stock_quantity<p_quantity/);
  assert.match(sql, /p_amount is distinct from o.total/);
  assert.match(sql, /p_status='RECEIVED'/);
  assert.match(sql, /o.stock_reserved and o.delivered_at is null/);
});
test('both interfaces use a shared checkout and admin has separate sections', () => {
  for (const file of ['index.html', 'adm/index.html']) assert.match(read(file), /store-commerce.js/);
  const admin = read('adm/index.html');
  for (const tab of ['catalog','orders','pos']) assert.ok(admin.includes('data-store-tab="' + tab + '"'));
  assert.match(admin, /updated_at=eq\./);
  assert.match(read('store-commerce.js'), /navigator.clipboard.writeText\(order.pix_payload\)/);
});

test('venda avulsa presencial gera Pix Asaas de uso único sem CPF', () => {
  const frontend = read('store-commerce.js');
  assert.match(frontend, /Venda avulsa: informe somente o nome/);
  assert.doesNotMatch(frontend, /name="customer_cpf"|name="customer_phone"/);
  assert.match(edge, /presencial \? body\.client_id \|\| null : auth\.user\.id/);
  assert.match(edge, /order\.payment_flow === "STATIC_QR"/);
  assert.match(edge, /storeProvider\("\/pix\/qrCodes\/static", "POST"/);
  assert.match(edge, /allowsMultiplePayments: false/);
  assert.match(edge, /value: Number\(order\.total\)/);
  assert.match(edge, /externalReference: reference/);
  assert.match(edge, /payments\?pixQrCodeId=/);
  assert.match(frontend, /provider_check: silent !== true/);
  assert.match(edge, /action === "cancel" \|\| body\.provider_check === true/);
  assert.match(edge, /store_cancel_static_qr/);
  assert.match(guestPixSql, /payment_flow in \('CHARGE','STATIC_QR'\)/);
  assert.match(guestPixSql, /case when p_source='PRESENCIAL' and p_client is null then 'STATIC_QR'/);
  assert.match(guestPixSql, /create unique index if not exists app_store_orders_provider_qr_unique/);
  assert.match(guestPixSql, /provider_payment_id is not null/);
  assert.match(provider, /payment\.pixQrCodeId/);
});

test('Postgres: reservations, repeats, overselling, refunds, cancellation and RLS', { skip: !process.env.ILHA_PGLITE_PATH }, async () => {
  const { PGlite } = await import(process.env.ILHA_PGLITE_PATH);
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create function public.has_club_permission(text) returns boolean language sql as 'select false';
      create table auth.users(id uuid primary key);
      create table public.app_clients(id uuid primary key);
      create table public.app_store_products(id uuid primary key default gen_random_uuid(),name text,active boolean default true,sale_price numeric,
        stock_quantity integer check(stock_quantity>=0),track_stock boolean,updated_at timestamptz);
      grant usage on schema public,auth to authenticated,service_role;
      grant all on all tables in schema public,auth to service_role;
      insert into auth.users values ('11111111-1111-4111-8111-111111111111');
      insert into public.app_clients values ('11111111-1111-4111-8111-111111111111');
      insert into public.app_store_products(id,name,sale_price,stock_quantity,track_stock) values('22222222-2222-4222-8222-222222222222','Camisa M',60,3,true);`);
    await db.exec(sql + '\n' + guestPixSql);
    const reserve = async (request, quantity) => (await db.query(`select * from public.store_reserve_order(
      '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','Teste','APP',$1,
      '22222222-2222-4222-8222-222222222222',$2,'SANDBOX')`, [request,quantity])).rows[0];
    const stock = async () => (await db.query('select stock_quantity from public.app_store_products')).rows[0].stock_quantity;
    const reconcile = async (o, status, amount = o.total) => (await db.query('select * from public.store_reconcile_payment($1,$2,$3,$4,$5,$6)',
      [o.id,'pay_'+o.id,'SANDBOX','ilha-store:'+o.id,amount,status])).rows[0];
    const first = await reserve('33333333-3333-4333-8333-333333333333',2);
    assert.equal(Number(first.total),120); assert.equal(await stock(),1);
    assert.equal((await reserve('33333333-3333-4333-8333-333333333333',2)).id,first.id);
    assert.equal(await stock(),1);
    await assert.rejects(reserve('44444444-4444-4444-8444-444444444444',2), /Estoque insuficiente/);
    await assert.rejects(reconcile(first,'RECEIVED',1), /não corresponde/);
    assert.equal((await reconcile(first,'CONFIRMED')).status,'PENDING');
    assert.equal((await reconcile(first,'RECEIVED')).status,'PAID');
    assert.equal((await reconcile(first,'RECEIVED')).status,'PAID'); assert.equal(await stock(),1);
    await reconcile(first,'REFUNDED'); assert.equal(await stock(),3);
    await reconcile(first,'REFUNDED'); assert.equal(await stock(),3);
    assert.equal((await reconcile(first,'RECEIVED')).status,'REVIEW');
    const second = await reserve('55555555-5555-4555-8555-555555555555',1);
    await reconcile(second,'RECEIVED');
    await db.query('update public.app_store_orders set delivered_at=now() where id=$1',[second.id]);
    await reconcile(second,'REFUNDED'); assert.equal(await stock(),2);
    const third = await reserve('66666666-6666-4666-8666-666666666666',1);
    await db.query('select public.store_cancel_unattempted($1)',[third.id]); assert.equal(await stock(),2);
    const fourth = await reserve('77777777-7777-4777-8777-777777777777',1);
    await db.query('update public.app_store_orders set payment_attempted_at=now() where id=$1',[fourth.id]);
    await assert.rejects(db.query('select public.store_cancel_unattempted($1)',[fourth.id]));
    assert.equal(await stock(),1);
    await db.exec('set role authenticated');
    assert.equal((await db.query('select * from public.app_store_orders')).rows.length,0);
    await assert.rejects(db.query("update public.app_store_orders set status='PAID'"),/permission denied/);
    await assert.rejects(reserve('88888888-8888-4888-8888-888888888888',1),/permission denied/);
  } finally { await db.close(); }
});
