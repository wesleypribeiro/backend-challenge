# Proposal

## Why

F1 (wallet/ledger) e F2 (transações idempotentes com lock, outbox e PENDING_REFERENCE) entregaram o domínio financeiro completo, mas inacessível: não existe superfície HTTP para provedores criarem wallets, submeterem apostas, consultarem estado nem reconciliarem saldos. O README §9 exige essa API com distinção clara de status HTTP, cursor estável de ledger e reconciliação que sinaliza (não corrige) divergências.

## What Changes

- Expor o domínio financeiro por HTTP NestJS: `POST /wallets`, `GET /wallets/:walletId`, `GET /wallets/:walletId/ledger?cursor&limit`, `POST /wagering/transactions`, `GET /wagering/transactions/:transactionId`, `GET /providers/:providerId/wagering/transactions/:externalTransactionId`, `POST /wallets/:walletId/reconciliation`.
- Reutilizar `ProcessWagerTransaction` como único use case de processamento da submissão HTTP (README §10: o consumidor SQS futuro reutilizará o mesmo).
- Exigir header `Idempotency-Key` em `POST /wagering/transactions` (fonte da verdade da idempotência; não faz parte do body nem do payload hash).
- Validar DTOs na borda: tipos, campos obrigatórios, UUID, Money/ISO-4217, limites de tamanho, identificadores vazios ou só espaços; reservar `providerId = 'internal'` para operações internas (rejeição estrutural em submissões de provedor).
- Mapear resultados em HTTP sem colapsar situações: 400 (payload inválido/estrutural), 404 (recurso inexistente), 409 (conflito de idempotência e wallet duplicada), 422 (rejeição de negócio persistida), 202 (`PENDING_REFERENCE`), 200 (processado/replay/consultas), 503 (falha transitória de infraestrutura).
- Preservar o resultado original no replay, inclusive o saldo observado na execução inicial (`result_balance`).
- Criação de wallet com saldo positivo grava `OPENING` + ledger + outbox no mesmo commit (já garantido por `saveOpen`; coberto por teste HTTP).
- Cursor opaco e estável (keyset sobre `(created_at, id)`) para o ledger, com `limit` validado.
- Use case de reconciliação: saldo persistido vs soma exata (`NUMERIC`) dos débitos/créditos do ledger; divergência é logada, sinalizada na resposta (`consistent`, `difference`) e nunca corrigida automaticamente.
- Tratamento global de exceções com corpo estruturado e sem dados sensíveis; health continua público; decisão de autenticação (não implementada — README §2) documentada com ponto de extensão explícito no código.
- Atualizar `ARCHITECTURE.md` (ainda descreve a fundação sem domínio financeiro) com F1/F2, migrations, concorrência, idempotência, outbox, API e limitações.

## Capabilities

### New Capabilities
- `financial/http-api`: contrato HTTP dos endpoints financeiros — validação de DTO/identificadores na borda, exigência de `Idempotency-Key`, mapeamento de status, corpo de erro estruturado, replay com saldo original, paginação por cursor opaco, health público e ponto de extensão de autenticação.
- `financial/reconciliation`: comparação do saldo materializado com a soma exata do ledger; resposta com `storedBalance`, `calculatedBalance`, `difference`, `consistent`, `checkedEntries`; divergência logada e nunca corrigida automaticamente.

### Modified Capabilities
- `financial/processing`: reforço da validação estrutural de identificadores — rejeição de valores vazios ou compostos somente por espaços e da reserva de `providerId = 'internal'` para operações internas (as transações financeiras em si permanecem idênticas).

## Impact

- Novos módulos `src/modules/wallet` (abertura/consultas/reconciliação + controller) e extensão de `src/modules/wagering` (controller HTTP reutilizando `ProcessWagerTransaction`); infra transversal em `src/platform/http` (exception filter) e `src/platform/auth` (ponto de extensão).
- `ApiModule` passa a registrar os controllers; worker/SQS/outbox publisher/scheduler permanecem fora do escopo (F4/F5 e consumidor SQS).
- Nenhuma mudança de schema: usa as tabelas e garantias já migradas (F1/F2). Fluxos financeiros e testes existentes preservados.
