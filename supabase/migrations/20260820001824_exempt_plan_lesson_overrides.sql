create or replace function public.sync_app_plan_to_linked_records()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.app_clients as c
     set official_plan_id = new.id,
         official_plan_code = new.code,
         official_plan_name = new.name,
         plan_amount = case
           when new.code = 'isento' then 0
           when new.code = 'personalizado' then c.plan_amount
           else new.amount
         end,
         weekly_lessons = case
           when new.code in ('isento', 'personalizado') then c.weekly_lessons
           else new.weekly_lessons
         end,
         due_day = case when new.code = 'isento' then null else c.due_day end,
         updated_at = now()
   where c.official_plan_id = new.id
      or c.official_plan_code = old.code;

  update public.app_plan_requests as r
     set plan_code = new.code,
         plan_name = new.name,
         amount = case
           when new.code = 'isento' then 0
           when new.code = 'personalizado' then r.amount
           else new.amount
         end,
         weekly_lessons = case
           when new.code in ('isento', 'personalizado') then r.weekly_lessons
           else new.weekly_lessons
         end,
         updated_at = now()
   where r.plan_code = old.code;

  return new;
end;
$$;

revoke all on function public.sync_app_plan_to_linked_records() from public;

update public.app_clients
   set plan_amount = 0,
       due_day = null,
       weekly_lessons = case
         when coalesce(weekly_lessons, 0) > 0 then weekly_lessons
         when coalesce(declared_plan_code, '') like '%_2x' or lower(coalesce(declared_plan_name, '')) like '%2x%' then 2
         when coalesce(declared_plan_code, '') like '%_1x' or lower(coalesce(declared_plan_name, '')) like '%1x%' then 1
         else 0
       end,
       updated_at = now()
 where official_plan_code = 'isento';

update public.students as s
   set weekly_lessons = c.weekly_lessons,
       monthly_value = 0,
       plan_name = c.official_plan_name,
       updated_at = now()
  from public.app_clients as c
 where c.official_plan_code = 'isento'
   and s.app_client_id = c.id;
