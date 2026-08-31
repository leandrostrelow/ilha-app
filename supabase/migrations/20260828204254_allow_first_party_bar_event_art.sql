alter table public.bar_tv_event_art
  drop constraint if exists bar_tv_event_art_image_url_check;

alter table public.bar_tv_event_art
  add constraint bar_tv_event_art_image_url_check check (
    image_url = ''
    or image_url ~ '^https://lkqtgptebkgfwguykxhv[.]supabase[.]co/storage/v1/object/public/bar-products/eventos/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+$'
    or image_url ~ '^https://app[.]ilhatenis[.]com/assets/bar-events/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+$'
  );
