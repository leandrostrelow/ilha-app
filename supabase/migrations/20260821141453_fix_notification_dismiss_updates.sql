drop policy if exists app_notification_dismissals_update_own on public.app_notification_dismissals;
create policy app_notification_dismissals_update_own
  on public.app_notification_dismissals
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant update on table public.app_notification_dismissals to authenticated;
