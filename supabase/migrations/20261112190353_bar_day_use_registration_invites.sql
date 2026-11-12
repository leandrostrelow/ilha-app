-- Individual capability links: no anonymous customer reads or financial writes.
-- Existing Day Use ledger and staff permission model stay unchanged.
create schema day_use_private;
revoke all on schema day_use_private from public,anon,authenticated,service_role;

create table day_use_private.bar_day_use_invites (
  token_hash text primary key,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  customer_id uuid references public.bar_day_use_customers(id),
  payload_hash text,
  constraint bar_day_use_invite_usage check ((used_at is null and customer_id is null and payload_hash is null) or (used_at is not null and customer_id is not null and payload_hash is not null))
);
alter table day_use_private.bar_day_use_invites enable row level security;
revoke all on day_use_private.bar_day_use_invites from public,anon,authenticated,service_role;
create index bar_day_use_invite_issuer on day_use_private.bar_day_use_invites(created_by,created_at);
create index bar_day_use_invite_customer on day_use_private.bar_day_use_invites(customer_id);

create function day_use_private.bar_create_day_use_invite() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_token text; v_expiry timestamptz:=now()+interval '7 days';
begin
  if auth.uid() is null or not public.has_bar_permission('bar.orders') then
    raise exception 'Sem permissão para criar convite.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('day-use-invite:'||auth.uid()::text,0));
  if (select count(*) from day_use_private.bar_day_use_invites where created_by=auth.uid() and created_at>now()-interval '1 hour')>=30 then
    raise exception 'Limite de convites atingido. Tente novamente em uma hora.';
  end if;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into day_use_private.bar_day_use_invites(token_hash,created_by,expires_at)
    values(encode(extensions.digest(v_token,'sha256'),'hex'),auth.uid(),v_expiry);
  return jsonb_build_object('token',v_token,'expires_at',v_expiry);
end $$;
create function public.bar_create_day_use_invite() returns jsonb
language sql security invoker set search_path='' as $$ select day_use_private.bar_create_day_use_invite(); $$;

-- Public capability-based submission intentionally does not require an account.
-- A valid, unguessable, single-person token is mandatory. Never exposes existing PII.
create function day_use_private.bar_submit_day_use_registration(p_token text,p_name text,p_phone text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_invite day_use_private.bar_day_use_invites;
  v_name text:=regexp_replace(btrim(coalesce(p_name,'')),'\s+',' ','g');
  v_phone text:=regexp_replace(coalesce(p_phone,''),'\D','','g');
  v_payload text; v_customer public.bar_day_use_customers;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Link inválido ou expirado. Peça um novo link ao Ilha.'; end if;
  select * into v_invite from day_use_private.bar_day_use_invites
    where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update;
  if not found or v_invite.expires_at<=now() then raise exception 'Link inválido ou expirado. Peça um novo link ao Ilha.'; end if;
  if length(v_name) not between 5 and 120 or v_name !~ '\S+\s+\S+' or length(coalesce(p_name,''))>300 then
    raise exception 'Informe seu nome completo.';
  end if;
  if length(v_phone) in(10,11) then v_phone:='55'||v_phone; end if;
  if v_phone !~ '^55[1-9][0-9]{9,10}$' or length(coalesce(p_phone,''))>30 then raise exception 'Informe um telefone válido com DDD.'; end if;
  v_payload:=encode(extensions.digest(lower(v_name)||':'||v_phone,'sha256'),'hex');
  if v_invite.used_at is not null then
    if v_invite.payload_hash=v_payload then return jsonb_build_object('ok',true); end if;
    raise exception 'Este link já foi utilizado. Peça um novo link ao Ilha.';
  end if;
  -- Same normalized identity reuses its record, with no edits or reactivation.
  insert into public.bar_day_use_customers(full_name,phone,created_by)
    values(v_name,v_phone,v_invite.created_by) on conflict(phone,name_key) do nothing;
  select * into strict v_customer from public.bar_day_use_customers where phone=v_phone and name_key=lower(v_name) for update;
  if v_customer.deleted_at is not null then raise exception 'Não foi possível concluir. Fale com a equipe do Ilha.'; end if;
  update day_use_private.bar_day_use_invites set used_at=now(),customer_id=v_customer.id,payload_hash=v_payload where token_hash=v_invite.token_hash;
  return jsonb_build_object('ok',true);
end $$;
create function public.bar_submit_day_use_registration(p_token text,p_name text,p_phone text) returns jsonb
language sql security invoker set search_path='' as $$ select day_use_private.bar_submit_day_use_registration(p_token,p_name,p_phone); $$;

revoke all on function day_use_private.bar_create_day_use_invite(),public.bar_create_day_use_invite(),day_use_private.bar_submit_day_use_registration(text,text,text),public.bar_submit_day_use_registration(text,text,text) from public,anon,authenticated,service_role;
grant execute on function day_use_private.bar_create_day_use_invite(),public.bar_create_day_use_invite() to authenticated;
grant usage on schema day_use_private to anon,authenticated;
grant execute on function day_use_private.bar_submit_day_use_registration(text,text,text),public.bar_submit_day_use_registration(text,text,text) to anon,authenticated;
comment on function public.bar_submit_day_use_registration(text,text,text) is 'Registers contact from an individual expiring invite. Does not activate membership or write payments.';
notify pgrst,'reload schema';
