begin;

-- Family billing keeps every athlete as an individual Club student/client,
-- while assigning exactly one app client as the financial responsible party.
-- A pending row may exist before the athlete has an Auth/Ilha Play account.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table public.app_family_members (
  id uuid primary key default gen_random_uuid(),
  billing_responsible_id uuid not null
    references public.app_clients(id) on delete restrict,
  member_client_id uuid
    references public.app_clients(id) on delete set null,
  student_id uuid
    references public.students(id) on delete set null,
  full_name text not null,
  relationship text,
  birth_date date,
  cpf text,
  phone text,
  contact_responsible_name text not null,
  contact_responsible_phone text,
  monthly_amount numeric(10, 2),
  status text not null default 'PENDENTE',
  requested_by_client_id uuid
    references public.app_clients(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_family_members_status_check
    check (status in ('PENDENTE', 'ATIVO', 'REJEITADO', 'DESVINCULADO')),
  constraint app_family_members_name_length_check
    check (char_length(trim(full_name)) between 3 and 120),
  constraint app_family_members_relationship_length_check
    check (relationship is null or char_length(trim(relationship)) between 2 and 60),
  constraint app_family_members_birth_date_check
    check (birth_date is null or birth_date >= date '1900-01-01'),
  constraint app_family_members_cpf_check
    check (cpf is null or public.is_valid_cpf(cpf)),
  constraint app_family_members_phone_length_check
    check (phone is null or char_length(phone) between 10 and 13),
  constraint app_family_members_contact_phone_length_check
    check (
      contact_responsible_phone is null
      or char_length(contact_responsible_phone) between 10 and 13
    ),
  constraint app_family_members_monthly_amount_check
    check (monthly_amount is null or monthly_amount >= 0),
  constraint app_family_members_distinct_people_check
    check (
      member_client_id is null
      or member_client_id <> billing_responsible_id
    ),
  constraint app_family_members_review_check
    check (
      (status = 'PENDENTE' and reviewed_at is null)
      or (status <> 'PENDENTE' and reviewed_at is not null)
    )
);

comment on table public.app_family_members is
  'Vincula alunos individuais a um único responsável financeiro sem compartilhar a conta do Ilha Play.';
comment on column public.app_family_members.member_client_id is
  'Conta individual opcional do membro no Ilha Play; permanece nula até o ADM liberar o acesso.';
comment on column public.app_family_members.student_id is
  'Aluno operacional criado/vinculado ao aprovar o membro, mesmo sem acesso ao Ilha Play.';
comment on column public.app_family_members.monthly_amount is
  'Componente opcional da mensalidade familiar, cobrado somente do responsável financeiro.';

create index app_family_members_responsible_status_idx
  on public.app_family_members (billing_responsible_id, status, created_at desc);

create index app_family_members_requested_by_idx
  on public.app_family_members (requested_by_client_id, created_at desc)
  where requested_by_client_id is not null;

create unique index app_family_members_active_client_uidx
  on public.app_family_members (member_client_id)
  where member_client_id is not null
    and status in ('PENDENTE', 'ATIVO');

create unique index app_family_members_active_student_uidx
  on public.app_family_members (student_id)
  where student_id is not null
    and status in ('PENDENTE', 'ATIVO');

create unique index app_family_members_active_cpf_uidx
  on public.app_family_members (cpf)
  where cpf is not null
    and status in ('PENDENTE', 'ATIVO');

create unique index app_family_members_responsible_identity_uidx
  on public.app_family_members (
    billing_responsible_id,
    lower(full_name),
    coalesce(birth_date, date '0001-01-01')
  )
  where status in ('PENDENTE', 'ATIVO');

create table public.app_family_member_audit (
  id bigint generated always as identity primary key,
  family_member_id uuid references public.app_family_members(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('CRIADO', 'ATUALIZADO')),
  old_data jsonb,
  new_data jsonb not null,
  created_at timestamptz not null default now()
);

create index app_family_member_audit_member_created_idx
  on public.app_family_member_audit (family_member_id, created_at desc);

alter table public.app_payment_invoices
  add column if not exists family_billing boolean not null default false;

comment on column public.app_payment_invoices.family_billing is
  'Indica que a fatura consolida os valores do responsável e de seus membros ativos.';

create table public.app_family_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null
    references public.app_payment_invoices(id) on delete cascade,
  family_member_id uuid
    references public.app_family_members(id) on delete set null,
  beneficiary_client_id uuid
    references public.app_clients(id) on delete set null,
  item_type text not null,
  description text not null,
  amount numeric(10, 2) not null,
  created_at timestamptz not null default now(),
  constraint app_family_invoice_items_type_check
    check (item_type in ('RESPONSAVEL', 'MEMBRO')),
  constraint app_family_invoice_items_amount_check check (amount >= 0),
  constraint app_family_invoice_items_reference_check check (
    (item_type = 'RESPONSAVEL' and family_member_id is null)
    or (item_type = 'MEMBRO' and family_member_id is not null)
  )
);

create index app_family_invoice_items_invoice_idx
  on public.app_family_invoice_items (invoice_id, created_at);

create unique index app_family_invoice_items_responsible_uidx
  on public.app_family_invoice_items (invoice_id)
  where item_type = 'RESPONSAVEL';

create unique index app_family_invoice_items_member_uidx
  on public.app_family_invoice_items (invoice_id, family_member_id)
  where item_type = 'MEMBRO';

alter table public.app_family_members enable row level security;
alter table public.app_family_member_audit enable row level security;
alter table public.app_family_invoice_items enable row level security;

revoke all on table public.app_family_members from anon, authenticated;
revoke all on table public.app_family_member_audit from anon, authenticated;
revoke all on table public.app_family_invoice_items from anon, authenticated;

