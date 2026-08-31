begin;

update public.tournaments
set allowed_payment_methods = '["PIX"]'::jsonb,
    settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
      'spatial_event_period_label', '21 a 27 de setembro'
    ),
    updated_at = now()
where lower(slug) = 'ilha-open-2026';

commit;
