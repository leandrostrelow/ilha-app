begin;

-- The reset below deliberately relies on these foreign-key actions to remove
-- only Ilha Play data while retaining shared Bar/Auth data. Abort at deploy
-- time if an older or drifted schema would leave financial data behind or
-- unexpectedly delete booking/student/tournament history.
do $$
declare
  invalid_foreign_keys text;
begin
  with expected_foreign_key(child_table, child_column, delete_code, delete_action, parent_table) as (
    values
      ('public.app_client_notifications', 'user_id', 'c', 'CASCADE', 'auth.users'),
      ('public.app_notification_dismissals', 'user_id', 'c', 'CASCADE', 'public.app_clients'),
      ('public.app_push_subscriptions', 'user_id', 'c', 'CASCADE', 'auth.users'),
      ('public.app_payment_invoices', 'client_id', 'c', 'CASCADE', 'public.app_clients'),
      ('public.app_plan_requests', 'client_id', 'c', 'CASCADE', 'public.app_clients'),
      ('public.app_store_requests', 'client_id', 'c', 'CASCADE', 'public.app_clients'),
      ('public.app_court_bookings', 'client_id', 'n', 'SET NULL', 'public.app_clients'),
      ('public.app_court_bookings', 'opponent_client_id', 'n', 'SET NULL', 'public.app_clients'),
      ('public.students', 'app_client_id', 'n', 'SET NULL', 'public.app_clients'),
      ('public.tournament_athletes', 'app_client_id', 'n', 'SET NULL', 'public.app_clients')
  )
  select string_agg(
           expected.child_table || '(' || expected.child_column ||
           ') ON DELETE ' || expected.delete_action,
           ', ' order by expected.child_table, expected.child_column
         )
    into invalid_foreign_keys
    from expected_foreign_key as expected
   where not exists (
     select 1
       from pg_catalog.pg_constraint as constraint_row
       join pg_catalog.pg_attribute as child_attribute
         on child_attribute.attrelid = constraint_row.conrelid
        and child_attribute.attnum = constraint_row.conkey[1]
       join pg_catalog.pg_attribute as parent_attribute
         on parent_attribute.attrelid = constraint_row.confrelid
        and parent_attribute.attnum = constraint_row.confkey[1]
      where constraint_row.contype = 'f'
        and constraint_row.conrelid = pg_catalog.to_regclass(expected.child_table)
        and constraint_row.confrelid = pg_catalog.to_regclass(expected.parent_table)
        and pg_catalog.array_length(constraint_row.conkey, 1) = 1
        and pg_catalog.array_length(constraint_row.confkey, 1) = 1
        and child_attribute.attname = expected.child_column
        and parent_attribute.attname = 'id'
        and constraint_row.confdeltype::text = expected.delete_code
        and constraint_row.convalidated is true
   );

  if invalid_foreign_keys is not null then
    raise exception 'Reset do Ilha Play incompatível com as chaves estrangeiras: %.',
      invalid_foreign_keys
      using errcode = '55000',
            hint = 'Alinhe o schema-base antes de aplicar esta migration; nenhuma função de exclusão foi alterada.';
  end if;
end;
$$;