grant select, insert, update on table public.app_family_members to authenticated;
grant select on table public.app_family_member_audit to authenticated;
grant select, insert, update, delete on table public.app_family_invoice_items to authenticated;

grant select, insert, update, delete on table
  public.app_family_members,
  public.app_family_member_audit,
  public.app_family_invoice_items
to service_role;

create or replace function private.validate_app_family_member()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  today_sp date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  new.full_name := nullif(trim(new.full_name), '');
  new.relationship := left(nullif(trim(new.relationship), ''), 60);
  new.cpf := nullif(pg_catalog.regexp_replace(coalesce(new.cpf, ''), '\D', '', 'g'), '');
  new.phone := nullif(pg_catalog.regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), '');
  new.contact_responsible_name := nullif(trim(new.contact_responsible_name), '');
  new.contact_responsible_phone := nullif(
    pg_catalog.regexp_replace(coalesce(new.contact_responsible_phone, ''), '\D', '', 'g'),
    ''
  );
  new.rejection_reason := left(nullif(trim(new.rejection_reason), ''), 500);
  new.notes := left(nullif(trim(new.notes), ''), 1000);

  if new.full_name is null then
    raise exception 'Informe o nome completo do membro.' using errcode = '22023';
  end if;
  if new.contact_responsible_name is null then
    raise exception 'O contato do responsável financeiro é obrigatório.' using errcode = '22023';
  end if;
  if new.birth_date is not null
     and (new.birth_date < date '1900-01-01' or new.birth_date > today_sp) then
    raise exception 'Data de nascimento inválida.' using errcode = '22023';
  end if;
  if new.birth_date is null and new.cpf is null then
    raise exception 'Informe o CPF ou a data de nascimento do membro.' using errcode = '22023';
  end if;
  if new.birth_date is not null
     and new.birth_date <= (today_sp - interval '18 years')::date
     and new.cpf is null then
    raise exception 'CPF é obrigatório para membros adultos.' using errcode = '22023';
  end if;
  if new.cpf is not null and not public.is_valid_cpf(new.cpf) then
    raise exception 'CPF do membro inválido.' using errcode = '22023';
  end if;
  if new.monthly_amount is not null and new.monthly_amount < 0 then
    raise exception 'O valor mensal não pode ser negativo.' using errcode = '22023';
  end if;
  if new.member_client_id = new.billing_responsible_id then
    raise exception 'O responsável não pode ser membro financeiro de si mesmo.' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function private.validate_app_family_member()
  from public, anon, authenticated, service_role;

create trigger validate_app_family_member_trigger
before insert or update on public.app_family_members
for each row execute function private.validate_app_family_member();

create or replace function private.sync_app_family_member_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_client public.app_clients%rowtype;
  linked_student public.students%rowtype;
  today_sp date := (now() at time zone 'America/Sao_Paulo')::date;
  is_minor boolean := false;
  student_phone text;
begin
  if new.status <> 'ATIVO' then
    return new;
  end if;

  is_minor := new.birth_date is not null
    and new.birth_date > (today_sp - interval '18 years')::date;

  if new.member_client_id is not null then
    select client.* into linked_client
      from public.app_clients as client
     where client.id = new.member_client_id;
    if not found then
      raise exception 'Conta do Ilha Play vinculada não encontrada.' using errcode = 'P0002';
    end if;
  end if;

  if new.student_id is not null then
    select student.* into linked_student
      from public.students as student
     where student.id = new.student_id
     for update;
  end if;

  if linked_student.id is null and new.member_client_id is not null then
    select student.* into linked_student
      from public.students as student
     where student.app_client_id = new.member_client_id
     order by student.created_at
     limit 1
     for update;
  end if;

  student_phone := case
    when is_minor then new.contact_responsible_phone
    else coalesce(new.phone, linked_client.phone)
  end;

  if linked_student.id is null then
    insert into public.students (
      app_client_id,
      name,
      phone,
      email,
      birth_date,
      guardian_name,
      status,
      weekly_lessons,
      monthly_value,
      plan_name,
      financial_status,
      relationship_status
    ) values (
      new.member_client_id,
      new.full_name,
      student_phone,
      nullif(linked_client.email, ''),
      new.birth_date,
      case when is_minor then new.contact_responsible_name else null end,
      'ATIVO',
      coalesce(linked_client.weekly_lessons, 0),
      new.monthly_amount,
      linked_client.official_plan_name,
      'OK',
      'ATIVO'
    ) returning * into linked_student;
  else
    if linked_student.app_client_id is not null
       and new.member_client_id is not null
       and linked_student.app_client_id <> new.member_client_id then
      raise exception 'O aluno já está vinculado a outra conta do Ilha Play.'
        using errcode = '23505';
    end if;

    update public.students as student
       set app_client_id = coalesce(new.member_client_id, student.app_client_id),
           name = new.full_name,
           phone = student_phone,
           email = coalesce(nullif(linked_client.email, ''), student.email),
           birth_date = coalesce(new.birth_date, student.birth_date),
           guardian_name = case
             when is_minor then new.contact_responsible_name
             else student.guardian_name
           end,
           status = 'ATIVO',
           monthly_value = new.monthly_amount,
           plan_name = coalesce(linked_client.official_plan_name, student.plan_name),
           relationship_status = 'ATIVO',
           updated_at = now()
     where student.id = linked_student.id
    returning student.* into linked_student;
  end if;

  new.student_id := linked_student.id;
  return new;
end;
$$;

revoke all on function private.sync_app_family_member_student()
  from public, anon, authenticated, service_role;

create trigger sync_app_family_member_student_trigger
before insert or update of
  status,
  member_client_id,
  student_id,
  full_name,
  birth_date,
  phone,
  contact_responsible_name,
  contact_responsible_phone,
  monthly_amount
on public.app_family_members
for each row execute function private.sync_app_family_member_student();

