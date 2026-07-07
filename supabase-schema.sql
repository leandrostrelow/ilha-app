create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  role text not null default 'secretaria' check (role in ('admin', 'secretaria', 'professor')),
  teacher_id uuid,
  active boolean not null default true,
  permissions jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists permissions jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists notes text;

create table if not exists public.app_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null default 'aluno' check (type in ('aluno', 'mensalista', 'avulso', 'outro')),
  amount numeric(10, 2) not null default 0,
  weekly_lessons integer not null default 0,
  default_due_day integer check (default_due_day between 1 and 31),
  active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_clients (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  cpf text,
  age integer,
  guardian_name text,
  guardian_phone text,
  profile_photo text,
  official_plan_id uuid references public.app_plans(id) on delete set null,
  official_plan_code text,
  official_plan_name text,
  plan_amount numeric(10, 2) not null default 0,
  weekly_lessons integer not null default 0,
  preferred_days jsonb not null default '[]'::jsonb,
  due_day integer check (due_day between 1 and 31),
  status text not null default 'ATIVO' check (status in ('ATIVO', 'BLOQUEADO', 'PENDENTE')),
  client_type text not null default 'cliente' check (client_type in ('cliente', 'aluno', 'mensalista', 'responsavel', 'socio')),
  source text not null default 'app',
  notes text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists app_clients_email_idx on public.app_clients(lower(email));

alter table public.app_clients add column if not exists cpf text;
alter table public.app_clients add column if not exists age integer;
alter table public.app_clients add column if not exists guardian_name text;
alter table public.app_clients add column if not exists guardian_phone text;
alter table public.app_clients add column if not exists profile_photo text;
alter table public.app_clients add column if not exists official_plan_id uuid references public.app_plans(id) on delete set null;
alter table public.app_clients add column if not exists official_plan_code text;
alter table public.app_clients add column if not exists official_plan_name text;
alter table public.app_clients add column if not exists plan_amount numeric(10, 2) not null default 0;
alter table public.app_clients add column if not exists weekly_lessons integer not null default 0;
alter table public.app_clients add column if not exists preferred_days jsonb not null default '[]'::jsonb;
alter table public.app_clients add column if not exists due_day integer;
alter table public.app_clients drop constraint if exists app_clients_client_type_check;
alter table public.app_clients add constraint app_clients_client_type_check check (client_type in ('cliente', 'aluno', 'mensalista', 'responsavel', 'socio'));

create table if not exists public.app_plan_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.app_clients(id) on delete cascade,
  plan_code text not null,
  plan_name text not null,
  amount numeric(10, 2) not null default 0,
  membership_type text not null default 'aluno',
  weekly_lessons integer not null default 0,
  requested_days jsonb not null default '[]'::jsonb,
  preferred_due_day integer check (preferred_due_day between 1 and 31),
  status text not null default 'SOLICITADO' check (status in ('SOLICITADO', 'EM_ANALISE', 'APROVADO', 'RECUSADO', 'CANCELADO')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_plan_requests_client_idx on public.app_plan_requests(client_id, created_at desc);
create index if not exists app_plan_requests_status_idx on public.app_plan_requests(status, created_at desc);
create index if not exists app_plans_active_idx on public.app_plans(active, type);

alter table public.app_plan_requests add column if not exists membership_type text not null default 'aluno';
alter table public.app_plan_requests add column if not exists weekly_lessons integer not null default 0;
alter table public.app_plan_requests add column if not exists requested_days jsonb not null default '[]'::jsonb;
alter table public.app_plan_requests add column if not exists preferred_due_day integer;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and active = true
  limit 1
$$;

create or replace function public.is_club_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'secretaria', 'professor')
$$;

create or replace function public.is_club_office()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'secretaria')
$$;

create or replace function public.ensure_current_user_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  profile_row public.profiles%rowtype;
  assigned_role text;
begin
  if auth.uid() is null then
    raise exception 'Usuario nao autenticado.';
  end if;

  select *
    into profile_row
    from public.profiles
   where id = auth.uid()
   limit 1;

  if found then
    return profile_row;
  end if;

  assigned_role := case
    when not exists (select 1 from public.profiles) then 'admin'
    else 'secretaria'
  end;

  insert into public.profiles (id, full_name, email, role)
  values (
    auth.uid(),
    coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1)),
    coalesce(auth.jwt() ->> 'email', ''),
    assigned_role
  )
  returning * into profile_row;

  return profile_row;
