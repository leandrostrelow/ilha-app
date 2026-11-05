import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({Intl, Date});
for (const name of ['isFinancePaid','isFinanceCancelled','financeReceiptDateKey','financeReceiptDay','financeReceiptMethod','financeReceiptRangeError','filteredFinanceReceipts']) {
  vm.runInContext(source.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0], ctx);
}
const row = {id:'receipt',type:'RECEITA',status:'RECEBIDO',counterparty:'João',source:'Mensalidade',amount:330,paidAt:'2026-10-09T01:30:00Z',due:'2026-11-30',competenceMonth:'2026-11-01',processingMethod:'ASAAS',paymentMethod:'PIX'};
test('data real de recebimento em Brasília; nunca usa vencimento ou competência',()=>{
  assert.equal(ctx.financeReceiptDay(row),'2026-10-08');
  assert.equal(ctx.financeReceiptDay({...row,paidAt:null}), '');
  assert.equal(ctx.financeReceiptDay({...row,receivedOn:'2026-09-30'}), '2026-09-30');
  assert.equal(ctx.financeReceiptDateKey('2026-10-09T03:00:00Z'),'2026-10-09');
  assert.equal(ctx.financeReceiptDateKey('2026-03-01T01:00:00Z'),'2026-02-28');
  assert.equal(ctx.financeReceiptDateKey('2026-02-30'),'');
  assert.equal(ctx.financeReceiptDateKey('2026-10-09T01:00:00'),'');
});
test('filtro inclusivo, só receitas pagas, busca sem acento e sem mutação',()=>{
  const rows=[row,{...row,id:'expense',type:'DESPESA'},{...row,id:'cancel',status:'CANCELADO'},
    {...row,id:'refund',status:'REFUNDED'},{...row,id:'pending',status:'ABERTO'},
    {...row,id:'nodate',paidAt:null},{...row,id:'tomorrow',paidAt:'2026-10-09T12:00:00-03:00'}];
  const before=JSON.stringify(rows);
  const filtered=ctx.filteredFinanceReceipts(rows,'2026-10-08','2026-10-08','ASAAS','joao');
  assert.equal(filtered.length,1);assert.equal(filtered[0].id,'receipt');
  assert.equal(ctx.filteredFinanceReceipts(rows,'2026-10-08','2026-10-09','all','').length,2);
  assert.equal(ctx.filteredFinanceReceipts(rows,'2026-10-09','2026-10-08','all','').length,0);
  assert.equal(JSON.stringify(rows),before);
});
test('baixa manual tem prioridade sobre marcador histórico Asaas',()=>{
  assert.equal(ctx.financeReceiptMethod({...row,paymentMethod:'CLUB_PIX'}),'CLUB_PIX');
  assert.equal(ctx.financeReceiptMethod({...row,paymentMethod:'CASH'}),'CASH');
  assert.equal(ctx.financeReceiptMethod({...row,processingMethod:'MANUAL'}),'CLUB_PIX');
  assert.equal(ctx.financeReceiptMethod({...row,processingMethod:'MANUAL',paymentMethod:'TRANSFERENCIA'}),'OTHER');
  assert.equal(ctx.filteredFinanceReceipts([{...row,paymentMethod:'CLUB_PIX'}],'2026-10-08','2026-10-08','ASAAS','').length,0);
});
test('exportação segue a lista filtrada, preserva centavos e bloqueia fórmula CSV',()=>{
  const fn=source.match(/    function exportFinanceReceipts\([^]*?\n    \}/)[0];
  assert.match(fn,/currentFinanceReceipts\(\)/);assert.match(fn,/toFixed\(2\)/);
  assert.match(fn,/quoteCsv/);assert.match(fn,/\[=\+@-\]/);
});

