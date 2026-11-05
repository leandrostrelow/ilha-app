begin;
create or replace function public.guard_lesson_enrollment()
returns trigger language plpgsql security invoker set search_path = public
as $$
declare
  v_capacity integer;
  v_day text;
  v_time time;
  v_enrolled integer;
begin
  select capacity, day, time into v_capacity, v_day, v_time
    from public.lesson_slots where id = new.slot_id and active is true for update;
  if v_capacity is null then
    raise exception using errcode = '23514', message = 'O horário escolhido não está mais disponível.';
  end if;
  new.lesson_day := v_day;
  new.lesson_time := v_time;
  if new.active is not true then return new; end if;
  select count(*) into v_enrolled from public.lesson_enrollments
    where slot_id = new.slot_id and active is true and id is distinct from new.id;
  if v_enrolled >= v_capacity then
    raise exception using errcode = '23514',
      message = format('Este horário já atingiu o limite de %s alunos.', v_capacity);
  end if;
  return new;
end;
$$;
commit;