end;
$$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  assigned_role text;
begin
  if coalesce(new.raw_user_meta_data ->> 'app_context', '') <> 'admin' then
    return new;
  end if;

  assigned_role := case
    when not exists (select 1 from public.profiles) then 'admin'
    else 'secretaria'
  end;

  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.email, ''),
    assigned_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

create or replace function public.handle_new_app_client()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'app_context', 'public') = 'admin' then
    return new;
  end if;

  insert into public.app_clients (id, full_name, email, phone, client_type)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1), 'Cliente Ilha'),
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'client_type', ''), 'cliente')
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_app_client on auth.users;
create trigger on_auth_user_created_app_client
  after insert on auth.users
  for each row execute function public.handle_new_app_client();

create or replace function public.ensure_current_app_client(
  p_full_name text default null,
  p_phone text default null
)
returns public.app_clients
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  client_row public.app_clients%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Usuario nao autenticado.';
  end if;

  insert into public.app_clients (id, full_name, email, phone, last_login_at)
  values (
    auth.uid(),
    coalesce(nullif(p_full_name, ''), auth.jwt() -> 'user_metadata' ->> 'full_name', split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), 'Cliente Ilha'),
    coalesce(auth.jwt() ->> 'email', ''),
    coalesce(nullif(p_phone, ''), auth.jwt() -> 'user_metadata' ->> 'phone'),
    now()
  )
  on conflict (id) do update
    set full_name = coalesce(nullif(p_full_name, ''), public.app_clients.full_name),
        phone = coalesce(nullif(p_phone, ''), public.app_clients.phone),
        email = excluded.email,
        last_login_at = now(),
        updated_at = now()
  returning * into client_row;

  return client_row;
end;
$$;

create or replace function public.protect_app_client_official_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_club_office() then
    return new;
  end if;

  if new.official_plan_id is distinct from old.official_plan_id
    or new.official_plan_code is distinct from old.official_plan_code
    or new.official_plan_name is distinct from old.official_plan_name
    or new.plan_amount is distinct from old.plan_amount
    or new.weekly_lessons is distinct from old.weekly_lessons
    or new.preferred_days is distinct from old.preferred_days
    or new.due_day is distinct from old.due_day
    or new.status is distinct from old.status
    or new.client_type is distinct from old.client_type
  then
    raise exception 'Plano oficial e dados financeiros so podem ser alterados pela equipe do clube.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_app_client_official_fields on public.app_clients;
create trigger protect_app_client_official_fields
  before update on public.app_clients
  for each row execute function public.protect_app_client_official_fields();

