# Design

## Context

F1 entregou `Money`, `Wallet` e o ledger append-only com constraints no banco; F2 entregou `WagerTransaction`, o use case `ProcessWagerTransaction` (lock pessimista por wallet, idempotência persistente, PENDING_REFERENCE, outbox transacional) e o `OPENING` atômico. O `ApiModule` já existe com health (`/health/live`, `/health/ready`) e MikroORM/SQS registrados, mas nenhum controller financeiro. F6 expõe esse domínio por HTTP sem tocar nos fluxos financeiros.

## Goals / Non-Goals

**Goals:**
- Sete endpoints do README §9 sobre o domínio existente, reutilizando `ProcessWagerTransaction` como único use case de processamento.
- Validação estrutural na borda (400) distinta de rejeição de negócio persistida (422), conflito (409), pendência (202), replay (200) e infra transitória (503).
- Cursor opaco/estável para o ledger; reconciliação exata que só sinaliza divergência.
- `ARCHITECTURE.md` atualizado; health público; decisão de autenticação registrada com ponto de extensão.

**Non-Goals:**
- Inbox/consumer SQS, publisher do outbox, scheduler de referências (F4/F5).
- Autenticação real (README §2: não pontua; decisão documentada).
- Métricas além do log estruturado (sem infra de métricas no projeto; limitação documentada).
- Correção automática de divergências ou operações de administrador.

## Decisions

1. **Camada de aplicação fina sobre o domínio existente** — novos use cases/queries em `src/modules/wallet/application` (`OpenWallet`, `GetWallet`, `ListLedger`, `ReconcileWallet`) e `src/modules/wagering/application` (`GetTransaction` por id ou por `(providerId, externalTransactionId)`). Controllers HTTP em `src/modules/*/http/` dependem apenas desses serviços; nenhum acesso direto ao EntityManager nos controllers. `ProcessWagerTransaction` é instanciado por requisição com o `EntityManager` do contexto (MikroORM request context ativo no papel `api`).

2. **`Idempotency-Key` obrigatório só na borda HTTP** — o header é a fonte da verdade (README §9): o controller o lê, valida (presente, não vazio/não só espaços, ≤ 255) e o repassa como `input.idempotencyKey` ao use case. O body não carrega a chave; o payload hash continua canonizando apenas campos de negócio. O use case de F2 não muda — o SQS futuro trará a chave na mensagem (README §10).

3. **Mapeamento de status HTTP** (consistente entre endpoints; corpo de erro `{ statusCode, error, code, message, field? }`):
   - `400` — DTO malformado, JSON inválido, campos obrigatórios ausentes, UUID/limites/tamanho violados, identificador vazio ou só espaços, `providerId` reservado `internal`, Money inválido, `limit` fora do intervalo, cursor inválido, `Idempotency-Key` ausente.
   - `404` — wallet, transação ou transação do provedor inexistente (UUID válido).
   - `409` — conflito de idempotência (mesma chave, payload divergente) e criação de wallet duplicada (`UNIQUE(player_id, currency)`).
   - `422` — resultado `rejected` do use case (regra de negócio persistida com `failureCode`).
   - `202` — resultado `pendingReference` (aceite aguardando referência).
   - `200` — `processed` (inclusive replay), consultas e reconciliação.
   - `503` — falha transitória de infraestrutura (erro de conexão/timeout do pool); `500` para erro não mapeado, com corpo genérico (sem stack, sem dados sensíveis) e log server-side.

4. **Replay preserva o resultado original** — `decideReplay` de F2 já devolve o `result_balance` armazenado; o controller apenas serializa o resultado do use case. Teste HTTP cobre replay após movimentação posterior.

5. **Cursor opaco e estável (keyset)** — paginação por `(created_at, id)` ascendente (ordem de inserção do ledger). Cursor = `base64url(JSON { t: ISO-8601, id: uuid })`; a query usa comparação lexicográfica de tupla `(created_at, id) > (t, id)` — estável mesmo com `created_at` empatado. `limit` default 50, aceito 1..100; busca `limit + 1` para devolver `nextCursor` somente quando há próxima página. Cursor malformado → 400. Abertura com saldo zero não tem páginas (lista vazia, `nextCursor: null`).

