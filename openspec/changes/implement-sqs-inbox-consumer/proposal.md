# Proposal

## Why

As fundações estão prontas: F1/F2 movem dinheiro com idempotência persistente e outbox atômica, F6 expõe a API HTTP, e a topologia SQS (`wager-transactions.fifo` + DLQ, FIFO, VisibilityTimeout 60s, long-poll 20s, `maxReceiveCount=5`) já é provisionada e verificada. Porém **nenhum componente consome mensagens**: o worker mantém o application context vivo sem consumidores (`WorkerLifetime`), `wagering.inbox_message` não existe, e o README §10/§6.5 exige entrega at-least-once com deduplicação persistente por `(consumerName, messageId)`, ack somente após commit, política explícita de erros transitórios/permanentes e DLQ. Sem F3, as invariantes globais (§3) só valem para a entrada HTTP — a entrada por SQS, que é o caminho principal do desafio, permanece inexercitada.

## What Changes

- Nova tabela `wagering.inbox_message` (migration incremental `Migration20261009000400` + registro em `migration-catalog.ts` **e** `migration-options.ts` (`migrationsList`) + `EntitySchema` + grants mínimos) com `UNIQUE (consumer_name, message_id)` nomeada `inbox_message_consumer_message_unique`, `payload_hash`, `received_at NOT NULL` e `processed_at` **nullable** (UPDATE do flip na mesma transação; `GRANT SELECT, INSERT, UPDATE` para `wagering_app`); domínio `InboxMessage` conforme README §6.5.
- Seam cirúrgico em `ProcessWagerTransaction`: novo método `executeInTransaction(tx, input)` que executa validação + processamento **dentro de uma transação SQL controlada pelo chamador**, sem abrir transação própria e sem o recovery via `em.fork()` (propaga `23505` ao chamador). O caminho HTTP `execute()` permanece byte-comportamental idêntico.
- Consumidor SQS no worker: loop de long polling com concorrência limitada por instância, validação estrutural do envelope (`WagerTransactionRequested`), transação única (inbox insert + regras financeiras + ledger + outbox + inbox `processed_at`), ack (`DeleteMessage`) somente após commit, política de erros (negócio → terminal+ack; transitório → sem ack/redelivery; permanente → sem ack/redrive à DLQ), detecção de duplicata e conflito de identidade via índice único.
- Shutdown gracioso integrado a `installShutdown`/`Readiness` com ordem de encerramento explícita (módulo raiz destruído antes dos imports no Nest 12): parar de receber, drenar processamentos em andamento **antes** da destruição do SQS client e do pool PG, nunca confirmar transação SQL não concluída.
- Observabilidade F3: eventos estruturados (`message.received/processed/duplicate/rejected/failed/identity_conflict/shutdown` etc.) com `messageId` (formato do produtor, não-UUID, ≤200), `transactionId`, `walletId`, `providerId`, `receiveCount` e `correlationId` (`idempotencyKey` se casar com `correlationIdPattern` do ALS, senão UUID — precedente de `http-logging.ts`) — sem payloads completos nem credenciais. Métricas agregadas ficam para etapa futura.
- Configuração do worker: `CONSUMER_CONCURRENCY` (default 1). Nenhuma dependência npm nova.

## Capabilities

### Added Capabilities
- `financial/inbox`: persistência da Inbox (identidade `(consumerName, messageId)`, hash do payload, reconhecimento de mensagem já processada / em processamento / conflito de identidade) e participação na transação única do processamento financeiro.
- `financial/sqs-consumer`: ciclo de vida do consumidor — envelope e validação, atomicidade com o use case, ack pós-commit, retry/DLQ, ordenação por wallet como otimização, concorrência por instância, shutdown gracioso, observabilidade.

### Modified Capabilities
- Nenhuma capacidade existente é modificada: o contrato HTTP, as regras BET/WIN/LOSS/REFUND/ROLLBACK, a topologia SQS provisionada e a atomicidade outbox permanecem intactos. O único toque em código existente é o seam aditivo em `ProcessWagerTransaction` (novo método; `execute()` inalterado).

## Impact

- Código: novo domínio `src/domain/wagering/inbox-message.ts`, novo schema/migration `inbox_message` (catalogo **e** `migration-options.ts`/`migrationsList`), seam aditivo em `src/modules/wagering/application/process-wager-transaction.ts`, novo consumidor sob `src/modules/wagering/consumer/` (+ wiring no `WorkerModule`), extensão do allowlist do `JsonLogger`, `CONSUMER_CONCURRENCY` na config do worker.
- Testes: unitários (domínio Inbox, parser do envelope, classificação de erro/decisão de ack) e integração real (PostgreSQL + LocalStack): happy path, duplicatas, mesmo negócio com MessageIds distintos, payload inválido → DLQ, contenção de saldo 80/80 vs 100 via SQS, mesmas/distintas wallets, 3 instâncias, falha antes do commit, commit-antes-do-ack, redelivery, shutdown em processamento, consistência final (wallet == ledger). Nenhum teste existente enfraquecido.
- Dependências F3/F4/F5/P1: F3 **não depende** de F4 (outbox permanece `PENDING` — o consumidor apenas grava eventos) nem de F5 (`PENDING_REFERENCE` é terminal para a mensagem; scheduler resolve depois). Ordem recomendada: F3 → F4 → F5. P1 permanece paralelo/pendente.
- Nenhum commit, nenhum push; mudança de planejamento apenas nesta etapa.
