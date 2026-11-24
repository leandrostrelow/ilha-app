# Auditoria Ilha Play e Asaas — 24/11/2026

Este documento registra a auditoria inicial, anterior à implementação. A entrega corretiva está descrita em `docs/correcoes-pagamentos-2026-11-24.md`.

Consulta realizada aproximadamente às 09h50, horário de Brasília. Auditoria somente leitura em produção, com testes locais usando dados fictícios. Nenhuma cobrança, baixa, estorno, notificação, cadastro ou publicação foi executada.

## Base e alcance

- GitHub: `9f852e6d9f841a43c61d3aded93563d0fc18838f`, `main`, PR #144, incluindo as entregas recentes do Evandro.
- Site: `https://app.ilhatenis.com`, versão `2026-11-24.0387`.
- O HTML servido pelo domínio coincide byte a byte com `index.html` da base auditada (SHA256 `16782ce784a5b6938f2e2db5e7baf3190578f9df7a86d015ae81ed7e287c54b9`).
- Vercel: build Git `dpl_9umaFsUmfH6ssGa4BmkFCQkM3uVP`, READY, commit correspondente.
- Supabase Ilha: estado ACTIVE_HEALTHY. A função publicada `app-monthly-billing` v17 e seus dez módulos TypeScript compartilhados coincidem com os arquivos da base auditada.
- Foram lidos contadores, estados, logs, agendas e metadados. Não foram exportados nomes, contatos, documentos, tokens ou códigos Pix de clientes.
- Não houve conferência individual de todas as cobranças por acesso independente à conta Asaas. Os resultados financeiros abaixo vêm do banco, eventos recebidos do provedor e execução da integração. Não equivalem a uma conciliação bancária completa.

## Situação observada em produção

### Mensalidades

Faturas não substituídas:

| Estado local / integração | Quantidade |
| --- | ---: |
| PAGA / RECEIVED | 91 |
| PAGA / sem status do provedor | 4 |
| AGUARDANDO / PENDING | 23 |
| VENCIDA / OVERDUE | 5 |
| ABERTA / FAILED | 2 |
| CANCELADA / CANCELLED | 8 |
| CANCELADA / sem status do provedor | 1 |

Os 91 recebimentos não significam 91 Pix pagos pelo cliente no aplicativo: podem incluir baixas registradas pelo fluxo administrativo. As quatro faturas pagas sem status de provedor não foram automaticamente classificadas como erro.

- Nenhuma divergência entre estado de fatura e registro local do provedor nas linhas vinculadas consultadas.
- Nenhum ID de pagamento do Asaas duplicado em `app_invoice_provider_payments`.
- Nenhum registro aberto PENDING/OVERDUE/RECONCILING sem atualização por mais de um dia.
- Os 64 cadastros de clientes no provedor estão ACTIVE, com identificador preenchido.
- 166 eventos de webhook nos últimos 30 dias, todos PROCESSED; nenhum evento FAILED ou preso encontrado.
- Sete execuções diárias de geração e 672 execuções de conciliação nos últimos sete dias: SUCCEEDED.
- Nas 24 horas consultadas: 103 chamadas à função mensal, todas HTTP 200; média de 3,2 s e máximo de 13,9 s. HTTP 200 não garante sucesso de todos os itens de um lote.
- Cron de conciliação ativo a cada 15 minutos; geração diária às 09h05 e lembretes às 09h30 de Brasília.

### Duas emissões antigas com erro

Há duas mensalidades de outubro, vencimento em 09/10/2026, sem ID de cobrança Asaas, sem emissão concluída e em FAILED. Últimas atualizações em 28/10, após 12 e seis tentativas. Não têm próxima reconciliação agendada.

A mensagem armazenada é genérica: “O Asaas recusou os dados da cobrança. Revise o cadastro do responsável no Financeiro.” Ela não permite determinar se a causa foi cadastro, data, limite ou outra rejeição. Não se deve reemitir automaticamente antes de conferir o histórico e a existência de pagamentos por outros meios.

### Notificações

Nos últimos 30 dias: 205 registros ENVIADO e 414 SEM_ASSINATURA (412 sem aparelho habilitado; dois sem assinatura válida após expiração). São notificações, não pessoas distintas. Ausência de assinatura não é erro de recebimento financeiro, mas explica por que parte das pessoas não recebe alerta no celular. A confirmação ENVIADO também não prova leitura pelo usuário.