test('Postgres: vencimento compartilhado, permissões, concorrência e rollback atômico', {skip:!process.env.ILHA_PGLITE_PATH}, async()=>{
  const {PGlite}=await import(process.env.ILHA_PGLITE_PATH); const db=new PGlite();
  const payer='11111111-1111-4111-8111-111111111111', member='22222222-2222-4222-8222-222222222222', student='33333333-3333-4333-8333-333333333333';
  try {
    await db.exec(`create role anon; create role authenticated; create schema private; create schema auth;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create function public.has_club_permission(text) returns boolean language sql as $$ select position($1 in coalesce(current_setting('test.permissions',true),''))>0 $$;
      create table public.app_clients(id uuid primary key,full_name text,phone text,cpf text,birth_date date,weekly_lessons int,official_plan_id uuid,official_plan_code text,official_plan_name text,due_day int,updated_at timestamptz);
      create table public.app_family_members(id uuid primary key,status text,student_id uuid,billing_responsible_id uuid,member_client_id uuid,full_name text,phone text,cpf text,birth_date date,contact_responsible_name text,contact_responsible_phone text,notes text,monthly_amount numeric check(monthly_amount>=0));
      create table public.students(id uuid primary key,weekly_lessons int,plan_name text,updated_at timestamptz);
      create table public.app_plans(id uuid primary key,name text,code text);
      create table public.lesson_slots(id uuid primary key,active bool);
      create table public.lesson_enrollments(slot_id uuid,student_id uuid,active bool);
      create table public.app_payment_invoices(id int,amount numeric,due_date date,status text);
      insert into public.app_clients(id,full_name,due_day) values('${payer}','Responsável',20);
      insert into public.students values('${student}',1,'Plano existente',now());
      insert into public.app_family_members(id,status,student_id,billing_responsible_id,full_name,monthly_amount) values('${member}','ATIVO','${student}','${payer}','Dependente',350);
      insert into public.app_payment_invoices values(1,350,'2026-10-20','AGUARDANDO');
      grant usage on schema private,auth to authenticated;
      select set_config('test.uid','${payer}',false),set_config('test.permissions','clients.write finance.write',false);`);
    await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261009170307_dependent_billing_due_day.sql',import.meta.url),'utf8'));
    const update=patch=>db.query('select private.admin_update_family_student_impl($1,$2)',[member,JSON.stringify(patch)]);
    const day=async()=> (await db.query('select due_day from public.app_clients where id=$1',[payer])).rows[0].due_day;
    const invoices=JSON.stringify((await db.query('select * from public.app_payment_invoices')).rows);
    await db.exec('set role authenticated');
    await update({billing_due_day:25,expected_billing_due_day:20});
    await db.exec('reset role');assert.equal(await day(),25);
    await assert.rejects(update({billing_due_day:30,expected_billing_due_day:20}),/foi alterado/);
    for(const value of [0,32,-1,1.5,null,'20'])await assert.rejects(update({billing_due_day:value,expected_billing_due_day:25}),/1 e 31/);
    await assert.rejects(update({billing_due_day:20}),/recarregue/);
    await assert.rejects(update({billing_due_day:20,expected_billing_due_day:25,monthly_amount:-1}),/valor mensal/);
    assert.equal(await day(),25,'invalid profile change rolls back due day');
    await db.exec("select set_config('test.permissions','clients.write',false)");
    await assert.rejects(update({billing_due_day:20,expected_billing_due_day:25}),/Seu acesso/);
    await update({full_name:'Nome editado'});assert.equal(await day(),25);
    await db.exec("select set_config('test.permissions','finance.write',false)");
    await assert.rejects(update({billing_due_day:20,expected_billing_due_day:25}),/Seu acesso/);
    await db.exec("select set_config('test.permissions','clients.write finance.write',false);select set_config('test.uid','',false)");
    await assert.rejects(update({billing_due_day:20,expected_billing_due_day:25}),/Seu acesso/);
    assert.equal(JSON.stringify((await db.query('select * from public.app_payment_invoices')).rows),invoices);
    assert.equal((await db.query('select monthly_amount from public.app_family_members')).rows[0].monthly_amount,'350');
  } finally {await db.close();}
});
