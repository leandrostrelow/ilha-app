# Runbook de homologação e entrada em produção do Asaas

Este roteiro separa os testes automáticos sem valor real do canário financeiro
que precisa ser executado por uma pessoa autorizada. Chaves, tokens, CPFs,
payloads Pix e outros segredos nunca devem ser colocados no repositório, em logs
do CI ou em conversas.

## 1. Gate automático no Sandbox

O workflow manual `staging-e2e.yml` permanece travado para um host e um projeto
Supabase de staging, uma chave Asaas com prefixo de Sandbox e identidades
sintéticas. Ele executa estes controles financeiros:

1. envia duas vezes o mesmo evento com token inválido e exige `HTTP 401` nas
   duas tentativas;
2. cria um cliente e uma cobrança Pix exclusivamente no Asaas Sandbox;
3. usa o endpoint exclusivo do Sandbox para simular o pagamento;
4. só aprova a baixa quando a consulta da cobrança retorna `RECEIVED`;
5. solicita o estorno da cobrança recebida e tenta remover o cliente sintético
   ao final. Como o histórico financeiro pode impedir a exclusão imediata do
   cliente, qualquer fixture pendente continua identificável pelo prefixo
   técnico `ilha-e2e` para limpeza manual no Sandbox.

As duas entregas não autenticadas provam somente que o webhook falha fechado.
Elas **não** comprovam a idempotência de uma entrega válida, pois o evento é
recusado antes de chegar à reserva atômica no banco.

## 2. E2E financeiro válido em staging

Este é o roteiro operacional completo. Ele usa somente o projeto Supabase
`ohndgphxtwhokekjyobu`, a conta Asaas Sandbox e identidades sintéticas
controladas. Execute cada bloco em ordem e pare na primeira divergência.

### 2.1 Limites do teste automático

O workflow `staging-e2e.yml` prova o isolamento de ambiente, cria uma cobrança
diretamente no Asaas Sandbox e verifica que o webhook recusa token inválido. A
cobrança direta usa `externalReference` iniciado por `ilha-e2e`, portanto não
possui uma linha correspondente em `tournament_payments` e seu webhook é
corretamente ignorado pelo aplicativo. Esse workflow não substitui o teste
válido abaixo.

O `ASAAS_WEBHOOK_TOKEN` permanece somente no Asaas e nos secrets da Edge
Function. Não o copie para a estação, não o adicione ao GitHub Actions e não
envie manualmente payloads ao webhook. O reenvio válido deve sempre sair do log
do próprio Asaas.

### 2.2 Preflight sem ler segredos

No SQL Editor do projeto de staging, execute apenas estas consultas:

```sql
select version
from supabase_migrations.schema_migrations
where version in ('20260901202913', '20260901202936')
order by version;

select
  to_regprocedure('public.invoke_tournament_payment_expiry()') is not null
    as expiry_invoker_exists,
  to_regprocedure('public.apply_tournament_payment_reconciliation(uuid,text,timestamptz,text,text,text,text,text,text,text,text,timestamptz,jsonb,timestamptz,timestamptz,integer,timestamptz,text,text,numeric,timestamptz,timestamptz)')
    is not null as reconciliation_exists;

select jobname, schedule, active
from cron.job
where jobname = 'ilha-open-expire-unpaid-registrations';

select name
from vault.secrets
where name in (
  'tournament_payment_expiry_url',
  'tournament_payment_expiry_publishable_key',
  'tournament_payment_expiry_token'
)
order by name;

select provider_environment, status, count(*)
from public.tournament_payments
where provider = 'ASAAS'
  and status in (
    'CREATED', 'RECONCILING', 'PENDING', 'CONFIRMED', 'REVIEW_REQUIRED',
    'PARTIALLY_REFUNDED', 'RECEIVED', 'OVERDUE'
  )
group by provider_environment, status
order by provider_environment, status;
```

Os dois IDs de migration devem aparecer, as duas funções devem existir, o job
deve estar ativo e os três nomes do Vault devem aparecer. A última consulta não
pode mostrar cobrança ativa `PRODUCTION` ou `UNKNOWN` neste projeto de staging.
Ela não exibe segredo, CPF, contato, `raw_response` nem payload Pix.

