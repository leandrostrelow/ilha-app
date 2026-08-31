begin;

-- The broadcast RPC intentionally keeps direct table access closed to
-- service_role. It needs to read both public.app_clients and auth.users in one
-- atomic statement, so execute it with the function owner's privileges while
-- keeping the callable surface restricted to the backend role.
alter function public.enqueue_app_client_broadcast(
  text, text, text, text, text, text, text, uuid
)
  security definer;

alter function public.enqueue_app_client_broadcast(
  text, text, text, text, text, text, text, uuid
)
  set search_path = '';

alter function public.enqueue_app_client_broadcast(
  text, text, text, text, text, text, text, uuid
)
  owner to postgres;

revoke all on function public.enqueue_app_client_broadcast(
  text, text, text, text, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.enqueue_app_client_broadcast(
  text, text, text, text, text, text, text, uuid
) to service_role;

comment on function public.enqueue_app_client_broadcast(
  text, text, text, text, text, text, text, uuid
) is 'Enfileira comunicados de forma atômica com leitura encapsulada e execução exclusiva do service_role.';

commit;
