begin;
-- Soft removal preserves the audit trail and cancels linked receipts atomically.
alter table public.bar_day_use_customers
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles(id) on delete set null,
  add column delete_reason text;
create index bar_day_use_customers_deleted_by_idx on public.bar_day_use_customers(deleted_by);
alter table public.bar_day_use_customers add constraint day_customer_deletion_reason check (
  (deleted_at is null and delete_reason is null) or
  (deleted_at is not null and length(btrim(delete_reason)) between 5 and 500)
);

create function private.bar_delete_day_use_customer(p_id uuid,p_reason text)
returns public.bar_day_use_customers language plpgsql security definer set search_path='' as $$
declare person public.bar_day_use_customers; pass_id uuid;
begin
  if auth.uid() is null or not public.has_bar_permission('bar.orders') then
    raise exception 'Sem permissão para excluir Day Use.' using errcode='42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then
    raise exception 'Informe o motivo da exclusão (5 a 500 caracteres).';
  end if;
  -- Same customer-first locking order as payment registration.
  select * into strict person from public.bar_day_use_customers where id=p_id for update;
  if person.deleted_at is not null then return person; end if;
  for pass_id in select id from public.bar_day_use_passes
    where customer_id=p_id and cancelled_at is null order by id
  loop
    perform private.bar_cancel_day_use(pass_id,left('Cadastro excluído: '||btrim(p_reason),500));
  end loop;
  update public.bar_day_use_customers
    set deleted_at=now(),deleted_by=auth.uid(),delete_reason=btrim(p_reason),updated_at=now()
    where id=p_id returning * into person;
  return person;
end;
$$;
create function public.bar_delete_day_use_customer(p_id uuid,p_reason text)
returns public.bar_day_use_customers language sql security invoker set search_path='' as $$
  select private.bar_delete_day_use_customer(p_id,p_reason);
$$;
revoke all on function private.bar_delete_day_use_customer(uuid,text),public.bar_delete_day_use_customer(uuid,text) from public,anon,authenticated;
grant execute on function private.bar_delete_day_use_customer(uuid,text),public.bar_delete_day_use_customer(uuid,text) to authenticated;

-- Explicit new registration can reactivate the same contact; old receipts remain
-- cancelled. Stale Renew/Edit actions cannot silently reactivate a removed user.
do $$
declare def text; needle text;
begin
  def:=pg_get_functiondef('private.bar_record_day_use(text,text,text,date,text,uuid,uuid)'::regprocedure);
  needle:='on conflict(phone,name_key) do update set updated_at=now() returning * into v_person;';
  if position(needle in def)=0 then raise exception 'Unexpected Day Use upsert'; end if;
  def:=replace(def,needle,'on conflict(phone,name_key) do update set updated_at=now(),deleted_at=null,deleted_by=null,delete_reason=null returning * into v_person;');
  needle:='if v_person.full_name<>v_name or v_person.phone<>v_phone then';
  if position(needle in def)=0 then raise exception 'Unexpected Day Use customer guard'; end if;
  def:=replace(def,needle,'if v_person.deleted_at is not null then raise exception ''Cadastro excluído. Use Registrar pagamento para um novo cadastro.''; end if; '||needle);
  execute def;
  def:=pg_get_functiondef('private.bar_edit_day_use_customer(uuid,text,text)'::regprocedure);
  needle:='where id=p_id returning * into strict person;';
  if position(needle in def)=0 then raise exception 'Unexpected Day Use edit guard'; end if;
  execute replace(def,needle,'where id=p_id and deleted_at is null returning * into strict person;');
end;
$$;
notify pgrst,'reload schema';
commit;
