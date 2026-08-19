create or replace function public.admin_save_app_plan(
  p_id uuid,
  p_code text,
  p_name text,
  p_type text,
  p_amount numeric,
  p_weekly_lessons integer,
  p_default_due_day integer,
  p_active boolean,
  p_description text
)
returns public.app_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_plan public.app_plans;
begin
  if auth.uid() is null or not public.is_club_office() then
    raise exception 'Apenas a gestão do clube pode alterar planos.'
      using errcode = '42501';
  end if;

  if nullif(trim(p_name), '') is null or nullif(trim(p_code), '') is null then
    raise exception 'Informe nome e código do plano.'
      using errcode = '22023';
  end if;

  if p_default_due_day is not null and (p_default_due_day < 1 or p_default_due_day > 31) then
    raise exception 'Vencimento padrão deve ser entre 1 e 31.'
      using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.app_plans (
      code,
      name,
      type,
      amount,
      weekly_lessons,
      default_due_day,
      active,
      description,
      updated_at
    ) values (
      trim(p_code),
      trim(p_name),
      coalesce(nullif(trim(p_type), ''), 'aluno'),
      coalesce(p_amount, 0),
      greatest(coalesce(p_weekly_lessons, 0), 0),
      p_default_due_day,
      coalesce(p_active, true),
      nullif(trim(coalesce(p_description, '')), ''),
      now()
    )
    returning * into saved_plan;
  else
    update public.app_plans
       set code = trim(p_code),
           name = trim(p_name),
           type = coalesce(nullif(trim(p_type), ''), 'aluno'),
           amount = coalesce(p_amount, 0),
           weekly_lessons = greatest(coalesce(p_weekly_lessons, 0), 0),
           default_due_day = p_default_due_day,
           active = coalesce(p_active, true),
           description = nullif(trim(coalesce(p_description, '')), ''),
           updated_at = now()
     where id = p_id
     returning * into saved_plan;

    if saved_plan.id is null then
      raise exception 'Plano não encontrado.'
        using errcode = 'P0002';
    end if;
  end if;

  return saved_plan;
end;
$$;

revoke all on function public.admin_save_app_plan(uuid, text, text, text, numeric, integer, integer, boolean, text) from public;
revoke all on function public.admin_save_app_plan(uuid, text, text, text, numeric, integer, integer, boolean, text) from anon;
grant execute on function public.admin_save_app_plan(uuid, text, text, text, numeric, integer, integer, boolean, text) to authenticated;