create or replace function private.audit_app_family_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_actor_id uuid;
begin
  select auth_user.id into audit_actor_id
    from auth.users as auth_user
   where auth_user.id = (select auth.uid());

  insert into public.app_family_member_audit (
    family_member_id,
    actor_id,
    action,
    old_data,
    new_data
  ) values (
    new.id,
    audit_actor_id,
    case when tg_op = 'INSERT' then 'CRIADO' else 'ATUALIZADO' end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new)
  );
  return new;
end;
$$;

revoke all on function private.audit_app_family_member()
  from public, anon, authenticated, service_role;

create trigger audit_app_family_member_trigger
after insert or update on public.app_family_members
for each row execute function private.audit_app_family_member();

drop policy if exists app_family_members_staff_read on public.app_family_members;
create policy app_family_members_staff_read
on public.app_family_members for select to authenticated
using (
  (select public.has_club_permission('clients.read'))
  or (select public.has_club_permission('clients.write'))
  or (select public.has_club_permission('finance.read'))
  or (select public.has_club_permission('finance.write'))
);

-- The requester may read only identity data they submitted themselves. Once
-- an existing adult account is linked, the sanitized summary RPC must be used.
drop policy if exists app_family_members_requester_read_unlinked on public.app_family_members;
create policy app_family_members_requester_read_unlinked
on public.app_family_members for select to authenticated
using (
  requested_by_client_id = (select auth.uid())
  and billing_responsible_id = (select auth.uid())
  and member_client_id is null
);

drop policy if exists app_family_members_member_read_self on public.app_family_members;
create policy app_family_members_member_read_self
on public.app_family_members for select to authenticated
using (member_client_id = (select auth.uid()));

drop policy if exists app_family_members_requester_insert on public.app_family_members;
create policy app_family_members_requester_insert
on public.app_family_members for insert to authenticated
with check (
  billing_responsible_id = (select auth.uid())
  and requested_by_client_id = (select auth.uid())
  and member_client_id is null
  and student_id is null
  and monthly_amount is null
  and status = 'PENDENTE'
  and reviewed_by is null
  and reviewed_at is null
  and rejection_reason is null
  and contact_responsible_name = (
    select client.full_name
      from public.app_clients as client
     where client.id = (select auth.uid())
       and client.status = 'ATIVO'
  )
  and contact_responsible_phone is not distinct from (
    select nullif(pg_catalog.regexp_replace(coalesce(client.phone, ''), '\D', '', 'g'), '')
      from public.app_clients as client
     where client.id = (select auth.uid())
       and client.status = 'ATIVO'
  )
);

drop policy if exists app_family_members_staff_insert on public.app_family_members;
create policy app_family_members_staff_insert
on public.app_family_members for insert to authenticated
with check ((select public.has_club_permission('clients.write')));

drop policy if exists app_family_members_staff_update on public.app_family_members;
create policy app_family_members_staff_update
on public.app_family_members for update to authenticated
using ((select public.has_club_permission('clients.write')))
with check ((select public.has_club_permission('clients.write')));

drop policy if exists app_family_member_audit_staff_read on public.app_family_member_audit;
create policy app_family_member_audit_staff_read
on public.app_family_member_audit for select to authenticated
using (
  (select public.has_club_permission('clients.read'))
  or (select public.has_club_permission('clients.write'))
);

drop policy if exists app_family_invoice_items_payer_read on public.app_family_invoice_items;
create policy app_family_invoice_items_payer_read
on public.app_family_invoice_items for select to authenticated
using (
  exists (
    select 1
      from public.app_payment_invoices as invoice
     where invoice.id = app_family_invoice_items.invoice_id
       and invoice.client_id = (select auth.uid())
       and (select public.is_current_app_client_active())
  )
  or (select public.has_club_permission('finance.read'))
  or (select public.has_club_permission('finance.write'))
);

drop policy if exists app_family_invoice_items_staff_insert on public.app_family_invoice_items;
create policy app_family_invoice_items_staff_insert
on public.app_family_invoice_items for insert to authenticated
with check ((select public.has_club_permission('finance.write')));

drop policy if exists app_family_invoice_items_staff_update on public.app_family_invoice_items;
create policy app_family_invoice_items_staff_update
on public.app_family_invoice_items for update to authenticated
using ((select public.has_club_permission('finance.write')))
with check ((select public.has_club_permission('finance.write')));

drop policy if exists app_family_invoice_items_staff_delete on public.app_family_invoice_items;
create policy app_family_invoice_items_staff_delete
on public.app_family_invoice_items for delete to authenticated
using ((select public.has_club_permission('finance.write')));

create or replace function public.request_family_member(
  p_full_name text,
  p_relationship text,
  p_birth_date date,
  p_cpf text default null,
  p_phone text default null
)
returns public.app_family_members
language plpgsql
security invoker
set search_path = ''
as $$
declare
  responsible public.app_clients%rowtype;
  saved public.app_family_members%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Entre no Ilha Play para adicionar um membro.' using errcode = '42501';
  end if;

  select client.* into responsible
    from public.app_clients as client
   where client.id = (select auth.uid())
     and client.status = 'ATIVO'
   for update;
  if not found then
    raise exception 'Sua conta precisa estar ativa para solicitar um membro.' using errcode = '42501';
  end if;
  if nullif(pg_catalog.regexp_replace(coalesce(responsible.phone, ''), '\D', '', 'g'), '') is null then
    raise exception 'Atualize o telefone do responsável antes de adicionar um membro.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from public.app_family_members as member
     where member.member_client_id = responsible.id
       and member.status = 'ATIVO'
       and member.billing_responsible_id <> responsible.id
  ) then
    raise exception 'Esta conta já pertence a outra família e não pode ser responsável financeiro.'
      using errcode = '23505';
  end if;

  insert into public.app_family_members (
    billing_responsible_id,
    full_name,
    relationship,
    birth_date,
    cpf,
    phone,
    contact_responsible_name,
    contact_responsible_phone,
    status,
    requested_by_client_id
  ) values (
    responsible.id,
    p_full_name,
    p_relationship,
    p_birth_date,
    p_cpf,
    p_phone,
    responsible.full_name,
    responsible.phone,
    'PENDENTE',
    responsible.id
  ) returning * into saved;

  return saved;
