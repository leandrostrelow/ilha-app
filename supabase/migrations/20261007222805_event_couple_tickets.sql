begin;
-- Quantities and prices remain per attendee in orders, inventory and payments.
-- A couple is sold only in pairs: 2 x R$175 = R$350, with two distinct QR codes.
alter table public.bar_event_ticket_types add column purchase_step smallint not null default 1
  check(purchase_step in (1,2));
comment on column public.bar_event_ticket_types.purchase_step is
  'Attendees per purchase option. price_cents is per attendee; displayed option price = price_cents * purchase_step.';

do $$
declare definition text; needle text;
begin
  definition:=pg_get_functiondef('public.event_reserve_order(text,uuid,text,text,jsonb,jsonb,jsonb,text)'::regprocedure);
  needle:='    select coalesce(sum(i.quantity),0) into v_held';
  if position(needle in definition)=0 then raise exception 'Unexpected reservation definition'; end if;
  definition:=replace(definition,needle,$guard$
    if v_qty % v_type.purchase_step <> 0 then
      raise exception 'O ingresso de casal deve incluir duas pessoas por unidade.';
    end if;
    select coalesce(sum(i.quantity),0) into v_held$guard$);
  definition:=replace(definition,
    'Para incluir crianças gratuitas, compre ao menos um ingresso integral de adulto no mesmo pedido.',
    'Para incluir crianças gratuitas, adicione um ingresso individual ou de casal no mesmo pedido.');
  execute definition;

  definition:=pg_get_functiondef('public.event_save(jsonb,jsonb)'::regprocedure);
  needle:='sort_order,min_age,max_age)';
  if position(needle in definition)=0 then raise exception 'Unexpected ticket save columns'; end if;
  definition:=replace(definition,needle,'sort_order,min_age,max_age,purchase_step)');
  needle:='nullif(v_type->>''max_age'','''')::integer)';
  if position(needle in definition)=0 then raise exception 'Unexpected ticket save values'; end if;
  definition:=replace(definition,needle,
    'nullif(v_type->>''max_age'','''')::integer,coalesce(nullif(v_type->>''purchase_step'','''')::smallint,(select purchase_step from public.bar_event_ticket_types where id=v_type_id),1))');
  definition:=replace(definition,'max_age=excluded.max_age;','max_age=excluded.max_age,purchase_step=excluded.purchase_step;');
  execute definition;
end;
$$;

-- Do not reinterpret a previously sold option or its historical quantities.
create function private.guard_event_ticket_purchase_step() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.purchase_step is distinct from old.purchase_step
    and exists(select 1 from public.bar_event_order_items where ticket_type_id=old.id) then
    raise exception 'Este ingresso já possui pedidos. Crie outra opção para mudar entre individual e casal.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_event_ticket_purchase_step() from public,anon,authenticated,service_role;
create trigger guard_event_ticket_purchase_step before update of purchase_step on public.bar_event_ticket_types
  for each row execute function private.guard_event_ticket_purchase_step();
commit;
