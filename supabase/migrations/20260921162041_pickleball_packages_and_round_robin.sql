begin;

-- Doubles are ONE draw entry, with two independently priced participants.
-- Private membership prevents a second public athlete FK from making legacy
-- PostgREST tournament_athletes joins ambiguous.
create table private.tournament_package_members (
  registration_id uuid not null references public.tournament_registrations(id) on delete cascade,
  athlete_id uuid not null references public.tournament_athletes(id),
  amount numeric(10,2) not null check (amount >= 0),
  primary key (registration_id, athlete_id)
);
create index tournament_package_members_athlete_idx on private.tournament_package_members(athlete_id, registration_id);
alter table private.tournament_package_members enable row level security;
revoke all on private.tournament_package_members from public, anon, authenticated;
grant select, insert, update, delete on private.tournament_package_members to service_role;

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
  names text[]; partner text; birth date;
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

  if jsonb_typeof(p_athletes) is distinct from 'array' or jsonb_array_length(p_athletes) not between 1 and 6
     or jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 9 then
    raise exception 'Informe de 1 a 6 atletas e até 9 inscrições.' using errcode='22023';
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
  -- Stable identity locks also protect new shared athlete creation.
  for person in select value from jsonb_array_elements(p_athletes) order by value->>'cpf' loop
    if person->>'cpf' !~ '^[0-9]{11}$' or length(trim(person->>'full_name')) not between 2 and 120
       or coalesce(person->>'gender','') not in ('MALE','FEMALE')
       or coalesce(person->>'key','') !~ '^[a-zA-Z0-9_-]{1,40}$'
       or coalesce(person->>'birth_date','') !~ '^\d{4}-\d{2}-\d{2}$'
       or roster ? (person->>'key') then
      raise exception 'Confira nome, CPF, sexo e nascimento de todos os atletas.' using errcode='22023';
    end if;
    birth := (person->>'birth_date')::date;
    if birth>t.starts_on or birth<date '1900-01-01' then raise exception 'Data de nascimento inválida.' using errcode='22023'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(person->>'cpf',20260921162042));
    select * into a from public.tournament_athletes where cpf=person->>'cpf' limit 1;
    if a.id is null then
      insert into public.tournament_athletes(full_name,cpf,birth_date,gender,phone,email,is_minor,guardian_name,guardian_phone)
      values(trim(person->>'full_name'),person->>'cpf',birth,person->>'gender',p_payer->>'phone',p_payer->>'email',
        extract(year from age(t.starts_on,birth))<18,p_payer->>'full_name',p_payer->>'phone') returning * into a;
    elsif not a.active or a.status <> 'ACTIVE' then
      raise exception 'Um dos atletas está desativado. Fale com a organização.' using errcode='P0001';
    end if;
    if exists(select 1 from jsonb_each(roster) x where x.value->>'id'=a.id::text) then
      raise exception 'Cadastre cada atleta apenas uma vez na lista.' using errcode='22023';
    end if;
    -- Do not overwrite a shared athlete's identity or Ilha Open registration.
    roster := roster || jsonb_build_object(person->>'key',person || jsonb_build_object('id',a.id));
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
      if (c.settings ? 'age_min' and age_years<(c.settings->>'age_min')::int)
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
      if n>3 then raise exception 'Cada atleta pode participar de até 3 classes.' using errcode='P0001'; end if;
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

alter table public.tournament_categories drop constraint tournament_categories_draw_size_check;
alter table public.tournament_categories add constraint tournament_categories_draw_size_check check (
  draw_size is null or (draw_format='ROUND_ROBIN' and draw_size>=2)
  or (draw_format='GROUPS_AND_KNOCKOUT' and draw_size>=3)
  or (draw_format='SINGLE_ELIMINATION' and draw_size in (2,4,8,16,32,64,128))
);

