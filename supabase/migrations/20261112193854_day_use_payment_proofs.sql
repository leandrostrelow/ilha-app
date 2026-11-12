begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('day-use-proofs','day-use-proofs',false,5242880,array['image/jpeg','image/png','image/webp']);
create table public.bar_day_use_proofs(
 id uuid primary key,
 customer_id uuid not null references public.bar_day_use_customers(id),
 object_path text not null unique,
 payload_hash text not null,
 created_at timestamptz not null default now(),
 uploaded_at timestamptz
);
create index bar_day_use_proofs_customer on public.bar_day_use_proofs(customer_id);
alter table public.bar_day_use_proofs enable row level security;
revoke all on public.bar_day_use_proofs from public,anon,authenticated,service_role;
grant select on public.bar_day_use_proofs to authenticated;
create policy day_use_proofs_staff on public.bar_day_use_proofs for select to authenticated using(uploaded_at is not null and ((select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.finance'))));
create function day_use_private.begin_proof(p_request_id uuid,p_name text,p_phone text,p_extension text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.bar_day_use_proofs; result jsonb; phone text:=regexp_replace(coalesce(p_phone,''),'\D','','g'); name text:=regexp_replace(btrim(coalesce(p_name,'')),'\s+',' ','g'); fingerprint text; customer uuid;
begin
 if p_request_id is null or p_extension not in('jpg','png','webp') or p_extension is null then raise exception 'Arquivo inválido.'; end if;
 if length(phone) in(10,11) then phone:='55'||phone; end if;
 fingerprint:=encode(extensions.digest(lower(name)||':'||phone||':'||p_extension,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('day-use-proof:'||p_request_id::text,0));
 select * into r from public.bar_day_use_proofs where id=p_request_id;
 if found then
  if r.payload_hash<>fingerprint or (r.uploaded_at is null and r.created_at<now()-interval '30 minutes') then raise exception 'Reabra a página para enviar o comprovante.'; end if;
  return jsonb_build_object('path',r.object_path,'uploaded',r.uploaded_at is not null);
 end if;
 result:=day_use_private.submit_public_registration(p_name,p_phone);
 if coalesce((result->>'ok')::boolean,false) is not true then return result; end if;
 select id into strict customer from public.bar_day_use_customers c where c.phone=begin_proof.phone and c.name_key=lower(begin_proof.name) and c.deleted_at is null;
 insert into public.bar_day_use_proofs(id,customer_id,object_path,payload_hash) values(p_request_id,customer,p_request_id::text||'/'||gen_random_uuid()::text||'.'||p_extension,fingerprint) returning * into r;
 return jsonb_build_object('path',r.object_path,'uploaded',false);
end $$;
create function public.bar_begin_day_use_proof(p_request_id uuid,p_name text,p_phone text,p_extension text) returns jsonb language sql security invoker set search_path='' as $$select day_use_private.begin_proof(p_request_id,p_name,p_phone,p_extension);$$;
create function day_use_private.can_upload_proof(p_path text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.bar_day_use_proofs where object_path=p_path and uploaded_at is null and created_at>now()-interval '30 minutes');$$;
create policy day_use_proof_upload on storage.objects for insert to anon,authenticated with check(bucket_id='day-use-proofs' and day_use_private.can_upload_proof(name));
create policy day_use_proof_read on storage.objects for select to authenticated using(bucket_id='day-use-proofs' and ((select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.finance'))));
create function day_use_private.finish_proof(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.bar_day_use_proofs; customer_name text;
begin
 select * into r from public.bar_day_use_proofs where id=p_request_id for update;
 if not found then raise exception 'Comprovante não encontrado.'; end if;
 if r.uploaded_at is not null then return jsonb_build_object('ok',true); end if;
 if not exists(select 1 from storage.objects where bucket_id='day-use-proofs' and name=r.object_path) then raise exception 'Envie a imagem antes de concluir.'; end if;
 update public.bar_day_use_proofs set uploaded_at=now() where id=r.id;
 select full_name into customer_name from public.bar_day_use_customers where id=r.customer_id;
 insert into public.app_client_notifications(user_id,title,body,link_url,event_type,dedupe_key)
 select p.id,'Comprovante de Day Use recebido',left(customer_name,120)||' enviou um comprovante. Confira no Day Use do bar.','/adm?module=bar','COMPROVANTE_DAY_USE','day-use-proof:'||r.id::text||':'||p.id::text
 from public.profiles p join auth.users u on u.id=p.id join public.app_clients c on c.id=p.id join public.protected_access_accounts a on a.email=lower(trim(u.email)) and a.role=p.role and a.active
 where p.active and (p.role='admin' or (coalesce(p.permissions,'[]'::jsonb) ? 'bar.orders' and coalesce(a.permissions,'[]'::jsonb) ? 'bar.orders') or (coalesce(p.permissions,'[]'::jsonb) ? 'bar.finance' and coalesce(a.permissions,'[]'::jsonb) ? 'bar.finance'))
 on conflict(dedupe_key) where dedupe_key is not null do nothing;
 return jsonb_build_object('ok',true);
end $$;
create function public.bar_finish_day_use_proof(p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select day_use_private.finish_proof(p_request_id);$$;
revoke all on function day_use_private.begin_proof(uuid,text,text,text),public.bar_begin_day_use_proof(uuid,text,text,text),day_use_private.can_upload_proof(text),day_use_private.finish_proof(uuid),public.bar_finish_day_use_proof(uuid) from public,anon,authenticated,service_role;
grant execute on function day_use_private.begin_proof(uuid,text,text,text),public.bar_begin_day_use_proof(uuid,text,text,text),day_use_private.can_upload_proof(text),day_use_private.finish_proof(uuid),public.bar_finish_day_use_proof(uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
