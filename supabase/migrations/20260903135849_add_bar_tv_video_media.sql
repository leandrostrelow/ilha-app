insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bar-tv-media',
  'bar-tv-media',
  true,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "bar menu staff reads tv media" on storage.objects;
drop policy if exists "bar menu staff uploads tv media" on storage.objects;
drop policy if exists "bar menu staff updates tv media" on storage.objects;
drop policy if exists "bar menu staff deletes tv media" on storage.objects;

create policy "bar menu staff reads tv media"
on storage.objects for select
to authenticated
using (
  bucket_id = 'bar-tv-media'
  and (storage.foldername(name))[1] = 'eventos'
  and (select public.has_bar_permission('bar.menu'))
);

create policy "bar menu staff uploads tv media"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'bar-tv-media'
  and (storage.foldername(name))[1] = 'eventos'
  and (select public.has_bar_permission('bar.menu'))
);

create policy "bar menu staff updates tv media"
on storage.objects for update
to authenticated
using (
  bucket_id = 'bar-tv-media'
  and (storage.foldername(name))[1] = 'eventos'
  and (select public.has_bar_permission('bar.menu'))
)
with check (
  bucket_id = 'bar-tv-media'
  and (storage.foldername(name))[1] = 'eventos'
  and (select public.has_bar_permission('bar.menu'))
);

create policy "bar menu staff deletes tv media"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'bar-tv-media'
  and (storage.foldername(name))[1] = 'eventos'
  and (select public.has_bar_permission('bar.menu'))
);

alter table public.bar_tv_event_art
  drop constraint if exists bar_tv_event_art_slides_check;

update public.bar_tv_event_art as art
set slides = coalesce(
  (
    select jsonb_agg(
      jsonb_build_object(
        'media_type', case
          when slide.value ->> 'media_type' = 'video'
            or coalesce(slide.value ->> 'media_url', slide.value ->> 'image_url', '') ~* '[.]mp4$'
            then 'video'
          else 'image'
        end,
        'media_url', coalesce(slide.value ->> 'media_url', slide.value ->> 'image_url', ''),
        'duration_seconds', case
          when jsonb_typeof(slide.value -> 'duration_seconds') = 'number'
            then greatest(3, least(300, (slide.value ->> 'duration_seconds')::numeric))
          else 10
        end,
        'active', case
          when jsonb_typeof(slide.value -> 'active') = 'boolean'
            then (slide.value ->> 'active')::boolean
          else true
        end
      )
      order by slide.position
    )
    from jsonb_array_elements(art.slides) with ordinality as slide(value, position)
  ),
  '[]'::jsonb
);

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
                (slide.value ->> 'media_url') ~* '^https://lkqtgptebkgfwguykxhv[.]supabase[.]co/storage/v1/object/public/bar-tv-media/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
                or (slide.value ->> 'media_url') ~* '^https://lkqtgptebkgfwguykxhv[.]supabase[.]co/storage/v1/object/public/bar-products/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
                or (slide.value ->> 'media_url') ~* '^https://app[.]ilhatenis[.]com/assets/bar-events/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
              )
              when slide.value ->> 'media_type' = 'video' then not (
                (slide.value ->> 'media_url') ~* '^https://lkqtgptebkgfwguykxhv[.]supabase[.]co/storage/v1/object/public/bar-tv-media/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.]mp4$'
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
  add constraint bar_tv_event_art_slides_check
    check (public.is_valid_bar_tv_slides(slides)),
  drop constraint if exists bar_tv_event_art_image_url_check;

alter table public.bar_tv_event_art
  add constraint bar_tv_event_art_image_url_check check (
    image_url = ''
    or image_url ~* '^https://lkqtgptebkgfwguykxhv[.]supabase[.]co/storage/v1/object/public/bar-tv-media/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
    or image_url ~* '^https://lkqtgptebkgfwguykxhv[.]supabase[.]co/storage/v1/object/public/bar-products/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
    or image_url ~* '^https://app[.]ilhatenis[.]com/assets/bar-events/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+[.](jpg|jpeg|png|webp)$'
  );

comment on column public.bar_tv_event_art.slides is
  'Ordered TV slideshow media (up to five images or MP4 videos), each with its own duration and active flag.';
