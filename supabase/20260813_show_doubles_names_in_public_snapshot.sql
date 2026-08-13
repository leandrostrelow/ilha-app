-- Exibe a dupla completa nas chaves públicas usando o nome público da inscrição.

create or replace function public.tournament_public_snapshot(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.tournaments%rowtype;
  result jsonb;
begin
  if nullif(trim(p_slug), '') is null then
    select jsonb_build_object(
      'tournaments', coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'slug', t.slug,
        'short_description', t.short_description, 'city', t.city,
        'club_name', t.club_name, 'venue', t.venue, 'status', t.status,
        'starts_on', t.starts_on, 'ends_on', t.ends_on,
        'registration_open', t.registration_open,
        'registration_closes_at', t.registration_closes_at,
        'cover_url', t.cover_url, 'logo_url', t.logo_url
      ) order by t.starts_on desc nulls last, t.name), '[]'::jsonb)
    ) into result
    from public.tournaments t
    where t.is_published = true and t.status <> 'ARCHIVED';
    return coalesce(result, jsonb_build_object('tournaments', '[]'::jsonb));
  end if;

  select * into target
  from public.tournaments t
  where lower(t.slug) = lower(trim(p_slug))
    and t.is_published = true
    and t.status <> 'ARCHIVED'
  limit 1;

  if target.id is null then return null; end if;

  return jsonb_build_object(
    'tournament', jsonb_build_object(
      'id', target.id, 'name', target.name, 'slug', target.slug, 'year', target.year,
      'short_description', target.short_description, 'description', target.description,
      'city', target.city, 'club_name', target.club_name, 'venue', target.venue,
      'timezone', target.timezone, 'logo_url', target.logo_url, 'cover_url', target.cover_url,
      'regulations_url', target.regulations_url, 'status', target.status,
      'registration_open', target.registration_open,
      'registration_opens_at', target.registration_opens_at,
      'registration_closes_at', target.registration_closes_at,
      'starts_on', target.starts_on, 'ends_on', target.ends_on,
      'default_fee', target.default_fee, 'allowed_payment_methods', target.allowed_payment_methods,
      'instagram', target.instagram, 'whatsapp', target.whatsapp,
      'settings', target.settings, 'theme', target.theme
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'tournament_id', c.tournament_id, 'code', c.code, 'name', c.name,
        'description', c.description, 'event_type', c.event_type, 'gender', c.gender,
        'class_level', c.class_level, 'draw_format', c.draw_format, 'draw_size', c.draw_size,
        'registration_fee', c.registration_fee, 'registration_open', c.registration_open,
        'max_entries', c.max_entries, 'sort_order', c.sort_order,
        'registration_count', (select count(*) from public.tournament_registrations r where r.category_id = c.id and r.status in ('CONFIRMED','WAITLIST'))
      ) order by c.sort_order, c.name)
      from public.tournament_categories c
      where c.tournament_id = target.id and c.active = true and c.is_published = true
    ), '[]'::jsonb),
    'registrations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'category_id', r.category_id, 'public_name', r.public_name,
        'public_city', r.public_city, 'public_club', r.public_club,
        'partner_name', r.partner_name, 'seed_number', r.seed_number, 'status', r.status
      ) order by r.seed_number nulls last, r.public_name)
      from public.tournament_registrations r
      where r.tournament_id = target.id and r.published = true and r.status in ('CONFIRMED','WAITLIST')
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'category_id', m.category_id, 'round_no', m.round_no,
        'round_code', m.round_code, 'phase', m.phase, 'match_no', m.match_no,
        'side1_athlete_id', m.side1_athlete_id, 'side2_athlete_id', m.side2_athlete_id,
        'winner_athlete_id', m.winner_athlete_id,
        'side1_name', coalesce(r1.public_name, a1.full_name),
        'side2_name', coalesce(r2.public_name, a2.full_name),
        'winner_name', coalesce(rw.public_name, aw.full_name),
        'source1_match_id', m.source1_match_id, 'source2_match_id', m.source2_match_id,
        'score', m.score, 'court_name', m.court_name, 'match_date', m.match_date,
        'match_time', m.match_time, 'scheduled_at', m.scheduled_at, 'status', m.status,
        'sort_order', m.sort_order, 'public_notes', m.public_notes
      ) order by m.category_id, m.round_no, m.match_no)
      from public.tournament_matches m
      left join public.tournament_athletes a1 on a1.id = m.side1_athlete_id
      left join public.tournament_athletes a2 on a2.id = m.side2_athlete_id
      left join public.tournament_athletes aw on aw.id = m.winner_athlete_id
      left join public.tournament_registrations r1
        on r1.tournament_id = m.tournament_id and r1.category_id = m.category_id
       and r1.athlete_id = m.side1_athlete_id and r1.status = 'CONFIRMED'
      left join public.tournament_registrations r2
        on r2.tournament_id = m.tournament_id and r2.category_id = m.category_id
       and r2.athlete_id = m.side2_athlete_id and r2.status = 'CONFIRMED'
      left join public.tournament_registrations rw
        on rw.tournament_id = m.tournament_id and rw.category_id = m.category_id
       and rw.athlete_id = m.winner_athlete_id and rw.status = 'CONFIRMED'
      where m.tournament_id = target.id and m.published = true
    ), '[]'::jsonb),
    'courts', coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'surface',c.surface,'sort_order',c.sort_order) order by c.sort_order,c.name)
      from public.tournament_courts c where c.tournament_id = target.id and c.active = true
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',e.id,'title',e.title,'description',e.description,'event_date',e.event_date,
        'event_time',e.event_time,'court_name',e.court_name,'status',e.status,'sort_order',e.sort_order
      ) order by e.event_date,e.event_time nulls last,e.sort_order)
      from public.tournament_schedule_events e where e.tournament_id = target.id and e.published = true
    ), '[]'::jsonb),
    'sponsors', coalesce((
      select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'logo_url',s.logo_url,'link_url',s.link_url,'tier',s.tier) order by s.sort_order,s.name)
      from public.tournament_sponsors s where s.tournament_id = target.id and s.is_published = true
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.tournament_public_snapshot(text) from public;
grant execute on function public.tournament_public_snapshot(text) to anon, authenticated;