## Problemas e prioridades

### P1 — Dados da conta anterior podem permanecer após troca de login

**Comprovado em reprodução local com dados fictícios; ocorrência real não comprovada.**

`index.html:7346`: `clearSession()` não limpa `paymentInvoices`, `familySummary`, `familyInvoiceItems` e outras coleções da conta. `index.html:7794` preserva faturas anteriores em falha de consulta e `:7800` preserva família. O login em `:8084` permite continuar com falhas parciais.

Reprodução: conta fictícia A com fatura → logout → login B → timeout simulado na consulta das faturas/família. O estado final associa a sessão B às coleções previamente carregadas de A. Pode exibir fatura e Pix da outra conta em um aparelho compartilhado; não é uma demonstração de acesso cruzado permitido pelo banco.

**Correção prioritária:** limpar integralmente dados do usuário na troca de sessão, associar cada carga à identidade inicial e descartar respostas tardias de outra sessão. Só preservar dados em falha quando pertencem ao mesmo usuário.

### P2 — Geração de Pix não renova sessão nem limita espera

**Comprovado localmente; frequência real não mensurada.**

`index.html:9615` usa `fetch` diretamente com o token atual, sem `ensureFreshSession`, recuperação de 401 ou timeout. A antecipação de meses repete a lacuna em `:9525–9532`. O fluxo REST comum já tem essas proteções em `:7200`.

Reprodução com sessão fictícia expirada: envia token antigo, zero chamadas de renovação e nenhum AbortSignal. Isso pode produzir erros ao retornar do aplicativo suspenso e manter botões aguardando numa conexão instável. A loja usa padrão semelhante em `:9645`.

**Correção:** um helper autenticado de Edge Functions, token fresco, timeout, uma recuperação de autenticação e consulta do resultado antes de repetir emissão com resultado incerto. Preservar a idempotência financeira existente.

### P2 — Pagamento confirmado não atualiza imediatamente a tela financeira

**Confirmado na implementação.**

O callback de notificação `index.html:6501–6508` carrega dados, mas redesenha apenas início e notificações. As assinaturas `:6559–6577` não acompanham diretamente faturas. Entrar na aba de pagamentos (`:8364`) não garante atualização, e o modal Pix (`:9395`) não acompanha a fatura aberta.

**Efeito:** a baixa pode estar correta no servidor enquanto a pessoa continua vendo “aguardando” e o QR antigo.

**Correção:** atualizar ao voltar do banco/retomar o app, ao abrir pagamentos e ao receber evento financeiro; retirar o Pix quando pago, cancelado ou em revisão. Disponibilizar consulta de status claramente identificada, sem prometer baixa instantânea.

### P2 — Erro repetido de torneio está oculto atrás de HTTP 200

**Ocorrência confirmada em produção, separada das mensalidades.**

Um único pagamento antigo de R$ 100 está RECEIVED, mas a inscrição está CANCELLED e PAID. A reconciliação tenta reativá-la numa chave esportiva já completa. O banco corretamente impede a reinserção: “A chave desta classe já está completa. Remova ou desative um atleta antes de adicionar outro.”

Foram encontrados aproximadamente 288 registros de falha em 24 horas, do mesmo pagamento (a consulta HTTP contou 287; as consultas usam instantes de corte ligeiramente diferentes). A pendência remonta a 03/11. Não são 288 clientes nem 288 mensalidades.

`supabase/functions/tournament-payment-expiry/index.ts:584` chama confirmação local; `:675–680` captura o erro, mas não agenda espera progressiva e registra `unknown` quando o erro PostgREST não é instância de Error; `:695` retorna HTTP 200. A proteção esportiva está em `supabase/migrations/20260921150000_fill_vacant_draw_slot_after_inactive_player.sql:74`.

**Correção:** separar confirmação financeira de reativação de inscrição cancelada, registrar conflito para revisão e reduzir retentativas com backoff. Não remover atletas nem alterar a chave para contornar a falha.

### P2 — Diagnóstico de rejeição do Asaas é genérico demais

`supabase/functions/app-monthly-billing/index.ts:234` extrai códigos de erro, mas `:204` transforma rejeições em “revise o cadastro”. Os dois FAILED existentes demonstram a limitação de diagnóstico.

