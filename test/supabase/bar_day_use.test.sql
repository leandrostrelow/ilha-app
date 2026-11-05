begin;
-- Entire fixture is rolled back. No payment gateway or messaging calls.
do $$
declare
  staff uuid:=gen_random_uuid(); reader uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  email text; uid uuid; permission text;
  p public.bar_day_use_passes; again public.bar_day_use_passes; daily public.bar_day_use_passes;
  c public.bar_day_use_customers; req uuid:=gen_random_uuid(); rejected boolean;
  day date:=(now() at time zone 'America/Sao_Paulo')::date;
  stocks jsonb; latest_stocks jsonb;
begin
  foreach uid in array array[staff,reader,outsider] loop
    email:='qa-day-'||uid||'@tests.invalid';
    permission:=case uid when staff then 'bar.orders' when reader then 'bar.finance' else 'bar.kitchen' end;
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
      values(uid,email,'{"provider":"email","providers":["email"]}','{"full_name":"QA Day Use"}');
    insert into public.profiles(id,email,full_name,role,permissions,active)
      values(uid,email,'QA Day Use','bar',jsonb_build_array(permission),true)
      on conflict(id) do update set role='bar',permissions=excluded.permissions,active=true;
    insert into public.protected_access_accounts(email,full_name,role,permissions,active)
      values(email,'QA Day Use','bar',jsonb_build_array(permission),true);
  end loop;
  select jsonb_agg(jsonb_build_array(b.id,b.stock_quantity) order by b.id) into stocks
    from public.bar_products b join public.bar_day_use_plans d on b.id=d.product_id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
  perform set_config('role','authenticated',true);
  if not public.has_bar_permission('bar.orders') or public.has_bar_permission('bar.finance') then raise exception 'Wrong staff fixture permissions'; end if;
  p:=public.bar_record_day_use('QA Day Pessoa','27999990001','MENSAL',day,'DINHEIRO',req);
  if p.amount<>100 or p.expires_on<>day+30 or p.paid_on<>day then raise exception 'Wrong monthly amount/expiry'; end if;
  if (select count(*) from public.bar_financial_entries where day_use_pass_id=p.id and amount=100 and status='RECEBIDO' and payment_method='DINHEIRO' and category='Day Use mensal')<>1 then raise exception 'Receipt missing/duplicated'; end if;
  again:=public.bar_record_day_use('QA Day Pessoa','27999990001','MENSAL',day,'DINHEIRO',req);
  if again.id<>p.id then raise exception 'Retry duplicated pass'; end if;
  rejected:=false;
  begin perform public.bar_record_day_use('QA Day Pessoa','27999990001','MENSAL',day,'PIX',req);
  exception when others then if sqlerrm not like 'Esta tentativa%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Changed idempotency payload accepted'; end if;
  rejected:=false;
  begin perform public.bar_record_day_use('QA Day Pessoa','27999990001','MENSAL',day,'PIX',gen_random_uuid());
  exception when others then if sqlerrm not like 'Já existe%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Same-day duplicate accepted'; end if;
  foreach permission in array array['name','phone','date','method'] loop
    rejected:=false;
    begin perform public.bar_record_day_use(case permission when 'name' then 'Ana' else 'QA Valid Pessoa' end,
      case permission when 'phone' then '123' else '27999990002' end,'DIARIO',
      case permission when 'date' then day+1 else day end,case permission when 'method' then 'CARTAO' else 'PIX' end,gen_random_uuid());
    exception when others then rejected:=true; end;
    if not rejected then raise exception 'Invalid input accepted: %',permission; end if;
  end loop;
  daily:=public.bar_record_day_use('QA Day Pessoa','27999990001','DIARIO',day,'CARTAO_DEBITO',gen_random_uuid(),p.customer_id);
  if daily.amount<>30 or daily.expires_on<>day+1 or daily.customer_id<>p.customer_id then raise exception 'Daily price/date/person mismatch'; end if;
  select jsonb_agg(jsonb_build_array(b.id,b.stock_quantity) order by b.id) into latest_stocks
    from public.bar_products b join public.bar_day_use_plans d on b.id=d.product_id;
  if stocks<>latest_stocks then raise exception 'Service decreased stock'; end if;
  if (select sum(amount) from public.bar_financial_entries where day_use_pass_id in (p.id,daily.id) and status='RECEBIDO')<>130 then raise exception 'Bar total mismatch'; end if;
  rejected:=false;
  begin update public.bar_financial_entries set amount=1 where day_use_pass_id=p.id;
  exception when others then if sqlerrm not like 'Edite ou cancele%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Receipt amount tampered'; end if;
  rejected:=false;
  begin update public.bar_financial_entries set status='CANCELADO' where day_use_pass_id=p.id;
  exception when others then if sqlerrm not like 'O recebimento deve%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Receipt cancelled without pass'; end if;
  rejected:=false;
  begin insert into public.bar_financial_entries(type,description,amount,status) values('RECEITA','Unauthorized standalone',1,'RECEBIDO');
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Order staff gained unrelated finance write'; end if;
  rejected:=false;
  begin update public.bar_day_use_passes set amount=1 where id=p.id;
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Direct ledger mutation accepted'; end if;
  c:=public.bar_edit_day_use_customer(p.customer_id,'QA Day Pessoa Editada','27999990003');
  if c.phone<>'5527999990003' then raise exception 'Contact normalization failed'; end if;
  p:=public.bar_cancel_day_use(p.id,'Registro de teste cancelado');
  again:=public.bar_cancel_day_use(p.id,'Registro de teste cancelado');
  if p.cancelled_at is null or p.cancelled_at<>again.cancelled_at then raise exception 'Cancellation not idempotent'; end if;
  if (select sum(amount) from public.bar_financial_entries where day_use_pass_id in(p.id,daily.id) and status='RECEBIDO')<>30 then raise exception 'Cancelled revenue still counted'; end if;
  -- Renewal/payment clock: the expiry follows the real paid date, including month boundaries.
  again:=public.bar_record_day_use(c.full_name,c.phone,'MENSAL',day-30,'PIX',gen_random_uuid(),c.id);
  if again.expires_on<>day then raise exception 'Exactly 30 days should expire today'; end if;
  p:=public.bar_record_day_use(c.full_name,c.phone,'MENSAL',day,'PIX',gen_random_uuid(),c.id);
  if p.expires_on<>day+30 then raise exception 'Renewal must start on payment date'; end if;
  c:=public.bar_delete_day_use_customer(p.customer_id,'Cadastro de teste');
  if c.deleted_at is null or c.deleted_by<>staff then raise exception 'Removal audit missing'; end if;
  if exists(select 1 from public.bar_day_use_passes where customer_id=c.id and cancelled_at is null)
     or exists(select 1 from public.bar_financial_entries f join public.bar_day_use_passes d on d.id=f.day_use_pass_id where d.customer_id=c.id and f.status<>'CANCELADO') then
    raise exception 'Removal failed to cancel all passes/receipts';
  end if;
  if (public.bar_delete_day_use_customer(c.id,'Cadastro de teste')).deleted_at<>c.deleted_at then raise exception 'Removal retry is not idempotent'; end if;
  rejected:=false;
  begin perform public.bar_record_day_use(c.full_name,c.phone,'MENSAL',day,'PIX',gen_random_uuid(),c.id);
  exception when others then if sqlerrm not like 'Cadastro excluído%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Stale renewal reactivated deleted customer'; end if;
  -- Explicit new registration is recoverable; never revive old revenue.
  p:=public.bar_record_day_use(c.full_name,c.phone,'MENSAL',day,'PIX',gen_random_uuid());
  if p.customer_id<>c.id or (select deleted_at from public.bar_day_use_customers where id=c.id) is not null then raise exception 'New registration cannot recover contact'; end if;
  if (select count(*) from public.bar_day_use_passes where customer_id=c.id and cancelled_at is null)<>1 then raise exception 'Old revenue revived'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',reader,'role','authenticated')::text,true);
  if (select count(*) from public.bar_day_use_passes where id=p.id)<>1 then raise exception 'Finance reader cannot see pass'; end if;
  rejected:=false;
  begin perform public.bar_cancel_day_use(p.id,'Reader cannot cancel');
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Read-only finance user cancelled pass'; end if;
  rejected:=false;
  begin perform public.bar_delete_day_use_customer(c.id,'Reader cannot delete');
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Read-only finance user deleted customer'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated','user_metadata',jsonb_build_object('role','admin'))::text,true);
  if (select count(*) from public.bar_day_use_passes)<>0 or (select count(*) from public.bar_day_use_customers)<>0 then raise exception 'Unrelated staff read PII'; end if;
  rejected:=false;
  begin perform public.bar_record_day_use('QA Bad Actor','27999990004','MENSAL',day,'PIX',gen_random_uuid());
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Unauthorized user created pass'; end if;
  rejected:=false;
  begin perform public.bar_delete_day_use_customer(c.id,'Outsider cannot delete');
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Unauthorized user deleted customer'; end if;
  perform set_config('role','postgres',true);
  if has_function_privilege('anon','public.bar_record_day_use(text,text,text,date,text,uuid,uuid)','EXECUTE')
     or has_function_privilege('anon','public.bar_delete_day_use_customer(uuid,text)','EXECUTE')
     or has_table_privilege('anon','public.bar_day_use_customers','SELECT') then raise exception 'Anonymous access exposed'; end if;
end;
$$;
rollback;
