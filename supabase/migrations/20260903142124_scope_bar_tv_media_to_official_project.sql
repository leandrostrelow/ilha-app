-- Keep media validation portable while preventing arbitrary Supabase projects.
-- The validator receives the allowed project ref from the table constraint, so
-- the function body stays reusable in local CI while production remains scoped.
alter table public.bar_tv_event_art
  drop constraint if exists bar_tv_event_art_slides_check;

drop function if exists public.is_valid_bar_tv_slides(jsonb);

create function public.is_valid_bar_tv_slides(
  candidate jsonb,
  allowed_project_ref text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when allowed_project_ref !~ '^[a-z0-9]{20}$' then false
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
                (slide.value ->> 'media_url') ~* (
                  '^https://' || allowed_project_ref || '[.]supabase[.]co/storage/v1/object/public/bar-tv-media/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
                )
                or (slide.value ->> 'media_url') ~* (
                  '^https://' || allowed_project_ref || '[.]supabase[.]co/storage/v1/object/public/bar-products/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
                )
                or (slide.value ->> 'media_url') ~* '^https://app[.]ilhatenis[.]com/assets/bar-events/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
              )
              when slide.value ->> 'media_type' = 'video' then not (
                (slide.value ->> 'media_url') ~* (
                  '^https://' || allowed_project_ref || '[.]supabase[.]co/storage/v1/object/public/bar-tv-media/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.]mp4$'
                )
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

revoke all on function public.is_valid_bar_tv_slides(jsonb, text) from public, anon;
grant execute on function public.is_valid_bar_tv_slides(jsonb, text) to authenticated, service_role;

alter table public.bar_tv_event_art
  add constraint bar_tv_event_art_slides_check check (
    public.is_valid_bar_tv_slides(slides, 'lkqtgptebkgfwguykxhv')
  );

alter table public.bar_tv_event_art
  drop constraint if exists bar_tv_event_art_image_url_check;

alter table public.bar_tv_event_art
  add constraint bar_tv_event_art_image_url_check check (
    image_url = ''
    or image_url ~* '^https://lkqtgptebkgfwguykxhv[.]supabase[.]co/storage/v1/object/public/bar-tv-media/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
    or image_url ~* '^https://lkqtgptebkgfwguykxhv[.]supabase[.]co/storage/v1/object/public/bar-products/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
    or image_url ~* '^https://app[.]ilhatenis[.]com/assets/bar-events/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
  );