create or replace function public.tournament_replace_round_robin_atomic(
  p_tournament_id uuid,
  p_category_id uuid,
  p_athlete_ids uuid[],
  p_overwrite boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_category public.tournament_categories%rowtype;
  previous_matches jsonb := '[]'::jsonb;
  inserted_matches jsonb := '[]'::jsonb;
  confirmed_count integer;
  pending_count integer;
  athlete_count integer := coalesce(cardinality(p_athlete_ids), 0);
  requested_athlete_count integer;
  matched_confirmed_count integer;
  expected_group_match_count integer;
  group_match_no integer := 0;
  first_index integer;
  second_index integer;
  group_match_id uuid;
  final_match_id uuid := gen_random_uuid();
begin
  if (select auth.uid()) is null
     or not public.has_tournament_permission('tournaments.write') then
    raise exception 'Você não tem permissão para gerar grupos.' using errcode = '42501';
  end if;

  if p_tournament_id is null or p_category_id is null then
    raise exception 'Torneio e classe são obrigatórios.' using errcode = '22023';
  end if;

  select tournament_category.*
    into target_category
  from public.tournament_categories as tournament_category
  where tournament_category.id = p_category_id
    and tournament_category.tournament_id = p_tournament_id;

  if not found then
    raise exception 'Classe não encontrada neste torneio.' using errcode = '22023';
  end if;

  perform 1
  from public.tournament_registrations as registration
  where registration.tournament_id = p_tournament_id
    and registration.category_id = p_category_id
  order by registration.id
  for update;

  select tournament_category.*
    into target_category
  from public.tournament_categories as tournament_category
  where tournament_category.id = p_category_id
    and tournament_category.tournament_id = p_tournament_id
  for update;

  if not found then
    raise exception 'Classe não encontrada neste torneio.' using errcode = '22023';
  end if;

  perform 1
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = p_tournament_id
    and tournament_match.category_id = p_category_id
  order by
    case when upper(coalesce(tournament_match.phase, tournament_match.round_code, '')) = 'FINAL' then 1 else 0 end,
    tournament_match.round_no,
    tournament_match.match_no,
    tournament_match.id
  for update;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_category_id::text, 928617403)
  );

  select count(distinct athlete_id)::integer
    into requested_athlete_count
  from unnest(p_athlete_ids) as athlete_id;

  select
    count(*) filter (where registration.status = 'CONFIRMED')::integer,
    count(*) filter (where registration.status = 'PENDING')::integer,
    count(*) filter (
      where registration.status = 'CONFIRMED'
        and registration.athlete_id = any(p_athlete_ids)
    )::integer
    into confirmed_count, pending_count, matched_confirmed_count
  from public.tournament_registrations as registration
  join public.tournament_athletes a on a.id=registration.athlete_id and a.active and a.status='ACTIVE'
  where registration.tournament_id = p_tournament_id
    and registration.category_id = p_category_id;

  if target_category.draw_format <> 'ROUND_ROBIN' then
    raise exception 'Esta classe não usa todos contra todos.' using errcode = '22023';
  end if;

  if athlete_count < 2
     or requested_athlete_count <> athlete_count
     or confirmed_count <> athlete_count
     or pending_count <> 0
     or matched_confirmed_count <> athlete_count then
    raise exception 'O grupo exige pelo menos duas inscrições confirmadas, atletas distintos e nenhuma inscrição pendente.' using errcode = '22023';
  end if;

  if target_category.min_entries > athlete_count then
    raise exception 'A configuração mínima da classe é incompatível com a quantidade atual de atletas.' using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(tournament_match) order by tournament_match.round_no, tournament_match.match_no),
    '[]'::jsonb
  )
    into previous_matches
  from public.tournament_matches as tournament_match
  where tournament_match.category_id = p_category_id;

  if jsonb_array_length(previous_matches) > 0 and not coalesce(p_overwrite, false) then
    raise exception 'Esta classe já possui jogos. Confirme a substituição para continuar.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.tournament_matches as tournament_match
    where tournament_match.category_id = p_category_id
      and tournament_match.winner_athlete_id is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Esta classe já possui resultados; não é possível substituir os jogos.';
  end if;

  delete from public.tournament_matches
  where category_id = p_category_id;

  expected_group_match_count := (athlete_count * (athlete_count - 1)) / 2;

  for first_index in 1..(athlete_count - 1) loop
    for second_index in (first_index + 1)..athlete_count loop
      group_match_no := group_match_no + 1;
      group_match_id := gen_random_uuid();

      insert into public.tournament_matches (
        id, legacy_key, tournament_id, category_id, round_no, round_code, phase, match_no,
        side1_athlete_id, side2_athlete_id, winner_athlete_id,
        source1_match_id, source2_match_id, status, sort_order, published, metadata
      ) values (
        group_match_id,
        'group:' || p_category_id::text || ':' || group_match_id::text,
        p_tournament_id,
        p_category_id,
        group_match_no,
        'GROUP',
        'GROUP',
        group_match_no,
        p_athlete_ids[first_index],
        p_athlete_ids[second_index],
        null,
        null,
        null,
        'PENDING',
        group_match_no * 1000 + 10,
        false,
        jsonb_build_object(
          'generated', true,
          'format', 'ROUND_ROBIN',
          'group', 'A',
          'group_size', athlete_count
        )
      );
    end loop;
  end loop;

  update public.tournament_categories
  set draw_format = 'ROUND_ROBIN',
      draw_size = athlete_count,
      max_entries = athlete_count,
      registration_open = false,
      settings = (
        case
          when jsonb_typeof(settings) = 'object' then settings
          else '{}'::jsonb
        end
      ) || jsonb_build_object(
        'group_stage_previous_max_entries',
        case
          when jsonb_typeof(settings) = 'object'
            and settings ? 'group_stage_previous_max_entries'
          then settings -> 'group_stage_previous_max_entries'
          else to_jsonb(target_category.max_entries)
        end
      ),
      updated_at = now()
  where id = p_category_id
    and tournament_id = p_tournament_id;

  select coalesce(
    jsonb_agg(to_jsonb(tournament_match) order by tournament_match.round_no, tournament_match.match_no),
    '[]'::jsonb
  )
    into inserted_matches
  from public.tournament_matches as tournament_match
  where tournament_match.category_id = p_category_id;

  if jsonb_array_length(inserted_matches) <> expected_group_match_count then
    raise exception 'O grupo não foi gravado por completo.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'category_id', p_category_id,
    'draw_format', 'ROUND_ROBIN',
    'draw_size', athlete_count,
    'group_match_count', expected_group_match_count,
    'previous_matches', previous_matches,
    'matches', inserted_matches
  );
