create or replace function public.notify_admins_about_new_app_client()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.app_client_notifications (
    user_id, title, body, link_url, event_type, dedupe_key
  )
  select
    profile.id,
    'Novo aluno cadastrado',
    coalesce(nullif(new.full_name, ''), nullif(new.email, ''), 'Novo aluno') || ' criou uma conta no Ilha Play.',
    '/adm',
    'NOVO_ALUNO',
    'novo-aluno:' || new.id::text || ':admin:' || profile.id::text
  from public.profiles profile
  join public.app_clients admin_client on admin_client.id = profile.id
  where profile.active = true
    and profile.role = 'admin'
    and profile.id <> new.id
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return new;
end;
$function$;
