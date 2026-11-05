begin;
-- Service passes have no physical inventory. Each paid pass creates exactly one
-- bar receipt; expiration is derived from the payment date, never a new charge.
create table public.bar_day_use_plans (
  kind text primary key check(kind in ('DIARIO','MENSAL')),
  product_id uuid not null unique references public.bar_products(id) on delete restrict,
  duration_days integer not null,
  check((kind='DIARIO' and duration_days=1) or (kind='MENSAL' and duration_days=30))
);
create table public.bar_day_use_customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check(length(full_name) between 5 and 120 and full_name ~ '\S+\s+\S+'),
  phone text not null check(phone ~ '^55[1-9][0-9]{9,10}$'),
  name_key text generated always as (lower(btrim(full_name))) stored,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(phone,name_key)
);
create index bar_day_use_customers_actor_idx on public.bar_day_use_customers(created_by);
create table public.bar_day_use_passes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.bar_day_use_customers(id) on delete restrict,
  kind text not null references public.bar_day_use_plans(kind) on delete restrict,
  product_id uuid not null references public.bar_products(id) on delete restrict,
  amount numeric(10,2) not null check(amount>0),
  paid_on date not null,
  expires_on date not null,
  payment_method text not null check(payment_method in ('PIX','DINHEIRO','CARTAO_CREDITO','CARTAO_DEBITO')),
  request_id uuid not null unique,
  payload_hash text not null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancel_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check(expires_on=paid_on+case kind when 'MENSAL' then 30 else 1 end),
  check((cancelled_at is null and cancel_reason is null) or (cancelled_at is not null and length(btrim(cancel_reason)) between 5 and 500))
);
create index bar_day_use_passes_customer_idx on public.bar_day_use_passes(customer_id,paid_on desc,created_at desc);
create index bar_day_use_passes_kind_expiry_idx on public.bar_day_use_passes(kind,expires_on) where cancelled_at is null;
create index bar_day_use_passes_product_idx on public.bar_day_use_passes(product_id);
create index bar_day_use_passes_actor_idx on public.bar_day_use_passes(created_by);
create index bar_day_use_passes_cancel_actor_idx on public.bar_day_use_passes(cancelled_by);
create unique index bar_day_use_one_payment_per_day on public.bar_day_use_passes(customer_id,kind,paid_on) where cancelled_at is null;
alter table public.bar_financial_entries add column day_use_pass_id uuid unique references public.bar_day_use_passes(id) on delete restrict;

