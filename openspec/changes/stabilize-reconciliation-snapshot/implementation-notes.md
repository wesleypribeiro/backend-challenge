# Implementation Notes — `stabilize-reconciliation-snapshot`

Date: 2026-10-09 · Working tree uncommitted · Change corretiva sobre F6, pré-requisito antes de F3. Revisão pós-aprovação aplicada (seção "Review adjustments").

## Final battery (real results, this session — post-review)

| Command | Result |
| --- | --- |
| `bun run typecheck` | 0 errors |
| `bun run build` | OK |
| `bun run test:unit` (unit + smoke, `tests/unit` + `tests/smoke`) | 209 pass / 0 fail (745 expects) |
| `bun test ./tests/integration` (12 suites) | 79 pass / 0 fail (691 expects, ~164 s) |
| `bun run test:smoke` (`tests/docker/*`, image + Compose) | 5 pass / 0 fail (162 expects) |
| `bun x openspec validate stabilize-reconciliation-snapshot --type change --strict --no-interactive` | exit 0 (INFO: MODIFIED delta of `financial/reconciliation` requires the F6 change to be archived first — same accepted transiente as F6) |

New tests: `tests/integration/reconciliation-consistency.test.ts` (3) + burst test in `http-reconciliation.test.ts` (1) = 4 integration tests; unit suite of `ReconcileWallet` has 5 tests (4 original behaviors + 1 single-query regression guard). All pre-existing suites unchanged and green (F1/F2/F6 regressions: none).

## What changed

- `src/modules/wallet/application/reconcile-wallet.ts` — single-statement snapshot query (see strategy below). Public contract (`ReconcileWalletResult`), `Money` arithmetic, divergence warn log, read-only semantics, 404 behavior: all preserved.
- `tests/unit/modules/wallet/application/reconcile-wallet.test.ts` — fake mirrors the one QueryBuilder chain (`select/leftJoin/where/groupBy/execute`); empty row array = unknown wallet.
- `tests/integration/reconciliation-consistency.test.ts` — deterministic snapshot tests with a held `pg.Client` connection (see below).
- `tests/integration/http-reconciliation.test.ts` — parallel burst (4 BETs × 4 reconciliations, every response `consistent: true`).
- `README.md` — operational status block corrected: P0 + F1 + F2 + F6 implemented; F3/F4/F5, P1 and remaining stages pending; final "Testes e aceite" paragraph no longer claims zero financial test coverage. Challenge statement (§1–§14) untouched.
- `ARCHITECTURE.md` — removed the false `wagering.inbox_message` claim (no migration created it; F3 will), documented the single-snapshot reconciliation strategy (D5/D7), updated status line and test matrix (D10).

## Consistency strategy

One SQL statement, one statement-level snapshot:

```sql
SELECT w.balance, w.currency, count(e.id)::int, coalesce(sum(CASE WHEN e.direction='CREDIT' THEN e.amount ELSE -e.amount END), 0)
FROM wagering.wallet w
LEFT JOIN wagering.wallet_ledger_entry e ON e.wallet_id = w.id
WHERE w.id = $1
GROUP BY w.id
```

Built with MikroORM QueryBuilder: root `WalletSchema`, bare-table join via `sql.ref(schema, tableName)` (no relation is declared between the schemas; `sql.ref` renders a quoted schema-qualified table), ON clause as raw key `{ [raw('e.wallet_id = w.id')]: [] }` with physical column names (the QB cannot map properties for an untyped alias), `where({ id: walletId })` keeps the id a bound parameter, `groupBy('id')` exploits the PK functional dependency. `count(e.id)` (not `count(*)`) gives 0 for an empty ledger under LEFT JOIN. Every PostgreSQL statement runs under a single snapshot even at READ COMMITTED, so a commit between the two former reads cannot interleave — false divergence is eliminated by construction. Explicit `REPEATABLE READ` transaction was rejected (extra transaction lifecycle per read request; statement atomicity is simpler and refactor-proof). No locks: reconciliation neither blocks, nor is blocked by, financial processing.

## Deterministic tests (no sleeps)

- Single-query regression guard (unit): the fake EntityManager counts `createQueryBuilder`/`execute`/`findOne` and records the select/where of the one chain; the test requires exactly one QueryBuilder, exactly one `execute`, zero `findOne`, and that the single query request balance, currency, ledger sum and count together. Any reversion to the old wallet-then-ledger two-query reading fails the counters deterministically.
- Held-connection test: dedicated `pg.Client` runs `BEGIN` + full wallet mutation (transaction row + ledger entry + balance/version update, mirroring the atomic F2 commit) left uncommitted; HTTP reconciliation sees the pre-commit consistent state; after `COMMIT`, the post-commit consistent state. MVCC hides pending rows from the reconciliation statement.
- Race test: `Promise.all([reconcile HTTP, COMMIT])` — the response must equal one of the two exact consistent bodies (wholly-before or wholly-after), never a mixed reading.
- Burst test: `Promise.all` of 4 BETs + 4 reconciliations on one wallet — every reconciliation `consistent: true`; wallet/ledger changed only by the bets (`version = 5`, balance `60.00`); reconstruction invariant holds.
- Non-mutation test: wallet row, `updated_at`, all ledger rows and the outbox count are byte-identical across three reconciliation calls.

## Review adjustments (post-approval)

- Unit regression guard added: `reconcile-wallet.test.ts` now instruments the fake (query/execute/findOne counters + select/where capture) and asserts the single-query contract — one new test, four pre-existing tests preserved unchanged.
- Synthetic seeds corrected: the movement rows in `reconciliation-consistency.test.ts` (snap/race) and the divergence seed in `http-reconciliation.test.ts` changed from `WIN`/`REJECTED` to coherent `WIN`/`PROCESSED` (`processed_at`, `result_balance`), respecting the domain rule that rejected transactions never produce ledger entries. The divergence test keeps its intentional inconsistency — a processed movement whose materialized-balance effect was deliberately omitted — and now documents it explicitly as the behavior under test. No assertions weakened, no scenarios removed.
- OpenSpec docs aligned to the implemented code: `design.md` and `tasks.md` describe the `sql.ref(...)` bare-table join with the raw ON clause (not the unsupported `leftJoin(EntitySchema, ...)` form); design also documents the regression guard and seed coherence; ARCHITECTURE.md no longer attributes inbox uniqueness to non-existent constraints and records that F3 will implement persistent dedup by `(consumerName, messageId)`.

## Problems found

- `leftJoin(EntitySchema, ...)` is not a supported join form in MikroORM 7 (QB joins expect relation paths or `RawQueryFragment`); resolved with `sql.ref()` bare-table join — the runtime documents it as the join-by-name mechanism, and `quoteIdentifier` splits dotted names into `"schema"."table"`.
- `EntitySchema` exposes `tableName` but not `schema` directly — used `meta.schema!` (schema is required in the entity definition).
- Outbox payload nests under `data` — queries must use `payload->'data'->>'walletId'`.

## Limitations (honest)

- Real divergences are still reported, never corrected (by design; no admin tooling).
- No metrics infrastructure — the warn log remains the only divergence counter (README §12 metrics pending).
- F3/F4/F5 untouched: outbox rows accumulate unpublished; no consumer, no scheduler.
- The held-connection test holds a row lock on the wallet during the pending window; reconciliation is unaffected (MVCC read, no lock wait) — by design of the fix, not luck.
- No commit was performed; working tree carries the change uncommitted.
