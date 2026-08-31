-- Supabase projects can retain explicit EXECUTE grants for anon when a
-- SECURITY DEFINER function is created. Revoke those inherited grants from
-- every privileged function, then restore only the token-scoped public RPCs.
do $block$
declare
  function_signature text;
begin
  for function_signature in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', function_signature);
  end loop;
end
$block$;

grant execute on function public.bar_public_menu(text) to anon, authenticated;
grant execute on function public.bar_public_submit_order(text, text, uuid, jsonb, text, text) to anon, authenticated;
grant execute on function public.bar_public_claim_access(text, text, text) to anon, authenticated;
grant execute on function public.bar_public_submit_card_order(text, jsonb, text) to anon, authenticated;
grant execute on function public.bar_public_card_order_status(text) to anon, authenticated;
grant execute on function public.bar_public_card_request_service(text, text, text) to anon, authenticated;
grant execute on function public.bar_public_order_status(text, text) to anon, authenticated;
grant execute on function public.bar_public_request_service(text, text, text, text, text) to anon, authenticated;
grant execute on function public.tournament_public_snapshot(text) to anon, authenticated;
grant execute on function public.tournament_public_registration_status(uuid) to anon, authenticated;

-- Trigger helpers are never client-callable. Triggers keep working without
-- grants because PostgreSQL invokes the function as the trigger owner.
revoke execute on function public.handle_new_app_client() from authenticated;
revoke execute on function public.notify_app_court_slot_change() from authenticated;
revoke execute on function public.refresh_bar_order_totals() from authenticated;
revoke execute on function public.sync_app_plan_to_linked_records() from authenticated;
