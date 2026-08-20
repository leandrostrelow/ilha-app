begin;

alter table public.lesson_enrollments
  add column if not exists lesson_day text,
  add column if not exists lesson_time time;

update public.lesson_enrollments enrollment
set lesson_day = slot.day,
    lesson_time = slot.time
from public.lesson_slots slot
where slot.id = enrollment.slot_id
  and (
    enrollment.lesson_day is distinct from slot.day
    or enrollment.lesson_time is distinct from slot.time
  );

alter table public.lesson_enrollments
  alter column lesson_day set not null,
  alter column lesson_time set not null;

create unique index if not exists lesson_enrollments_active_student_time_uidx
  on public.lesson_enrollments (student_id, lesson_day, lesson_time)
  where active is true;

alter table public.lesson_slots
  alter column court_id set not null,
  alter column teacher_id set not null;

create or replace function public.guard_lesson_enrollment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_capacity integer;
  v_day text;
  v_time time;
  v_enrolled integer;
begin
  select least(4, greatest(1, capacity)), day, time
    into v_capacity, v_day, v_time
    from public.lesson_slots
   where id = new.slot_id
     and active is true
   for update;

  if v_capacity is null then
    raise exception using
      errcode = '23514',
      message = 'O horário escolhido não está mais disponível.';
  end if;

  new.lesson_day := v_day;
  new.lesson_time := v_time;

  if new.active is not true then
    return new;
  end if;

  select count(*)
    into v_enrolled
    from public.lesson_enrollments
   where slot_id = new.slot_id
     and active is true
     and id is distinct from new.id;

  if v_enrolled >= v_capacity then
    raise exception using
      errcode = '23514',
      message = 'Este horário já atingiu o limite de 4 alunos.';
  end if;

  return new;
end;
$$;

drop trigger if exists lesson_enrollments_guard on public.lesson_enrollments;
create trigger lesson_enrollments_guard
before insert or update of student_id, slot_id, active, lesson_day, lesson_time
on public.lesson_enrollments
for each row execute function public.guard_lesson_enrollment();

create or replace function public.guard_lesson_slot_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.active is true
    and new.active is false
    and exists (
      select 1
      from public.lesson_enrollments enrollment
      where enrollment.slot_id = new.id
        and enrollment.active is true
    ) then
    raise exception 'Mova ou remova os alunos antes de desativar este horário.'
      using errcode = '23514';
  end if;

  if new.active is true and (
    select count(*)
    from public.lesson_enrollments enrollment
    where enrollment.slot_id = new.id
      and enrollment.active is true
  ) > new.capacity then
    raise exception 'A capacidade não pode ser menor que o número de alunos da aula.'
      using errcode = '23514';
  end if;

  if new.active is true and (
    new.day is distinct from old.day
    or new.time is distinct from old.time
    or new.active is distinct from old.active
  ) then
    update public.lesson_enrollments
       set lesson_day = new.day,
           lesson_time = new.time
     where slot_id = new.id
       and active is true;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_lesson_slot_update_trigger
  on public.lesson_slots;

create trigger guard_lesson_slot_update_trigger
after update of day, time, active, capacity
on public.lesson_slots
for each row
execute function public.guard_lesson_slot_update();

commit;
