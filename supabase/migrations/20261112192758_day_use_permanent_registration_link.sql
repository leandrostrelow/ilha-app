begin;
create table day_use_private.public_registration_settings(id boolean primary key default true check(id),created_by uuid not null references public.profiles(id));
alter table day_use_private.public_registration_settings enable row level security;
revoke all on day_use_private.public_registration_settings from public,anon,authenticated,service_role;
create function day_use_private.enable_public_registration() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_bar_permission('bar.orders') then raise exception 'Sem permissão.' using errcode='42501'; end if;
 insert into day_use_private.public_registration_settings(id,created_by) values(true,auth.uid()) on conflict(id) do nothing;
 return jsonb_build_object('enabled',true);
end $$;
create function public.bar_enable_day_use_public_registration() returns jsonb language sql security invoker set search_path='' as $$ select day_use_private.enable_public_registration(); $$;
create table day_use_private.registration_rate_limits(key text primary key,window_start timestamptz not null,attempts integer not null);
alter table day_use_private.registration_rate_limits enable row level security;
revoke all on day_use_private.registration_rate_limits from public,anon,authenticated,service_role;
create function day_use_private.submit_public_registration(p_name text,p_phone text) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid; token text; headers jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb; bucket text; attempts integer;
begin
 select created_by into owner_id from day_use_private.public_registration_settings where id=true;
 if owner_id is null then raise exception 'Cadastro indisponível. Fale com a equipe do Ilha.'; end if;
 bucket:=encode(extensions.digest(coalesce(split_part(headers->>'x-forwarded-for',',',1),headers->>'x-real-ip','unknown'),'sha256'),'hex');
 insert into day_use_private.registration_rate_limits as r(key,window_start,attempts) values(bucket,now(),1)
 on conflict(key) do update set attempts=case when r.window_start<now()-interval '1 hour' then 1 else r.attempts+1 end,window_start=case when r.window_start<now()-interval '1 hour' then now() else r.window_start end returning r.attempts into attempts;
 if attempts>30 then return jsonb_build_object('ok',false,'message','Muitas tentativas. Aguarde um pouco e tente novamente.'); end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into day_use_private.bar_day_use_invites(token_hash,created_by) values(encode(extensions.digest(token,'sha256'),'hex'),owner_id);
 return day_use_private.bar_submit_day_use_registration(token,p_name,p_phone);
end $$;
create function public.bar_submit_day_use_public_registration(p_name text,p_phone text) returns jsonb language sql security invoker set search_path='' as $$ select day_use_private.submit_public_registration(p_name,p_phone); $$;
revoke all on function day_use_private.enable_public_registration(),public.bar_enable_day_use_public_registration(),day_use_private.submit_public_registration(text,text),public.bar_submit_day_use_public_registration(text,text) from public,anon,authenticated,service_role;
grant execute on function day_use_private.enable_public_registration(),public.bar_enable_day_use_public_registration() to authenticated;
grant execute on function day_use_private.submit_public_registration(text,text),public.bar_submit_day_use_public_registration(text,text) to anon,authenticated;
-- Activate the permanent form for an existing protected administrator, when present.
insert into day_use_private.public_registration_settings(id,created_by)
select true,p.id from public.profiles p join auth.users u on u.id=p.id join public.protected_access_accounts a on a.email=lower(trim(u.email)) and a.role=p.role and a.active where p.active and p.role='admin' order by p.id limit 1 on conflict(id) do nothing;
notify pgrst,'reload schema';
commit;
