insert into public.teachers (name, active)
select seed.name, true
from (values
  ('Renato'),
  ('Emerson'),
  ('Gabriel')
) as seed(name)
where not exists (
  select 1
  from public.teachers teacher
  where lower(trim(teacher.name)) = lower(trim(seed.name))
);

insert into public.courts (name, active)
select seed.name, true
from (values
  ('Quadra 1'),
  ('Quadra 2')
) as seed(name)
where not exists (
  select 1
  from public.courts court
  where lower(trim(court.name)) = lower(trim(seed.name))
);
