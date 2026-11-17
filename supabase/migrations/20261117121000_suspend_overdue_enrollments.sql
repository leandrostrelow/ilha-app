begin;
alter table public.app_clients drop constraint app_clients_status_check;
alter table public.app_clients add constraint app_clients_status_check check(status in ('ATIVO','BLOQUEADO','PENDENTE','SUSPENSO'));
alter table public.app_family_members add column classes_suspended boolean not null default false;
create table private.overdue_enrollment_suspensions (
 invoice_id uuid primary key references public.app_payment_invoices(id),
 actor_id uuid not null references auth.users(id),
 reason text not null, payer boolean not null, member_ids uuid[] not null,
 before_state jsonb not null, created_at timestamptz not null default now()
);
revoke all on private.overdue_enrollment_suspensions from public,anon,authenticated,service_role;

create function private.guard_suspended_family_classes() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='INSERT' and new.classes_suspended) or (tg_op='UPDATE' and new.classes_suspended is distinct from old.classes_suspended) then
 if auth.uid() is null or not coalesce(public.has_club_permission('clients.write'),false)
 or not coalesce(public.has_club_permission('finance.write'),false) or not coalesce(public.has_club_permission('classes'),false) then
 raise exception 'Sem permissão para suspender aulas.' using errcode='42501';end if;
 end if;
 if new.classes_suspended and not new.billing_paused then raise exception 'Retome a inscrição antes de retomar a cobrança.';end if;
 return new;
end;$$;
revoke all on function private.guard_suspended_family_classes() from public,anon,authenticated,service_role;
create trigger guard_suspended_family_classes before insert or update on public.app_family_members for each row execute function private.guard_suspended_family_classes();
create function private.keep_suspended_student_inactive() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.app_clients where id=new.app_client_id and status='SUSPENSO')
 or exists(select 1 from public.app_family_members where student_id=new.id and classes_suspended) then
 new.status:='INATIVO';new.relationship_status:='INATIVO';end if;
 return new;
end;$$;
revoke all on function private.keep_suspended_student_inactive() from public,anon,authenticated,service_role;
create trigger keep_suspended_student_inactive before insert or update on public.students for each row execute function private.keep_suspended_student_inactive();


create function private.prevent_suspended_lesson_enrollment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.active and (exists(select 1 from public.students s join public.app_clients c on c.id=s.app_client_id where s.id=new.student_id and c.status='SUSPENSO')
 or exists(select 1 from public.app_family_members m where m.student_id=new.student_id and m.classes_suspended)) then
 raise exception 'Retome a inscrição antes de incluir o aluno nas aulas.';end if;
 return new;
end;$$;
revoke all on function private.prevent_suspended_lesson_enrollment() from public,anon,authenticated,service_role;
create trigger prevent_suspended_lesson_enrollment before insert or update on public.lesson_enrollments for each row execute function private.prevent_suspended_lesson_enrollment();

