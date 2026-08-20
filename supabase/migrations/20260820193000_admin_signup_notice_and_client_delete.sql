create or replace function public.notify_admins_about_new_app_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_client_notifications (
    user_id,
    title,
    body,
    link_url,
    event_type,
    dedupe_key
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
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

revoke all on function public.notify_admins_about_new_app_client() from public, anon, authenticated;

drop trigger if exists notify_admins_about_new_app_client on public.app_clients;
create trigger notify_admins_about_new_app_client
after insert on public.app_clients
for each row execute function public.notify_admins_about_new_app_client();

create or replace function public.delete_app_client_account(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Somente administradores podem excluir alunos.' using errcode = '42501';
  end if;

  if p_client_id is null then
    raise exception 'Aluno inválido.' using errcode = '22023';
  end if;

  if p_client_id = auth.uid() then
    raise exception 'Você não pode excluir sua própria conta administrativa.' using errcode = '42501';
  end if;

  if exists (select 1 from public.profiles where id = p_client_id) then
    raise exception 'Contas da equipe não podem ser excluídas pela ficha de alunos.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.app_clients where id = p_client_id) then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;

  delete from auth.users where id = p_client_id;
end;
$$;

revoke all on function public.delete_app_client_account(uuid) from public, anon;
grant execute on function public.delete_app_client_account(uuid) to authenticated;
