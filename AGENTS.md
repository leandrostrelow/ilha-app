# Trabalhar no Ilha

O GitHub é a fonte de verdade do código publicado. Leia `docs/publicacao.md` antes de publicar.

- Comece com `git fetch origin` e uma branch `codex/...` criada da `origin/main` atual. Se a pasta contiver trabalho pendente, crie um worktree; não apague, resete ou misture mudanças de outras tarefas.
- Toda mudança vai por pull request, com CI aprovado e revisão. Não use push direto ou force push na `main`.
- Os arquivos públicos estão listados em `config/site-files.json`. Inclua novos recursos nessa lista. Não publique arquivos de trabalho, segredos, backups ou dados de clientes.
- Para alterações no site, rode `pnpm run release:bump` uma vez por entrega e inclua os arquivos de versão/cache no commit. Rode `pnpm run verify`.
- A Vercel gera builds de teste a partir do GitHub. Atribuição automática do domínio oficial deve continuar desativada.
- Publique somente um build Git da `main`, com o SHA aprovado e CI concluído, usando `pnpm run release:publish <deployment-id> <sha-completo> --confirm`. Confirme no final o domínio e `autoAssignCustomDomains=false`.
- Não publique uma pasta local com mudanças pendentes, nem use `vercel --prod` ou `vercel promote` isoladamente: isso pode ignorar a revisão ou reativar a publicação automática.
- Builds de preview do projeto atual usam os serviços existentes. Não faça compras, pagamentos, envios, exclusões ou testes com dados reais. Testes que gravam dados usam exclusivamente ambiente e contas sintéticas de staging.
- Alterações no banco e nas Edge Functions são uma entrega separada, com alvo e migrations revisados. Não rode `supabase db push` em produção sem reconciliar os timestamps locais com o histórico remoto.
- Não copie tokens, senhas ou variáveis secretas para o GitHub ou para mensagens.

Em 05/11/2026 a `main` antiga de setembro substituiu uma publicação direta mais recente. A recuperação registrada em `docs/production-baseline-2026-11-05.json` preserva a referência. Nunca use uma branch anterior à sincronização como base de novas publicações.
