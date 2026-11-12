begin;
create function day_use_private.notify_new_registration() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_name text;
begin
  select full_name into v_name from public.bar_day_use_customers where id=new.customer_id;
  insert into public.app_client_notifications(user_id,title,body,link_url,event_type,dedupe_key)
  select p.id,'Novo cadastro no Day Use',left(v_name,120)||' preencheu o cadastro do Beach Tennis. Confira em Mensalistas.','/adm?module=bar','NOVO_CADASTRO_DAY_USE','day-use-registration:'||new.customer_id::text||':'||p.id::text
  from public.profiles p
  join auth.users u on u.id=p.id
  join public.app_clients c on c.id=p.id
  join public.protected_access_accounts a on a.email=lower(trim(u.email)) and a.role=p.role and a.active
  where p.active and (p.role='admin' or ((coalesce(p.permissions,'[]'::jsonb) ? 'bar.orders' and coalesce(a.permissions,'[]'::jsonb) ? 'bar.orders') or (coalesce(p.permissions,'[]'::jsonb) ? 'bar.finance' and coalesce(a.permissions,'[]'::jsonb) ? 'bar.finance')))
  on conflict(dedupe_key) where dedupe_key is not null do nothing;
  return new;
end $$;
revoke all on function day_use_private.notify_new_registration() from public,anon,authenticated,service_role;
create trigger notify_new_registration after update of used_at on day_use_private.bar_day_use_invites
for each row when (old.used_at is null and new.used_at is not null) execute function day_use_private.notify_new_registration();
commit;
