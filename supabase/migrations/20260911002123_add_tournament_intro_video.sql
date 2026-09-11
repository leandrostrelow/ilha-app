begin;

-- O mesmo bucket público já usado pelas artes passa a aceitar a abertura do
-- app. As validações do ADM mantêm PNG em 2 MB e MP4 em 15 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tournament-branding',
  'tournament-branding',
  true,
  15728640,
  array['image/png', 'video/mp4']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Ativa o vídeo enviado apenas no Ilha Open atual. Outros torneios continuam
-- sem intro até que o administrador escolha um arquivo e ative a opção.
update public.tournaments
set settings = jsonb_set(
      coalesce(settings, '{}'::jsonb),
      '{intro_video}',
      coalesce(
        settings -> 'intro_video',
        jsonb_build_object(
          'enabled', true,
          'url', '/assets/tournament/ilha-open-intro.mp4'
        )
      ),
      true
    ),
    updated_at = now()
where lower(slug) = 'ilha-open-2026';

-- A projeção pública é uma allow-list. Exponha somente o sinal de ativação e
-- a URL pública do vídeo, sem liberar as demais configurações privadas.
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
    'intro_video', stored_settings -> 'intro_video'
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

commit;
