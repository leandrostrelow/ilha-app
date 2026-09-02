create or replace function public.clear_terminal_tournament_payment_artifacts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if upper(coalesce(new.status, '')) in ('REFUNDED', 'CANCELLED', 'CHARGEBACK') then
    new.invoice_url := null;
    new.pix_payload := null;
    new.pix_encoded_image := null;
    new.pix_expires_at := null;
  end if;

  return new;
end;
$$;

revoke all on function public.clear_terminal_tournament_payment_artifacts() from public, anon, authenticated;
grant execute on function public.clear_terminal_tournament_payment_artifacts() to service_role;

drop trigger if exists clear_terminal_tournament_payment_artifacts
  on public.tournament_payments;

create trigger clear_terminal_tournament_payment_artifacts
before insert or update of status, invoice_url, pix_payload, pix_encoded_image, pix_expires_at
on public.tournament_payments
for each row
execute function public.clear_terminal_tournament_payment_artifacts();

update public.tournament_payments
set invoice_url = null,
    pix_payload = null,
    pix_encoded_image = null,
    pix_expires_at = null,
    updated_at = now()
where upper(coalesce(status, '')) in ('REFUNDED', 'CANCELLED', 'CHARGEBACK')
  and (
    invoice_url is not null
    or pix_payload is not null
    or pix_encoded_image is not null
    or pix_expires_at is not null
  );

comment on function public.clear_terminal_tournament_payment_artifacts() is
  'Remove links and Pix material whenever a tournament payment reaches a terminal state.';
