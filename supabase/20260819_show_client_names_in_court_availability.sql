begin;

drop function if exists public.get_app_court_availability(date, date);

create function public.get_app_court_availability(
  p_start_date date,
  p_end_date date
)
returns table (
  booking_date date,
  starts_at time,
  court_name text,
  status text,
  is_mine boolean,
  client_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Entre no Ilha Play para consultar a agenda.' using errcode = '42501';
  end if;

  if p_start_date is null or p_end_date is null or p_end_date < p_start_date or p_end_date > p_start_date + 45 then
    raise exception 'Período da agenda inválido.' using errcode = '22023';
  end if;

  return query
  select
    booking.booking_date,
    booking.starts_at,
    booking.court_name,
    booking.status,
    booking.client_id = auth.uid(),
    case
      when booking.status = 'BLOQUEADO' then null
      else nullif(trim(booking.client_name), '')
    end
  from public.app_court_bookings booking
  where booking.booking_date between p_start_date and p_end_date
    and booking.status <> 'CANCELADO'
  order by booking.booking_date, booking.starts_at, booking.court_name;
end;
$$;

revoke all on function public.get_app_court_availability(date, date) from public, anon;
grant execute on function public.get_app_court_availability(date, date) to authenticated;

commit;