exception
  when unique_violation then
    raise exception 'Este membro já possui uma solicitação ou vínculo familiar ativo.'
      using errcode = '23505';
end;
$$;

revoke all on function public.request_family_member(text, text, date, text, text)
  from public, anon;
grant execute on function public.request_family_member(text, text, date, text, text)
  to authenticated;

create or replace function public.admin_create_family_member(
  p_billing_responsible_id uuid,
  p_full_name text,
  p_relationship text default null,
  p_birth_date date default null,
  p_cpf text default null,
  p_phone text default null,
  p_monthly_amount numeric default null,
  p_status text default 'ATIVO',
  p_member_client_id uuid default null,
  p_notes text default null
)
returns public.app_family_members
language plpgsql
security invoker
set search_path = ''
as $$
declare
  responsible public.app_clients%rowtype;
  member_client public.app_clients%rowtype;
  saved public.app_family_members%rowtype;
  status_value text := upper(trim(coalesce(p_status, 'ATIVO')));
begin
  if (select auth.uid()) is null
     or not coalesce(public.has_club_permission('clients.write'), false) then
    raise exception 'Seu acesso não permite criar membros familiares.' using errcode = '42501';
  end if;
  if status_value not in ('PENDENTE', 'ATIVO') then
    raise exception 'Novo membro deve ficar PENDENTE ou ATIVO.' using errcode = '22023';
  end if;

  select client.* into responsible
    from public.app_clients as client
   where client.id = p_billing_responsible_id
   for update;
  if not found then
    raise exception 'Responsável financeiro não encontrado.' using errcode = 'P0002';
  end if;

  if p_member_client_id is not null then
    select client.* into member_client
      from public.app_clients as client
     where client.id = p_member_client_id
     for update;
    if not found then
      raise exception 'Conta do membro não encontrada.' using errcode = 'P0002';
    end if;
  end if;

  insert into public.app_family_members (
    billing_responsible_id,
    member_client_id,
    full_name,
    relationship,
    birth_date,
    cpf,
    phone,
    contact_responsible_name,
    contact_responsible_phone,
    monthly_amount,
    status,
    reviewed_by,
    reviewed_at,
    notes
  ) values (
    responsible.id,
    p_member_client_id,
    coalesce(nullif(trim(p_full_name), ''), member_client.full_name),
    p_relationship,
    coalesce(p_birth_date, member_client.birth_date),
    coalesce(p_cpf, member_client.cpf),
    coalesce(p_phone, member_client.phone),
    responsible.full_name,
    responsible.phone,
    p_monthly_amount,
    status_value,
    case when status_value = 'ATIVO' then (select auth.uid()) else null end,
    case when status_value = 'ATIVO' then now() else null end,
    p_notes
  ) returning * into saved;

  return saved;
exception
  when unique_violation then
    raise exception 'Este aluno já possui vínculo familiar ativo.' using errcode = '23505';
end;
$$;

revoke all on function public.admin_create_family_member(
  uuid, text, text, date, text, text, numeric, text, uuid, text
) from public, anon;
grant execute on function public.admin_create_family_member(
  uuid, text, text, date, text, text, numeric, text, uuid, text
) to authenticated;

create or replace function public.admin_link_family_member(
  p_family_member_id uuid,
  p_member_client_id uuid,
  p_monthly_amount numeric default null
)
returns public.app_family_members
language plpgsql
security invoker
set search_path = ''
as $$
declare
  linked_client public.app_clients%rowtype;
  saved public.app_family_members%rowtype;
begin
  if (select auth.uid()) is null
     or not coalesce(public.has_club_permission('clients.write'), false) then
    raise exception 'Seu acesso não permite vincular membros.' using errcode = '42501';
  end if;

  select client.* into linked_client
    from public.app_clients as client
   where client.id = p_member_client_id
   for update;
  if not found then
    raise exception 'Conta do membro não encontrada.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
      from public.app_family_members as dependent
     where dependent.billing_responsible_id = p_member_client_id
       and dependent.status in ('PENDENTE', 'ATIVO')
  ) then
    raise exception 'Este cliente já é responsável financeiro por outra família.'
      using errcode = '23505';
  end if;

  update public.app_family_members as member
     set member_client_id = linked_client.id,
         full_name = linked_client.full_name,
         birth_date = coalesce(linked_client.birth_date, member.birth_date),
         cpf = coalesce(linked_client.cpf, member.cpf),
         phone = coalesce(linked_client.phone, member.phone),
         monthly_amount = coalesce(p_monthly_amount, member.monthly_amount),
         status = 'ATIVO',
         reviewed_by = (select auth.uid()),
         reviewed_at = now(),
         rejection_reason = null
   where member.id = p_family_member_id
     and member.status in ('PENDENTE', 'ATIVO')
  returning member.* into saved;

  if not found then
    raise exception 'Solicitação familiar não encontrada ou já encerrada.' using errcode = 'P0002';
  end if;
  return saved;
exception
  when unique_violation then
    raise exception 'Esta conta já pertence a outra família.' using errcode = '23505';
end;
$$;

revoke all on function public.admin_link_family_member(uuid, uuid, numeric)
  from public, anon;
grant execute on function public.admin_link_family_member(uuid, uuid, numeric)
  to authenticated;