**Correção:** registrar etapa, status HTTP e código sanitizado, distinguindo cadastro, data, limitação e indisponibilidade, sem salvar dados pessoais ou payload financeiro no log. Incluir identificador de atendimento para o usuário.

### P1/P2 — Lacunas preventivas na conciliação

São riscos reproduzidos/revisados no código, **não ocorrências demonstradas nos dados atuais**:

- `asaas-payment-webhook/index.ts:419`: `PAYMENT_RECEIVED_IN_CASH_UNDONE` não é reconhecido e pode ser ignorado. Como faturas PAGA não entram na conciliação normal, desfazer uma baixa diretamente no Asaas pode deixar o Ilha pago até intervenção auditada. Tratar o evento como revisão, preservando histórico; não reabrir débito automaticamente. Nenhum evento desse tipo apareceu na consulta. [Referência oficial Asaas](https://docs.asaas.com/reference/undo-cash-receipt-confirmation).
- `app-monthly-billing/index.ts:477–503`: uma rejeição explícita à criação do cliente deixa a reserva de criação pendente; a rotina SQL pode convertê-la em REVIEW_REQUIRED e impedir nova tentativa mesmo após correção. Não há cadastros presos atualmente. Diferenciar rejeição definitiva de resultado ambíguo.
- `app-monthly-billing/index.ts:338` não compara vencimento na conciliação normal; `:296` ignora `deleted`. Testes em memória aceitaram vencimento divergente e classificaram cobrança excluída com status PENDING como pendente. Os fluxos recentes de ajustes auditados possuem controles mais fortes. Levar esses controles também à conciliação periódica.

### P3 — Comprovante de baixa manual pode não aparecer

`index.html:7662` consulta `received_method` e `received_on`, mas `mapPaymentInvoiceRow`, em `:7635`, descarta os campos. O renderizador em `:9331` depende de `received_method`, portanto a informação não aparece como pretendido. Corrigir o mapeamento, sem alterar a baixa financeira.

## Melhorias recomendadas

1. Corrigir isolamento de sessão e atualizar testes com troca de usuário, respostas tardias e falhas parciais.
2. Unificar chamadas autenticadas do Pix/antecipação/loja e melhorar o retorno visual após pagamento.
3. Encaminhar as duas emissões FAILED e a inscrição de torneio ao fluxo auditado, sem alteração direta de tabelas.
4. Instrumentar erros do frontend por versão, etapa, dispositivo/navegador e identificador técnico, sem CPF, contato, Pix, token ou conteúdo financeiro. Os logs atuais não permitem atribuir todas as reclamações de aparelhos às causas encontradas.
5. Mostrar no app o estado das notificações: ativadas, bloqueadas ou aparelho não registrado; oferecer orientação para ativação. Separar alerta push de confirmação financeira.
6. Alertar sobre FAILED, REVIEW_REQUIRED, filas sem progresso e divergências; HTTP 200 isolado é insuficiente.
7. Expandir testes sintéticos de sessão expirada, retomada do banco, rejeição 400/429, eventos fora de ordem, baixa desfeita e cancelamento esportivo com pagamento recebido.

Os advisors também listaram oportunidades de índices e políticas RLS redundantes. Não foram tratados como causa comprovada das reclamações; mudanças de performance exigem plano de execução e revisão própria. Funções SECURITY DEFINER expostas não são automaticamente vulneráveis: é necessário verificar suas autorizações antes de alterar privilégios.

## Validação e limites

- `pnpm run verify` concluído: dependências, lint, tipos, build, 899 testes Node aprovados, três ignorados; 75 testes Edge aprovados.
- Ambiente local: Node 24.22.3 e pnpm 11.25.0 emitiram aviso por diferença do Node 22 / pnpm 11.19.0 declarados. Não é erro observado no aplicativo publicado.
- As 26 verificações de cliente/família/lembretes selecionadas também passaram. A cobertura existente não inclui os cenários defeituosos reproduzidos.
- Não foi executado pagamento real nem teste ponta a ponta financeiro de staging nesta auditoria. O staging documentado não aparece na lista de projetos acessíveis ao conector atual.
- Não foi feito login como aluno real, alteração de cadastro, execução manual de cron ou reenvio de webhook.
- Nenhuma correção foi implantada. A fonte permanece intacta; este relatório é a única adição na branch isolada `codex/auditoria-pagamentos-20261124`.
