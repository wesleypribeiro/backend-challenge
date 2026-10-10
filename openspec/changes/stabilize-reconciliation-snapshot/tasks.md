# Tasks

## 1. Snapshot Único de Reconciliação

- [x] 1.1 Reescrever `ReconcileWallet.execute` (`src/modules/wallet/application/reconcile-wallet.ts`) para uma única consulta parametrizada via MikroORM QueryBuilder: root `WalletSchema` (`w`), `leftJoin(WalletLedgerEntrySchema, 'e', { 'e.walletId': raw('w.id') })`, `select` misto (`w.balance`, `w.currency`, `raw('count(e.id)::int as count')`, `raw("coalesce(sum(case when e.direction = 'CREDIT' then e.amount else -e.amount end), 0) as calculated")`), `where({ id: walletId })`, `groupBy('id')`, `execute('all')`. Linha vazia → `WalletNotFoundError`. Nenhum lock, nenhuma escrita, nenhuma transação explícita. Preservar `ReconcileWalletResult`, cálculo `Money` (stored − calculated), `consistent`, evento `reconciliation.divergence` (warn) e leitura-only. Verificar unit tests (`tests/unit/modules/wallet/application/reconcile-wallet.test.ts`) com fake único QB: consistente, divergente (log warn completo), ledger vazio, não-encontrado.

## 2. Testes de Integração (PostgreSQL Real)

- [x] 2.1 Ampliar `tests/integration/http-reconciliation.test.ts`: cenário de rajada paralela — apostas concorrentes (POST /wagering/transactions) e reconciliações concorrentes (Promise.all) sobre a mesma wallet; **todas** as respostas com `consistent: true` (nenhuma divergência falsa); wallet, version e ledger alterados apenas pelas apostas, nunca pela conciliação; invariant de reconstrução no fim.
- [x] 2.2 Nova suíte determinística `tests/integration/reconciliation-consistency.test.ts` com conexão `pg.Client` controlada: `BEGIN` + mutação completa (wager_transaction + wallet_ledger_entry + update de wallet balance/version) mantida sem commit; reconciliação HTTP pendurada → `consistent: true` com estado antigo; `COMMIT`; reconciliação HTTP → `consistent: true` com estado novo; sem sleeps — sincronização explícita por await de transação. Confirmar não-mutação: snapshot de wallet/ledger/`updated_at` antes e depois das reconciliações.
- [x] 2.3 Confirmar preservamento do comportamento HTTP existente: corpos exatos (`walletId`, `storedBalance`, `calculatedBalance`, `difference`, `consistent`, `checkedEntries`), 404 wallet desconhecida, 400 id malformado, divergência real seedada inalterada (suites existentes seguem verdes sem edição enfraquecedora).

## 3. Documentação Operacional

- [x] 3.1 README.md — corrigir apenas o bloco operacional pós-enunciado: substituir a afirmação de que a implementação atual é só a fundação P0 ("não processa dinheiro ou apostas") pelo estado real (P0 + F1 + F2 + F6; F3/F4/F5 e demais etapas pendentes) e corrigir o parágrafo final que afirma não haver testes de invariantes financeiras. Enunciado original (seções 1–14) permanece intacto.
- [x] 3.2 ARCHITECTURE.md — remover a falsa afirmação de que `wagering.inbox_message` já foi criada pelas migrations (D4; tabela será criada em F3), documentar a estratégia de snapshot único da reconciliação (D5/D7), atualizar linha de status e matriz de testes (D10), mantendo limitações atuais explícitas.

## 4. Bateria Final e Evidências

- [x] 4.1 Executar `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun test ./tests/integration`, `bun run test:smoke` e `bun x openspec validate stabilize-reconciliation-snapshot --type change --strict --no-interactive`; registrar resultados reais (contagens, exit codes). Nenhum teste declarado aprovado sem execução real.
- [x] 4.2 Marcar tasks `[x]`, escrever `implementation-notes.md` com evidências reais e limitações honestas; relatório final ao usuário — sem commit.