6. **Reconciliação exata no banco** — `SELECT count(*), coalesce(sum(case when direction='CREDIT' then amount else -amount end), 0.00) FROM wallet_ledger_entry WHERE wallet_id=$1`: a soma é `NUMERIC` exata no PostgreSQL (sem float). O ledger inclui o `OPENING`, então a soma a partir de zero é o saldo calculado. `difference = stored − calculated`; `consistent` é `difference.isZero()`. Divergência emite `logger.event('reconciliation.divergence', ...)` nível warn e retorna `200` com `consistent:false` — nunca escreve nada. Sem infra de métricas: o log estruturado é o contador (limitação documentada).

7. **Validação de DTO sem dependências novas** — o projeto não usa `class-validator`; parsers manuais por módulo (`parseCreateWalletBody`, `parseSubmissionBody`, `parseListQuery`) devolvem o valor tipado ou lançam `InvalidPayloadError` (campo nomeado). `Money.from` continua o guardião de formato/moeda; erros dele viram 400 na borda antes de reaching o use case (defesa em profundidade: o use case também valida).

8. **Reserva de `providerId = 'internal'`** — reforço em `assertValidBusinessIdentifiers` (domínio F2): submissão com `providerId === 'internal'` é erro estrutural (`InvalidBusinessIdentifierError`), porque o namespace é exclusivo das operações internas (OPENING). Casamento exato, sem trim/case-fold — o valor `internal` é literal. Aplicável a HTTP e ao futuro SQS.

9. **Identificadores só com espaços** — `assertValidBusinessIdentifiers` passa a rejeitar valores cujo `trim()` é vazio (além dos já rejeitados como `''`). Valores com conteúdo e espaços nas bordas são aceitos como estão (sem normalização silenciosa — o payload hash não normaliza).

10. **Exception filter global** (`src/platform/http/financial-exception.filter.ts`): mapeia `InvalidBusinessIdentifierError`/`InvalidPayloadError`/`Money` errors → 400; `NotFoundError` de domínio → 404; `UniqueConstraintViolationException` (wallet create) → 409; erros de driver/conexão/timeout → 503; resto → 500 genérico. Nunca serializa stack, SQL ou credenciais. Logs server-side via `JsonLogger` com `correlationId` (README §12).

11. **Autenticação: decisão registrada, ponto de extensão explícito** — não implementada (README §2: não pontua e não compete com correção financeira). Decisão documentada em `ARCHITECTURE.md`: integraria um IdP externo (Keycloak/Zitadel, OIDC) com verificação de JWT; health permanece público; fila tratada como canal interno. Ponto de extensão no código: `src/platform/auth/public-auth.guard.ts` — guard no-op aplicado aos controllers financeiros, substituível por um `AuthGuard('oidc')` real sem tocar nos handlers.

12. **Wallet creation** — `OpenWallet`: valida playerId (UUID) e `initialBalance` (Money), gera o id, chama `Wallet.open` + `WalletRepository.saveOpen` (mesmo flush: wallet + OPENING + ledger + outbox, F2). `23505` em `wallet_player_currency_unique` → 409. Resposta `201` com `{id, playerId, balance, version}` (README §9).

## Risks / Trade-offs

- [Trade-off] Validação manual de DTOs vs `class-validator` — escolhido por zero dependências novas e pelo padrão já estabelecido (validadores de domínio puros); o custo é o parser explícito por endpoint.
- [Trade-off] Cursor compara `(created_at, id)` com resolução de microssegundos do Postgres — estável para a carga do desafio; milhões de entries por wallet exigiriam repensar (limitação documentada).
- [Risk] `503` para erros de infra pode esconder bugs não mapeados — mitigado pelo split explícito 500/503 e log server-side do erro completo.
- [Trade-off] Sem autenticação real — aceito pelo README; o ponto de extensão e a documentação mitigam o débito.