create function public.admin_overdue_suspension(p_invoice_id uuid,p_payer boolean default false,p_member_ids uuid[] default '{}',p_reason text default null,p_version text default null,p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.app_payment_invoices%rowtype;c public.app_clients%rowtype; f public.financial_transactions%rowtype;
 members jsonb; before_state jsonb; revision text; all_members uuid[]; clients uuid[]; selected_student_ids uuid[];
 m public.app_family_members%rowtype; a private.overdue_enrollment_suspensions%rowtype;
begin
 if auth.uid() is null or not coalesce(public.has_club_permission('finance.write'),false)
 or not coalesce(public.has_club_permission('clients.write'),false) or not coalesce(public.has_club_permission('classes'),false) then
 raise exception 'Sem permissão para suspender aulas.' using errcode='42501';end if;
 if p_payer is null or p_member_ids is null or p_apply is null then raise exception 'Confira a seleção de alunos.';end if;
 select * into strict i from public.app_payment_invoices where id=p_invoice_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ilha-monthly-billing:'||i.invoice_month::text,0));
 select * into strict i from public.app_payment_invoices where id=p_invoice_id for update;
 select * into strict c from public.app_clients where id=i.client_id for update;
 if exists(select 1 from public.app_family_members where member_client_id=c.id and billing_responsible_id<>c.id and status in ('ATIVO','PENDENTE')) then
 raise exception 'Fatura anterior ao vínculo familiar. Confira a ficha do responsável antes de suspender.';end if;
 perform 1 from public.app_family_members where billing_responsible_id=c.id order by id for update;
 select * into a from private.overdue_enrollment_suspensions where invoice_id=i.id;
 if found and p_reason is null then return jsonb_build_object('state','COMPLETED');end if;
 if found and p_reason is not null then
 if a.payer is distinct from p_payer or not (a.member_ids @> p_member_ids and a.member_ids <@ p_member_ids) or a.reason is distinct from trim(p_reason) then
 raise exception 'Esta fatura já concluiu outra suspensão. Confira o histórico.';end if;
 return jsonb_build_object('state','COMPLETED');end if;
 if i.amount<=0 or i.due_date >= (now() at time zone 'America/Sao_Paulo')::date
 or i.paid_at is not null or i.received_on is not null or i.superseded_at is not null
 or i.status not in ('ABERTA','AGUARDANDO','VENCIDA','CANCELADA')
 or coalesce(i.provider_status,'') in ('CONFIRMED','RECEIVED','RECEIVED_IN_CASH','REFUNDED')
 or exists(select 1 from private.monthly_invoice_receipts where invoice_id=i.id and (completed_at is not null or reversed_at is null)) then
 raise exception 'Fatura paga ou em conciliação: suspensão bloqueada.';end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]),coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') into all_members,members
 from public.app_family_members t where billing_responsible_id=c.id and status='ATIVO';
 before_state:=jsonb_build_object('client',to_jsonb(c),'members',members,
 'enrollment',(select to_jsonb(e) from public.app_monthly_billing_enrollments e where client_id=c.id));
 revision:=md5((before_state||jsonb_build_object('invoiceIdentity',jsonb_build_array(i.id,i.amount,i.due_date,i.invoice_month,i.payment_method)))::text);
 if not p_apply and p_reason is null then return jsonb_build_object('state','PREVIEW','version',revision,'payerName',c.full_name,'amount',i.amount,'dueDate',i.due_date,'invoiceMonth',i.invoice_month,'members',
 (select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id','name',x->>'full_name')),'[]') from jsonb_array_elements(members) x));end if;
 if p_version is null or p_version<>revision then raise exception 'O cadastro mudou. Reabra a operação antes de continuar.';end if;
 if length(trim(coalesce(p_reason,''))) not between 10 and 400 or (not p_payer and cardinality(p_member_ids)=0)
 or not (p_member_ids <@ all_members) or array_position(p_member_ids,null) is not null then raise exception 'Selecione os alunos e informe o motivo de 10 a 400 caracteres.';end if;
 if p_payer and not (all_members <@ p_member_ids) then
 raise exception 'Para suspender o responsável pagador, selecione toda a família. Dependentes podem ser suspensos individualmente.';end if;
 select * into strict f from public.financial_transactions where app_payment_invoice_id=i.id for update;
 if f.amount<>i.amount or f.paid_at is not null or f.type<>'RECEITA' then raise exception 'Financeiro divergente; confira a fatura.';end if;
 if not p_apply then return jsonb_build_object('state','PREPARED');end if;
 if exists(select 1 from public.app_invoice_provider_payments where invoice_id=i.id) then
 if i.status<>'CANCELADA' or i.provider_status<>'CANCELLED' or f.status<>'CANCELADO'
 or not exists(select 1 from public.app_invoice_provider_payments where invoice_id=i.id and status='CANCELLED')
 or not exists(select 1 from private.monthly_invoice_adjustments where invoice_id=i.id and operation='cancel') then
 raise exception 'Cancele e confira a cobrança no Asaas antes de suspender a inscrição.';end if;
 else
 if i.payment_method not in ('CLUB_PIX','CASH') or f.status not in ('ABERTO','VENCIDO','CANCELADO') then raise exception 'Fatura não permite cancelamento manual.';end if;
 perform pg_catalog.set_config('ilha.monthly_billing_write','1',true);
 update public.app_payment_invoices set status='CANCELADA',notes=concat_ws(E'\n',nullif(notes,''),'Suspensão administrativa: '||trim(p_reason)),updated_at=now() where id=i.id;
 update public.financial_transactions set status='CANCELADO',updated_at=now() where id=f.id;
 end if;
 clients:=case when p_payer then array[c.id] else '{}'::uuid[] end;
 select clients||coalesce(array_agg(member_client_id) filter(where member_client_id is not null),'{}'::uuid[]) into clients
 from public.app_family_members where id=any(p_member_ids);
 select coalesce(array_agg(id),'{}'::uuid[]) into selected_student_ids from public.students where app_client_id=any(clients)
 or id in(select student_id from public.app_family_members where id=any(p_member_ids));
 before_state:=before_state||jsonb_build_object('invoice',to_jsonb(i),'ledger',to_jsonb(f),'students',(select jsonb_agg(to_jsonb(s)) from public.students s where id=any(selected_student_ids)),
 'lessons',(select jsonb_agg(to_jsonb(e)) from public.lesson_enrollments e where student_id=any(selected_student_ids)));
 insert into private.overdue_enrollment_suspensions values(i.id,auth.uid(),trim(p_reason),p_payer,p_member_ids,before_state,now());
 foreach p_invoice_id in array clients loop
 perform public.admin_set_app_monthly_billing_enrollment(p_invoice_id,false,coalesce((select billing_method from public.app_monthly_billing_enrollments where client_id=p_invoice_id),'ASAAS_PIX'));
 end loop;
 update public.app_clients set status='SUSPENSO',notes=concat_ws(E'\n',nullif(notes,''),'Inscrição suspensa: '||trim(p_reason)),updated_at=now() where id=any(clients);
 for m in select * from public.app_family_members where id=any(p_member_ids) loop
 update public.app_family_members set billing_paused=true,billing_pause_reason=trim(p_reason),classes_suspended=true where id=m.id;
 end loop;
 update public.lesson_enrollments set active=false,updated_at=now() where student_id=any(selected_student_ids) and active;
 update public.students set status='INATIVO',relationship_status='INATIVO',updated_at=now() where id=any(selected_student_ids);
 return jsonb_build_object('state','COMPLETED');
end;$$;
revoke all on function public.admin_overdue_suspension(uuid,boolean,uuid[],text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_overdue_suspension(uuid,boolean,uuid[],text,text,boolean) to authenticated;

create table private.enrollment_resumptions (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),
 client_id uuid,member_id uuid,reason text not null,before_state jsonb not null,created_at timestamptz not null default now()
);
revoke all on private.enrollment_resumptions from public,anon,authenticated,service_role;
create function public.admin_resume_suspended_enrollment(p_client_id uuid default null,p_member_id uuid default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare clients uuid[]; members uuid[]; selected_student_ids uuid[]; before_state jsonb;
begin
 if auth.uid() is null or not coalesce(public.has_club_permission('finance.write'),false)
 or not coalesce(public.has_club_permission('clients.write'),false) or not coalesce(public.has_club_permission('classes'),false) then
 raise exception 'Sem permissão para retomar aulas.' using errcode='42501';end if;
 if (p_client_id is null)=(p_member_id is null) or length(trim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Informe aluno e motivo da retomada.';end if;
 if p_member_id is not null then
 perform 1 from public.app_family_members where id=p_member_id and classes_suspended for update;
 if not found then raise exception 'Inscrição não está suspensa.';end if;
 members:=array[p_member_id];clients:='{}';
 else
 perform 1 from public.app_clients where id=p_client_id and status='SUSPENSO' for update;
 if not found then raise exception 'Inscrição não está suspensa.';end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into members from public.app_family_members
 where (billing_responsible_id=p_client_id or member_client_id=p_client_id) and classes_suspended;
 clients:=array[p_client_id];
 end if;
 select clients||coalesce(array_agg(member_client_id) filter(where member_client_id is not null),'{}'::uuid[]) into clients from public.app_family_members where id=any(members);
 select coalesce(array_agg(id),'{}'::uuid[]) into selected_student_ids from public.students where app_client_id=any(clients) or id in(select student_id from public.app_family_members where id=any(members));
 before_state:=jsonb_build_object('clients',(select jsonb_agg(to_jsonb(c)) from public.app_clients c where id=any(clients)),
 'members',(select jsonb_agg(to_jsonb(m)) from public.app_family_members m where id=any(members)));
 insert into private.enrollment_resumptions(actor_id,client_id,member_id,reason,before_state) values(auth.uid(),p_client_id,p_member_id,trim(p_reason),before_state);
 update public.app_family_members set classes_suspended=false where id=any(members);
 update public.app_clients set status='ATIVO',notes=concat_ws(E'\n',nullif(notes,''),'Inscrição retomada: '||trim(p_reason)),updated_at=now() where id=any(clients) and status='SUSPENSO';
 update public.students set status='ATIVO',relationship_status='ATIVO',updated_at=now() where id=any(selected_student_ids)
 and not exists(select 1 from public.app_clients c where c.id=app_client_id and c.client_type='responsavel');
 return jsonb_build_object('state','COMPLETED');
end;$$;
revoke all on function public.admin_resume_suspended_enrollment(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_resume_suspended_enrollment(uuid,uuid,text) to authenticated;
commit;
