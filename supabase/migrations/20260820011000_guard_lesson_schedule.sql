begin;

create unique index if not exists lesson_enrollments_active_student_slot_uidx
  on public.lesson_enrollments (student_id, slot_id)
  where active is true;

create unique index if not exists lesson_slots_active_court_time_uidx
  on public.lesson_slots (day, time, court_id)
  where active is true and court_id is not null;

create unique index if not exists lesson_slots_active_teacher_time_uidx
  on public.lesson_slots (day, time, teacher_id)
  where active is true and teacher_id is not null;

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
  if new.active is not true then
    return new;
  end if;

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

  if exists (
    select 1
      from public.lesson_enrollments enrollment
      join public.lesson_slots slot on slot.id = enrollment.slot_id
     where enrollment.student_id = new.student_id
       and enrollment.active is true
       and enrollment.id is distinct from new.id
       and slot.active is true
       and slot.day = v_day
       and slot.time = v_time
  ) then
    raise exception using
      errcode = '23514',
      message = 'Este aluno já possui uma aula no mesmo dia e horário.';
  end if;

  return new;
end;
$$;

drop trigger if exists lesson_enrollments_guard on public.lesson_enrollments;
create trigger lesson_enrollments_guard
before insert or update of student_id, slot_id, active
on public.lesson_enrollments
for each row execute function public.guard_lesson_enrollment();

commit;
