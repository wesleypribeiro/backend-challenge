# Proposal

## Why

A reconciliação implementada na F6 (`ReconcileWallet`) lê o saldo materializado da wallet e depois calcula a soma do ledger em uma segunda consulta. Sob concorrência, uma transação financeira confirmada entre essas duas leituras produz uma divergência falsa: o saldo observado pertence ao estado anterior e a soma do ledger ao estado posterior. O README §9 exige que divergências reais sejam sinalizadas — não leituras misturadas. Esta é uma correção corretiva pequena e isolada, pré-requisito de confiança antes de F3/F4/F5.

## What Changes

- `ReconcileWallet` (`src/modules/wallet/application/reconcile-wallet.ts`) passa a observar saldo materializado e soma do ledger no **mesmo snapshot** do PostgreSQL: uma única consulta SQL parametrizada (`wallet` LEFT JOIN `wallet_ledger_entry` + `GROUP BY` na PK), sem lock, sem escrita, sem dependência de isolamento de transação multi-statement.
- Preservar exatidão financeira: agregação `NUMERIC` no banco, `Money`/decimal.js na aplicação, nenhum `number`/float.
- Preservar o contrato HTTP (`storedBalance`, `calculatedBalance`, `difference`, `consistent`, `checkedEntries`), o log estruturado `reconciliation.divergence` (warn) e o comportamento somente-leitura (wallet, version e ledger intocados).
- Ampliar os testes de integração (PostgreSQL real): wallet consistente, divergência real, ledger vazio, conciliação simultânea a transações financeiras, prova determinística de que uma transação confirmada entre leituras não gera divergência falsa, não-mutação e preservamento do comportamento HTTP.
- Corrigir documentação desatualizada: README (status da implementação — fundação P0 descrita como estado atual; F1/F2/F6 já implementadas; F3/F4/F5 pendentes) e ARCHITECTURE (afirmação de que `wagering.inbox_message` já existe — a tabela não foi criada por nenhuma migration; estratégia de snapshot da conciliação; limitações atuais).

## Capabilities

### Modified Capabilities
- `financial/reconciliation`: requisito de comparação saldo vs ledger reforçado com consistência de snapshot — ambas as leituras observadas no mesmo snapshot do PostgreSQL, de modo que uma transação confirmada entre leituras parciais seja impossível de produzir divergência falsa.

## Impact

- Código: somente `src/modules/wallet/application/reconcile-wallet.ts` (uso interno do MikroORM QueryBuilder já existente; contrato público do use case inalterado). Nenhuma migration, nenhuma mudança de schema, nenhuma alteração de regras BET/WIN/LOSS/REFUND/ROLLBACK, nenhuma dependência nova.
- Testes: unitário do use case atualizado (fake único QB); suíte de integração `http-reconciliation` ampliada e nova suíte determinística de consistência sob concorrência. Nenhum teste existente enfraquecido.
- Documentação: apenas trechos operacionais desatualizados do README e ARCHITECTURE; o enunciado original do desafio permanece intacto.
- F3/F4/F5 permanecem fora do escopo; outbox segue não publicada; consumer SQS e scheduler não existem.