create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  status text not null default 'ATIVO',
  weekly_lessons integer,
  monthly_value numeric(10, 2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.courts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lesson_slots (
  id uuid primary key default gen_random_uuid(),
  day text not null check (day in ('segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo')),
  time time not null,
  period text not null check (period in ('manha', 'tarde', 'noite')),
  court_id uuid references public.courts(id),
  court_name text,
  teacher_id uuid references public.teachers(id),
  teacher_name text,
  level text not null default 'Iniciante',
  capacity integer not null default 4,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lesson_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  slot_id uuid not null references public.lesson_slots(id) on delete cascade,
  type text not null default 'FIXO',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lesson_slots_day_time_idx on public.lesson_slots(day, time);
create index if not exists lesson_enrollments_slot_idx on public.lesson_enrollments(slot_id) where active = true;
create index if not exists lesson_enrollments_student_idx on public.lesson_enrollments(student_id) where active = true;

alter table public.students add column if not exists email text;
alter table public.students add column if not exists birth_date date;
alter table public.students add column if not exists guardian_name text;
alter table public.students add column if not exists plan_name text;
alter table public.students add column if not exists level text;
alter table public.students add column if not exists financial_status text not null default 'OK';
alter table public.students add column if not exists relationship_status text not null default 'ATIVO';

create table if not exists public.student_interactions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  type text not null default 'NOTE',
  title text not null,
  body text,
  due_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.club_agenda_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null default 'EVENTO',
  starts_at timestamptz not null,
  ends_at timestamptz,
  court_id uuid references public.courts(id),
  court_name text,
  owner_name text,
  status text not null default 'CONFIRMADO',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete set null,
  counterparty text,
  description text not null,
  category text not null default 'Aulas',
  type text not null default 'RECEITA' check (type in ('RECEITA', 'DESPESA')),
  amount numeric(10, 2) not null default 0,
  due_date date,
  paid_at timestamptz,
  status text not null default 'ABERTO',
  payment_method text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.financial_transactions add column if not exists counterparty text;

create table if not exists public.communication_audiences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  filters jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null default 'WHATSAPP',
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_campaigns (
  id uuid primary key default gen_random_uuid(),
  audience_id uuid references public.communication_audiences(id),
  template_id uuid references public.communication_templates(id),
  title text not null,
  channel text not null default 'WHATSAPP',
  status text not null default 'RASCUNHO',
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_interactions_student_idx on public.student_interactions(student_id);
create index if not exists club_agenda_events_starts_idx on public.club_agenda_events(starts_at);
create index if not exists financial_transactions_due_idx on public.financial_transactions(due_date, status);
create index if not exists communication_campaigns_status_idx on public.communication_campaigns(status);

alter table public.profiles enable row level security;
alter table public.app_plans enable row level security;
alter table public.app_clients enable row level security;
alter table public.app_plan_requests enable row level security;
alter table public.teachers enable row level security;
alter table public.students enable row level security;
alter table public.courts enable row level security;
alter table public.lesson_slots enable row level security;
alter table public.lesson_enrollments enable row level security;
alter table public.student_interactions enable row level security;
alter table public.club_agenda_events enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.communication_audiences enable row level security;
alter table public.communication_templates enable row level security;
alter table public.communication_campaigns enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.profiles,
  public.app_plans,
  public.app_clients,
  public.app_plan_requests,
  public.teachers,
  public.students,
  public.courts,
  public.lesson_slots,
  public.lesson_enrollments,
  public.student_interactions,
  public.club_agenda_events,
  public.financial_transactions,
  public.communication_audiences,
  public.communication_templates,
  public.communication_campaigns
to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_club_staff() to authenticated;
grant execute on function public.is_club_office() to authenticated;
grant execute on function public.ensure_current_user_profile() to authenticated;
grant execute on function public.ensure_current_app_client(text, text) to authenticated;

drop policy if exists "public read teachers" on public.teachers;
drop policy if exists "public read students" on public.students;
drop policy if exists "public read courts" on public.courts;
drop policy if exists "public read lesson_slots" on public.lesson_slots;
drop policy if exists "public read lesson_enrollments" on public.lesson_enrollments;
drop policy if exists "public read student_interactions" on public.student_interactions;
drop policy if exists "public read club_agenda_events" on public.club_agenda_events;
drop policy if exists "public read financial_transactions" on public.financial_transactions;
drop policy if exists "public read communication_audiences" on public.communication_audiences;
drop policy if exists "public read communication_templates" on public.communication_templates;
drop policy if exists "public read communication_campaigns" on public.communication_campaigns;

drop policy if exists "profiles read own or admin" on public.profiles;
drop policy if exists "profiles admin manage" on public.profiles;
drop policy if exists "plans read active or staff" on public.app_plans;
drop policy if exists "plans staff manage" on public.app_plans;
drop policy if exists "clients read own or staff" on public.app_clients;
drop policy if exists "clients insert own" on public.app_clients;
drop policy if exists "clients update own or staff" on public.app_clients;
drop policy if exists "clients staff manage" on public.app_clients;
drop policy if exists "plan requests read own or staff" on public.app_plan_requests;
drop policy if exists "plan requests insert own" on public.app_plan_requests;
drop policy if exists "plan requests update own draft or staff" on public.app_plan_requests;
drop policy if exists "plan requests staff manage" on public.app_plan_requests;
drop policy if exists "staff read teachers" on public.teachers;
drop policy if exists "office manage teachers" on public.teachers;
drop policy if exists "staff read students" on public.students;
drop policy if exists "office manage students" on public.students;
drop policy if exists "staff manage students" on public.students;
drop policy if exists "staff read courts" on public.courts;
drop policy if exists "office manage courts" on public.courts;
drop policy if exists "staff read lesson_slots" on public.lesson_slots;
drop policy if exists "office manage lesson_slots" on public.lesson_slots;
drop policy if exists "staff read lesson_enrollments" on public.lesson_enrollments;
drop policy if exists "staff manage lesson_enrollments" on public.lesson_enrollments;
drop policy if exists "staff read student_interactions" on public.student_interactions;
drop policy if exists "staff manage student_interactions" on public.student_interactions;
drop policy if exists "staff read club_agenda_events" on public.club_agenda_events;
drop policy if exists "staff manage club_agenda_events" on public.club_agenda_events;
drop policy if exists "office read financial_transactions" on public.financial_transactions;
drop policy if exists "office manage financial_transactions" on public.financial_transactions;
drop policy if exists "staff read communication_audiences" on public.communication_audiences;
drop policy if exists "office manage communication_audiences" on public.communication_audiences;
drop policy if exists "staff read communication_templates" on public.communication_templates;
drop policy if exists "office manage communication_templates" on public.communication_templates;
drop policy if exists "staff read communication_campaigns" on public.communication_campaigns;
drop policy if exists "office manage communication_campaigns" on public.communication_campaigns;

create policy "profiles read own or admin"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.current_user_role() = 'admin');

create policy "profiles admin manage"
on public.profiles for all
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy "plans read active or staff"
on public.app_plans for select
to authenticated
using (active = true or public.is_club_staff());

create policy "plans staff manage"
on public.app_plans for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "clients read own or staff"
on public.app_clients for select
to authenticated
using (id = auth.uid() or public.is_club_staff());

create policy "clients insert own"
on public.app_clients for insert
to authenticated
with check (id = auth.uid());

create policy "clients update own or staff"
on public.app_clients for update
to authenticated
using (id = auth.uid() or public.is_club_staff())
with check (id = auth.uid() or public.is_club_staff());

create policy "clients staff manage"
on public.app_clients for delete
to authenticated
using (public.is_club_office());

create policy "plan requests read own or staff"
on public.app_plan_requests for select
to authenticated
using (client_id = auth.uid() or public.is_club_staff());

create policy "plan requests staff manage"
on public.app_plan_requests for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "staff read teachers"
on public.teachers for select
to authenticated
using (public.is_club_staff());

create policy "office manage teachers"
on public.teachers for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "staff read students"
on public.students for select
to authenticated
using (public.is_club_staff());

create policy "staff manage students"
on public.students for all
to authenticated
using (public.is_club_staff())
with check (public.is_club_staff());

create policy "staff read courts"
on public.courts for select
to authenticated
using (public.is_club_staff());

create policy "office manage courts"
on public.courts for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "staff read lesson_slots"
on public.lesson_slots for select
to authenticated
using (public.is_club_staff());

create policy "office manage lesson_slots"
on public.lesson_slots for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "staff read lesson_enrollments"
on public.lesson_enrollments for select
to authenticated
using (public.is_club_staff());

create policy "staff manage lesson_enrollments"
on public.lesson_enrollments for all
to authenticated
using (public.is_club_staff())
with check (public.is_club_staff());

create policy "staff read student_interactions"
on public.student_interactions for select
to authenticated
using (public.is_club_staff());

create policy "staff manage student_interactions"
on public.student_interactions for all
to authenticated
using (public.is_club_staff())
with check (public.is_club_staff());

create policy "staff read club_agenda_events"
on public.club_agenda_events for select
to authenticated
using (public.is_club_staff());

create policy "staff manage club_agenda_events"
on public.club_agenda_events for all
to authenticated
using (public.is_club_staff())
with check (public.is_club_staff());

create policy "office read financial_transactions"
on public.financial_transactions for select
to authenticated
using (public.is_club_office());

create policy "office manage financial_transactions"
on public.financial_transactions for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "staff read communication_audiences"
on public.communication_audiences for select
to authenticated
using (public.is_club_staff());

create policy "office manage communication_audiences"
on public.communication_audiences for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "staff read communication_templates"
on public.communication_templates for select
to authenticated
using (public.is_club_staff());

create policy "office manage communication_templates"
on public.communication_templates for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

create policy "staff read communication_campaigns"
on public.communication_campaigns for select
to authenticated
using (public.is_club_staff());

create policy "office manage communication_campaigns"
on public.communication_campaigns for all
to authenticated
using (public.is_club_office())
with check (public.is_club_office());

-- Public traffic stays outside the operational data. The /adm app now reads and writes
-- through Supabase Auth with admin, secretaria and professor profiles.