create or replace function public.admin_update_family_member(
  p_family_member_id uuid,
  p_full_name text,
  p_relationship text,
  p_birth_date date,
  p_cpf text,
  p_phone text,
  p_monthly_amount numeric,
  p_notes text default null
)
returns public.app_family_members
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved public.app_family_members%rowtype;
begin
  if (select auth.uid()) is null
     or not coalesce(public.has_club_permission('clients.write'), false) then
    raise exception 'Seu acesso não permite editar membros.' using errcode = '42501';
  end if;

  update public.app_family_members as member
     set full_name = p_full_name,
         relationship = p_relationship,
         birth_date = p_birth_date,
         cpf = p_cpf,
         phone = p_phone,
         monthly_amount = p_monthly_amount,
         notes = p_notes
   where member.id = p_family_member_id
     and member.status <> 'DESVINCULADO'
  returning member.* into saved;

  if not found then
    raise exception 'Membro familiar não encontrado.' using errcode = 'P0002';
  end if;
  return saved;
end;
$$;

revoke all on function public.admin_update_family_member(
  uuid, text, text, date, text, text, numeric, text
) from public, anon;
grant execute on function public.admin_update_family_member(
  uuid, text, text, date, text, text, numeric, text
) to authenticated;

create or replace function public.admin_review_family_member(
  p_family_member_id uuid,
  p_status text,
  p_monthly_amount numeric default null,
  p_rejection_reason text default null
)
returns public.app_family_members
language plpgsql
security invoker
set search_path = ''
as $$
declare
  status_value text := upper(trim(coalesce(p_status, '')));
  saved public.app_family_members%rowtype;
begin
  if (select auth.uid()) is null
     or not coalesce(public.has_club_permission('clients.write'), false) then
    raise exception 'Seu acesso não permite revisar membros.' using errcode = '42501';
  end if;
  if status_value not in ('ATIVO', 'REJEITADO') then
    raise exception 'Use ATIVO para aprovar ou REJEITADO para recusar.' using errcode = '22023';
  end if;
  if status_value = 'REJEITADO' and nullif(trim(coalesce(p_rejection_reason, '')), '') is null then
    raise exception 'Informe o motivo da recusa.' using errcode = '22023';
  end if;

  update public.app_family_members as member
     set status = status_value,
         monthly_amount = case
           when status_value = 'ATIVO' then coalesce(p_monthly_amount, member.monthly_amount)
           else member.monthly_amount
         end,
         reviewed_by = (select auth.uid()),
         reviewed_at = now(),
         rejection_reason = case
           when status_value = 'REJEITADO' then p_rejection_reason
           else null
         end
   where member.id = p_family_member_id
     and member.status in ('PENDENTE', 'ATIVO', 'REJEITADO')
  returning member.* into saved;

  if not found then
    raise exception 'Solicitação familiar não encontrada.' using errcode = 'P0002';
  end if;
  return saved;
end;
$$;

revoke all on function public.admin_review_family_member(uuid, text, numeric, text)
  from public, anon;
grant execute on function public.admin_review_family_member(uuid, text, numeric, text)
  to authenticated;

create or replace function public.admin_unlink_family_member(
  p_family_member_id uuid,
  p_reason text default null
)
returns public.app_family_members
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved public.app_family_members%rowtype;
begin
  if (select auth.uid()) is null
     or not coalesce(public.has_club_permission('clients.write'), false) then
    raise exception 'Seu acesso não permite desvincular membros.' using errcode = '42501';
  end if;

  update public.app_family_members as member
     set status = 'DESVINCULADO',
         reviewed_by = (select auth.uid()),
         reviewed_at = now(),
         rejection_reason = left(nullif(trim(p_reason), ''), 500)
   where member.id = p_family_member_id
     and member.status <> 'DESVINCULADO'
  returning member.* into saved;

  if not found then
    raise exception 'Membro familiar não encontrado ou já desvinculado.' using errcode = 'P0002';
  end if;
  return saved;
end;
$$;

revoke all on function public.admin_unlink_family_member(uuid, text)
  from public, anon;
grant execute on function public.admin_unlink_family_member(uuid, text)
  to authenticated;

create or replace function public.admin_transfer_family_billing_responsibility(
  p_current_responsible_id uuid,
  p_new_responsible_id uuid
)
returns setof public.app_family_members
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_responsible public.app_clients%rowtype;
  new_responsible public.app_clients%rowtype;
