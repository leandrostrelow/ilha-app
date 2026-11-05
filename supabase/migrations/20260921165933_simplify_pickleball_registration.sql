begin;
create or replace function private.tournament_package_name_key(value text)
returns text language sql immutable strict set search_path='' as $$
  select lower(regexp_replace(trim(regexp_replace(normalize(value,NFD),U&'[\0300-\036f]','','g')),'\s+',' ','g'));
$$;
revoke all on function private.tournament_package_name_key(text) from public,anon,authenticated;
grant execute on function private.tournament_package_name_key(text) to service_role;

create or replace function public.claim_tournament_package_checkout(
  p_tournament_id uuid, p_request_token uuid, p_payer jsonb,
  p_athletes jsonb, p_entries jsonb, p_provider_environment text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.tournaments%rowtype;
  c public.tournament_categories%rowtype;
  g public.tournament_registration_groups%rowtype;
  a public.tournament_athletes%rowtype;
  entry jsonb; person jsonb; member_key text; member_id uuid;
  roster jsonb := '{}'::jsonb;
  counts jsonb := '{}'::jsonb;
  members jsonb; resolved jsonb := '[]'::jsonb;
  probed jsonb; new_id uuid; first_id uuid; captain uuid;
  n integer; age_years integer; male_count integer; participant_count integer;
  increment numeric; entry_amount numeric; total numeric := 0;
  names text[]; partner text; birth date; identity_key text; matching_ids uuid[];
begin
  if coalesce((select auth.jwt()->>'role'),'') <> 'service_role' then
    raise exception 'Acesso negado.' using errcode='42501';
  end if;
  -- The proven family checkout owns payment retry, expiry and Asaas outbox.
  -- Its request lock and payment -> group order are also used on this path.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_token::text,20260901032343));
  probed := public.claim_public_tournament_family_checkout(p_tournament_id,p_request_token,
    p_payer->>'full_name',p_payer->>'email',p_payer->>'phone',p_payer->>'cpf',
    '[{}]'::jsonb,'PIX',p_provider_environment,null,false);
  if coalesce((probed->>'found')::boolean,false) or coalesce((probed->>'expired')::boolean,false) then return probed; end if;

  if jsonb_typeof(p_athletes) is distinct from 'array' or jsonb_array_length(p_athletes) not between 1 and 18
     or jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 36 then
    raise exception 'Informe de 1 a 18 atletas e até 36 inscrições.' using errcode='22023';
  end if;
  -- Serialize package allocation so a partner cannot claim overlapping tiers
  -- in two simultaneous checkouts. No Asaas/network work happens in this lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tournament_id::text,20260921162041));
  select * into t from public.tournaments where id=p_tournament_id;
  if not found or t.settings->>'registration_mode' is distinct from 'ATHLETE_PACKAGES'
     or not t.is_published or not t.registration_open or t.status <> 'REGISTRATION_OPEN'
     or (t.registration_opens_at is not null and now()<t.registration_opens_at)
     or (t.registration_closes_at is not null and now()>t.registration_closes_at) then
    raise exception 'As inscrições deste torneio estão fechadas.' using errcode='P0001';
  end if;
  -- Serialize name identity within this event only. Never infer CPF or date of birth.
  for person in select value from jsonb_array_elements(p_athletes) order by value->>'cpf' loop
    if length(trim(coalesce(person->>'full_name',''))) not between 2 and 120
       or (nullif(person->>'cpf','') is not null and person->>'cpf' !~ '^[0-9]{11}$')
       or coalesce(person->>'gender','') not in ('MALE','FEMALE','NOT_INFORMED')
       or coalesce(person->>'key','') !~ '^[a-zA-Z0-9_-]{1,40}$'
       or (nullif(person->>'birth_date','') is not null and person->>'birth_date' !~ '^\d{4}-\d{2}-\d{2}$')
       or roster ? (person->>'key') then
      raise exception 'Confira o nome dos atletas e o nascimento nas classes de base.' using errcode='22023';
    end if;
    birth := nullif(person->>'birth_date','')::date;
    if birth>t.starts_on or birth<date '1900-01-01' then raise exception 'Data de nascimento inválida.' using errcode='22023'; end if;
    identity_key := 'pickleball:'||t.id||':'||md5(private.tournament_package_name_key(person->>'full_name'));
    select * into a from public.tournament_athletes where source_key=identity_key;
    if a.id is null and nullif(person->>'cpf','') is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(person->>'cpf',20260921162042));
      select * into a from public.tournament_athletes where cpf=person->>'cpf' limit 1;
    end if;
    if a.id is null then
      -- Compatibility with packages already registered through the CPF form or ADM.
      select array_agg(distinct ta.id) into matching_ids from public.tournament_athletes ta
      where private.tournament_package_name_key(ta.full_name)=private.tournament_package_name_key(person->>'full_name')
        and exists(select 1 from public.tournament_registrations r where r.tournament_id=t.id
          and (r.athlete_id=ta.id or exists(select 1 from private.tournament_package_members m where m.registration_id=r.id and m.athlete_id=ta.id)));
      if cardinality(matching_ids)>1 then raise exception 'Há cadastros com o mesmo nome. Fale com a organização para conferir.' using errcode='P0001'; end if;
      if cardinality(matching_ids)=1 then select * into a from public.tournament_athletes where id=matching_ids[1]; end if;
    end if;
    if a.id is null then
      insert into public.tournament_athletes(source_key,full_name,cpf,birth_date,gender,phone,email,is_minor,guardian_name,guardian_phone)
      values(identity_key,trim(person->>'full_name'),nullif(person->>'cpf',''),birth,person->>'gender',p_payer->>'phone',p_payer->>'email',
        coalesce(extract(year from age(t.starts_on,birth))<18,false),p_payer->>'full_name',p_payer->>'phone') returning * into a;
    elsif not a.active or a.status <> 'ACTIVE' then
      raise exception 'Um dos atletas está desativado. Fale com a organização.' using errcode='P0001';
    end if;
    if (a.birth_date is not null and birth is not null and a.birth_date<>birth)
       or (a.gender in ('MALE','FEMALE') and person->>'gender' in ('MALE','FEMALE') and a.gender<>person->>'gender') then
      raise exception 'Os dados não correspondem ao cadastro deste nome. Confira com a organização.' using errcode='P0001';
    end if;
    if exists(select 1 from jsonb_each(roster) x where x.value->>'id'=a.id::text
      or private.tournament_package_name_key(x.value->>'full_name')=private.tournament_package_name_key(person->>'full_name')) then
      raise exception 'Use o mesmo participante nas classes, sem repetir seu nome na lista de atletas.' using errcode='22023';
    end if;
    -- Only enrich records created by this new flow; shared tennis profiles stay untouched.
    if a.source_key=identity_key and (a.birth_date is null or a.gender='NOT_INFORMED') then
      update public.tournament_athletes set birth_date=coalesce(birth_date,birth),
        is_minor=case when birth is not null then extract(year from age(t.starts_on,birth))<18 else is_minor end,
        gender=case when gender='NOT_INFORMED' then person->>'gender' else gender end
      where id=a.id;
    end if;
    roster := roster || jsonb_build_object(person->>'key',person || jsonb_build_object('id',a.id,'birth_date',coalesce(birth,a.birth_date)));
  end loop;
  perform 1 from public.tournament_categories where tournament_id=t.id
    and id in (select (value->>'category_id')::uuid from jsonb_array_elements(p_entries)) order by id for update;
  for entry in select value from jsonb_array_elements(p_entries) loop
    select * into c from public.tournament_categories where id=(entry->>'category_id')::uuid and tournament_id=t.id;
    if not found or not c.active or not c.registration_open or not c.is_published
       or exists(select 1 from public.tournament_matches where category_id=c.id) then
      raise exception 'Uma das classes não está mais aberta para inscrições.' using errcode='P0001';
    end if;
    if c.max_entries is not null and
       (select count(*) from public.tournament_registrations where category_id=c.id and status in ('PENDING','CONFIRMED'))
       + (select count(*) from jsonb_array_elements(resolved) where value->>'category_id'=c.id::text) >= c.max_entries then
      raise exception 'Uma das classes está lotada.' using errcode='P0001';
    end if;
    members:=entry->'members'; participant_count:=case when c.event_type='DOUBLES' then 2 else 1 end;
    if jsonb_typeof(members) is distinct from 'array' or jsonb_array_length(members)<>participant_count then
      raise exception 'Informe os dois integrantes da dupla ou um atleta em simples.' using errcode='22023';
    end if;
    names:='{}'; entry_amount:=0; male_count:=0; captain:=null;
    for member_key in select jsonb_array_elements_text(members) loop
      person:=roster->member_key; member_id:=(person->>'id')::uuid;
      if member_id is null then raise exception 'Atleta não encontrado na inscrição.' using errcode='22023'; end if;
      if (select count(*) from jsonb_array_elements_text(members) x where x=member_key)>1 then
        raise exception 'Os integrantes da dupla precisam ser diferentes.' using errcode='22023';
      end if;
      age_years:=extract(year from age(t.starts_on,(person->>'birth_date')::date));
      if ((c.settings ? 'age_min' or c.settings ? 'age_max') and age_years is null)
         or (c.settings ? 'age_min' and age_years<(c.settings->>'age_min')::int)
         or (c.settings ? 'age_max' and age_years>(c.settings->>'age_max')::int)
         or (c.gender in ('MALE','FEMALE') and c.gender<>person->>'gender') then
        raise exception 'Idade ou sexo incompatível com a classe %.',c.name using errcode='P0001';
      end if;
      if person->>'gender'='MALE' then male_count:=male_count+1; end if;
      if exists(select 1 from private.tournament_package_members m join public.tournament_registrations r on r.id=m.registration_id
        where m.athlete_id=member_id and r.category_id=c.id and r.status in ('PENDING','CONFIRMED','WAITLIST'))
        or exists(select 1 from public.tournament_registrations r where r.athlete_id=member_id and r.category_id=c.id and r.status in ('PENDING','CONFIRMED','WAITLIST'))
        or exists(select 1 from jsonb_array_elements(resolved) x where x.value->>'category_id'=c.id::text and (x.value->'members') ? member_key) then
        raise exception 'Um dos atletas já está inscrito nesta classe.' using errcode='P0001';
      end if;
      -- A separate unpaid checkout cannot fund a discounted tier. Otherwise
      -- paying the R$30 complement and abandoning the R$50 Pix would undercharge.
      -- Same-request retries have already returned through the idempotency probe.
      if exists(select 1 from public.tournament_registrations r
        where r.tournament_id=t.id and r.status in ('PENDING','CONFIRMED','WAITLIST')
          and r.payment_status not in ('PAID','NOT_REQUIRED')
          and (r.athlete_id=member_id or exists(select 1 from private.tournament_package_members m
            where m.registration_id=r.id and m.athlete_id=member_id))) then
        raise exception 'Um dos atletas tem um Pix pendente. Conclua o pagamento ou aguarde a expiração antes de adicionar outras classes.' using errcode='P0001';
      end if;
      select count(distinct r.category_id) into n from public.tournament_registrations r
        where r.tournament_id=t.id and r.status in ('PENDING','CONFIRMED','WAITLIST')
          and (r.athlete_id=member_id or exists(select 1 from private.tournament_package_members m where m.registration_id=r.id and m.athlete_id=member_id));
      n:=n+coalesce((counts->>member_key)::int,0)+1;
      if n>4 then raise exception 'Cada atleta pode participar de até 4 classes.' using errcode='P0001'; end if;
      increment:=case n when 1 then 50 when 2 then 30 else 10 end;
      counts:=counts||jsonb_build_object(member_key,coalesce((counts->>member_key)::int,0)+1);
      entry_amount:=entry_amount+increment;
      entry:=jsonb_set(entry,array['prices'],coalesce(entry->'prices','{}')||jsonb_build_object(member_key,increment),true);
      names:=array_append(names,person->>'full_name');
      captain:=coalesce(captain,member_id);
    end loop;
    if c.gender='MIXED' and male_count<>1 then raise exception 'A dupla mista deve ter um atleta masculino e uma atleta feminina.' using errcode='P0001'; end if;
    resolved:=resolved||jsonb_build_array(entry||jsonb_build_object('captain',captain,'names',to_jsonb(names),'amount',entry_amount));
    total:=total+entry_amount;
  end loop;
  if (select count(*) from jsonb_each(counts)) <> jsonb_array_length(p_athletes) then
    raise exception 'Selecione uma classe para cada atleta cadastrado.' using errcode='22023';
  end if;
  insert into public.tournament_registration_groups(tournament_id,request_token,payer_name,payer_email,payer_phone,payer_cpf,total_amount)
  values(t.id,p_request_token,p_payer->>'full_name',p_payer->>'email',p_payer->>'phone',p_payer->>'cpf',total) returning * into g;
  for entry in select value from jsonb_array_elements(resolved) loop
    partner:=entry#>>'{names,1}';
    insert into public.tournament_registrations(tournament_id,category_id,athlete_id,public_name,partner_name,total_amount,registration_group_id,source,terms_accepted_at)
    values(t.id,(entry->>'category_id')::uuid,(entry->>'captain')::uuid,
      concat_ws(' / ',entry#>>'{names,0}',partner),partner,(entry->>'amount')::numeric,g.id,'PUBLIC',now()) returning id into new_id;
    first_id:=coalesce(first_id,new_id);
    for member_key in select jsonb_array_elements_text(entry->'members') loop
      insert into private.tournament_package_members(registration_id,athlete_id,amount)
      values(new_id,(roster#>>array[member_key,'id'])::uuid,(entry#>>array['prices',member_key])::numeric);
    end loop;
  end loop;
  update public.tournament_registration_groups set primary_registration_id=first_id where id=g.id;
  return public.claim_public_tournament_family_checkout(t.id,p_request_token,p_payer->>'full_name',p_payer->>'email',
    p_payer->>'phone',p_payer->>'cpf','[{}]'::jsonb,'PIX',p_provider_environment,null,false);
end;
$$;
revoke all on function public.claim_tournament_package_checkout(uuid,uuid,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_tournament_package_checkout(uuid,uuid,jsonb,jsonb,jsonb,text) to service_role;

-- Update only the new event; the Ilha Open is intentionally untouched.
update public.tournaments set
  settings=jsonb_set(jsonb_set(settings,'{package_prices}','{"1":50,"2":80,"3":90,"4":100}'::jsonb),
    '{about_event,text}',to_jsonb(replace(settings#>>'{about_event,text}',
      '3 classes R$ 90.','3 classes R$ 90, 4 classes R$ 100.'))),
  updated_at=now()
where slug='ilha-pickleball-open-2026';
commit;
