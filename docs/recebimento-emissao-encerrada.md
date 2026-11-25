# PIX CLUBE após emissão falhada encerrada

Quando o Pix já foi recebido pelo clube, mas a emissão no Asaas falhou e foi encerrada pelo fluxo auditado, o ADM pode registrar o recebimento sem gerar outra cobrança remota. Em Financeiro → Conciliação administrativa, selecione “Registrar PIX CLUBE após encerrar emissão falhada”, a emissão original, a data real e o motivo.

O fluxo aceita somente faturas individuais com auditoria de encerramento, financeiro cancelado e nenhum recebimento ou identificador remoto. Consulta novamente o Asaas por referência externa; resposta incompleta, cobrança encontrada ou alteração concorrente impedem a operação. A emissão e o financeiro cancelados permanecem no histórico. Uma fatura local substituta, com o mesmo valor, competência e vencimento, é quitada atomicamente pelo fluxo existente de recebimentos. Não altera cadastro, inscrição nem próximas competências.

## Implantação separada

- Projeto existente: `lkqtgptebkgfwguykxhv`.
- Pré-conferência: 251 entradas no histórico remoto, última `20261124144313_monthly_whatsapp_archived_customer_origins`. As diferenças históricas de timestamp permanecem preservadas.
- Conferidas as definições remotas de preparação/conclusão de recebimento, encerramento de emissão, vinculação financeira e proteções de recebimento/substituição. O recebimento sem provedor e as proteções de reversão estão presentes.
- Aplicar somente `20261125180000_receipt_after_failed_issuance.sql`, após integração e CI. Registrar essa migration no histórico na mesma transação. Não usar `db push` para reaplicar a cadeia antiga.
- Implantar somente `app-monthly-billing` a partir do commit integrado, mantendo a autenticação e as permissões existentes. Depois publicar o build aprovado pelo fluxo documentado em `publicacao.md`.
- Conferir a operação real no ADM somente após implantação. Os testes automatizados usam dados fictícios, inclusive no Postgres descartável da CI.

Não há criação ou confirmação de pagamento no Asaas: trata-se de recebimento externo do clube com ausência remota comprovada. A operação tem auditoria própria e repetição idempotente; um recebimento divergente exige revisão.
