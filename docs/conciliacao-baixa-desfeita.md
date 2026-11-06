# Baixa externa desfeita com tentativa local pendente

Entrega de banco e Edge Function, sem execução automática em produção. Não depende da aprovação do PR de regra de vencimento, nem substitui aquela entrega.

## Problema e resultado

Quando uma confirmação em dinheiro é recebida por webhook e depois desfeita no Asaas, a proteção `STATUS_REGRESSION` mantém o pagamento local. Se a tentativa administrativa ainda não terminou, o financeiro pode continuar somando um recebimento que já foi desfeito.

A ação administrativa `review_reversal` da função `app-monthly-billing` verifica a cobrança atual por GET no Asaas, sem chamadas de alteração ao provedor. Somente aceita o caso estreito de uma fatura paga por `RECEIVED_IN_CASH`, com recebimento local pendente, claim expirado e financeiro correspondente. Uma fatura quitada por Pix ou um recebimento local concluído fica fora desse fluxo.

A transação preserva uma cópia anterior da fatura, vínculo do provedor, tentativa de recebimento e lançamento financeiro, além do ator, motivo e evidência remota. Invalida o claim anterior e retira a data de pagamento da fatura e do financeiro. Mantém ambos em revisão, sem reabrir automaticamente a cobrança. O estado `REVIEW_REQUIRED` impede que webhooks atrasados voltem a registrar aquele recebimento. Não altera valores, competência ou vencimento emitido; não exclui o histórico nem a tentativa pendente.

## Contrato administrativo

Após aplicação revisada da migration e da Edge Function, um usuário autenticado com `finance.write` pode enviar para `app-monthly-billing`:

```json
{
  "action": "review_reversal",
  "invoiceId": "UUID da fatura conferida",
  "expectedAmount": 250,
  "invoiceMonth": "2026-11-01",
  "dueDate": "2026-11-03",
  "reason": "Motivo conferido para a confirmação externa desfeita"
}
```

Esses valores são exemplo de formato, não autorização para executar contra um aluno. `dueDate` é o vencimento da fatura emitida que está sendo conferida, não o dia contratual desejado. O backend rejeita valores divergentes, outros campos e identidades de provedor enviadas pelo cliente. O ator vem da sessão autenticada. Tokens internos de automação não podem usar essa ação.

Não há botão novo no site nesta entrega: a operação é uma ação administrativa da API, para execução autenticada após revisão. Nenhum token deve ser copiado para SQL, Git ou relatórios. A RPC de banco é exclusiva do serviço; não executar manualmente fingindo uma resposta do Asaas.

## Implantação e conferência

1. Aguardar CI e concluir a revisão técnica. Aprovação de outra pessoa é opcional, conforme `docs/publicacao.md`. Reconciliar integralmente o histórico remoto de migrations, pois os timestamps recuperados diferem do remoto.
2. Conferir as definições remotas dos dois procedimentos de recebimento. A migration aborta se não encontrar o trecho esperado. Aplicar somente a migration desta entrega; não fazer `db push` de migrations antigas.
3. Publicar separadamente a Edge Function revisada. Não há alteração do site, domínio ou publicação Vercel necessária.
4. Antes da operação, conferir competência, valor, vencimento emitido, pagamento real, cancelamento do recebimento remoto e ausência de outro pagamento. Se faltar informação, pedir ao responsável.
5. Conferir o resultado: fatura `AGUARDANDO/REVIEW_REQUIRED`, financeiro `REVISAO` sem `paid_at`, tentativa original com `reversed_at` e auditoria com motivo. Nenhum novo recebimento ou cobrança é criado.
6. A saída da revisão, a correção do vencimento de uma fatura emitida e um eventual lançamento histórico são uma conciliação específica posterior. Não usar update direto, desativar guardas, inventar datas ou restaurar cobrança cancelada no Asaas isoladamente.

## Cobrança cancelada com dia incorreto

Preservar a fatura cancelada e verificar que não existe outra via ativa no Asaas e no Ilha. Aplicar a regra de vencimento contratual somente após aprovação e conferência do banco. A nova via deve usar o fluxo existente de reemissão auditada, que vincula o histórico e impede duas faturas ativas na mesma competência; nunca restaurar a via antiga apenas no provedor. Conferir valor, competência e vencimento propostos antes de emitir. Um pagamento da competência anterior não deve quitar a próxima.

## Pix histórico que ainda não tem fatura nem lançamento

A ação administrativa `historical_receipt` exige `clientId`, `invoiceMonth`, `amount`, `dueDate`, `receivedOn` e `reason`. O ator vem da sessão com `finance.write`. Só aceita competências anteriores ao mês atual, valor e datas reais informados explicitamente e aluno sem composição familiar. Se existir qualquer fatura naquele mês, ou lançamento mensal pelo mesmo nome/competência, bloqueia para revisão; não duplica nem substitui registros.

Na mesma transação cria uma fatura local histórica e usa os procedimentos existentes `prepare_monthly_invoice_receipt` e `complete_monthly_invoice_receipt`, com método `CLUB_PIX`. Não chama o Asaas nem altera o preço recorrente atual. Preserva ator, motivo, valor histórico e data real no recebimento; financeiro e fatura ficam vinculados. Repetir exatamente o mesmo registro não duplica a receita. Antes de executar, conferir também variantes de nome nos lançamentos legados e cobranças removidas no provedor. Esta é a segunda migration da entrega e também depende de revisão e implantação separada.
