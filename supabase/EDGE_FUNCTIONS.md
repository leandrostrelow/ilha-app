# Contratos de segurança das Edge Functions

`config.toml` declara `verify_jwt` por função. Não remova essas entradas durante
o deploy:

- `true`: `bar-user-access`, `club-user-access`, `client-broadcast-push`,
  `family-member-access` e `tournament-admin-api`. O gateway exige JWT e o
  handler repete a validação de usuário/permissão antes de usar qualquer
  cliente privilegiado.
- `false`: callbacks públicos que se autenticam no próprio handler:
  `asaas-payment-webhook` (segredo do provedor), `bar-order-push` (capacidade da
  comanda), `client-notification-dispatch` (segredo de despacho),
  `tournament-register` (token de cortesia/acompanhamento quando aplicável) e
  `protected-access-recovery` (resposta genérica, allowlist, cooldown e limites
  de tentativa).

Segredos obrigatórios são configurados somente no ambiente de deploy; nunca em
arquivos versionados: `SUPABASE_URL`, chave secreta/service role,
`ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, chaves VAPID, segredo de despacho,
`TURNSTILE_SECRET_KEY` e `PUBLIC_REGISTRATION_RATE_LIMIT_SALT`. A configuração
pública `TURNSTILE_SITE_KEY` também é fornecida pelo ambiente para evitar
acoplamento entre projetos. Staging/preview deve fornecer
`PUBLIC_REGISTRATION_ALLOWED_ORIGINS` com origins HTTPS exatas. Consulte
`DEPLOYMENT_SECURITY_BOOTSTRAP.md`.

As Functions chamadas diretamente pelo ADM, Ilha Play e Bar também leem
`APP_ALLOWED_ORIGINS`. Em staging/preview, informe a origin HTTPS exata do
frontend. A configuração compartilhada rejeita curingas, credenciais, paths,
query e fragmentos; produção e localhost:8769 permanecem defaults explícitos.

## Acesso individual de membros familiares

`family-member-access` só aceita chamadas autenticadas de um operador com
`clients.write`. A função exige e-mail individual, cria convite apenas para uma
conta Auth realmente nova e envia recuperação de senha quando a conta já
existe. A vinculação ao membro aprovado acontece por RPC restrita a
`service_role`, sem trocar a função, as permissões ou a senha de uma conta já
existente. O frontend nunca recebe a chave privilegiada.

## Recuperação do ADM

`protected-access-recovery` aceita qualquer e-mail ativo em
`protected_access_accounts`, mas sempre responde de forma genérica. O link usa
`https://app.ilhatenis.com/adm?recovery=1`; o ADM deve detectar o evento
Supabase `PASSWORD_RECOVERY`, solicitar e confirmar a nova senha, chamar
`auth.updateUser({ password })`, limpar query/fragmento com
`history.replaceState` e encerrar a sessão/voltar ao login. Tokens do fragmento
nunca devem ir para logs, analytics ou mensagens de erro.

O limite por IP/global mantido pela Function é uma defesa best-effort por
instância; o cooldown atômico por conta em Postgres é a proteção durável.

## Dispatcher portável e fail-closed

A migration histórica não contém mais endpoint ou chave do projeto canônico.
O `pg_net` lê `court_dispatch_url` e `court_dispatch_publishable_key` do Vault,
aceita somente HTTPS para a função `client-notification-dispatch` e somente
chaves `sb_publishable_`. Nunca use chave secreta/service role nesse caminho.
Sem os dois valores válidos, a invocação retorna `null`, não realiza HTTP e
mantém os itens na fila para processamento posterior. O bootstrap e as
verificações sem exposição de valores estão em
`DEPLOYMENT_SECURITY_BOOTSTRAP.md`.

Como esse dispatcher autentica o handler com `x-dispatch-token`, sua entrada em
`config.toml` precisa permanecer com `verify_jwt = false`. A chave publicável é
enviada apenas no cabeçalho `apikey`, conforme o contrato das chaves atuais.

## Inscrições públicas de torneio

`tournament-register` falha fechado até que Turnstile e o sal de rate limit
estejam configurados. O navegador obtém somente a site key pública por `GET`,
e o `POST` valida o token no servidor antes de consultar o torneio ou criar
cobrança. O limite persistente é atômico no Postgres e guarda apenas HMACs de
IP e identidade, nunca IP, e-mail ou telefone em claro. Global e IP são
contabilizados antes do CAPTCHA; identidade somente depois da validação, para
que tokens falsos não bloqueiem uma vítima.