end;
$$;

alter function public.tournament_replace_round_robin_atomic(uuid, uuid, uuid[], boolean)
  owner to postgres;
comment on function public.tournament_replace_round_robin_atomic(uuid, uuid, uuid[], boolean) is
  'Creates round robin matches without a final; champion is determined by standings.';
revoke all on function public.tournament_replace_round_robin_atomic(uuid, uuid, uuid[], boolean)
  from public, anon, service_role;
grant execute on function public.tournament_replace_round_robin_atomic(uuid, uuid, uuid[], boolean)
  to authenticated;

create or replace function public.tournament_public_snapshot(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  snapshot jsonb;
  stored_settings jsonb;
  stored_theme jsonb;
  public_settings jsonb;
  public_theme jsonb;
begin
  snapshot := private.tournament_public_snapshot_legacy_unsafe(p_slug);
  if snapshot is null or not (snapshot ? 'tournament') then
    return snapshot;
  end if;

  stored_settings := coalesce(snapshot #> '{tournament,settings}', '{}'::jsonb);
  public_settings := jsonb_strip_nulls(jsonb_build_object(
    'public_tabs', stored_settings -> 'public_tabs',
    'about_event', stored_settings -> 'about_event',
    'registration_pricing', stored_settings -> 'registration_pricing',
    'spatial_addon_fee', stored_settings -> 'spatial_addon_fee',
    'spatial_addons', stored_settings -> 'spatial_addons',
    'spatial_event_period_label', stored_settings -> 'spatial_event_period_label',
    'intro_video', stored_settings -> 'intro_video',
    'sport', stored_settings -> 'sport',
    'registration_mode', stored_settings -> 'registration_mode',
    'package_prices', stored_settings -> 'package_prices',
    'match_rules', stored_settings -> 'match_rules'
  ));

  stored_theme := coalesce(snapshot #> '{tournament,theme}', '{}'::jsonb);
  public_theme := jsonb_strip_nulls(jsonb_build_object(
    'primary', stored_theme -> 'primary',
    'accent', stored_theme -> 'accent',
    'surface', stored_theme -> 'surface',
    'background', stored_theme -> 'background',
    'text', stored_theme -> 'text'
  ));

  snapshot := jsonb_set(
    snapshot,
    '{tournament}',
    coalesce(snapshot -> 'tournament', '{}'::jsonb) - 'courtesy_registration_token',
    true
  );
  snapshot := jsonb_set(snapshot, '{tournament,settings}', public_settings, true);
  snapshot := jsonb_set(snapshot, '{tournament,theme}', public_theme, true);
  snapshot := jsonb_set(snapshot, '{categories}', coalesce((
    select jsonb_agg(item.value || jsonb_build_object('settings', jsonb_strip_nulls(jsonb_build_object(
      'score_format',c.settings->'score_format','age_min',c.settings->'age_min','age_max',c.settings->'age_max'
    ))) order by item.ordinality)
    from jsonb_array_elements(snapshot->'categories') with ordinality as item(value,ordinality)
    join public.tournament_categories c on c.id=(item.value->>'id')::uuid
  ),'[]'::jsonb),true);
  return snapshot;
end;
$$;

alter function public.tournament_public_snapshot(text) owner to postgres;
comment on function public.tournament_public_snapshot(text) is
  'Public tournament projection with allow-listed settings, intro video and theme fields.';
revoke all on function public.tournament_public_snapshot(text)
  from public, anon, authenticated, service_role;
grant execute on function public.tournament_public_snapshot(text)
  to anon, authenticated, service_role;

-- Validate the actual saved score for every admin/API writer, scoped by class.
create function public.validate_pickleball_match_score() returns trigger
language plpgsql security definer set search_path='' as $$
declare format text; pair text[]; left_points int; right_points int; wins1 int:=0; wins2 int:=0; sets int:=0; complete boolean;
begin
  select settings->>'score_format' into format from public.tournament_categories where id=new.category_id;
  if format is distinct from 'BEST_OF_3_ST10' then return new; end if;
  if new.status='WALKOVER' then
    if new.winner_athlete_id is null or new.winner_athlete_id not in (new.side1_athlete_id,new.side2_athlete_id) then
      raise exception 'Informe o vencedor do W.O.' using errcode='22023';
    end if;
    return new;
  end if;
  if coalesce(trim(new.score),'')='' then
    if new.winner_athlete_id is not null then raise exception 'Informe os sets vencidos antes de finalizar.' using errcode='22023'; end if;
    return new;
  end if;
  if new.score !~ '^\s*(ST|TB)?\s*[0-9]{1,3}[xX/-][0-9]{1,3}(\s+(ST|TB)?\s*[0-9]{1,3}[xX/-][0-9]{1,3}){0,2}\s*$' then
    raise exception 'Use até 3 sets em pontos, por exemplo 10x7 8x10 ST10x6.' using errcode='22023';
  end if;
  for pair in select regexp_matches(new.score,'([0-9]+)[xX/-]([0-9]+)','g') loop
    if wins1=2 or wins2=2 or complete=false then raise exception 'Placar possui set extra ou set anterior incompleto.' using errcode='22023'; end if;
    left_points:=pair[1]::int; right_points:=pair[2]::int; sets:=sets+1;
    complete:=greatest(left_points,right_points)>=10 and abs(left_points-right_points)>=2;
    if complete and ((greatest(left_points,right_points)=10 and least(left_points,right_points)>8)
       or (greatest(left_points,right_points)>10 and abs(left_points-right_points)<>2)) then
      raise exception 'O set termina em 10 pontos, com 2 de diferença, ou na primeira vantagem de 2 após o empate.' using errcode='22023';
    end if;
    if complete and left_points>right_points then wins1:=wins1+1; end if;
    if complete and right_points>left_points then wins2:=wins2+1; end if;
  end loop;
  if new.winner_athlete_id is not null and
     ((wins1<>2 and wins2<>2) or new.winner_athlete_id is distinct from case when wins1=2 then new.side1_athlete_id else new.side2_athlete_id end) then
    raise exception 'O vencedor deve ganhar 2 super tiebreaks.' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_pickleball_match_score() from public,anon,authenticated,service_role;
create trigger validate_pickleball_match_score before insert or update of score,winner_athlete_id,status on public.tournament_matches
for each row execute function public.validate_pickleball_match_score();

commit;
