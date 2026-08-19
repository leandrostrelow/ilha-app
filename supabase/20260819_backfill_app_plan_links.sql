-- Reaplica o catálogo oficial aos clientes e alunos já vinculados.
-- O trigger de app_plans mantém as próximas alterações sincronizadas.
update public.app_plans
   set updated_at = now();
