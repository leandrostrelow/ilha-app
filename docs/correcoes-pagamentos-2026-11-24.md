# Correções de pagamentos — 24/11/2026

Base: main `9f852e6d9f841a43c61d3aded93563d0fc18838f`, incluindo o PR #144. A entrega não reverte as mudanças do Evandro.

## Aplicação

- Dados da sessão são descartados na troca de usuário; respostas e renovações antigas não podem restabelecer uma conta encerrada.
- Pix mensal, antecipação e Store usam renovação de autenticação, timeout e uma única recuperação de 401. Não repetem emissão após resultado de rede incerto.
- Faturas atualizam por realtime, retorno ao app e consulta periódica enquanto o financeiro está visível. O modal acompanha a fatura e remove o Pix quando deixa de ser pagável.
- “Já paguei / consultar” lê o estado do banco atualizado pelo webhook. Não reemite nem registra recebimento.
- Baixas manuais preservam os campos de método e data ao renderizar.
- A conciliação administrativa permite encerrar emissão com falha somente após GET do Asaas comprovar ausência, comparação de versão e conferência de fatura/financeiro. Mantém auditoria e não registra pagamento.

## Entrega do banco e funções

Aplicar somente as três migrations desta entrega, após CI do Postgres e integração. Nunca reenviar a cadeia histórica.

| Arquivo local | Objetivo |
| --- | --- |
| `20261124125731_preserve_cancelled_tournament_reconciliation.sql` | Preservar cancelamento esportivo e encerrar acompanhamento financeiro antigo com auditoria |
| `20261124125744_monthly_provider_recovery_guards.sql` | Revisão de alterações Asaas, liberação de criação rejeitada e concorrência com ajuste auditado de vencimento |
| `20261124125801_close_failed_monthly_invoice.sql` | Encerrar emissão falhada sem cobrança remota nem recebimento |

Funções necessárias: `app-monthly-billing`, `asaas-payment-webhook`, `tournament-payment-expiry`. Devem partir do SHA integrado; publicar após as migrations correspondentes.

Pré-conferência de produção: 245 entradas no histórico remoto, última `20261117190000_suspend_family_without_invoice`. Diferenças históricas de nome/timestamp permanecem preservadas. A definição remota de `sync_tournament_registration_payment_group` coincide com o corpo da baseline `20260901202936`. As extensões de conciliação mensal e ajuste auditado recusam definições sem as âncoras esperadas. A tabela `app_payment_invoices` já participa de `supabase_realtime`.

## Operações autorizadas, separadas de testes

Depois da implantação, encerrar as duas emissões falhadas de outubro pelo novo fluxo administrativo. Conferir ausência remota, estados cancelados e ausência de baixa; manter valores, datas e histórico original.

Encerrar somente a conciliação repetida do pagamento do torneio cancelado via `close_cancelled_tournament_reconciliation`, com administrador autorizado, dados atuais e motivo. Preservar recebimento, inscrições e histórico; futuros eventos de estorno continuam aplicáveis.

## Verificação

Testes de sessão e integração usam respostas sintéticas. Testes SQL usam banco descartável no GitHub Actions, sem contas de clientes. A conferência visual local usa fatura fictícia, com código Pix inválido e modo somente leitura. Não foram feitos pagamentos de teste em produção.

Notificações dependem de permissão e assinatura no aparelho. Corrigir pagamentos não habilita push automaticamente. Recomendações de observabilidade e índices da auditoria não constituem incidentes comprovados e não foram incluídas como alterações de infraestrutura nesta entrega.
