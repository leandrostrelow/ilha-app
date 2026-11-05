begin;
do $test$
declare e uuid; a uuid; h uuid; f uuid; o public.bar_event_orders; req uuid:=gen_random_uuid(); rejected boolean:=false;
begin
 insert into public.bar_ticket_events(slug,event_date,status,sales_state,content,capacity_total) values('qa-age-'||gen_random_uuid(),'2026-10-29','PUBLICADO','OPEN','{"title":"QA rollback","time":"18:30"}',100) returning id into e;
 insert into public.bar_event_ticket_types(event_id,name,price_cents,capacity,active,min_age,max_age) values(e,'Integral',19500,100,true,15,null) returning id into a;
 insert into public.bar_event_ticket_types(event_id,name,price_cents,capacity,active,min_age,max_age) values(e,'Meia',9750,100,true,9,14) returning id into h;
 insert into public.bar_event_ticket_types(event_id,name,price_cents,capacity,active,min_age,max_age) values(e,'Gratuito',0,100,true,0,8) returning id into f;
 select * into o from public.event_reserve_order((select slug from public.bar_ticket_events where id=e),req,repeat('a',64),'qa','{"name":"QA","cpf":"52998224725","email":"qa@example.invalid","phone":"27999999999"}',jsonb_build_array(jsonb_build_object('ticket_type_id',a,'quantity',2),jsonb_build_object('ticket_type_id',f,'quantity',1)),jsonb_build_array(jsonb_build_object('ticket_type_id',a,'name','QA Adulto','age',15),jsonb_build_object('ticket_type_id',a,'name','QA Adulto B','age',50),jsonb_build_object('ticket_type_id',f,'name','QA Criança','age',8)),'SANDBOX');
 if o.total_cents<>39000 or o.quantity<>3 or o.status<>'CREATED' then raise exception 'mixed order failed'; end if;
 if (select count(*) from public.bar_event_tickets where order_id=o.id)<>3 then raise exception 'missing tickets'; end if;
 select * into o from public.event_reserve_order((select slug from public.bar_ticket_events where id=e),gen_random_uuid(),repeat('b',64),'qa','{"name":"QA","cpf":"52998224725","email":"qa@example.invalid","phone":"27999999999"}',jsonb_build_array(jsonb_build_object('ticket_type_id',h,'quantity',2)),jsonb_build_array(jsonb_build_object('ticket_type_id',h,'name','QA nove','age',9),jsonb_build_object('ticket_type_id',h,'name','QA quatorze','age',14)),'SANDBOX');
 if o.total_cents<>19500 then raise exception 'half price failed'; end if;
 select * into o from public.event_reserve_order((select slug from public.bar_ticket_events where id=e),gen_random_uuid(),repeat('c',64),'qa','{"name":"QA","cpf":"52998224725","email":"qa@example.invalid","phone":"27999999999"}',jsonb_build_array(jsonb_build_object('ticket_type_id',f,'quantity',1)),jsonb_build_array(jsonb_build_object('ticket_type_id',f,'name','QA Bebê','age',0)),'SANDBOX');
 if o.total_cents<>0 or o.status<>'PAID' or o.provider_status<>'FREE' or o.provider_payment_id is not null then raise exception 'free failed'; end if;
 begin
 perform public.event_reserve_order((select slug from public.bar_ticket_events where id=e),gen_random_uuid(),repeat('d',64),'qa','{"name":"QA","cpf":"52998224725","email":"qa@example.invalid","phone":"27999999999"}',jsonb_build_array(jsonb_build_object('ticket_type_id',f,'quantity',1)),jsonb_build_array(jsonb_build_object('ticket_type_id',f,'name','QA Invalido','age',9)),'SANDBOX');
 exception when others then if sqlerrm not like 'A idade%' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'age bypass'; end if;
 update public.bar_ticket_events set content=content || '{"freeRequiresAdult":true}' where id=e;
 rejected:=false;
 begin
 perform public.event_reserve_order((select slug from public.bar_ticket_events where id=e),gen_random_uuid(),repeat('f',64),'qa','{"name":"QA","cpf":"52998224725","email":"qa@example.invalid","phone":"27999999999"}',jsonb_build_array(jsonb_build_object('ticket_type_id',f,'quantity',1)),jsonb_build_array(jsonb_build_object('ticket_type_id',f,'name','QA Gratuito','age',8)),'SANDBOX');
 exception when others then if sqlerrm not like 'Para incluir crianças gratuitas%' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'free adult rule bypass'; end if;
 update public.bar_ticket_events set capacity_total=6 where id=e;
 rejected:=false;
 begin
 perform public.event_reserve_order((select slug from public.bar_ticket_events where id=e),gen_random_uuid(),repeat('e',64),'qa','{"name":"QA","cpf":"52998224725","email":"qa@example.invalid","phone":"27999999999"}',jsonb_build_array(jsonb_build_object('ticket_type_id',a,'quantity',1)),jsonb_build_array(jsonb_build_object('ticket_type_id',a,'name','QA Lotado','age',20)),'SANDBOX');
 exception when others then if sqlerrm not like 'O evento não tem vagas%' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'capacity bypass'; end if;
 update public.bar_ticket_events set capacity_total=null where id=e;
 update public.bar_event_ticket_types set capacity=null where event_id=e;
 select * into o from public.event_reserve_order((select slug from public.bar_ticket_events where id=e),gen_random_uuid(),repeat('a',64),'qa','{"name":"QA","cpf":"52998224725","email":"qa@example.invalid","phone":"27999999999"}',jsonb_build_array(jsonb_build_object('ticket_type_id',a,'quantity',1),jsonb_build_object('ticket_type_id',f,'quantity',1)),jsonb_build_array(jsonb_build_object('ticket_type_id',a,'name','QA Adulto','age',30),jsonb_build_object('ticket_type_id',f,'name','QA Filho','age',8)),'SANDBOX');
 if o.total_cents<>19500 or o.quantity<>2 or o.status<>'CREATED' then raise exception 'adult plus free with unlimited capacity failed'; end if;
 perform public.event_reconcile_payment(o.id,'qa-payment','SANDBOX','ilha-event:'||o.id,19500,'CONFIRMED');
 if not exists(select 1 from public.bar_event_orders where id=o.id and status='PAID') then raise exception 'payment reconciliation failed'; end if;
end $test$;
rollback;
