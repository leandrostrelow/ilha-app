begin;

-- Compatibility migration for databases where the original notification
-- migration has already run. Environment-specific values must be provisioned
-- in Vault as `court_dispatch_url` and `court_dispatch_publishable_key`.
-- Missing or invalid configuration is intentionally a no-op: queued
-- notifications remain pending and no external project is contacted.
create or replace function public.invoke_app_client_notification_dispatch()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch_url text;
  v_publishable_key text;
  v_dispatch_secret text;
begin
  select secret.decrypted_secret
    into v_dispatch_url
  from vault.decrypted_secrets secret
  where secret.name = 'court_dispatch_url'
  limit 1;

  select secret.decrypted_secret
    into v_publishable_key
  from vault.decrypted_secrets secret
  where secret.name = 'court_dispatch_publishable_key'
  limit 1;

  select config.dispatch_secret
    into v_dispatch_secret
  from public.app_notification_dispatch_config config
  where config.id = true;

  if v_dispatch_url is null
     or v_dispatch_url !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?/functions/v1/client-notification-dispatch$'
     or v_publishable_key is null
     or v_publishable_key !~ '^sb_publishable_[A-Za-z0-9_-]{20,}$'
     or length(coalesce(v_dispatch_secret, '')) < 32 then
    return null;
  end if;

  return net.http_post(
    url := v_dispatch_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_publishable_key,
      'x-dispatch-token', v_dispatch_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;

revoke all on function public.invoke_app_client_notification_dispatch() from public, anon, authenticated;
grant execute on function public.invoke_app_client_notification_dispatch() to service_role;

create or replace function public.queue_app_client_notification_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_client_notification_dispatches (notification_id)
  values (new.id)
  on conflict (notification_id) do nothing;

  perform public.invoke_app_client_notification_dispatch();
  return new;
end;
$$;

revoke all on function public.queue_app_client_notification_push() from public, anon, authenticated;

-- The former JWT anon key was embedded in migration history. It is no longer
-- used, and removing this exact Vault entry prevents accidental fallback.
delete from vault.secrets
where name = 'court_dispatch_anon_key';

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select job.jobid
    from cron.job job
    where job.jobname = 'ilha-play-court-reminders'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end;
$$;

select cron.schedule(
  'ilha-play-court-reminders',
  '* * * * *',
  $cron$
    select public.enqueue_due_court_reminders();
    select public.invoke_app_client_notification_dispatch();
  $cron$
);

commit;
