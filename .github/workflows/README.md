# CI e E2E seguro

`ci.yml` não recebe credenciais remotas. Ele monta um projeto Supabase dentro
de `RUNNER_TEMP`, usa `supabase-schema.sql` como baseline, aplica as migrations
canônicas e insere uma única fixture `@tests.invalid` entre as migrations
`20260821185000` e `20260821190000`. Depois recria o banco, executa pgTAP e
`db lint`. Todos os containers e volumes são efêmeros.

`staging-e2e.yml` é exclusivamente manual e usa o GitHub Environment
`staging`. Proteja esse Environment com aprovação humana e configure:

- Variables: `STAGING_BASE_URL`, `STAGING_SUPABASE_URL`,
  `STAGING_SUPABASE_PROJECT_REF`, `STAGING_SUPABASE_PUBLISHABLE_KEY`,
  `STAGING_VAPID_PUBLIC_KEY` e `STAGING_ASAAS_MODE=sandbox`.
- Secrets: `STAGING_E2E_CLIENT_EMAIL`, `STAGING_E2E_CLIENT_PASSWORD`,
  `STAGING_E2E_ADMIN_EMAIL`, `STAGING_E2E_ADMIN_PASSWORD`,
  `STAGING_E2E_BAR_EMAIL`, `STAGING_E2E_BAR_PASSWORD`,
  `STAGING_ASAAS_SANDBOX_API_KEY` e `STAGING_ASAAS_E2E_DOCUMENT`.

As três contas devem ser fixtures dedicadas e conter `e2e` no identificador do
e-mail. A conta do Ilha Play deve estar ativa e com cadastro sintético completo;
a conta do ADM deve constar da allowlist de staging. Não use nome, CPF, telefone,
e-mail, reserva, cobrança ou assinatura Push de uma pessoa real.

`STAGING_ASAAS_SANDBOX_API_KEY` deve ser uma chave moderna de uma conta Sandbox
dedicada e começar com `$aact_hmlg_`. `STAGING_ASAAS_E2E_DOCUMENT` deve ser um
CPF/CNPJ fictício, aceito pelo Sandbox e jamais vinculado a uma pessoa ou empresa
real. O ADM E2E precisa ter a permissão `communication`; a Edge Function de
staging precisa ter a configuração VAPID privada correspondente à chave pública.
O ADM também precisa de `clients.write`. A conta Bar deve ter `role=bar`, estar
na allowlist e possuir somente permissões `bar.*`; ela é exclusiva do E2E e não
pode ter reservas, cobranças, tarefas ou qualquer dado operacional real.

Antes de enviar qualquer senha, o runner confirma que o host contém um marcador
de staging e que os HTMLs publicados apontam exatamente para o project ref,
chave publicável e VAPID de staging. Os hosts e o project ref conhecidos de
produção são bloqueados. O fluxo então valida Auth, PostgREST/RLS, abertura do
Realtime, PWA, persistência/logout e responsividade do Ilha Play e ADM. Para o
Push, o Chromium recebe permissão somente para o host de staging, cria e persiste
uma inscrição, recebe uma notificação sintética pela Edge Function e remove a
inscrição ao final. Para o Asaas, mantém a prova fail-closed do webhook e também
cria, consulta e remove um cliente e uma cobrança exclusivamente no Sandbox. O
cliente não recebe e-mail ou telefone e é criado com notificações desativadas.

Esses testes são gates reais: ausência da tabela de inscrições, configuração
VAPID privada, permissão `communication`, acesso ao provedor Push, chave Sandbox
ou documento sintético faz o job falhar; não há mensagem de sucesso baseada
somente na presença das variáveis. Falhas de limpeza também reprovam o job e as
fixtures Asaas usam `externalReference` com prefixo `ilha-e2e` para localização.

O mesmo job cria um cadastro Ilha Play e uma inscrição Push fictícia para a
conta Bar, chama `reset_app_client_account`, confirma que Play/Push sumiram e
que Auth, perfil, allowlist e permissões Bar continuam válidos. Depois autentica
novamente, recria o Play e repete o reset. Isso cobre diretamente o caso de uma
pessoa que pertence somente à equipe do Bar e também aparece como cliente.

O workflow não recebe `service_role`, chave secreta do Supabase, chave VAPID
privada ou senha de banco. A chave Asaas é estritamente de Sandbox e fica em
GitHub Secrets. O job só altera as inscrições da conta E2E e as fixtures que ele
mesmo cria no Sandbox; não deve ser adaptado para produção.

`staging-build.yml` resolve o outro gate: os HTMLs-fonte continuam com os valores
de produção, então eles não podem ser publicados diretamente em staging. O
workflow manual usa apenas as quatro variables públicas de Supabase/VAPID, gera `dist/`,
substitui em Ilha Play, ADM, Torneios, Bar e Menu somente URL/chave publicável do
Supabase e VAPID pública, verifica que nenhum project ref de produção permaneceu
e entrega um artefato por sete dias. Ele não possui etapa ou credencial de deploy;
o artefato deve passar pelo processo de publicação protegido do staging antes do
`staging-e2e.yml`.
