# Reemissão administrativa com vencimento contratual

A ação `audited_reissue` em `app-monthly-billing` exige sessão administrativa com `finance.write`, fatura, competência, valor, vencimentos original e proposto e motivo. Não aceita identidade do provedor enviada pelo cliente. A interface fica em Alunos → Financeiro → Conciliação administrativa.

A operação aceita exclusivamente cobrança cancelada sem recebimento ou a baixa desfeita já auditada em `monthly_receipt_reversal_reviews`. Valida o valor e o vencimento propostos contra o cadastro atual. Faturas pagas, tentativas pendentes não revertidas e estados fora desses dois casos são recusados.

O backend consulta a cobrança no Asaas. Apenas uma baixa desfeita auditada pode autorizar DELETE de uma cobrança ainda pendente/vencida. O DELETE é a remoção recuperável documentada pelo Asaas, não um estorno de pagamento. Confere novamente por GET a identidade, o valor, o vencimento original, ausência de pagamento e `deleted=true`. Falha ou resposta ambígua impede criar a substituta. Referências: https://docs.asaas.com/reference/excluir-cobranca e https://docs.asaas.com/reference/recuperar-uma-unica-cobranca.

Uma transação com bloqueio por competência confere a versão da fatura, cancela coordenadamente os estados locais e o financeiro, e chama `prepare_cancelled_monthly_invoice_reissue`. O vencimento emitido antigo não muda. A substituta recebe outro ID e o vencimento contratual; a restrição de uma fatura ativa por aluno/competência continua ativa. Auditoria preserva ator, motivo, fatura, recebimento, financeiro e evidência de cancelamento anteriores.

O envio da substituta usa o dispatcher existente, sua busca por referência externa e seus claims. Retentativas da operação retornam a mesma substituta. Se o cancelamento remoto ocorrer e a transação local falhar por concorrência, repita a mesma operação para conferir novamente; não restaure a antiga nem gere outra cobrança por fora. Se o envio ficar PROCESSING/FAILED, confira os registros e repita com os mesmos dados. Só declare concluído quando Ilha e Asaas tiverem identificadores, valor, vencimento e situação correspondentes.

Não há migração de dados em lote nem atualização direta de valor/vencimento de faturas emitidas. Outubro quitado e auditorias anteriores não são modificados. Aplique somente a migration desta entrega após revisar histórico remoto e CI; publique separadamente a Edge Function e o site pelo fluxo em docs/publicacao.md.
