-- Run with an administrative SQL connection; all fixture data is rolled back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='admin' and active limit 1),true);
set local role authenticated;
do $test$
declare sid uuid; student_id uuid:=gen_random_uuid(); response jsonb; repeated jsonb; i integer; extra uuid:=gen_random_uuid();
begin
 select s.id into sid from public.lesson_slots s where active and capacity=4 and not exists(select 1 from public.lesson_enrollments e where e.slot_id=s.id and active) order by s.id limit 1;
 if sid is null then raise exception 'Nenhum horário vazio para teste reversível'; end if;
 response:=public.add_manual_lesson_student(sid,'  QA   Manual  ',student_id);
 if response#>>'{student,name}' <> 'QA Manual' or response#>>'{student,app_client_id}' is not null then raise exception 'Registro manual incorreto'; end if;
 repeated:=public.add_manual_lesson_student(sid,'QA Manual',student_id);
 if repeated#>>'{enrollment,id}' <> response#>>'{enrollment,id}' then raise exception 'Retry duplicou matrícula'; end if;
 for i in 2..4 loop perform public.add_manual_lesson_student(sid,'QA Manual '||i,gen_random_uuid()); end loop;
 begin
   perform public.add_manual_lesson_student(sid,'QA excedente',extra);
   raise exception 'Aceitou quinto aluno';
 exception when check_violation then null;
 end;
 if exists(select 1 from public.students where id=extra) then raise exception 'Criou aluno órfão'; end if;
 begin
   perform public.add_manual_lesson_student(sid,' ',gen_random_uuid());
   raise exception 'Aceitou nome vazio';
 exception when invalid_parameter_value then null;
 end;
end $test$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $test$ begin
 begin
  perform public.add_manual_lesson_student(gen_random_uuid(),'Sem Permissão',gen_random_uuid());
  raise exception 'Aceitou usuário sem permissão';
 exception when insufficient_privilege then null;
 end;
end $test$;
reset role;
rollback;
