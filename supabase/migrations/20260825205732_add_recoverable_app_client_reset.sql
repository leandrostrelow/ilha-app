begin;

-- A client reset is intentionally logical. Auth, staff access, family links,
-- financial history, store orders, classes, tournaments and bookings keep the
-- same UUID and are never deleted by this operation. This makes an individual
-- rollback possible without restoring the whole database.
create schema if not exists private;

create table if not exists private.app_client_account_backups (
  id uuid primary key default extensions.gen_random_uuid(),
  operation_id uuid not null unique default extensions.gen_random_uuid(),
  client_id uuid not null,
  client_name text not null,
  client_email text not null,
  actor_id uuid not null,
  reason text not null check (char_length(reason) between 5 and 500),
  state text not null default 'CREATED'
    check (state in ('CREATED', 'RESET_APPLIED', 'RESTORED', 'SUPERSEDED')),
  snapshot_version integer not null default 1 check (snapshot_version = 1),
  app_client_snapshot jsonb not null,
  snapshot_sha256 text not null check (char_length(snapshot_sha256) = 64),
  protected_state_before jsonb not null default '{}'::jsonb,
  protected_state_after jsonb not null default '{}'::jsonb,
  reset_client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  reset_at timestamptz,
  restored_at timestamptz,
  restored_by uuid,
  restore_reason text,
  expires_at timestamptz not null default (now() + interval '90 days')
);

create unique index if not exists app_client_account_backups_open_client_idx
  on private.app_client_account_backups(client_id)
  where state = 'RESET_APPLIED';

create index if not exists app_client_account_backups_client_created_idx
  on private.app_client_account_backups(client_id, created_at desc);

create index if not exists app_client_account_backups_state_expires_idx
  on private.app_client_account_backups(state, expires_at);

alter table private.app_client_account_backups enable row level security;
revoke all on table private.app_client_account_backups
  from public, anon, authenticated, service_role;

comment on table private.app_client_account_backups is
  'Snapshots privados e recuperáveis da ficha Ilha Play. Nunca armazena senha, hash de senha, sessão ou token Auth.';
comment on column private.app_client_account_backups.expires_at is
  'Prazo operacional de 90 dias para restauração automática pelo ADM.';

-- Fingerprint only the surfaces that the reset promises not to change. It
-- stores counts and non-secret access metadata, never Auth hashes or Push keys.
create or replace function private.app_client_reset_protected_fingerprint(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'auth_user_exists', exists (
      select 1 from auth.users as auth_user where auth_user.id = p_client_id
    ),
    'profile_state', coalesce((
      select jsonb_build_object(
        'exists', true,
        'role', profile.role,
        'active', profile.active,
        'permissions', coalesce(profile.permissions, '[]'::jsonb)
      )
      from public.profiles as profile
      where profile.id = p_client_id
    ), jsonb_build_object('exists', false)),
    'allowlist_count', (
      select count(*)
      from public.protected_access_accounts as protected_account
      where protected_account.email = (
        select lower(trim(auth_user.email))
        from auth.users as auth_user
        where auth_user.id = p_client_id
      )
    ),
    'bar_task_count', (
      select count(*) from public.bar_user_tasks as task where task.user_id = p_client_id
    ),
    'family_reference_count', (
      select count(*)
      from public.app_family_members as member
      where member.billing_responsible_id = p_client_id
         or member.member_client_id = p_client_id
         or member.requested_by_client_id = p_client_id
    ),
    'family_invoice_item_count', (
      select count(*)
      from public.app_family_invoice_items as invoice_item
      where invoice_item.beneficiary_client_id = p_client_id
    ),
    'payment_invoice_count', (
      select count(*)
      from public.app_payment_invoices as invoice
      where invoice.client_id = p_client_id
    ),
    'store_request_count', (
      select count(*)
      from public.app_store_requests as store_request
      where store_request.client_id = p_client_id
    ),
    'student_links', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', student.id, 'app_client_id', student.app_client_id)
        order by student.id
      )
      from public.students as student
      where student.app_client_id = p_client_id
    ), '[]'::jsonb)
  );
