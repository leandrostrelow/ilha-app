# Bootstrap de segurança por ambiente

Este runbook complementa as migrations. Execute-o separadamente em local,
staging e produção; nunca copie valores de um projeto para outro e nunca cole
segredos em arquivos versionados, tickets ou logs.

Para todas as Edge Functions consumidas no navegador, configure também
`APP_ALLOWED_ORIGINS` com a origin HTTPS exata do frontend de staging/preview.
Não use `*`, credenciais, path, query ou fragmento. Produção e os dois endereços
locais na porta 8769 já são defaults explícitos. `tournament-register` mantém,
além disso, a lista mais restrita `PUBLIC_REGISTRATION_ALLOWED_ORIGINS` descrita
abaixo.

## 1. Dispatcher de notificações

Antes de publicar a migration de compatibilidade em um ambiente já ativo,
cadastre pelo Dashboard do Supabase, em **Vault**, dois valores próprios daquele
ambiente:

- `court_dispatch_url`: URL HTTPS exata terminada em
  `/functions/v1/client-notification-dispatch`;
- `court_dispatch_publishable_key`: chave atual com prefixo
  `sb_publishable_` do mesmo projeto.

Não use JWT `anon` legado, chave `sb_secret_` nem `service_role`. O dispatcher
envia a chave publicável somente em `apikey`; a autorização efetiva do handler
é o segredo interno `x-dispatch-token`.

Valide sem imprimir os valores:

```sql
select
  count(*) filter (
    where name = 'court_dispatch_url'
      and decrypted_secret ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?/functions/v1/client-notification-dispatch$'
  ) = 1 as url_valida,
  count(*) filter (
    where name = 'court_dispatch_publishable_key'
      and decrypted_secret ~ '^sb_publishable_[A-Za-z0-9_-]{20,}$'
  ) = 1 as chave_publicavel_valida
from vault.decrypted_secrets
where name in ('court_dispatch_url', 'court_dispatch_publishable_key');
```

Os dois resultados precisam ser `true`. Confirme também que
`client-notification-dispatch` está implantada com `verify_jwt = false`. Se a
configuração estiver ausente ou inválida, a função SQL retorna `null`, não faz
requisição externa e deixa as notificações pendentes.

## 2. Turnstile e rate limit das inscrições

Crie um widget Cloudflare Turnstile separado para cada ambiente e autorize
somente os hostnames desse ambiente. Em **Edge Functions > Secrets**, configure:

- `TURNSTILE_SITE_KEY`: site key do widget;
- `TURNSTILE_SECRET_KEY`: chave secreta do widget;
- `TURNSTILE_ALLOWED_HOSTNAMES`: hostnames exatos separados por vírgula, sem
  protocolo, caminho ou porta;
- `PUBLIC_REGISTRATION_RATE_LIMIT_SALT`: valor aleatório exclusivo do ambiente,
  com pelo menos 32 caracteres, gerado e mantido no gerenciador de segredos;
- `PUBLIC_REGISTRATION_ALLOWED_ORIGINS`: origins HTTPS exatas adicionais,
  separadas por vírgula, necessárias para staging/preview.

Turnstile, hostnames e sal não possuem valor padrão. Se algum deles estiver
ausente ou malformado — ou se a lista adicional de origins for inválida —,
`tournament-register` responde `503` e não cria atleta, inscrição ou cobrança.
Em staging, inclua exatamente o hostname publicado da branch/app. Use
`localhost` somente no ambiente local e não cadastre curingas ou hostnames de
outros ambientes. Origins com `*`, credenciais, path, query ou fragmento são
recusadas e fazem a função falhar fechado. Produção e os dois endereços locais
na porta 8769 continuam sendo defaults explícitos.

O limite global e por IP é consumido antes do Turnstile. O limite por identidade
(HMAC de e-mail e telefone) só é consumido depois de o CAPTCHA ser aceito; assim,
um bot sem prova válida não consegue bloquear os dados de outra pessoa.
O bucket por IP usa exclusivamente `cf-connecting-ip`, que precisa ser
sobrescrito pelo gateway confiável do ambiente. A função não confia em
`x-forwarded-for` nem `x-real-ip`; se o header confiável estiver ausente ou
inválido, ela pula o bucket por IP e ainda aplica os limites global e por
identidade. Confirme esse contrato do gateway no teste de staging.

Depois de aplicar
`20260822091000_public_registration_abuse_protection.sql` e publicar a Edge
Function, valide em staging:

1. `GET /functions/v1/tournament-register` retorna apenas provider e site key;
2. `POST` sem token CAPTCHA é rejeitado antes de criar dados;
3. token expirado, hostname diferente e action diferente são rejeitados;
4. excesso por identidade, IP ou global retorna `429` com `Retry-After`;
5. uma inscrição válida cria somente um registro e a repetição respeita o token
   de acompanhamento existente;
6. a tabela `public_registration_rate_limits` contém apenas chaves HMAC, sem
   dados pessoais em claro.

Referências oficiais:

- <https://supabase.com/docs/guides/functions/examples/cloudflare-turnstile>
- <https://supabase.com/docs/guides/functions/secrets>
- <https://supabase.com/docs/guides/database/vault>

## 3. Login pendente e recuperação de senha do Ilha Play

Em **Authentication > Sign In / Providers > Email**, mantenha cadastro e login
por e-mail habilitados e desative a confirmação obrigatória de e-mail. A
aprovação do clube não é feita pelo Auth: novos clientes entram autenticados
com `app_clients.status = 'PENDENTE'`, e as políticas do banco mantêm o conteúdo
bloqueado até o ADM executar `approve_app_client` e alterar o status para
`ATIVO`. Não converta em pendentes as contas que já estão ativas.

Em **Authentication > URL Configuration**, confira:

- Site URL: `https://app.ilhatenis.com/`;
- Redirect URL de produção: `https://app.ilhatenis.com/**`;
- a URL HTTPS exata de staging, também com `/**`;
- os endereços locais `http://127.0.0.1:8769/**` e
  `http://localhost:8769/**` somente no ambiente de desenvolvimento.

Configure SMTP próprio em **Authentication > SMTP Settings**. O SMTP padrão do
Supabase é apenas para avaliação, tem limite baixo e não deve ser considerado
entrega confiável em produção. Use remetente do domínio do clube, valide SPF,
DKIM e DMARC no provedor e nunca versione a senha SMTP.

Validação obrigatória em staging, com e-mails descartáveis do próprio teste:

1. criar uma conta nova e confirmar que recebe sessão sem confirmação por link;
2. confirmar no banco que o cadastro nasceu `PENDENTE`;
3. fechar e reabrir o PWA e confirmar que a sessão continua conectada;
4. confirmar que planos, agenda, financeiro, comunicados e ações ficam ocultos;
5. liberar no ADM e confirmar que “Verificar liberação” abre o aplicativo;
6. solicitar “Esqueci minha senha”, abrir o link recebido no mesmo ambiente,
   definir uma nova senha e entrar com ela;
7. repetir a solicitação até o limite esperado do provedor e confirmar que o
   usuário recebe uma mensagem clara, sem expor se o e-mail existe.

Referências oficiais:

- <https://supabase.com/docs/guides/auth/passwords>
- <https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail>