No Asaas Sandbox, confirme sem alterar o token já instalado:

- URL:
  `https://ohndgphxtwhokekjyobu.supabase.co/functions/v1/asaas-payment-webhook`;
- autenticação pelo cabeçalho `asaas-access-token`;
- eventos de recebimento, atualização, vencimento, exclusão, estorno e disputa
  habilitados, incluindo `PAYMENT_RECEIVED`, `PAYMENT_REFUND_IN_PROGRESS`,
  `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_REFUNDED`,
  `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_CHARGEBACK_DISPUTE` e
  `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`.

### 2.3 Criar duas cobranças Pix vinculadas ao aplicativo

Abra `https://ilha-app-staging.vercel.app/torneios` e, pelo frontend publicado
de staging, faça duas inscrições em um torneio aberto:

1. `E2E-PAGO-<data-hora-UTC>` será liquidada e estornada;
2. `E2E-EXPIRA-<data-hora-UTC>` permanecerá sem pagamento para testar expiração.

Use somente o documento sintético aprovado para a conta Sandbox, e-mail de teste
controlado e telefone de teste controlado. Não invente telefone que possa
pertencer a terceiro. Clientes novos criados pela integração ficam com
notificações Asaas desabilitadas no ambiente `SANDBOX`.

Localize as duas fixtures pelo marcador, sem consultar campos sensíveis:

```sql
select
  registration.public_name as marker,
  registration.id as registration_id,
  registration.registration_group_id,
  payment.id as local_payment_id,
  payment.provider_payment_id,
  payment.external_reference,
  payment.provider_environment,
  payment.billing_type,
  payment.status as payment_status,
  registration.status as registration_status,
  registration.payment_status as registration_payment_status,
  payment.amount,
  payment.expires_at,
  payment.updated_at as payment_updated_at,
  registration.updated_at as registration_updated_at
from public.tournament_registrations as registration
join public.tournament_payments as payment
  on payment.registration_id = registration.id
where registration.public_name in (
  'E2E-PAGO-<data-hora-UTC>',
  'E2E-EXPIRA-<data-hora-UTC>'
)
order by registration.public_name;
```

Exija duas linhas, `provider_environment='SANDBOX'`, `billing_type='PIX'`,
`provider_payment_id` preenchido e `external_reference` iniciado por
`tournament-registration:` ou `tournament-family:`. Guarde somente os UUIDs,
IDs `pay_...`, marcadores e horários técnicos.

### 2.4 Confirmar a cobrança pelo Asaas e pelo webhook

