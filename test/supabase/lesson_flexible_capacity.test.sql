begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='admin' and active limit 1),true);
set local role authenticated;
do $test$
declare sid uuid; i integer; eid uuid; extra uuid:=gen_random_uuid();
begin
 select s.id into sid from public.lesson_slots s where active and not exists(select 1 from public.lesson_enrollments e where e.slot_id=s.id and active) order by s.id limit 1;
 if sid is null then raise exception 'Missing empty lesson fixture'; end if;
 update public.lesson_slots set capacity=5 where id=sid;
 for i in 1..5 loop perform public.add_manual_lesson_student(sid,'QA Capacity '||i,gen_random_uuid()); end loop;
 if (select count(*) from public.lesson_enrollments where slot_id=sid and active)<>5 then raise exception 'Fifth enrollment missing'; end if;
 begin
   perform public.add_manual_lesson_student(sid,'QA Overflow',extra);
   raise exception 'Accepted sixth student in five seats';
 exception when check_violation then
   if sqlerrm not like '%5 alunos%' then raise; end if;
 end;
 if exists(select 1 from public.students where id=extra) then raise exception 'Orphan student'; end if;
 -- Exercise direct enrollment writes as well as the manual RPC.
 insert into public.students(id,name,status,relationship_status) values(extra,'QA Direct','ATIVO','ATIVO');
 begin
   insert into public.lesson_enrollments(student_id,slot_id,type,active) values(extra,sid,'FIXO',true);
   raise exception 'Direct insertion exceeded capacity';
 exception when check_violation then
   if sqlerrm not like '%5 alunos%' then raise; end if;
 end;
 update public.lesson_slots set capacity=6 where id=sid;
 insert into public.lesson_enrollments(student_id,slot_id,type,active) values(extra,sid,'FIXO',true) returning id into eid;
 update public.lesson_enrollments set active=false where id=eid;
 update public.lesson_enrollments set active=true where id=eid;
 if (select count(*) from public.lesson_enrollments where slot_id=sid and active)<>6 then raise exception 'Sixth enrollment missing'; end if;
 begin
   update public.lesson_slots set capacity=5 where id=sid;
   raise exception 'Reduced capacity below enrollment count';
 exception when check_violation then null;
 end;
end $test$;
reset role;
rollback;
