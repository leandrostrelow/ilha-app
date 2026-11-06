# Correção da regra de vencimento mensal

Entrega exclusiva de banco, sem execução automática em produção.

Na primeira ativação, `first_due_date` guardava o dia da ativação e tinha precedência sobre o vencimento contratado. Isso também afetava a proposta de reemissão de uma fatura cancelada. A nova migration mantém o dado histórico e calcula o vencimento pelo `due_day` do cadastro, limitado ao último dia do mês. A previsão de um mês vencido deixa de trocar silenciosamente o vencimento por amanhã.

## Limites da entrega

- Não altera nem reabre faturas já emitidas, canceladas ou pagas.
- Não registra recebimentos, não modifica valores e não chama o Asaas.
- Faturas emitidas com vencimento divergente exigem correção coordenada no provedor e no histórico local, em entrega operacional separada. Não edite apenas a data no Asaas: o snapshot local é imutável.
- Recebimentos externos anteriores à criação da cobrança podem ser recusados pelo Asaas. Não substituir a data real por hoje para conseguir confirmar.
- Uma confirmação manual desfeita no Asaas não é necessariamente revertida no app: a proteção `STATUS_REGRESSION` preserva pagamentos. Encaminhar para reconciliação auditada; não desabilitar essa proteção.

## Aplicação após revisão

1. Aprovar a CI, incluindo `monthly_due_day.test.sql`, e concluir a revisão técnica.
2. Reconciliar integralmente o histórico remoto antes da aplicação. A consulta de 06/11/2026 encontrou `first_monthly_payment_on_activation` remoto em `20261007202933` e `dependent_billing_due_day` em `20261009170915`; os timestamps diferem dos arquivos recuperados no Git. Não rodar `supabase db push` com todo o diretório.
3. Conferir as definições remotas de `private.first_monthly_due_date` e `private.monthly_billing_candidates_ignoring`. A nova migration aborta se o trecho esperado não corresponder.
4. Aplicar somente esta migration em uma entrega de banco explicitamente autorizada e registrar sua versão no histórico pelo procedimento de manutenção do projeto.
5. Conferir prévia, autoatendimento, fim de mês e ausência de alteração nas faturas existentes. Não gerar cobranças reais para testar.
6. Em entrega de site posterior, atualizar os avisos da primeira ativação que ainda dizem que a mensalidade vence hoje. Só publicar essa mensagem depois da regra de banco estar aplicada, seguindo `docs/publicacao.md`.

Os testes usam apenas cadastro sintético, com cobrança desativada, sem emissão ou fila de chamadas externas. O teste antigo `first_monthly_payment.test.sql` depende de dados preexistentes e não pertence à lista de CI; suas expectativas de vencimento imediato precisam ser atualizadas antes de eventual reutilização manual.
