# Publicação do Ilha

Leandro e Evandro trabalham a partir da mesma `main`. Uma alteração aceita no GitHub gera um build, mas não substitui automaticamente `app.ilhatenis.com`.

## Começar uma mudança

Com a pasta limpa:

```sh
git switch main
git pull --ff-only origin main
git switch -c codex/descricao-da-mudanca
pnpm install --frozen-lockfile
```

Se houver alterações pendentes, preserve-as em sua branch e crie outra pasta com `git worktree add -b codex/descricao-da-mudanca ../ilha-nova-tarefa origin/main`. Não use `reset --hard` nem `clean` para preparar uma publicação.

Edite os arquivos-fonte normalmente. O build copia somente os arquivos de `config/site-files.json`; novos recursos precisam entrar nessa lista. Depois de alterar o site:

```sh
pnpm run release:bump
pnpm run verify
git add <arquivos-da-mudanca>
git commit -m "Descreve a mudança"
git push -u origin HEAD
```

Abra um pull request para `main`. O GitHub exige branch atualizada, verificações aprovadas e revisão da outra pessoa. Os testes de banco recriam apenas um banco descartável no GitHub Actions. Nunca usam o banco dos clientes.

## Conferir e publicar

1. Confira o preview da Vercel. Um preview deste projeto ainda consulta os serviços existentes: testes visuais e leituras são adequados; testes de pagamento, cadastro, exclusão ou envio precisam de staging sintético.
2. Depois da revisão e dos testes, faça o merge.
3. Aguarde também o CI da `main` e o build Vercel de produção ficarem prontos. Confira o SHA completo do merge. Esse build fica preparado, sem mudar o domínio oficial.
4. Com a CLI da Vercel autenticada na sua própria conta, publique o build aprovado:

```sh
pnpm run release:publish dpl_IDENTIFICADOR SHA_COMPLETO_DE_40_CARACTERES --confirm
```

O comando valida projeto, ambiente, origem Git, branch, SHA atual da `main` e os três checks do GitHub. Promove exatamente aquele build e mantém a atribuição automática do domínio desativada. Se alguma conferência falhar, não use um comando alternativo para contorná-la; corrija a falha primeiro.

O acesso do Evandro continua válido. Uma nova assinatura ou um novo projeto não é necessário para esse fluxo.

## Recuperação

Em um incidente, use Instant Rollback da Vercel para uma publicação conhecida e confira o domínio e a versão do app. A reversão não altera o GitHub nem o banco. Corrija a causa em uma branch da `main` atual antes de publicar novamente.

## Base recuperada em 05/11/2026

A publicação `dpl_1aS7uynej49BcsZTHuB5MKha85CC`, de 21/10, foi recuperada por hash. A versão do app era `2026-10-09.0333`. Os 440 arquivos de conteúdo recompilados coincidem com a publicação; `dist/vercel.json` muda apenas para registrar os comandos do novo build. O manifesto contém as referências originais.

Foram recuperadas também as 20 Edge Functions publicadas. O módulo compartilhado de pagamento corresponde à publicação mais recente que o utiliza. Nenhuma função ou migration foi aplicada em produção durante essa sincronização. O histórico de migrations locais tem timestamps diferentes dos remotos; ele não deve ser reenviado cegamente ao banco.

A antiga pasta de trabalho contém alterações e materiais preservados. Novos trabalhos devem partir da `main` sincronizada; não publique aquela pasta antiga por CLI.

## Testes do banco

`config/supabase-ci-tests.json` mantém os oito contratos pgTAP que já faziam parte da CI e acrescenta o contrato de Day Use com dados fictícios. Todas as migrations são reaplicadas em banco descartável. Os demais arquivos SQL recuperados são cenários manuais antigos, alguns dependentes de cadastros específicos; precisam de fixtures sintéticas antes de entrar na CI. Não os execute no banco dos clientes. A preparação falha se uma suíte listada não tiver um plano pgTAP.

A reconstrução também recupera a função de chaveamento atômico que já existia no banco remoto e nos scripts antigos. As migrations de 05/11 restringem a execução direta de duas funções de trigger e qualificam uma coluna ambígua na preparação de recebimentos familiares. Essas duas correções ficam versionadas e testadas localmente; não foram aplicadas ao banco remoto nesta entrega de publicação.
