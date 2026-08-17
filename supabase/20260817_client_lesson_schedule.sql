alter table public.students
  add column if not exists app_client_id uuid references public.app_clients(id) on delete set null;

create unique index if not exists students_app_client_id_idx
  on public.students(app_client_id);

create or replace function public.sync_app_client_lesson_student()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_student_id uuid;
begin
  if coalesce(new.weekly_lessons, 0) <= 0
     and coalesce(new.official_plan_code, '') not like 'aulas_%'
  then
    return new;
  end if;

  select s.id
    into target_student_id
  from public.students s
  where s.app_client_id = new.id
     or (
       s.app_client_id is null
       and (
         (nullif(trim(s.email), '') is not null and lower(trim(s.email)) = lower(trim(new.email)))
         or (
           nullif(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g'), '') is not null
           and regexp_replace(coalesce(s.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(new.phone, ''), '\D', '', 'g')
         )
       )
     )
  order by (s.app_client_id = new.id) desc, s.created_at asc
  limit 1;

  if target_student_id is null then
    insert into public.students (
      app_client_id,
      name,
      phone,
      email,
      status,
      weekly_lessons,
      monthly_value,
      plan_name,
      financial_status,
      relationship_status
    ) values (
      new.id,
      new.full_name,
      new.phone,
      new.email,
      'ATIVO',
      new.weekly_lessons,
      new.plan_amount,
      new.official_plan_name,
      'OK',
      'ATIVO'
    );
  else
    update public.students
       set app_client_id = new.id,
           name = new.full_name,
           phone = new.phone,
           email = new.email,
           status = case when new.status = 'ATIVO' then 'ATIVO' else 'INATIVO' end,
           weekly_lessons = new.weekly_lessons,
           monthly_value = new.plan_amount,
           plan_name = new.official_plan_name,
           updated_at = now()
     where id = target_student_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_app_client_lesson_student on public.app_clients;
create trigger sync_app_client_lesson_student
  after update of official_plan_id, official_plan_code, official_plan_name, plan_amount, weekly_lessons, status
  on public.app_clients
  for each row
  execute function public.sync_app_client_lesson_student();

update public.app_plans
set name = case code
  when 'aulas_mensal_1x' then '1x Aula por semana - Mensal'
  when 'aulas_mensal_2x' then '2x Aulas por semana - Mensal'
  else name
end,
updated_at = now()
where code in ('aulas_mensal_1x', 'aulas_mensal_2x');

update public.app_clients c
set official_plan_name = p.name,
    updated_at = now()
from public.app_plans p
where p.code = c.official_plan_code
  and p.code in ('aulas_mensal_1x', 'aulas_mensal_2x');

insert into public.students (
  app_client_id,
  name,
  phone,
  email,
  status,
  weekly_lessons,
  monthly_value,
  plan_name,
  financial_status,
  relationship_status
)
select
  c.id,
  c.full_name,
  c.phone,
  c.email,
  case when c.status = 'ATIVO' then 'ATIVO' else 'INATIVO' end,
  c.weekly_lessons,
  c.plan_amount,
  c.official_plan_name,
  'OK',
  'ATIVO'
from public.app_clients c
where (coalesce(c.weekly_lessons, 0) > 0 or coalesce(c.official_plan_code, '') like 'aulas_%')
on conflict (app_client_id) do update
set name = excluded.name,
    phone = excluded.phone,
    email = excluded.email,
    status = excluded.status,
    weekly_lessons = excluded.weekly_lessons,
    monthly_value = excluded.monthly_value,
    plan_name = excluded.plan_name,
    updated_at = now();

drop policy if exists "clients read own student" on public.students;
create policy "clients read own student"
on public.students for select
to authenticated
using (app_client_id = (select auth.uid()));

drop policy if exists "clients read own lesson enrollments" on public.lesson_enrollments;
create policy "clients read own lesson enrollments"
on public.lesson_enrollments for select
to authenticated
using (
  exists (
    select 1
    from public.students s
    where s.id = lesson_enrollments.student_id
      and s.app_client_id = (select auth.uid())
  )
);

drop policy if exists "clients read own lesson slots" on public.lesson_slots;
create policy "clients read own lesson slots"
on public.lesson_slots for select
to authenticated
using (
  exists (
    select 1
    from public.lesson_enrollments e
    join public.students s on s.id = e.student_id
    where e.slot_id = lesson_slots.id
      and e.active = true
      and s.app_client_id = (select auth.uid())
  )
);

grant select on public.students, public.lesson_enrollments, public.lesson_slots to authenticated;
