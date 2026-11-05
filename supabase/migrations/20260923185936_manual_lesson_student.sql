begin;

create or replace function public.add_manual_lesson_student(p_slot_id uuid, p_name text, p_student_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_slot public.lesson_slots%rowtype;
  v_student public.students%rowtype;
  v_enrollment public.lesson_enrollments%rowtype;
begin
  if auth.uid() is null or not coalesce(public.has_club_permission('classes'), false) then
    raise exception 'Sem permissão para gerenciar aulas.' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 or p_student_id is null then
    raise exception 'Informe um nome de 2 a 120 caracteres.' using errcode = '22023';
  end if;
  select * into v_slot from public.lesson_slots where id=p_slot_id and active for update;
  if not found then
    raise exception 'Horário indisponível.' using errcode = '23514';
  end if;

  -- Client-generated ID makes a retried request safe without merging homonyms.
  select * into v_student from public.students where id=p_student_id;
  if found then
    select * into v_enrollment from public.lesson_enrollments
      where student_id=p_student_id and slot_id=p_slot_id and active;
    if v_enrollment.id is not null and v_student.name=v_name then
      return jsonb_build_object('student',to_jsonb(v_student),'enrollment',to_jsonb(v_enrollment));
    end if;
    raise exception 'Cadastro já existente. Selecione o aluno na lista.' using errcode = '23505';
  end if;
  if (select count(*) from public.lesson_enrollments where slot_id=p_slot_id and active) >= v_slot.capacity then
    raise exception 'Este horário já atingiu o limite de % alunos.',v_slot.capacity using errcode = '23514';
  end if;
  insert into public.students(id,name,status,relationship_status,notes)
    values(p_student_id,v_name,'ATIVO','ATIVO','Cadastro manual na grade de aulas; vínculo com o app pendente.')
    returning * into v_student;
  insert into public.lesson_enrollments(student_id,slot_id,type,active)
    values(v_student.id,p_slot_id,'FIXO',true) returning * into v_enrollment;
  return jsonb_build_object('student',to_jsonb(v_student),'enrollment',to_jsonb(v_enrollment));
end;
$$;

revoke all on function public.add_manual_lesson_student(uuid,text,uuid) from public,anon;
grant execute on function public.add_manual_lesson_student(uuid,text,uuid) to authenticated;

commit;