begin
  if (select auth.uid()) is null
     or not coalesce(public.has_club_permission('clients.write'), false) then
    raise exception 'Seu acesso não permite transferir a responsabilidade financeira.'
      using errcode = '42501';
  end if;
  if p_current_responsible_id is null
     or p_new_responsible_id is null
     or p_current_responsible_id = p_new_responsible_id then
    raise exception 'Escolha dois responsáveis diferentes.' using errcode = '22023';
  end if;

  select client.* into current_responsible
    from public.app_clients as client
   where client.id = p_current_responsible_id
   for update;
  if not found then
    raise exception 'Responsável atual não encontrado.' using errcode = 'P0002';
  end if;

  select client.* into new_responsible
    from public.app_clients as client
   where client.id = p_new_responsible_id
   for update;
  if not found then
    raise exception 'Novo responsável não encontrado.' using errcode = 'P0002';
  end if;

  -- If the new payer was a member of this family, close only that membership.
  update public.app_family_members as member
     set status = 'DESVINCULADO',
         reviewed_by = (select auth.uid()),
         reviewed_at = now(),
         rejection_reason = 'Passou a ser o responsável financeiro da família.'
   where member.billing_responsible_id = p_current_responsible_id
     and member.member_client_id = p_new_responsible_id
     and member.status in ('PENDENTE', 'ATIVO');

  return query
  update public.app_family_members as member
     set billing_responsible_id = p_new_responsible_id,
         contact_responsible_name = new_responsible.full_name,
         contact_responsible_phone = new_responsible.phone,
         reviewed_by = (select auth.uid()),
         reviewed_at = case
           when member.status = 'PENDENTE' then null
           else now()
         end
   where member.billing_responsible_id = p_current_responsible_id
     and member.status in ('PENDENTE', 'ATIVO')
     and member.member_client_id is distinct from p_new_responsible_id
  returning member.*;

  -- The payer changes, but every athlete must stay inside the family. The old
  -- payer therefore becomes an ordinary member under the new payer; their own
  -- plan amount becomes a family line item instead of disappearing.
  if exists (
    select 1
      from public.app_family_members as member
     where member.billing_responsible_id = p_new_responsible_id
       and member.member_client_id = p_current_responsible_id
       and member.status in ('PENDENTE', 'ATIVO')
  ) then
    return query
    update public.app_family_members as member
       set full_name = current_responsible.full_name,
           birth_date = coalesce(current_responsible.birth_date, member.birth_date),
           cpf = coalesce(current_responsible.cpf, member.cpf),
           phone = coalesce(current_responsible.phone, member.phone),
           contact_responsible_name = new_responsible.full_name,
           contact_responsible_phone = new_responsible.phone,
           monthly_amount = coalesce(
             member.monthly_amount,
             nullif(current_responsible.plan_amount, 0)
           ),
           status = 'ATIVO',
           reviewed_by = (select auth.uid()),
           reviewed_at = now(),
           rejection_reason = null
     where member.billing_responsible_id = p_new_responsible_id
       and member.member_client_id = p_current_responsible_id
       and member.status in ('PENDENTE', 'ATIVO')
    returning member.*;
  else
    return query
    insert into public.app_family_members (
      billing_responsible_id,
      member_client_id,
      full_name,
      relationship,
      birth_date,
      cpf,
      phone,
      contact_responsible_name,
      contact_responsible_phone,
      monthly_amount,
      status,
      reviewed_by,
      reviewed_at,
      notes
    ) values (
      p_new_responsible_id,
      current_responsible.id,
      current_responsible.full_name,
      'Outro',
      current_responsible.birth_date,
      current_responsible.cpf,
      current_responsible.phone,
      new_responsible.full_name,
      new_responsible.phone,
      nullif(current_responsible.plan_amount, 0),
      'ATIVO',
      (select auth.uid()),
      now(),
      'Antigo responsável financeiro mantido como membro após transferência.'
    )
    returning *;
  end if;
end;
$$;

revoke all on function public.admin_transfer_family_billing_responsibility(uuid, uuid)
  from public, anon;
grant execute on function public.admin_transfer_family_billing_responsibility(uuid, uuid)
  to authenticated;

create or replace function private.get_my_family_summary_impl(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with caller_context as (
    select
      coalesce((
        select member.billing_responsible_id
          from public.app_family_members as member
         where member.member_client_id = p_user_id
           and member.status = 'ATIVO'
         limit 1
      ), p_user_id) as effective_responsible_id,
      exists (
        select 1
          from public.app_family_members as member
         where member.member_client_id = p_user_id
           and member.status = 'ATIVO'
           and member.billing_responsible_id <> p_user_id
      ) as caller_is_member
  )
  select case
    when p_user_id is null or p_user_id <> (select auth.uid()) then
      jsonb_build_object(
        'billing_responsible', null,
        'is_billing_responsible', false,
        'total_monthly_amount', 0,
        'members', '[]'::jsonb
      )
    else coalesce((
      select jsonb_build_object(
        'billing_responsible', jsonb_build_object(
          'id', responsible.id,
          'full_name', responsible.full_name,
          'phone', responsible.phone
        ),
        'is_billing_responsible', not context.caller_is_member,
        'total_monthly_amount', case
          when context.caller_is_member then 0
          else coalesce(responsible.plan_amount, 0) + coalesce((
              select sum(coalesce(member_total.monthly_amount, 0))
                from public.app_family_members as member_total
               where member_total.billing_responsible_id = responsible.id
                 and member_total.status = 'ATIVO'
            ), 0)
        end,
        'members', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', member.id,
              'full_name', member.full_name,
              'relationship', member.relationship,
              'birth_date', member.birth_date,
              'phone', member.phone,
              'status', member.status,
              'monthly_amount', case
                when context.caller_is_member then null
                else member.monthly_amount
              end,
              'has_play_access', member.member_client_id is not null,
              'is_minor',
                member.birth_date is not null
                and member.birth_date > (
                  (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
                )::date,
              'lessons', case
                when member.birth_date is not null
                 and member.birth_date > (
                   (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
                 )::date
                then coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'enrollment_id', enrollment.id,
                      'day', slot.day,
                      'time', slot.time,
                      'court_name', slot.court_name,
                      'teacher_name', slot.teacher_name,
                      'level', slot.level,
                      'type', enrollment.type
                    ) order by slot.day, slot.time
                  )
                    from public.lesson_enrollments as enrollment
                    join public.lesson_slots as slot on slot.id = enrollment.slot_id
                   where enrollment.student_id = member.student_id
                     and enrollment.active is true
                     and slot.active is true
                ), '[]'::jsonb)
                else '[]'::jsonb
              end,
              'upcoming_bookings', case
                when member.birth_date is not null
                 and member.birth_date > (
                   (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
                 )::date
                 and member.member_client_id is not null
                then coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', booking.id,
                      'booking_date', booking.booking_date,
                      'starts_at', booking.starts_at,
                      'court_name', booking.court_name,
                      'status', booking.status,
                      'client_name', booking.client_name,
                      'opponent_name', booking.opponent_name
                    ) order by booking.booking_date, booking.starts_at
                  )
                    from public.app_court_bookings as booking
                   where (
                     booking.client_id = member.member_client_id
                     or booking.opponent_client_id = member.member_client_id
                   )
                     and booking.booking_date >= (now() at time zone 'America/Sao_Paulo')::date
                     and booking.status <> 'CANCELADO'
                ), '[]'::jsonb)
                else '[]'::jsonb
              end
            ) order by member.created_at, member.full_name
          )
            from public.app_family_members as member
           where member.billing_responsible_id = responsible.id
             and member.status in ('PENDENTE', 'ATIVO')
             and (
               not context.caller_is_member
               or member.member_client_id = p_user_id
             )
        ), '[]'::jsonb)
      )
        from caller_context as context
        join public.app_clients as responsible
          on responsible.id = context.effective_responsible_id
         and responsible.status = 'ATIVO'
    ), jsonb_build_object(
      'billing_responsible', null,
      'is_billing_responsible', false,
      'total_monthly_amount', 0,
      'members', '[]'::jsonb
    ))
  end