-- Auth and profiles are shared by Ilha Play and the Bar. Resetting a person
-- who is exclusively Bar staff must delete only the client surface; deleting
-- auth.users would also destroy the Bar account, permissions and task links.
create or replace function public.reset_app_client_account(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  client_row public.app_clients%rowtype;
  has_staff_profile boolean := false;
  preserve_bar_access boolean := false;
begin
  if (select auth.uid()) is null
     or not coalesce(public.has_club_permission('clients.write'), false) then
    raise exception 'Seu acesso não permite excluir alunos.' using errcode = '42501';
  end if;

  if p_client_id is null then
    raise exception 'Aluno inválido.' using errcode = '22023';
  end if;
  if p_client_id = (select auth.uid()) then
    raise exception 'Você não pode excluir a própria conta administrativa.' using errcode = '42501';
  end if;

  select client.*
    into client_row
    from public.app_clients as client
   where client.id = p_client_id
   for update;
  if not found then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;

  select exists (
    select 1
      from public.profiles as profile
     where profile.id = p_client_id
  ) into has_staff_profile;

  select exists (
    select 1
      from public.profiles as profile
      join auth.users as auth_user
        on auth_user.id = profile.id
      join public.protected_access_accounts as protected_account
        on protected_account.email = lower(trim(auth_user.email))
       and protected_account.role = profile.role
       and protected_account.active is true
     where profile.id = p_client_id
       and profile.role = 'bar'
       and profile.active is true
       and jsonb_typeof(coalesce(profile.permissions, '[]'::jsonb)) = 'array'
       and jsonb_typeof(coalesce(protected_account.permissions, '[]'::jsonb)) = 'array'
       and exists (
         select 1
           from jsonb_array_elements_text(
             case when jsonb_typeof(profile.permissions) = 'array'
               then profile.permissions else '[]'::jsonb end
           ) as permission(value)
          where permission.value = 'bar'
             or permission.value like 'bar.%'
       )
       and exists (
         select 1
           from jsonb_array_elements_text(
             case when jsonb_typeof(protected_account.permissions) = 'array'
               then protected_account.permissions else '[]'::jsonb end
           ) as permission(value)
          where permission.value = 'bar'
             or permission.value like 'bar.%'
       )
       and not exists (
         select 1
           from jsonb_array_elements_text(
             case when jsonb_typeof(profile.permissions) = 'array'
               then profile.permissions else '[]'::jsonb end
           ) as permission(value)
          where permission.value <> 'bar'
            and permission.value not like 'bar.%'
       )
       and not exists (
         select 1
           from jsonb_array_elements_text(
             case when jsonb_typeof(protected_account.permissions) = 'array'
               then protected_account.permissions else '[]'::jsonb end
           ) as permission(value)
          where permission.value <> 'bar'
            and permission.value not like 'bar.%'
       )
  ) into preserve_bar_access;

  if has_staff_profile and not preserve_bar_access then
    raise exception 'Contas da equipe do Clube não podem ser excluídas pela ficha de alunos.'
      using errcode = '42501';
  end if;

  -- Cancel future/current participation and remove the deleted client's name
  -- from the booking history. Cancellation notifications to the other
  -- participant remain valid and are intentionally generated by the trigger.
  update public.app_court_bookings as booking
     set status = 'CANCELADO',
         client_name = case
           when booking.client_id = p_client_id then 'Cadastro removido'
           else booking.client_name
         end,
         opponent_name = case
           when booking.opponent_client_id = p_client_id then 'Cadastro removido'
           else booking.opponent_name
         end,
         challenge_kind = case when booking.status = 'PENDENTE' then null else booking.challenge_kind end,
         challenge_expires_at = case when booking.status = 'PENDENTE' then null else booking.challenge_expires_at end,
         updated_at = now()
   where booking.status <> 'CANCELADO'
     and (booking.client_id = p_client_id or booking.opponent_client_id = p_client_id);

  update public.app_court_bookings as booking
     set client_name = case
           when booking.client_id = p_client_id then 'Cadastro removido'
           else booking.client_name
         end,
         opponent_name = case
           when booking.opponent_client_id = p_client_id then 'Cadastro removido'
           else booking.opponent_name
         end,
         updated_at = now()
   where booking.status = 'CANCELADO'
     and (booking.client_id = p_client_id or booking.opponent_client_id = p_client_id);

  -- Notifications and browser subscriptions belong to Ilha Play, not to the
  -- Bar surface. Remove them before preserving the shared Auth identity.
  delete from public.app_client_notifications as notification
   where notification.user_id = p_client_id
      or notification.dedupe_key like
        'novo-aluno:' || p_client_id::text || ':admin:%';

  if pg_catalog.to_regclass('public.app_push_subscriptions') is not null then
    execute 'delete from public.app_push_subscriptions where user_id = $1'
      using p_client_id;
  end if;

  if preserve_bar_access then
    delete from public.app_clients as client where client.id = p_client_id;
    if not found then
      raise exception 'Não foi possível remover o cadastro do Ilha Play.' using errcode = 'P0002';
    end if;

    return jsonb_build_object(
      'deleted', true,
      'preserved_bar_access', true,
      'user_id', p_client_id
    );
  end if;

  delete from auth.users as auth_user where auth_user.id = p_client_id;
  if not found then
    raise exception 'Conta de acesso do aluno não encontrada.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'preserved_bar_access', false,
    'user_id', p_client_id
  );
end;
$$;

revoke all on function public.reset_app_client_account(uuid) from public, anon;
grant execute on function public.reset_app_client_account(uuid) to authenticated;

-- Keep compatibility with already deployed ADM versions while routing every
-- deletion through the surface-aware implementation above.
create or replace function public.delete_app_client_account(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.reset_app_client_account(p_client_id);
end;
$$;

revoke all on function public.delete_app_client_account(uuid) from public, anon;
grant execute on function public.delete_app_client_account(uuid) to authenticated;

commit;
