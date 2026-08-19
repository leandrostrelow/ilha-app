update public.app_plans
   set name = case code
     when 'aulas_mensal_1x' then '1x Aula por semana'
     when 'aulas_mensal_2x' then '2x Aulas por semana'
     when 'jogar_mensal' then 'Somente jogar'
     else name
   end,
       updated_at = now()
 where code in ('aulas_mensal_1x', 'aulas_mensal_2x', 'jogar_mensal');
