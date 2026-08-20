begin;

alter table public.lesson_slots
  drop constraint if exists lesson_slots_capacity_max_four;

alter table public.lesson_slots
  add constraint lesson_slots_capacity_max_four
  check (capacity between 1 and 4);

create or replace function public.guard_lesson_slot_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.active is true and (
    select count(*)
    from public.lesson_enrollments enrollment
    where enrollment.slot_id = new.id
      and enrollment.active is true
  ) > new.capacity then
    raise exception 'A capacidade não pode ser menor que o número de alunos da aula.'
      using errcode = '23514';
  end if;

  if new.active is true
    and (
      new.day is distinct from old.day
      or new.time is distinct from old.time
      or new.active is distinct from old.active
    )
    and exists (
      select 1
      from public.lesson_enrollments current_enrollment
      join public.lesson_enrollments other_enrollment
        on other_enrollment.student_id = current_enrollment.student_id
       and other_enrollment.id <> current_enrollment.id
       and other_enrollment.active is true
      join public.lesson_slots other_slot
        on other_slot.id = other_enrollment.slot_id
       and other_slot.active is true
      where current_enrollment.slot_id = new.id
        and current_enrollment.active is true
        and other_slot.day = new.day
        and other_slot.time = new.time
    ) then
    raise exception 'Um aluno desta aula já possui outro horário no mesmo dia e hora.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_lesson_slot_update_trigger
  on public.lesson_slots;

create trigger guard_lesson_slot_update_trigger
before update of day, time, active, capacity
on public.lesson_slots
for each row
execute function public.guard_lesson_slot_update();

commit;