$$;

revoke all on function private.app_client_reset_protected_fingerprint(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.reset_app_client_account_with_backup(
  p_client_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_reason text := nullif(trim(coalesce(p_reason, '')), '');
  client_row public.app_clients%rowtype;
  backup_row private.app_client_account_backups%rowtype;
  client_snapshot jsonb;
  protected_before jsonb;
  protected_after jsonb;
  reset_updated_at timestamptz;
  staff_access_preserved boolean := false;
begin
  if actor_id is null
     or public.current_user_role() <> 'admin'
     or not coalesce(public.has_club_permission('clients.write'), false) then
    raise exception 'Somente um administrador pode criar backup e zerar um cadastro.'
      using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'Aluno inválido.' using errcode = '22023';
  end if;
  if p_client_id = actor_id then
    raise exception 'Você não pode zerar a própria conta administrativa.'
      using errcode = '42501';
  end if;
  if normalized_reason is null or char_length(normalized_reason) not between 5 and 500 then
    raise exception 'Informe o motivo do reset (de 5 a 500 caracteres).'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('app-client-reset:' || p_client_id::text, 0)
  );

  select client.*
    into client_row
    from public.app_clients as client
   where client.id = p_client_id
   for update;
  if not found then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from auth.users as auth_user where auth_user.id = p_client_id) then
    raise exception 'A identidade de acesso do aluno não existe. O reset foi cancelado.'
      using errcode = '55000';
  end if;

  select backup.*
    into backup_row
    from private.app_client_account_backups as backup
   where backup.client_id = p_client_id
     and backup.state = 'RESET_APPLIED'
   order by backup.created_at desc
   limit 1
   for update;

  if found
     and upper(coalesce(client_row.status, '')) = 'PENDENTE'
     and client_row.registration_completed_at is null
     and client_row.email_verified_at is null
     and client_row.official_plan_id is null
     and client_row.official_plan_code is null
     and client_row.official_plan_name is null
     and coalesce(client_row.plan_amount, 0) = 0
     and coalesce(client_row.weekly_lessons, 0) = 0
     and coalesce(client_row.preferred_days, '[]'::jsonb) = '[]'::jsonb
     and client_row.due_day is null
     and client_row.declared_plan_code is null
     and client_row.declared_plan_name is null
     and coalesce(client_row.declared_lesson_slots, '[]'::jsonb) = '[]'::jsonb
     and client_row.plan_cancellation_requested_at is null
     and client_row.plan_cancel_at is null
     and client_row.reenrollment_fee_required is false then
    return jsonb_build_object(
      'reset', true,
      'already_reset', true,
      'deleted', false,
      'backup_id', backup_row.id,
      'operation_id', backup_row.operation_id,
      'backup_expires_at', backup_row.expires_at,
      'backup_expired', backup_row.expires_at <= now(),
      'user_id', p_client_id,
      'preserved_auth_access', true,
      'preserved_team_access', exists (
        select 1 from public.profiles as profile where profile.id = p_client_id
      ),
      'preserved_bar_access', exists (
        select 1 from public.profiles as profile where profile.id = p_client_id
      ),
      'preserved_history', true
    );
  elsif found then
    update private.app_client_account_backups as previous_backup
       set state = 'SUPERSEDED'
     where previous_backup.id = backup_row.id;
  end if;

  client_snapshot := to_jsonb(client_row);
  protected_before := private.app_client_reset_protected_fingerprint(p_client_id);

  insert into private.app_client_account_backups (
    client_id,
    client_name,
    client_email,
    actor_id,
    reason,
    app_client_snapshot,
    snapshot_sha256,
    protected_state_before
  ) values (
    p_client_id,
    client_row.full_name,
    client_row.email,
    actor_id,
    normalized_reason,
    client_snapshot,
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(client_snapshot::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    protected_before
  )
  returning * into backup_row;

  -- These are the only mutable fields changed by reset. Identity and all
  -- historical/related records remain in place under the same UUID.
  update public.app_clients as client
     set status = 'PENDENTE',
         last_login_at = null,
         official_plan_id = null,
         official_plan_code = null,
         official_plan_name = null,
         plan_amount = 0,
         weekly_lessons = 0,
         preferred_days = '[]'::jsonb,
         due_day = null,
         declared_plan_code = null,
         declared_plan_name = null,
         registration_completed_at = null,
         email_verified_at = null,
         declared_lesson_slots = '[]'::jsonb,
         plan_cancellation_requested_at = null,
         plan_cancel_at = null,
         reenrollment_fee_required = false,
         updated_at = now()
   where client.id = p_client_id
  returning client.updated_at into reset_updated_at;

  if not found then
    raise exception 'Não foi possível zerar a ficha do Ilha Play.' using errcode = 'P0002';
  end if;

  protected_after := private.app_client_reset_protected_fingerprint(p_client_id);
  if protected_after is distinct from protected_before then
    raise exception 'O reset tentou alterar dados protegidos e foi integralmente cancelado.'
      using errcode = '55000';
  end if;

  update private.app_client_account_backups as created_backup
     set state = 'RESET_APPLIED',
         protected_state_after = protected_after,
         reset_client_updated_at = reset_updated_at,
         reset_at = now()
   where created_backup.id = backup_row.id
  returning created_backup.* into backup_row;

  select exists (
    select 1 from public.profiles as profile where profile.id = p_client_id
  ) into staff_access_preserved;

  return jsonb_build_object(
    'reset', true,
    'already_reset', false,
    'deleted', false,
    'backup_id', backup_row.id,
    'operation_id', backup_row.operation_id,
    'backup_expires_at', backup_row.expires_at,
    'user_id', p_client_id,
    'preserved_auth_access', true,
    'preserved_team_access', staff_access_preserved,
    'preserved_bar_access', staff_access_preserved,
    'preserved_history', true
  );
end;
$$;

revoke all on function public.reset_app_client_account_with_backup(uuid, text)
  from public, anon, service_role;
grant execute on function public.reset_app_client_account_with_backup(uuid, text)
  to authenticated;

-- Compatibility for already published versions of ADM. It now performs the
-- same safe backup + logical reset instead of deleting Auth or business data.
create or replace function public.reset_app_client_account(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.reset_app_client_account_with_backup(
    p_client_id,
    'Reset administrativo pelo ADM (versão compatível).'
  );
end;
$$;

revoke all on function public.reset_app_client_account(uuid) from public, anon, service_role;
grant execute on function public.reset_app_client_account(uuid) to authenticated;

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

revoke all on function public.delete_app_client_account(uuid) from public, anon, service_role;
grant execute on function public.delete_app_client_account(uuid) to authenticated;

create or replace function public.list_app_client_account_backups(
  p_client_id uuid default null,
  p_limit integer default 50
)
returns table (
  backup_id uuid,
  operation_id uuid,
  client_id uuid,
  client_name text,
  client_email text,
  reason text,
  status text,
  actor_id uuid,
  actor_name text,
  created_at timestamptz,
  reset_at timestamptz,
  restored_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or public.current_user_role() <> 'admin'
     or not coalesce(public.has_club_permission('clients.write'), false) then
    raise exception 'Somente um administrador pode consultar backups de clientes.'
      using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'O limite deve estar entre 1 e 100.' using errcode = '22023';
  end if;

  return query
  select backup.id,
         backup.operation_id,
         backup.client_id,
         backup.client_name,
         backup.client_email,
         backup.reason,
         case
           when backup.state = 'RESET_APPLIED' and backup.expires_at <= now() then 'EXPIRADO'
           else backup.state
         end,
         backup.actor_id,
         coalesce(profile.full_name, 'Administrador'),
         backup.created_at,
         backup.reset_at,
         backup.restored_at,
         backup.expires_at
    from private.app_client_account_backups as backup
    left join public.profiles as profile on profile.id = backup.actor_id
   where p_client_id is null or backup.client_id = p_client_id
   order by backup.created_at desc, backup.id desc
   limit p_limit;
end;
$$;

revoke all on function public.list_app_client_account_backups(uuid, integer)
  from public, anon, service_role;
grant execute on function public.list_app_client_account_backups(uuid, integer)
  to authenticated;

create or replace function public.restore_app_client_account_backup(p_backup_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  backup_row private.app_client_account_backups%rowtype;
  current_client public.app_clients%rowtype;
  snapshot_client public.app_clients%rowtype;
  current_fingerprint jsonb;
  calculated_checksum text;
begin
  if caller_id is null
     or public.current_user_role() <> 'admin'
     or not coalesce(public.has_club_permission('clients.write'), false) then
    raise exception 'Somente um administrador pode restaurar um backup de cliente.'
      using errcode = '42501';
  end if;
  if p_backup_id is null then
    raise exception 'Backup inválido.' using errcode = '22023';
  end if;

  select backup.*
    into backup_row
    from private.app_client_account_backups as backup
   where backup.id = p_backup_id;
  if not found then
    raise exception 'Backup não encontrado.' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('app-client-reset:' || backup_row.client_id::text, 0)
  );

  select backup.*
    into backup_row
    from private.app_client_account_backups as backup
   where backup.id = p_backup_id
   for update;

  if backup_row.state = 'RESTORED' then
    return jsonb_build_object(
      'restored', true,
      'already_restored', true,
      'backup_id', backup_row.id,
      'user_id', backup_row.client_id,
      'restored_at', backup_row.restored_at
    );
  end if;
  if backup_row.state <> 'RESET_APPLIED' then
    raise exception 'Este backup não está disponível para restauração.' using errcode = '55000';
  end if;
  if backup_row.expires_at <= now() then
    raise exception 'O prazo de 90 dias deste backup terminou. Solicite análise técnica.'
      using errcode = '55000';
  end if;

  select client.*
    into current_client
    from public.app_clients as client
   where client.id = backup_row.client_id
   for update;
  if not found then
    raise exception 'A ficha-base do cliente não existe mais; a restauração automática foi bloqueada.'
      using errcode = '55000';
  end if;
  if not exists (
    select 1 from auth.users as auth_user where auth_user.id = backup_row.client_id
  ) then
    raise exception 'A identidade Auth não existe mais; a restauração automática foi bloqueada.'
      using errcode = '55000';
  end if;

  calculated_checksum := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(backup_row.app_client_snapshot::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  if calculated_checksum is distinct from backup_row.snapshot_sha256 then
    raise exception 'A integridade do backup não pôde ser confirmada.' using errcode = '55000';
  end if;

  current_fingerprint := private.app_client_reset_protected_fingerprint(backup_row.client_id);
  if current_fingerprint is distinct from backup_row.protected_state_after then
    raise exception 'Há dados relacionados alterados depois do reset. Nada foi sobrescrito; faça a restauração assistida.'
      using errcode = '40001';
  end if;

  -- A completed or administratively edited re-registration wins over the old
  -- backup. Never overwrite it automatically.
  if upper(coalesce(current_client.status, '')) <> 'PENDENTE'
     or current_client.registration_completed_at is not null
     or current_client.email_verified_at is not null
     or current_client.official_plan_id is not null
     or current_client.official_plan_code is not null
     or current_client.official_plan_name is not null
     or coalesce(current_client.plan_amount, 0) <> 0
     or coalesce(current_client.weekly_lessons, 0) <> 0
     or coalesce(current_client.preferred_days, '[]'::jsonb) <> '[]'::jsonb
     or current_client.due_day is not null
     or current_client.declared_plan_code is not null
     or current_client.declared_plan_name is not null
     or coalesce(current_client.declared_lesson_slots, '[]'::jsonb) <> '[]'::jsonb
     or current_client.plan_cancellation_requested_at is not null
     or current_client.plan_cancel_at is not null
     or current_client.reenrollment_fee_required is true then
    raise exception 'O cliente já iniciou um novo cadastro. Nada foi sobrescrito.'
      using errcode = '40001';
  end if;

  select snapshot.*
    into snapshot_client
    from pg_catalog.jsonb_populate_record(
      null::public.app_clients,
      backup_row.app_client_snapshot
    ) as snapshot;

  if snapshot_client.id is distinct from backup_row.client_id then
    raise exception 'O backup não corresponde ao cliente informado.' using errcode = '55000';
  end if;
  if snapshot_client.official_plan_id is not null
     and not exists (
       select 1 from public.app_plans as plan where plan.id = snapshot_client.official_plan_id
     ) then
    raise exception 'O plano original não existe mais. Nada foi restaurado; revise a ficha manualmente.'
      using errcode = '23503';
  end if;

  -- Restore only the fields changed by reset. Name, e-mail, CPF, contact,
  -- source and family identity are deliberately left as they currently are.
  update public.app_clients as client
     set status = snapshot_client.status,
         last_login_at = snapshot_client.last_login_at,
         official_plan_id = snapshot_client.official_plan_id,
         official_plan_code = snapshot_client.official_plan_code,
         official_plan_name = snapshot_client.official_plan_name,
         plan_amount = snapshot_client.plan_amount,
         weekly_lessons = snapshot_client.weekly_lessons,
         preferred_days = snapshot_client.preferred_days,
         due_day = snapshot_client.due_day,
         declared_plan_code = snapshot_client.declared_plan_code,
         declared_plan_name = snapshot_client.declared_plan_name,
         registration_completed_at = snapshot_client.registration_completed_at,
         email_verified_at = snapshot_client.email_verified_at,
         declared_lesson_slots = snapshot_client.declared_lesson_slots,
         plan_cancellation_requested_at = snapshot_client.plan_cancellation_requested_at,
         plan_cancel_at = snapshot_client.plan_cancel_at,
         reenrollment_fee_required = snapshot_client.reenrollment_fee_required,
         updated_at = now()
   where client.id = backup_row.client_id;

  if not found then
    raise exception 'Não foi possível restaurar a ficha do cliente.' using errcode = 'P0002';
  end if;

  update private.app_client_account_backups as restored_backup
     set state = 'RESTORED',
         restored_at = now(),
         restored_by = caller_id,
         restore_reason = 'Restauração manual confirmada no ADM.'
   where restored_backup.id = backup_row.id
  returning restored_backup.* into backup_row;

  return jsonb_build_object(
    'restored', true,
    'already_restored', false,
    'backup_id', backup_row.id,
    'user_id', backup_row.client_id,
    'restored_at', backup_row.restored_at,
    'preserved_auth_access', true,
    'preserved_history', true
  );
end;
$$;

revoke all on function public.restore_app_client_account_backup(uuid)
  from public, anon, service_role;
grant execute on function public.restore_app_client_account_backup(uuid)
  to authenticated;

-- A pending client may only see the onboarding surface. Legacy lesson/family
-- policies predated pending access and therefore need the active-client gate.
drop policy if exists "clients read own student" on public.students;
create policy "clients read own student"
on public.students for select to authenticated
using (
  app_client_id = (select auth.uid())
  and (select public.is_current_app_client_active())
);

drop policy if exists "clients read own lesson enrollments" on public.lesson_enrollments;
create policy "clients read own lesson enrollments"
on public.lesson_enrollments for select to authenticated
using (
  (select public.is_current_app_client_active())
  and exists (
    select 1
    from public.students as student
    where student.id = lesson_enrollments.student_id
      and student.app_client_id = (select auth.uid())
  )
);

drop policy if exists "clients read own lesson slots" on public.lesson_slots;
create policy "clients read own lesson slots"
on public.lesson_slots for select to authenticated
using (
  (select public.is_current_app_client_active())
  and exists (
    select 1
    from public.lesson_enrollments as enrollment
    join public.students as student on student.id = enrollment.student_id
    where enrollment.slot_id = lesson_slots.id
      and enrollment.active is true
      and student.app_client_id = (select auth.uid())
  )
);

drop policy if exists family_responsible_read_minor_students on public.students;
create policy family_responsible_read_minor_students
on public.students for select to authenticated
using (
  (select public.is_current_app_client_active())
  and exists (
    select 1
    from public.app_family_members as member
    where member.student_id = students.id
      and member.billing_responsible_id = (select auth.uid())
      and member.status = 'ATIVO'
      and member.birth_date is not null
      and member.birth_date > (
        (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
      )::date
  )
);

drop policy if exists family_responsible_read_minor_enrollments on public.lesson_enrollments;
create policy family_responsible_read_minor_enrollments
on public.lesson_enrollments for select to authenticated
using (
  (select public.is_current_app_client_active())
  and exists (
    select 1
    from public.app_family_members as member
    where member.student_id = lesson_enrollments.student_id
      and member.billing_responsible_id = (select auth.uid())
      and member.status = 'ATIVO'
      and member.birth_date is not null
      and member.birth_date > (
        (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
      )::date
  )
);

drop policy if exists family_responsible_read_minor_lesson_slots on public.lesson_slots;
create policy family_responsible_read_minor_lesson_slots
on public.lesson_slots for select to authenticated
using (
  (select public.is_current_app_client_active())
  and exists (
    select 1
    from public.lesson_enrollments as enrollment
    join public.app_family_members as member on member.student_id = enrollment.student_id
    where enrollment.slot_id = lesson_slots.id
      and enrollment.active is true
      and member.billing_responsible_id = (select auth.uid())
      and member.status = 'ATIVO'
      and member.birth_date is not null
      and member.birth_date > (
        (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
      )::date
  )
);

drop policy if exists family_responsible_read_minor_bookings on public.app_court_bookings;
create policy family_responsible_read_minor_bookings
on public.app_court_bookings for select to authenticated
using (
  (select public.is_current_app_client_active())
  and exists (
    select 1
    from public.app_family_members as member
    where member.billing_responsible_id = (select auth.uid())
      and member.status = 'ATIVO'
      and member.member_client_id is not null
      and member.birth_date is not null
      and member.birth_date > (
        (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
      )::date
      and (
        member.member_client_id = app_court_bookings.client_id
        or member.member_client_id = app_court_bookings.opponent_client_id
      )
  )
);

drop policy if exists app_family_members_requester_read_unlinked on public.app_family_members;
create policy app_family_members_requester_read_unlinked
on public.app_family_members for select to authenticated
using (
  (select public.is_current_app_client_active())
  and requested_by_client_id = (select auth.uid())
  and billing_responsible_id = (select auth.uid())
  and member_client_id is null
);

drop policy if exists app_family_members_member_read_self on public.app_family_members;
create policy app_family_members_member_read_self
on public.app_family_members for select to authenticated
using (
  (select public.is_current_app_client_active())
  and member_client_id = (select auth.uid())
);

drop policy if exists app_court_slot_events_read_authenticated on public.app_court_slot_events;
create policy app_court_slot_events_read_authenticated
on public.app_court_slot_events for select to authenticated
using (
  (select public.is_current_app_client_active())
  or (select public.has_club_permission('classes'))
);

commit;
