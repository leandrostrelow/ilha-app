begin;

create or replace function public.notify_club_staff_about_lesson_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_client_notifications (user_id, title, body, link_url, event_type, dedupe_key)
  select profile.id,
    'Novo interessado em aulas',
    left(new.nome, 120) || ' enviou o formulário de interesse. Abra o ADM para conferir.',
    '/adm?module=leads', 'NOVO_INTERESSADO_AULA',
    'lesson-lead:' || new.id::text || ':adm:' || profile.id::text
  from public.profiles as profile
  join auth.users as auth_user on auth_user.id = profile.id
  join public.app_clients as admin_client on admin_client.id = profile.id
  join public.protected_access_accounts as protected_account
    on protected_account.email = lower(trim(auth_user.email))
   and protected_account.role = profile.role and protected_account.active is true
  where profile.active is true
    and (profile.role = 'admin' or (
      coalesce(profile.permissions, '[]'::jsonb) ? 'classes'
      and coalesce(protected_account.permissions, '[]'::jsonb) ? 'classes'
    ))
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end;
$$;

revoke all on function public.notify_club_staff_about_lesson_lead()
  from public, anon, authenticated, service_role;
drop trigger if exists notify_club_staff_about_lesson_lead on public.lesson_leads;
create trigger notify_club_staff_about_lesson_lead after insert on public.lesson_leads
for each row execute function public.notify_club_staff_about_lesson_lead();

commit;