A documentação pública atual do Asaas é inconsistente: a
[referência de confirmação](https://docs.asaas.com/reference/confirm-payment)
ainda lista `POST /v3/sandbox/payment/{id}/confirm`, enquanto a
[FAQ do Sandbox](https://docs.asaas.com/docs/sandbox-1) orienta confirmar pela
interface. Para este gate manual, use a interface do Asaas Sandbox: abra a
cobrança `E2E-PAGO`, escolha **CONFIRMAR PAGAMENTO** e aguarde a cobrança chegar
a `RECEIVED`. Não aprove apenas `CONFIRMED`.

Depois aguarde o webhook e execute, substituindo somente o ID técnico `pay_...`:

```sql
select
  payment.id as local_payment_id,
  payment.status as payment_status,
  payment.paid_at,
  payment.next_reconciliation_at,
  registration.id as registration_id,
  registration.status as registration_status,
  registration.payment_status as registration_payment_status,
  registration.paid_amount,
  payment.updated_at as payment_updated_at,
  registration.updated_at as registration_updated_at
from public.tournament_payments as payment
join public.tournament_registrations as registration
  on registration.id = payment.registration_id
where payment.provider = 'ASAAS'
  and payment.provider_environment = 'SANDBOX'
  and payment.provider_payment_id = '<PAYMENT_ID_ASAAS_E2E_PAGO>';

select event_id, event_type, status, received_at, processed_at, error
from public.asaas_webhook_events
where provider_payment_id = '<PAYMENT_ID_ASAAS_E2E_PAGO>'
order by received_at;
```

O gate passa somente com cobrança local `RECEIVED`, inscrição `CONFIRMED`,
`registration_payment_status='PAID'`, valor pago igual ao esperado e evento
`PAYMENT_RECEIVED` em `PROCESSED`. Se houver grupo familiar, todos os integrantes
do grupo devem estar confirmados.

### 2.5 Idempotência de uma entrega válida

Copie da consulta anterior o `event_id` do `PAYMENT_RECEIVED` e anote os dois
`updated_at`. No painel Asaas Sandbox, abra **Webhooks > Logs**, localize esse
evento e use **Reenviar**. Espere a resposta 2xx terminar e reenvie o mesmo
evento mais uma vez. Não crie um payload parecido e não troque o ID. Esse teste
segue a garantia de entrega *at least once* documentada nos
[eventos de webhook do Asaas](https://docs.asaas.com/docs/webhooks-events).

Execute:

```sql
select
  '<EVENT_ID_PAYMENT_RECEIVED>' as checked_event_id,
  count(*) as event_rows,
  min(status) as event_status,
  min(processed_at) as processed_at
from public.asaas_webhook_events
where event_id = '<EVENT_ID_PAYMENT_RECEIVED>';

select
  payment.status as payment_status,
  payment.updated_at as payment_updated_at,
  registration.status as registration_status,
  registration.payment_status as registration_payment_status,
  registration.updated_at as registration_updated_at,
  (
    select count(*)
    from public.tournament_registrations as member
    where member.id = registration.id
       or (
         registration.registration_group_id is not null
         and member.registration_group_id = registration.registration_group_id
       )
  ) as registration_rows
from public.tournament_payments as payment
join public.tournament_registrations as registration
  on registration.id = payment.registration_id
where payment.provider_payment_id = '<PAYMENT_ID_ASAAS_E2E_PAGO>'
  and payment.provider_environment = 'SANDBOX';
```

`event_rows` deve ser `1`, o estado deve continuar `RECEIVED`/`CONFIRMED`/`PAID`,
os dois `updated_at` devem permanecer iguais aos anotados antes do reenvio e
`registration_rows` não pode aumentar. A resposta repetida pode informar
`duplicate:true`; isso é sucesso idempotente.

### 2.6 Expiração controlada da cobrança não paga

Use somente o `local_payment_id` de `E2E-EXPIRA`. O bloco abaixo falha fechado se
o ID não for uma cobrança Sandbox pendente e vinculada ao marcador informado:

```sql
begin;

do $$
declare
  target_payment_id uuid := '<LOCAL_PAYMENT_UUID_E2E_EXPIRA>'::uuid;
  matched_rows integer;
begin
  select count(*)
    into matched_rows
  from public.tournament_payments as payment
  join public.tournament_registrations as registration
    on registration.id = payment.registration_id
  where payment.id = target_payment_id
    and payment.provider = 'ASAAS'
    and payment.provider_environment = 'SANDBOX'
    and payment.status in ('CREATED', 'RECONCILING', 'PENDING', 'FAILED', 'OVERDUE')
    and payment.paid_at is null
    and registration.public_name = 'E2E-EXPIRA-<data-hora-UTC>';

  if matched_rows <> 1 then
    raise exception 'A cobrança E2E de expiração não corresponde ao alvo seguro.';
  end if;

  update public.tournament_payments
  set expires_at = now() - interval '1 minute',
      next_reconciliation_at = now(),
      updated_at = now()
  where id = target_payment_id;
end
$$;

commit;
```

Dispare a mesma função usada pelo cron, sem ler nem transportar o token do Vault:

```sql
select public.invoke_tournament_payment_expiry() as request_id;
```

O ID deve ser não nulo. Como o
[`pg_net` inicia a requisição após o commit](https://supabase.com/docs/guides/database/extensions/pg_net),
aguarde alguns segundos e consulte apenas a resposta desse ID:

```sql
select id, status_code, timed_out, error_msg, content
from net._http_response
where id = <REQUEST_ID>;
```

Exija `status_code=200`, `timed_out=false` e `error_msg is null`. Se o cron de
cinco minutos vencer a corrida, a resposta pode indicar zero itens; o resultado
do alvo continua sendo a prova definitiva:

```sql
select
  not exists (
    select 1 from public.tournament_payments
    where id = '<LOCAL_PAYMENT_UUID_E2E_EXPIRA>'::uuid
  ) as payment_removed,
  not exists (
    select 1 from public.tournament_registrations
    where id = '<REGISTRATION_UUID_E2E_EXPIRA>'::uuid
  ) as registration_removed,
  exists (
    select 1 from private.tournament_expired_registration_attempts
    where payment_id = '<LOCAL_PAYMENT_UUID_E2E_EXPIRA>'::uuid
  ) as archive_recorded;
```

Os três resultados devem ser `true`. Não consulte os snapshots privados. A
rotina também tenta remover a cobrança ainda não paga no Asaas Sandbox.

### 2.7 Estorno parcial e integral

O teste parcial é o caminho mais previsível, pois o estorno integral de Pix pode
exigir saldo Sandbox adicional para cobrir tarifas. A API Key precisa ter a
permissão `PAYMENT_REFUND:WRITE`, conforme a
[referência de estorno](https://docs.asaas.com/reference/refund-payment). Em um
terminal com histórico protegido e `xtrace` desabilitado, carregue a chave sem
mostrá-la:

```bash
set +x
read -r -s -p 'API Key exclusiva do Asaas Sandbox: ' E2E_ASAAS_API_KEY
printf '\n'
case "$E2E_ASAAS_API_KEY" in
  '$aact_hmlg_'*) ;;
  *) echo 'Chave recusada: use somente Sandbox.' >&2; unset E2E_ASAAS_API_KEY; exit 1 ;;
esac

read -r -p 'ID pay_... da fixture E2E-PAGO: ' E2E_ASAAS_PAYMENT_ID
read -r -p 'Valor parcial menor que o total (ex.: 1.00): ' E2E_ASAAS_REFUND_VALUE

curl --fail-with-body --silent --show-error \
  --request POST \
  --url "https://api-sandbox.asaas.com/v3/payments/${E2E_ASAAS_PAYMENT_ID}/refund" \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --header "access_token: ${E2E_ASAAS_API_KEY}" \
  --data "$(jq -cn --argjson value "$E2E_ASAAS_REFUND_VALUE" \
    '{value:$value,description:"E2E Sandbox sem dados reais"}')" \
  | jq '{id,status,value}'

unset E2E_ASAAS_API_KEY E2E_ASAAS_PAYMENT_ID E2E_ASAAS_REFUND_VALUE
```

Aguarde `PAYMENT_PARTIALLY_REFUNDED` no log do webhook e valide:

```sql
select
  payment.status as payment_status,
  payment.next_reconciliation_at,
  registration.status as registration_status,
  registration.payment_status as registration_payment_status,
  registration.paid_amount
from public.tournament_payments as payment
join public.tournament_registrations as registration
  on registration.id = payment.registration_id
where payment.provider_payment_id = '<PAYMENT_ID_ASAAS_E2E_PAGO>'
  and payment.provider_environment = 'SANDBOX';

select event_id, event_type, status, processed_at
from public.asaas_webhook_events
where provider_payment_id = '<PAYMENT_ID_ASAAS_E2E_PAGO>'
  and event_type in (
    'PAYMENT_REFUND_IN_PROGRESS',
    'PAYMENT_PARTIALLY_REFUNDED',
    'PAYMENT_REFUNDED'
  )
order by received_at;
```

Depois do parcial, espere pagamento `PARTIALLY_REFUNDED`, inscrição ainda
`CONFIRMED`, `registration_payment_status='PARTIALLY_REFUNDED'` e `paid_amount`
reduzido pelo valor concluído. Para testar o integral, solicite somente o saldo
restante após garantir saldo fictício suficiente no Sandbox. O evento final
deve ser `PAYMENT_REFUNDED`, com pagamento e inscrição `REFUNDED` e valor pago
zero. Reenvie o evento final uma vez e repita a prova de idempotência da seção
2.5.

### 2.8 Chargeback: limite real do Sandbox

Não existe um passo self-service confiável para fabricar chargeback. A matriz
oficial de
[recursos testáveis no Sandbox](https://docs.asaas.com/docs/what-can-be-tested)
informa que disputas de chargeback exigem assistência da equipe **Integration
Success**. Não envie um `PAYMENT_CHARGEBACK_REQUESTED` sintético ao webhook e não
exponha `ASAAS_WEBHOOK_TOKEN` para contornar essa limitação.

O comportamento determinístico local deve passar antes de solicitar o cenário
ao Asaas:

```bash
node --test --test-reporter=spec \
  --test-name-pattern='webhook Asaas trata chargeback repetido como idempotente' \
  test/contracts.test.mjs
```

Para a prova integrada, peça ao Integration Success que habilite uma disputa
somente sobre uma terceira fixture Sandbox dedicada e confirme previamente que
o cenário é compatível com cobrança Pix. Quando o Asaas emitir o evento real,
espere:

- evento `PAYMENT_CHARGEBACK_REQUESTED` em `PROCESSED`;
- pagamento local `CANCELLED` com `next_reconciliation_at` não nulo enquanto a
  disputa puder ser revertida;
- inscrição `CANCELLED`, `registration_payment_status='CANCELLED'` e valor pago
  zero;
- reenvio do mesmo `event_id` respondendo 2xx sem nova transição.

Se o Asaas não disponibilizar chargeback Pix no Sandbox, registre o caso como
**não executável pelo provedor**, mantenha o teste local aprovado e não declare
o E2E de chargeback como realizado.

### 2.9 Encerramento

Não apague eventos de webhook, arquivos privados de expiração ou histórico
financeiro para “limpar” o teste. Cancele somente fixtures sintéticas ainda
ativas pelo fluxo administrativo, remova no Asaas apenas cobranças não pagas e
mantenha os IDs técnicos, horário UTC e resultado do gate. Nunca copie
`raw_response`, CPF, telefone, e-mail, QR Code, Pix copia-e-cola ou secrets para
o relatório.

Se qualquer item falhar, não avance para Produção.

## 3. Preparação da conta oficial

Antes do canário real:

- a conta Asaas deve estar aprovada, com Pix e recebimento habilitados;
- gere uma API Key de Produção dedicada à integração;
- gere um token de webhook aleatório com pelo menos 32 caracteres, diferente da
  API Key;
- configure somente nos segredos das Edge Functions de Produção:
  - `ASAAS_API_KEY`;
  - `ASAAS_BASE_URL=https://api.asaas.com/v3`;
  - `ASAAS_WEBHOOK_TOKEN`;
- confirme o par exato entre endpoint e chave moderna. A integração falha
  fechada se o par estiver divergente: Sandbox usa
  `https://api-sandbox.asaas.com/v3` com chave de prefixo `$aact_hmlg_`, e
  Produção usa `https://api.asaas.com/v3` com chave de prefixo
  `$aact_prod_`. Nunca registre ou copie o restante da chave;
- mantenha os segredos atuais do Supabase e Turnstile sem copiá-los ou
  substituí-los durante esta troca;
- no Asaas oficial, configure a URL dedicada da função
  `asaas-payment-webhook`, o mesmo token e apenas os eventos de cobrança que o
  código trata;
- gere outro token aleatório, também com ao menos 32 caracteres, para a rotina
  interna de reconciliação. Configure o mesmo valor como secret da Edge Function
  `TOURNAMENT_PAYMENT_EXPIRY_TOKEN` e como secret Vault
  `tournament_payment_expiry_token`;
- configure no Vault `tournament_payment_expiry_url` com a URL HTTPS exata da
  Edge Function e `tournament_payment_expiry_publishable_key` com a chave
  publicável do projeto. A chave publicável é enviada somente no cabeçalho
  `apikey`; ela não substitui o token interno;
- execute `public.invoke_tournament_payment_expiry()` em uma sessão autorizada e
  exija um ID de requisição não nulo. Em seguida, confirme a resposta HTTP e o
  log da Edge Function sem imprimir nenhum dos três valores. Se o retorno for
  nulo ou não houver execução autenticada, o cron ainda está inoperante;
- valide que nenhuma chave com prefixo de Sandbox ficou no ambiente de
  Produção e que nenhuma chave de Produção chegou ao frontend ou à Vercel.

### Gate de isolamento Sandbox/Produção

A migração financeira coloca em `REVIEW_REQUIRED` toda cobrança Asaas
histórica com identificador remoto e ambiente `UNKNOWN`, remove o link/QR Pix
armazenado e não consulta esse identificador no provedor. Antes do canário,
uma sessão administrativa deve executar as consultas abaixo sem expor
`raw_response`, payload Pix ou dados pessoais:

```sql
select provider_environment, status, count(*)
from public.tournament_payments
where provider = 'ASAAS'
  and provider_payment_id is not null
group by provider_environment, status
order by provider_environment, status;

select count(*) as incompatible_active_charges
from public.tournament_payments
where provider = 'ASAAS'
  and provider_payment_id is not null
  and provider_environment <> 'PRODUCTION'
  and (
    status in (
      'CREATED', 'RECONCILING', 'PENDING', 'CONFIRMED', 'REVIEW_REQUIRED',
      'PARTIALLY_REFUNDED', 'RECEIVED', 'OVERDUE'
    )
    or (status = 'CANCELLED' and next_reconciliation_at is not null)
  );
```

O segundo resultado deve ser **zero** para abrir Produção. Registros de
Sandbox/legados devem ser conciliados e encerrados pela equipe financeira; não
edite `provider_environment` manualmente e não reaproveite IDs, links ou QR
Codes entre ambientes.

O canário também deve confirmar que toda cobrança remota possui
`billingType=PIX`. Qualquer divergência de ambiente, ID, referência externa,
valor ou forma de pagamento vai para revisão manual e não confirma a vaga.

### Gate de privacidade e retenção

Antes de abrir as inscrições, a organização deve registrar quem é responsável
pelos dados do torneio e aprovar uma política objetiva de retenção para
inscrições, dados de responsáveis e menores, convites, eventos de webhook,
tentativas expiradas, logs e backups. A política deve definir prazo, acesso,
procedimento de atendimento ao titular e o momento de exclusão ou anonimização.

Este hardening reduz exposição e privilégios, mas deliberadamente **não apaga
histórico financeiro nem dados pessoais automaticamente**: fazer isso sem o
prazo e a responsabilidade aprovados poderia destruir evidência de pagamento ou
remover informação que ainda precisa ser conciliada. Registre a decisão antes
do go-live e implemente a rotina de retenção em uma mudança separada, testada em
staging e acompanhada de backup recuperável.

## 4. Canário real controlado

O canário movimenta dinheiro real e, portanto, não pode ser automatizado no CI.
Execute com as inscrições públicas fechadas ou em uma janela supervisionada.

1. Escolha um integrante autorizado da equipe, com dados reais e ciência do
   teste. Não use CPF fictício em Produção.
2. Faça uma única inscrição de menor valor permitido pelo regulamento e anote
   apenas os IDs técnicos da inscrição e da cobrança.
3. Confirme que o QR Code e o código Pix vieram da conta oficial correta.
4. Pague o Pix e acompanhe os logs do Asaas e da Edge Function.
5. O gate financeiro só termina quando o provedor enviar `PAYMENT_RECEIVED` e o
   sistema refletir, uma única vez:
   - pagamento interno `RECEIVED`/pago;
   - inscrição e todos os integrantes do grupo confirmados;
   - valor pago igual ao valor esperado;
   - vaga efetivamente ocupada no ADM.
6. Reenvie o mesmo evento pelo log do Asaas e confirme resposta 2xx sem segunda
   baixa, segunda vaga ou alteração duplicada.
7. Teste o procedimento de estorno/cancelamento com a equipe financeira e
   confirme o estado resultante antes de abrir as inscrições ao público. Um
   estorno parcial deve aparecer como `PARTIALLY_REFUNDED`/revisão, sem ser
   rotulado como pagamento integral; um chargeback deve cancelar a inscrição
   e continuar em reconciliação enquanto ainda puder ser revertido.

## 5. Critérios de abertura e rollback

Abra as inscrições somente depois de Sandbox, idempotência válida em staging e
canário real estarem aprovados. Nas primeiras horas, acompanhe falhas 4xx/5xx,
fila de webhooks, eventos `FAILED`, pagamentos pendentes e divergências de valor.

Se o canário falhar:

1. mantenha ou volte as inscrições para fechadas;
2. não apague cobranças, eventos ou inscrições para “limpar” o erro;
3. preserve os IDs técnicos e os logs para auditoria;
4. faça o estorno pelo procedimento oficial do Asaas quando necessário;
5. corrija e repita a partir do Sandbox antes de uma nova tentativa real.
