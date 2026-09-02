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
           or jsonb_typeof(slide.value -> 'image_url') <> 'string'
           or not (
             (slide.value ->> 'image_url') ~ '^https://lkqtgptebkgfwguykxhv[.]supabase[.]co/storage/v1/object/public/bar-products/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+$'
             or (slide.value ->> 'image_url') ~ '^https://app[.]ilhatenis[.]com/assets/bar-events/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+$'
           )
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
  add column if not exists slides jsonb not null default '[]'::jsonb,
  add column if not exists menu_duration_seconds smallint not null default 10;

alter table public.bar_tv_event_art
  drop constraint if exists bar_tv_event_art_slides_check,
  add constraint bar_tv_event_art_slides_check
    check (public.is_valid_bar_tv_slides(slides)),
  drop constraint if exists bar_tv_event_art_menu_duration_check,
  add constraint bar_tv_event_art_menu_duration_check
    check (menu_duration_seconds between 3 and 300);

update public.bar_tv_event_art
set slides = jsonb_build_array(jsonb_build_object(
  'image_url', image_url,
  'duration_seconds', 10,
  'active', active
))
where image_url <> ''
  and slides = '[]'::jsonb;

comment on column public.bar_tv_event_art.slides is
  'Ordered TV slideshow images (maximum five), each with its own duration and active flag.';
comment on column public.bar_tv_event_art.menu_duration_seconds is
  'Seconds that the live bar menu remains visible between slideshow images.';

drop policy if exists "public reads active bar tv event art" on public.bar_tv_event_art;
create policy "public reads active bar tv event art"
on public.bar_tv_event_art for select
to anon
using (
  active is true
  and (
    image_url <> ''
    or jsonb_array_length(slides) > 0
  )
);
