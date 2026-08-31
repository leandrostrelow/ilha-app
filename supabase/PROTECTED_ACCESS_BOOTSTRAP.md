# Bootstrap da allowlist de equipe

As migrations `20260821185000_create_protected_access_allowlist.sql` e
`20260821190000_backend_security_integrity_hardening.sql` não promovem perfis
automaticamente. Essa decisão evita transformar perfis legados ou
`raw_user_meta_data` manipulável em acesso administrativo.

1. Aplique primeiro a migration `20260821185000`.
2. Em uma sessão administrativa controlada (`service_role`/SQL Editor), audite
   os perfis ativos ainda sem correspondência confiável:

```sql
select p.id, p.email, p.role, p.active
from public.profiles as p
left join auth.users as u on u.id = p.id
left join public.protected_access_accounts as a
  on a.email = lower(trim(u.email))
 and a.role = p.role
 and a.active is true
where p.active is true
  and p.role in ('admin', 'secretaria', 'professor', 'bar')
  and (
    a.email is null
    or lower(nullif(trim(p.email), '')) is distinct from lower(trim(u.email))
  )
order by p.role, p.id;
```

3. Confirme cada pessoa por um canal independente. Não use e-mail ou papel
   vindo apenas de metadados de cadastro. Antes de copiar, substitua permissões
   vazias e o marcador legado `"bar"` pelo conjunto mínimo explícito mostrado
   no ADM (por exemplo, somente `bar.kitchen`; nunca conceda todas por padrão).
   A migration `190000` aborta se uma conta ativa não-admin ficar sem permissão
   explícita, se `role=bar` não tiver ao menos uma `bar.*`, ou se perfil e
   allowlist divergirem. Para cada UUID confirmado, execute em uma transação
   (substitua o UUID nulo; ele deliberadamente não corresponde a uma conta real):

```sql
begin;

with trusted_staff(id) as (
  values ('00000000-0000-0000-0000-000000000000'::uuid)
)
insert into public.protected_access_accounts (
  email, full_name, role, permissions, active, updated_at
)
select
  lower(trim(u.email)),
  p.full_name,
  p.role,
  coalesce(p.permissions, '[]'::jsonb),
  true,
  now()
from trusted_staff as trusted
join auth.users as u on u.id = trusted.id
join public.profiles as p on p.id = trusted.id
where nullif(trim(u.email), '') is not null
  and p.active is true
  and p.role in ('admin', 'secretaria', 'professor', 'bar')
on conflict (email) do update
set full_name = excluded.full_name,
    role = excluded.role,
    permissions = excluded.permissions,
    active = true,
    updated_at = now();

-- O e-mail espelhado no perfil é necessário para que uma exclusão em cascata
-- consiga revogar a allowlist mesmo quando a linha de Auth já estiver saindo.
with trusted_staff(id) as (
  values ('00000000-0000-0000-0000-000000000000'::uuid)
)
update public.profiles as p
set email = lower(trim(u.email)),
    updated_at = now()
from trusted_staff as trusted
join auth.users as u on u.id = trusted.id
where p.id = trusted.id
  and nullif(trim(u.email), '') is not null;

commit;
```

4. Repita a auditoria até não restar perfil ativo sem par e confirme que não há
   entrada ativa órfã na allowlist (uma entrada órfã poderia reativar uma conta
   deliberadamente revogada):

```sql
select a.email, a.role
from public.protected_access_accounts as a
left join auth.users as u on lower(trim(u.email)) = a.email
left join public.profiles as p
  on p.id = u.id
 and p.role = a.role
 and p.active is true
 and lower(nullif(trim(p.email), '')) = lower(trim(u.email))
where a.active is true
  and p.id is null
order by a.role, a.email;
```

   Confirme também que existe pelo menos um administrador confiável e confira
   a simetria das permissões antes de aplicar a migration:

```sql
select p.id, p.role, p.permissions as profile_permissions,
       a.permissions as allowlist_permissions
from public.profiles as p
join auth.users as u on u.id = p.id
join public.protected_access_accounts as a
  on a.email = lower(trim(u.email)) and a.role = p.role and a.active is true
where p.active is true
  and p.role <> 'admin'
  and (
    case
      when jsonb_typeof(coalesce(p.permissions, '[]'::jsonb)) = 'array'
        then jsonb_array_length(coalesce(p.permissions, '[]'::jsonb)) = 0
      else true
    end
    or not (
      coalesce(p.permissions, '[]'::jsonb) @> coalesce(a.permissions, '[]'::jsonb)
      and coalesce(a.permissions, '[]'::jsonb) @> coalesce(p.permissions, '[]'::jsonb)
    )
  );
```

   Só então aplique a migration `190000`. Ela aborta e reverte integralmente
   se qualquer precondição não for atendida.

## Troca de e-mail de uma conta protegida

O e-mail é parte da identidade da allowlist. Depois da migration `190000`, a
troca comum em `auth.users` é bloqueada para contas presentes em
`protected_access_accounts`; atualizar somente a autenticação quebraria a
correspondência com o perfil e poderia causar perda de acesso.

Não desative o trigger nem altere as três tabelas separadamente. Para substituir
o e-mail, um administrador confiável deve criar/confirmar a nova conta pelo fluxo
de gestão, conferir papel e permissões nas três fontes e, somente depois que o
novo acesso funcionar, revogar a conta antiga. A proteção do último
administrador impede que a conta anterior seja revogada antes de existir outro
administrador funcional. Se for indispensável preservar o mesmo UUID, implemente
antes uma RPC administrativa transacional e auditável que atualize Auth, perfil e
allowlist em conjunto; não faça a troca manual parcial.

Nunca coloque chaves `service_role`, senhas, tokens ou e-mails pessoais neste
repositório.