alter table public.bar_day_use_plans enable row level security;
alter table public.bar_day_use_customers enable row level security;
alter table public.bar_day_use_passes enable row level security;
revoke all on public.bar_day_use_plans,public.bar_day_use_customers,public.bar_day_use_passes from public,anon,authenticated;
grant select on public.bar_day_use_plans,public.bar_day_use_customers,public.bar_day_use_passes to authenticated;
grant all on public.bar_day_use_plans,public.bar_day_use_customers,public.bar_day_use_passes to service_role;
create policy day_plans_staff_read on public.bar_day_use_plans for select to authenticated
  using((select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.finance')));
create policy day_customers_staff_read on public.bar_day_use_customers for select to authenticated
  using((select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.finance')));
create policy day_passes_staff_read on public.bar_day_use_passes for select to authenticated
  using((select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.finance')));

-- Explicit product binding: historical bar sales are not reimported or charged.
do $$
declare daily_id uuid; monthly_id uuid;
begin
  if (select count(*) from public.bar_products where lower(btrim(name))='day use' and lower(category)='beach')<>1 then
    raise exception 'Confira o produto Day Use / Beach antes de configurar.';
  end if;
  select id into daily_id from public.bar_products where lower(btrim(name))='day use' and lower(category)='beach';
  if not exists(select 1 from public.bar_products where id=daily_id and sale_price=30 and active) then
    raise exception 'Confira o preço diário de R$30 e a disponibilidade do produto.';
  end if;
  if exists(select 1 from public.bar_products where lower(btrim(name))='day use mensal') then
    raise exception 'Day Use mensal já existe. Confira antes de criar.';
  end if;
  insert into public.bar_products(name,category,sale_price,cost_price,stock_quantity,active,menu_visible,menu_tv_visible)
    values('Day Use mensal','Beach',100,0,0,true,false,false) returning id into monthly_id;
  insert into public.bar_day_use_plans(kind,product_id,duration_days) values('DIARIO',daily_id,1),('MENSAL',monthly_id,30);
end;
$$;

-- Order staff may record only the linked Day Use receipt without gaining
-- permission to insert unrelated standalone financial entries.
do $$
declare def text; needle text := '(case when tg_op = ''DELETE'' then old.order_id else new.order_id end) is null';
begin
  def:=pg_get_functiondef('public.guard_bar_staff_table_write()'::regprocedure);
  if position(needle in def)=0 then raise exception 'Unexpected staff finance guard'; end if;
  def:=replace(def,needle,'((case when tg_op = ''DELETE'' then old.order_id else new.order_id end) is null and (case when tg_op = ''DELETE'' then old.day_use_pass_id else new.day_use_pass_id end) is null)');
  execute def;
end;
$$;

create function private.guard_day_use_finance() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p public.bar_day_use_passes; person public.bar_day_use_customers;
begin
  if tg_op<>'INSERT' and old.day_use_pass_id is not null then
    if tg_op='DELETE' then raise exception 'Cancele o pagamento no painel Day Use; não apague o histórico.'; end if;
    if (to_jsonb(new)-'status'-'updated_at') is distinct from (to_jsonb(old)-'status'-'updated_at') then
      raise exception 'Edite ou cancele pelo painel Day Use.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.day_use_pass_id is null then return new; end if;
  select * into strict p from public.bar_day_use_passes where id=new.day_use_pass_id;
  select * into strict person from public.bar_day_use_customers where id=p.customer_id;
  if new.order_id is not null or new.type<>'RECEITA' or new.amount<>p.amount
    or new.payment_method is distinct from p.payment_method or new.due_date is distinct from p.paid_on
    or new.category is distinct from ('Day Use '||case p.kind when 'MENSAL' then 'mensal' else 'diário' end)
    or new.status is distinct from (case when p.cancelled_at is null then 'RECEBIDO' else 'CANCELADO' end)
    or new.paid_at is distinct from ((p.paid_on+time '12:00') at time zone 'America/Sao_Paulo')
    or (tg_op='INSERT' and new.counterparty is distinct from person.full_name) then
    raise exception 'O recebimento deve corresponder ao pagamento do Day Use.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_day_use_finance() from public,anon,authenticated;
create trigger guard_day_use_finance before insert or update or delete on public.bar_financial_entries
  for each row execute function private.guard_day_use_finance();

-- Private privileged implementations keep the ledger read-only via REST. They
-- require the signed-in staff permission before touching any data. Public RPCs
-- are SECURITY INVOKER wrappers; no user metadata is trusted for authorization.
create function private.bar_record_day_use(p_name text,p_phone text,p_kind text,p_paid_on date,p_payment_method text,p_request_id uuid,p_customer_id uuid default null)
returns public.bar_day_use_passes language plpgsql security definer set search_path='' as $$
declare
  v_name text:=regexp_replace(btrim(p_name),'\s+',' ','g');
  v_phone text:=regexp_replace(p_phone,'[^0-9]','','g');
  v_hash text; v_person public.bar_day_use_customers; v_pass public.bar_day_use_passes;
  v_product public.bar_products; v_plan public.bar_day_use_plans;
  today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.uid() is null or not public.has_bar_permission('bar.orders') then raise exception 'Sem permissão para registrar Day Use.' using errcode='42501'; end if;
  if length(v_phone) in (10,11) then v_phone:='55'||v_phone; end if;
  if v_name is null or length(v_name) not between 5 and 120 or v_name !~ '\S+\s+\S+' or v_phone is null or v_phone !~ '^55[1-9][0-9]{9,10}$' then
    raise exception 'Informe o nome completo e um telefone válido com DDD.';
  end if;
  if p_request_id is null or p_paid_on is null or p_paid_on>today or p_paid_on<date '2020-01-01'
    or p_payment_method is null or p_payment_method not in ('PIX','DINHEIRO','CARTAO_CREDITO','CARTAO_DEBITO') then
    raise exception 'Confira a data de pagamento e a forma recebida. Pagamentos futuros não são permitidos.';
  end if;
  v_hash:=md5(jsonb_build_array(v_name,v_phone,p_kind,p_paid_on,p_payment_method,p_customer_id)::text);
  perform pg_advisory_xact_lock(hashtextextended('day-use:'||p_request_id::text,0));
  select * into v_pass from public.bar_day_use_passes where request_id=p_request_id;
  if found then
    if v_pass.payload_hash<>v_hash then raise exception 'Esta tentativa já foi usada. Reabra o formulário para registrar outro pagamento.'; end if;
    return v_pass;
  end if;
  select * into strict v_plan from public.bar_day_use_plans where kind=p_kind;
  select * into strict v_product from public.bar_products where id=v_plan.product_id for share;
  if not v_product.active or v_product.sale_price<=0 then raise exception 'Este Day Use está indisponível nos produtos do bar.'; end if;
  if p_customer_id is null then
    insert into public.bar_day_use_customers(full_name,phone,created_by) values(v_name,v_phone,auth.uid())
      on conflict(phone,name_key) do update set updated_at=now() returning * into v_person;
  else
    select * into strict v_person from public.bar_day_use_customers where id=p_customer_id for update;
    if v_person.full_name<>v_name or v_person.phone<>v_phone then raise exception 'O cadastro mudou. Atualize os dados antes de registrar o pagamento.'; end if;
  end if;
  if exists(select 1 from public.bar_day_use_passes where customer_id=v_person.id and kind=p_kind and paid_on=p_paid_on and cancelled_at is null) then
    raise exception 'Já existe um Day Use deste tipo pago nesta data para esta pessoa.';
  end if;
  insert into public.bar_day_use_passes(customer_id,kind,product_id,amount,paid_on,expires_on,payment_method,request_id,payload_hash,created_by)
    values(v_person.id,p_kind,v_product.id,v_product.sale_price,p_paid_on,p_paid_on+v_plan.duration_days,p_payment_method,p_request_id,v_hash,auth.uid()) returning * into v_pass;
  insert into public.bar_financial_entries(day_use_pass_id,type,description,counterparty,category,amount,due_date,status,payment_method,paid_at,created_by)
    values(v_pass.id,'RECEITA','Day Use '||case p_kind when 'MENSAL' then 'mensal · 30 dias' else 'diário' end||' · '||v_person.full_name,
      v_person.full_name,'Day Use '||case p_kind when 'MENSAL' then 'mensal' else 'diário' end,v_pass.amount,p_paid_on,'RECEBIDO',p_payment_method,
      (p_paid_on+time '12:00') at time zone 'America/Sao_Paulo',auth.uid());
  return v_pass;
end;
$$;
create function public.bar_record_day_use(p_name text,p_phone text,p_kind text,p_paid_on date,p_payment_method text,p_request_id uuid,p_customer_id uuid default null)
returns public.bar_day_use_passes language sql security invoker set search_path='' as $$
  select private.bar_record_day_use(p_name,p_phone,p_kind,p_paid_on,p_payment_method,p_request_id,p_customer_id);
$$;

create function private.bar_cancel_day_use(p_id uuid,p_reason text) returns public.bar_day_use_passes
language plpgsql security definer set search_path='' as $$
declare p public.bar_day_use_passes;
begin
  if auth.uid() is null or not public.has_bar_permission('bar.orders') then raise exception 'Sem permissão para cancelar Day Use.' using errcode='42501'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'Informe o motivo do cancelamento (5 a 500 caracteres).'; end if;
  select * into strict p from public.bar_day_use_passes where id=p_id for update;
  if p.cancelled_at is not null then return p; end if;
  update public.bar_day_use_passes set cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=btrim(p_reason) where id=p_id returning * into p;
  update public.bar_financial_entries set status='CANCELADO',updated_at=now() where day_use_pass_id=p_id;
  if not found then raise exception 'Recebimento não encontrado. Cancelamento não concluído.'; end if;
  return p;
end;
$$;
create function public.bar_cancel_day_use(p_id uuid,p_reason text) returns public.bar_day_use_passes
language sql security invoker set search_path='' as $$ select private.bar_cancel_day_use(p_id,p_reason); $$;

create function private.bar_edit_day_use_customer(p_id uuid,p_name text,p_phone text) returns public.bar_day_use_customers
language plpgsql security definer set search_path='' as $$
declare person public.bar_day_use_customers; phone_value text:=regexp_replace(p_phone,'[^0-9]','','g');
begin
  if auth.uid() is null or not public.has_bar_permission('bar.orders') then raise exception 'Sem permissão para editar Day Use.' using errcode='42501'; end if;
  if length(phone_value) in (10,11) then phone_value:='55'||phone_value; end if;
  update public.bar_day_use_customers set full_name=regexp_replace(btrim(p_name),'\s+',' ','g'),phone=phone_value,updated_at=now() where id=p_id returning * into strict person;
  return person;
end;
$$;
create function public.bar_edit_day_use_customer(p_id uuid,p_name text,p_phone text) returns public.bar_day_use_customers
language sql security invoker set search_path='' as $$ select private.bar_edit_day_use_customer(p_id,p_name,p_phone); $$;

revoke all on function private.bar_record_day_use(text,text,text,date,text,uuid,uuid),public.bar_record_day_use(text,text,text,date,text,uuid,uuid),
  private.bar_cancel_day_use(uuid,text),public.bar_cancel_day_use(uuid,text),
  private.bar_edit_day_use_customer(uuid,text,text),public.bar_edit_day_use_customer(uuid,text,text) from public,anon,authenticated;
grant execute on function private.bar_record_day_use(text,text,text,date,text,uuid,uuid),public.bar_record_day_use(text,text,text,date,text,uuid,uuid),
  private.bar_cancel_day_use(uuid,text),public.bar_cancel_day_use(uuid,text),
  private.bar_edit_day_use_customer(uuid,text,text),public.bar_edit_day_use_customer(uuid,text,text) to authenticated;
commit;
