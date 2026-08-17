begin;

update public.app_plans
set active = false
where code not in (
  'aulas_mensal_1x',
  'aulas_mensal_2x',
  'jogar_mensal',
  'personalizado'
);

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
values
  ('aulas_mensal_1x', 'Aulas 1x por semana - Mensal', 'aluno', 270, 1, 10, true, 'Plano mensal de aulas uma vez por semana.'),
  ('aulas_mensal_2x', 'Aulas 2x por semana - Mensal', 'aluno', 390, 2, 10, true, 'Plano mensal de aulas duas vezes por semana.'),
  ('jogar_mensal', 'Somente jogar - Mensal', 'mensalista', 150, 0, 10, true, 'Acesso mensal às quadras conforme regras do clube.'),
  ('personalizado', 'Plano personalizado', 'outro', 0, 0, 10, true, 'Valor e frequência definidos individualmente pela equipe do clube.')
on conflict (code) do update
set
  name = excluded.name,
  type = excluded.type,
  amount = excluded.amount,
  weekly_lessons = excluded.weekly_lessons,
  default_due_day = excluded.default_due_day,
  active = excluded.active,
  description = excluded.description;

commit;
