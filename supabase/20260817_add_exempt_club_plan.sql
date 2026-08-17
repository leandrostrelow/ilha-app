insert into public.app_plans (
  code,
  name,
  type,
  amount,
  weekly_lessons,
  default_due_day,
  active,
  description
)
values (
  'isento',
  'Plano isento',
  'outro',
  0,
  0,
  10,
  true,
  'Acesso liberado sem cobrança mensal, vinculado somente pela equipe do clube.'
)
on conflict (code) do update
set
  name = excluded.name,
  type = excluded.type,
  amount = excluded.amount,
  weekly_lessons = excluded.weekly_lessons,
  default_due_day = excluded.default_due_day,
  active = excluded.active,
  description = excluded.description;
