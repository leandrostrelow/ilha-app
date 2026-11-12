begin;
-- Re-registration restores only the contact, never cancelled access or revenue.
create table day_use_private.customer_reregistrations(
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.bar_day_use_customers(id),
 invite_hash text not null unique references day_use_private.bar_day_use_invites(token_hash),
 previous_deleted_at timestamptz not null,
 previous_deleted_by uuid,
 previous_delete_reason text,
 created_at timestamptz not null default now()
);
create index day_use_customer_reregistration_customer on day_use_private.customer_reregistrations(customer_id);
alter table day_use_private.customer_reregistrations enable row level security;
revoke all on day_use_private.customer_reregistrations from public,anon,authenticated,service_role;
do $$
declare definition text; needle text:='if v_customer.deleted_at is not null then raise exception ''Não foi possível concluir. Fale com a equipe do Ilha.''; end if;';
begin
 definition:=pg_get_functiondef('day_use_private.bar_submit_day_use_registration(text,text,text)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Unexpected registration guard'; end if;
 definition:=replace(definition,needle,$replacement$
 if v_customer.deleted_at is not null then
   insert into day_use_private.customer_reregistrations(customer_id,invite_hash,previous_deleted_at,previous_deleted_by,previous_delete_reason)
   values(v_customer.id,v_invite.token_hash,v_customer.deleted_at,v_customer.deleted_by,v_customer.delete_reason);
   update public.bar_day_use_customers set deleted_at=null,deleted_by=null,delete_reason=null,updated_at=now() where id=v_customer.id;
 end if;
 $replacement$);
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
