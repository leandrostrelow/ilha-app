-- Keep the validator portable for local CI and preview projects. Access stays
-- limited to the two first-party bucket names and the expected media formats.
create or replace function public.is_valid_bar_tv_slides(candidate jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(candidate) <> 'array' then false
    when jsonb_array_length(candidate) > 5 then false
    else not exists (
      select 1
      from jsonb_array_elements(candidate) as slide(value)
      where jsonb_typeof(slide.value) <> 'object'
         or jsonb_typeof(slide.value -> 'media_type') <> 'string'
         or jsonb_typeof(slide.value -> 'media_url') <> 'string'
         or case
              when slide.value ->> 'media_type' = 'image' then not (
                (slide.value ->> 'media_url') ~* '^https://[a-z0-9]{20}[.]supabase[.]co/storage/v1/object/public/bar-tv-media/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
                or (slide.value ->> 'media_url') ~* '^https://[a-z0-9]{20}[.]supabase[.]co/storage/v1/object/public/bar-products/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
                or (slide.value ->> 'media_url') ~* '^https://app[.]ilhatenis[.]com/assets/bar-events/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
              )
              when slide.value ->> 'media_type' = 'video' then not (
                (slide.value ->> 'media_url') ~* '^https://[a-z0-9]{20}[.]supabase[.]co/storage/v1/object/public/bar-tv-media/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.]mp4$'
              )
              else true
            end
         or case
              when jsonb_typeof(slide.value -> 'duration_seconds') = 'number'
                then (slide.value ->> 'duration_seconds')::numeric not between 3 and 300
              else true
            end
         or jsonb_typeof(slide.value -> 'active') <> 'boolean'
    )
  end;
$$;

revoke all on function public.is_valid_bar_tv_slides(jsonb) from public, anon;
grant execute on function public.is_valid_bar_tv_slides(jsonb) to authenticated, service_role;

alter table public.bar_tv_event_art
  drop constraint if exists bar_tv_event_art_image_url_check;

alter table public.bar_tv_event_art
  add constraint bar_tv_event_art_image_url_check check (
    image_url = ''
    or image_url ~* '^https://[a-z0-9]{20}[.]supabase[.]co/storage/v1/object/public/bar-tv-media/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
    or image_url ~* '^https://[a-z0-9]{20}[.]supabase[.]co/storage/v1/object/public/bar-products/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
    or image_url ~* '^https://app[.]ilhatenis[.]com/assets/bar-events/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
  );
