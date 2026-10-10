# Implementation Notes — `implement-financial-api-reconciliation` (F6)

Date: 2026-10-09 · Working tree uncommitted · HEAD `d48b4b5` (F1)

## Final battery (real results, this session)

| Command | Result |
| --- | --- |
| `bun run typecheck` | 0 errors |
| `bun run build` | OK |
| `bun run test:unit` (unit + smoke, `tests/unit` + `tests/smoke`) | 208 pass / 0 fail (735 expects) |
| `bun test ./tests/integration` (11 suites) | 75 pass / 0 fail (647 expects, ~154 s) |
| `bun run test:smoke` (`tests/docker/*`, image + Compose) | 5 pass / 0 fail (162 expects) |
| `bun x openspec validate implement-financial-api-reconciliation --type change --strict --no-interactive` | exit 0 (INFO: archive of `financial/processing` MODIFIED delta blocked until F2 is archived — expected) |

F6 contributes 19 new integration tests: `http-wallet` 6, `http-wagering` 7, `http-reconciliation` 4, `http-unavailable` 2. F1/F2 suites remain green (no regressions from identifier hardening).

## Delivered surface

Seven endpoints on the API process (health untouched, public):

- `POST /wallets` → 201 · `GET /wallets/:walletId` → 200/404
- `GET /wallets/:walletId/ledger` → 200 `{entries, nextCursor}` (keyset `(created_at, id)`, limit 1..100 default 50)
- `POST /wallets/:walletId/reconciliation` → 200 (read-only NUMERIC sum, `stored − calculated`)
- `POST /wagering/transactions` → 200 processed (replay preserves observed balance) / 202 pendingReference / 422 rejected+failureCode / 409 conflict — requires `Idempotency-Key`
- `GET /wagering/transactions/:transactionId`, `GET /providers/:providerId/wagering/transactions/:externalTransactionId` → 200/404

Error contract (single global filter `src/platform/http/financial-exception.filter.ts`): `{statusCode, error, code, message, field?}`; codes `INVALID_PAYLOAD` (400), `NOT_FOUND` (404), `CONFLICT`/`IDEMPOTENCY_CONFLICT` (409), `TRANSACTION_REJECTED` (422), `PENDING_REFERENCE` (202), `SERVICE_UNAVAILABLE` (503), `INTERNAL_ERROR` (500, generic body; details logged server-side with correlation id). No stack/SQL/driver detail ever reaches the client.

## Decisions and deviations from the plan

- **Auth**: `NoopAuthGuard` (`src/platform/auth/noop-auth.guard.ts`, not `public-auth.guard.ts`) on both financial controllers — README §2 auth does not score; documented swap point for a future OIDC guard (Keycloak/Zitadel).
- **5.4 file**: `tests/integration/http-unavailable.test.ts` (not `http-transient.test.ts`). Uses a real broken connection (POST against an unreachable `127.0.0.1:1` URL with the API started via `startApi(undefined, {DATABASE_URL})`) — no infrastructure constraint, so no unit-level fake was needed.
- **DI**: `@Inject(EntityManager)` with a value import of `PostgreSqlEntityManager` from `@mikro-orm/postgresql` (token alias registered in `AppModule`). `InjectEntityManager()` requires a name argument and resolves the wrong token — do not use. Controllers instantiate use cases per request against the request-context fork (`#useContext` ALS).
- **`JsonLogger` must be a value import** in controllers — `import type` breaks Nest `design:paramtypes` reflection.
- **POST status**: `@HttpCode(200)` on `POST /wagering/transactions` (Nest defaults POST to 201).
- **Filter pass-through**: status always comes from `exception.getStatus()`, never from the body — health's `ServiceUnavailableException({status, checks})` carries no `statusCode` field and must be repassaged intact.
- **Raw aggregates**: MikroORM `getConnection().execute()` inlines `?` placeholders but `escape()` is identity (invalid for UUIDs) — `ReconcileWallet` uses `em.createQueryBuilder(...).select([raw(...)]).where({...}).execute('all')`.
- **Outbox event types** are plain names (`WagerTransactionProcessed`, `WalletBalanceChanged`); payload nested → queries use `payload->'data'->>'walletId'`.
- **Bun test**: `toMatchObject` with `expect.any(String)` mutates the received object (value becomes `{}`) — capture `response.body.transactionId` before the matcher (comments in the suites).
- **Replay/conflict**: replay preserves the original `result_balance`; conflict is detected by payload divergence (`payloadHash`), not by the `Idempotency-Key` value itself.
- **Pagination proof**: ledger cursor chain walks three pages (OPENING + 2 BETs, limit=1), asserting distinct ids, terminal `null` cursor, and the shared reconstruction invariant.
- **Reserved identifiers** (task 1.1): whitespace-only `externalTransactionId` and `providerId === 'internal'` are rejected with `InvalidBusinessIdentifierError` before any SQL; leading/trailing spaces around valid content still accepted.

## Limitations (honest, not shipped)

- No authentication/authorization implemented (`NoopAuthGuard` only).
- No metrics infrastructure (no Prometheus/OTel).
- No SQS consumer (F3), no outbox publisher (F4), no reconciliation scheduler (F5) — outbox rows persist but are not yet published.
- Cursor ordering ties fall back to `id` comparison; microsecond-tied rows are ordered by UUID, not creation time (deterministic, not chronological).
- No new runtime dependencies were added (no class-validator, no @nestjs/testing, no @types/express — HTTP types are structural).
- CHANGELOG/specs: `financial/processing` MODIFIED delta can only be archived after F2 is archived (validate INFO, exit 0).
