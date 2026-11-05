begin;
-- Local reservations only, all rolled back. No Edge Function, Asaas or email calls.
do $$
declare e uuid; a uuid; c uuid; h uuid; f uuid; slug text:='qa-couple-'||gen_random_uuid();
  o public.bar_event_orders; again public.bar_event_orders; req uuid:=gen_random_uuid();
  buyer jsonb:='{"name":"QA Couple","cpf":"52998224725","email":"qa@example.invalid","phone":"27999999999"}';
  people jsonb; items jsonb; rejected boolean; qty integer; admin_id uuid; ticket text; result jsonb;
begin
  insert into public.bar_ticket_events(slug,event_date,status,sales_state,content,max_per_order)
    values(slug,current_date+30,'PUBLICADO','OPEN','{"title":"QA rollback","time":"18:30","freeRequiresAdult":true}',10) returning id into e;
  insert into public.bar_event_ticket_types(event_id,name,price_cents,active,min_age,purchase_step)
    values(e,'Casal',17500,true,15,2) returning id into c;
  insert into public.bar_event_ticket_types(event_id,name,price_cents,active,min_age)
    values(e,'Individual',19500,true,15) returning id into a;
  insert into public.bar_event_ticket_types(event_id,name,price_cents,active,min_age,max_age)
    values(e,'Meia',9750,true,9,14) returning id into h;
  insert into public.bar_event_ticket_types(event_id,name,price_cents,active,min_age,max_age)
    values(e,'Gratuito',0,true,0,8) returning id into f;
  items:=jsonb_build_array(jsonb_build_object('ticket_type_id',c,'quantity',2,'price_cents',1));
  people:=jsonb_build_array(jsonb_build_object('ticket_type_id',c,'name','Pessoa Um','age',15),jsonb_build_object('ticket_type_id',c,'name','Pessoa Dois','age',35));
  o:=public.event_reserve_order(slug,req,repeat('a',64),'pair',buyer,items,people,'SANDBOX');
  if o.total_cents<>35000 or o.quantity<>2 then raise exception 'Wrong couple total/count'; end if;
  if (select count(distinct code) from public.bar_event_tickets where order_id=o.id)<>2 then raise exception 'Missing distinct individual tickets'; end if;
  if (select count(distinct attendee_name) from public.bar_event_tickets where order_id=o.id)<>2 then raise exception 'Missing both participant names'; end if;
  again:=public.event_reserve_order(slug,req,repeat('a',64),'pair',buyer,items,people,'SANDBOX');
  if again.id<>o.id then raise exception 'Duplicate couple order'; end if;
  for qty in 1..3 by 2 loop
    rejected:=false;
    begin perform public.event_reserve_order(slug,gen_random_uuid(),repeat('b',64),'odd',buyer,
      jsonb_build_array(jsonb_build_object('ticket_type_id',c,'quantity',qty)),people,'SANDBOX');
    exception when others then if sqlerrm not like 'O ingresso de casal%' then raise; end if; rejected:=true; end;
    if not rejected then raise exception 'Partial couple accepted'; end if;
  end loop;
  rejected:=false;
  begin perform public.event_reserve_order(slug,gen_random_uuid(),repeat('b',64),'age',buyer,items,jsonb_set(people,'{0,age}','14'),'SANDBOX');
  exception when others then if sqlerrm not like 'A idade%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Underage couple accepted'; end if;
  rejected:=false;
  begin perform public.event_reserve_order(slug,gen_random_uuid(),repeat('b',64),'name',buyer,items,people-1,'SANDBOX');
  exception when others then if sqlerrm not like 'Informe o nome%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'One name accepted for a couple'; end if;

  items:=items||jsonb_build_array(jsonb_build_object('ticket_type_id',f,'quantity',1),jsonb_build_object('ticket_type_id',h,'quantity',1));
  people:=people||jsonb_build_array(jsonb_build_object('ticket_type_id',f,'name','Criança Oito','age',8),jsonb_build_object('ticket_type_id',h,'name','Criança Nove','age',9));
  again:=public.event_reserve_order(slug,gen_random_uuid(),repeat('c',64),'family',buyer,items,people,'SANDBOX');
  if again.total_cents<>44750 or again.quantity<>4 then raise exception 'Couple plus children incorrect'; end if;
  if (select count(*) from public.bar_event_tickets where order_id=again.id)<>4 then raise exception 'Missing family tickets'; end if;
  rejected:=false;
  begin perform public.event_reserve_order(slug,gen_random_uuid(),repeat('d',64),'free',buyer,
    jsonb_build_array(jsonb_build_object('ticket_type_id',f,'quantity',1)),jsonb_build_array(jsonb_build_object('ticket_type_id',f,'name','Só Criança','age',8)),'SANDBOX');
  exception when others then if sqlerrm not like 'Para incluir crianças gratuitas%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Free-only order accepted'; end if;
  -- Existing six attendees leave only one slot: a pair cannot fit.
  update public.bar_ticket_events set capacity_total=7 where id=e;
  rejected:=false;
  begin perform public.event_reserve_order(slug,gen_random_uuid(),repeat('d',64),'full',buyer,
    jsonb_build_array(jsonb_build_object('ticket_type_id',c,'quantity',2)),people-3-2,'SANDBOX');
  exception when others then if sqlerrm not like 'O evento não tem vagas%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Couple counted as one capacity slot'; end if;
  update public.bar_ticket_events set capacity_total=null,max_per_order=1 where id=e;
  rejected:=false;
  begin perform public.event_reserve_order(slug,gen_random_uuid(),repeat('d',64),'limit',buyer,
    jsonb_build_array(jsonb_build_object('ticket_type_id',c,'quantity',2)),people-3-2,'SANDBOX');
  exception when others then if sqlerrm not like 'Limite de ingressos%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Couple bypassed per-order participant limit'; end if;
  update public.bar_ticket_events set max_per_order=10 where id=e;
  again:=public.event_reserve_order(slug,gen_random_uuid(),repeat('e',64),'individual',buyer,
    jsonb_build_array(jsonb_build_object('ticket_type_id',a,'quantity',2)),
    jsonb_build_array(jsonb_build_object('ticket_type_id',a,'name','Individual Um','age',15),jsonb_build_object('ticket_type_id',a,'name','Individual Dois','age',40)),'SANDBOX');
  if again.total_cents<>39000 then raise exception 'Individual price changed'; end if;
  update public.bar_event_ticket_types set price_cents=18000 where id=c;
  if (select total_cents from public.bar_event_orders where id=o.id)<>35000 then raise exception 'Historical price changed'; end if;
  rejected:=false;
  begin update public.bar_event_ticket_types set purchase_step=1 where id=c;
  exception when others then if sqlerrm not like 'Este ingresso já possui pedidos%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Historical format changed'; end if;
  perform public.event_reconcile_payment(o.id,'qa-couple-payment','SANDBOX','ilha-event:'||o.id,35000,'RECEIVED');
  select id into admin_id from public.profiles where role='admin' and active=true limit 1;
  if admin_id is null then raise exception 'Missing admin fixture context'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  perform set_config('role','authenticated',true);
  for ticket in select code from public.bar_event_tickets where order_id=o.id loop
    result:=public.event_checkin(e,ticket);
    if (result->>'already_checked_in')::boolean then raise exception 'First individual entry rejected'; end if;
    result:=public.event_checkin(e,ticket);
    if not (result->>'already_checked_in')::boolean then raise exception 'Duplicate entry accepted'; end if;
  end loop;
  if (select count(*) from public.bar_event_tickets where order_id=o.id and checked_in_at is not null)<>2 then raise exception 'Both couple entries not checked in'; end if;
  perform public.event_save((select to_jsonb(ev) from public.bar_ticket_events ev where id=e),
    (select jsonb_agg(to_jsonb(t)) from public.bar_event_ticket_types t where event_id=e));
  -- Older editors omitting the field cannot silently turn a couple into singles.
  perform public.event_save((select to_jsonb(ev) from public.bar_ticket_events ev where id=e),
    (select jsonb_agg(to_jsonb(t)-'purchase_step') from public.bar_event_ticket_types t where event_id=e));
  if (select purchase_step from public.bar_event_ticket_types where id=c)<>2 then raise exception 'Save lost couple format'; end if;
  perform set_config('role','postgres',true);
  if has_function_privilege('anon','public.event_reserve_order(text,uuid,text,text,jsonb,jsonb,jsonb,text)','EXECUTE')
    or has_function_privilege('authenticated','public.event_reserve_order(text,uuid,text,text,jsonb,jsonb,jsonb,text)','EXECUTE') then raise exception 'Direct public reservation bypass'; end if;
end;
$$;
rollback;