$$;

revoke all on function private.get_my_family_summary_impl(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.get_my_family_summary_impl(uuid)
  to authenticated;

create or replace function public.get_my_family_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_my_family_summary_impl((select auth.uid()))
$$;

revoke all on function public.get_my_family_summary() from public, anon;
grant execute on function public.get_my_family_summary() to authenticated;

-- Responsible parties can directly read schedules only for minors. Adult
-- member reservations and lessons remain private to that adult and Club staff.
drop policy if exists family_responsible_read_minor_students on public.students;
create policy family_responsible_read_minor_students
on public.students for select to authenticated
using (
  exists (
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
  exists (
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
  exists (
    select 1
      from public.lesson_enrollments as enrollment
      join public.app_family_members as member
        on member.student_id = enrollment.student_id
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
  exists (
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

create or replace function private.guard_family_member_direct_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.app_family_members as member
     where member.member_client_id = new.client_id
       and member.status = 'ATIVO'
       and member.billing_responsible_id <> new.client_id
  ) then
    raise exception 'Este aluno é membro de uma família; gere a cobrança no responsável financeiro.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_family_member_direct_invoice()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_family_member_direct_invoice_trigger
  on public.app_payment_invoices;
create trigger guard_family_member_direct_invoice_trigger
before insert or update of client_id on public.app_payment_invoices
for each row execute function private.guard_family_member_direct_invoice();

drop policy if exists "payment invoices read own or permitted staff"
  on public.app_payment_invoices;
create policy "payment invoices read own or permitted staff"
on public.app_payment_invoices for select to authenticated
using (
  (
    client_id = (select auth.uid())
    and (select public.is_current_app_client_active())
    and not exists (
      select 1
        from public.app_family_members as member
       where member.member_client_id = (select auth.uid())
         and member.status = 'ATIVO'
         and member.billing_responsible_id <> (select auth.uid())
    )
  )
  or (select public.has_club_permission('finance.read'))
  or (select public.has_club_permission('finance.write'))
);

create or replace function public.admin_generate_family_invoice(
  p_billing_responsible_id uuid,
  p_invoice_month date,
  p_due_date date
)
returns public.app_payment_invoices
language plpgsql
security invoker
set search_path = ''
as $$
declare
  responsible public.app_clients%rowtype;
  invoice_row public.app_payment_invoices%rowtype;
  month_start date;
  total_amount numeric(10, 2);
begin
  if (select auth.uid()) is null
     or not coalesce(public.has_club_permission('finance.write'), false) then
    raise exception 'Seu acesso não permite gerar cobranças familiares.' using errcode = '42501';
  end if;
  if p_invoice_month is null or p_due_date is null then
    raise exception 'Informe o mês e o vencimento da cobrança.' using errcode = '22023';
  end if;

  month_start := date_trunc('month', p_invoice_month)::date;
  select client.* into responsible
    from public.app_clients as client
   where client.id = p_billing_responsible_id
   for update;
  if not found then
    raise exception 'Responsável financeiro não encontrado.' using errcode = 'P0002';
  end if;

  total_amount := round(
    coalesce(responsible.plan_amount, 0)
    + coalesce((
        select sum(coalesce(member.monthly_amount, 0))
          from public.app_family_members as member
         where member.billing_responsible_id = responsible.id
           and member.status = 'ATIVO'
      ), 0),
    2
  );

  select invoice.* into invoice_row
    from public.app_payment_invoices as invoice
   where invoice.client_id = responsible.id
     and invoice.invoice_month = month_start
   for update;

  if found and invoice_row.status in ('PAGA', 'CANCELADA') then
    raise exception 'Cobrança paga ou cancelada não pode ser recalculada.' using errcode = '23514';
  end if;

  insert into public.app_payment_invoices (
    client_id,
    invoice_month,
    description,
    plan_code,
    plan_name,
    amount,
    due_date,
    status,
    family_billing,
    notes
  ) values (
    responsible.id,
    month_start,
    'Mensalidade familiar Ilha Tênis',
    'familia',
    'Conta familiar',
    total_amount,
    p_due_date,
    'ABERTA',
    true,
    'Cobrança consolidada no responsável financeiro.'
  )
  on conflict (client_id, invoice_month) do update
    set description = excluded.description,
        plan_code = excluded.plan_code,
        plan_name = excluded.plan_name,
        amount = excluded.amount,
        due_date = excluded.due_date,
        family_billing = true,
        notes = excluded.notes,
        updated_at = now()
  returning * into invoice_row;

  delete from public.app_family_invoice_items as item
   where item.invoice_id = invoice_row.id;

  insert into public.app_family_invoice_items (
    invoice_id,
    beneficiary_client_id,
    item_type,
    description,
    amount
  ) values (
    invoice_row.id,
    responsible.id,
    'RESPONSAVEL',
    responsible.full_name,
    coalesce(responsible.plan_amount, 0)
  );

  insert into public.app_family_invoice_items (
    invoice_id,
    family_member_id,
    beneficiary_client_id,
    item_type,
    description,
    amount
  )
  select
    invoice_row.id,
    member.id,
    member.member_client_id,
    'MEMBRO',
    member.full_name,
    member.monthly_amount
  from public.app_family_members as member
  where member.billing_responsible_id = responsible.id
    and member.status = 'ATIVO'
    and member.monthly_amount is not null
  order by member.full_name;

  return invoice_row;
end;
$$;

revoke all on function public.admin_generate_family_invoice(uuid, date, date)
  from public, anon;
grant execute on function public.admin_generate_family_invoice(uuid, date, date)
  to authenticated;

create or replace function private.enable_family_member_access_impl(
  p_family_member_id uuid,
  p_auth_user_id uuid,
  p_email text
)
returns public.app_family_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.app_family_members%rowtype;
  responsible public.app_clients%rowtype;
  normalized_email text := lower(trim(coalesce(p_email, '')));
  auth_email text;
  contact_phone text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Esta operação exige a função de serviço.' using errcode = '42501';
  end if;
  if p_auth_user_id is null or normalized_email = '' then
    raise exception 'Informe o usuário Auth e o e-mail do membro.' using errcode = '22023';
  end if;

  select lower(trim(auth_user.email)) into auth_email
    from auth.users as auth_user
   where auth_user.id = p_auth_user_id
   for update;
  if not found then
    raise exception 'Usuário Auth não encontrado.' using errcode = 'P0002';
  end if;
  if auth_email is distinct from normalized_email then
    raise exception 'O e-mail informado não corresponde ao usuário Auth.' using errcode = '23514';
  end if;

  select family_member.* into member
    from public.app_family_members as family_member
   where family_member.id = p_family_member_id
     and family_member.status = 'ATIVO'
   for update;
  if not found then
    raise exception 'Aprove o membro antes de liberar o Ilha Play.' using errcode = '23514';
  end if;

  select client.* into responsible
    from public.app_clients as client
   where client.id = member.billing_responsible_id;
  if not found then
    raise exception 'Responsável financeiro não encontrado.' using errcode = 'P0002';
  end if;
  if p_auth_user_id = responsible.id then
    raise exception 'Responsável e membro precisam de contas diferentes.' using errcode = '23514';
  end if;
  if exists (
    select 1
      from public.app_clients as client
     where lower(trim(client.email)) = normalized_email
       and client.id <> p_auth_user_id
  ) then
    raise exception 'Este e-mail já pertence a outra conta do Ilha Play.' using errcode = '23505';
  end if;
  if exists (
    select 1
      from public.app_family_members as other_member
     where other_member.id <> member.id
       and other_member.member_client_id = p_auth_user_id
       and other_member.status in ('PENDENTE', 'ATIVO')
  ) then
    raise exception 'Esta conta já pertence a outra família.' using errcode = '23505';
  end if;

  contact_phone := case
    when member.birth_date is not null
     and member.birth_date > (
       (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
     )::date
    then responsible.phone
    else coalesce(member.phone, responsible.phone)
  end;

  insert into public.app_clients (
    id,
    full_name,
    email,
    phone,
    cpf,
    birth_date,
    guardian_name,
    guardian_phone,
    status,
    client_type,
    source,
    registration_completed_at,
    email_verified_at
  ) values (
    p_auth_user_id,
    member.full_name,
    normalized_email,
    contact_phone,
    member.cpf,
    member.birth_date,
    case
      when member.birth_date is not null
       and member.birth_date > (
         (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
       )::date
      then responsible.full_name
      else null
    end,
    case
      when member.birth_date is not null
       and member.birth_date > (
         (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
       )::date
      then responsible.phone
      else null
    end,
    'ATIVO',
    'aluno',
    'familia',
    now(),
    now()
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        phone = coalesce(public.app_clients.phone, excluded.phone),
        cpf = coalesce(public.app_clients.cpf, excluded.cpf),
        birth_date = coalesce(public.app_clients.birth_date, excluded.birth_date),
        guardian_name = coalesce(excluded.guardian_name, public.app_clients.guardian_name),
        guardian_phone = coalesce(excluded.guardian_phone, public.app_clients.guardian_phone),
        status = 'ATIVO',
        updated_at = now();

  update public.app_family_members as family_member
     set member_client_id = p_auth_user_id,
         reviewed_at = coalesce(family_member.reviewed_at, now()),
         rejection_reason = null
   where family_member.id = member.id
  returning family_member.* into member;

  return member;
end;
$$;

revoke all on function private.enable_family_member_access_impl(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.enable_family_member_access_impl(uuid, uuid, text)
  to service_role;

create or replace function public.admin_enable_family_member_access(
  p_family_member_id uuid,
  p_auth_user_id uuid,
  p_email text
)
returns public.app_family_members
language sql
security invoker
set search_path = ''
as $$
  select private.enable_family_member_access_impl(
    p_family_member_id,
    p_auth_user_id,
    p_email
  )
$$;

revoke all on function public.admin_enable_family_member_access(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_enable_family_member_access(uuid, uuid, text)
  to service_role;

comment on function public.request_family_member(text, text, date, text, text) is
  'Cria uma solicitação PENDENTE para um novo membro sem permitir vínculo arbitrário com contas existentes.';
comment on function public.get_my_family_summary() is
  'Retorna dados sanitizados da família; agenda e aulas somente para menores calculados pela data de nascimento.';
comment on function public.admin_enable_family_member_access(uuid, uuid, text) is
  'RPC exclusiva de service_role usada após criar/reutilizar Auth para liberar acesso individual ao Ilha Play.';
comment on function public.admin_generate_family_invoice(uuid, date, date) is
  'Gera ou recalcula uma única mensalidade detalhada no responsável financeiro, sem cobrar os membros individualmente.';

commit;
