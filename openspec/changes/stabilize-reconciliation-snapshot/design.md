# Design

## Context

F6 entregou `POST /wallets/:walletId/reconciliation` sobre o use case `ReconcileWallet`, que executava duas consultas independentes: `findOne(WalletSchema)` (saldo materializado) e um agregado SQL do ledger (soma exata + contagem). Cada consulta é atomicamente correta, mas o par não é: em PostgreSQL READ COMMITTED, cada statement enxerga o snapshot vigente no início do statement — uma transação que confirmar entre os dois statements torna o resultado uma mistura de estados (divergência falsa, reportada como `consistent: false` com `reconciliation.divergence`). A F6 cobria apenas cenários serializados nos testes; a janela de corrida era real.

## Goals / Non-Goals

**Goals:**
- Observar saldo materializado e soma do ledger no mesmo snapshot do PostgreSQL, eliminando divergência falsa por leitura misturada.
- Uma única consulta SQL parametrizada (sem interpolação, sem `getConnection().execute()` — limitação já documentada com placeholders `?`/`escape()` identidade).
- Exatidão `NUMERIC`/`Money` preservada; conciliação estritamente read-only; nenhum lock (não bloquear processamento de nenhuma wallet).
- Contrato HTTP, log de divergência e semântica de 404/200 inalterados.
- Testes determinísticos (sincronização explícita via transação SQL controlada, sem sleeps arbitrários) cobrindo concorrência e não-mutação.
- Documentação corrigida apenas nos trechos operacionais desatualizados (README status; ARCHITECTURE `inbox_message` e estratégia de snapshot).

**Non-Goals:**
- F3 (inbox/consumer), F4 (publisher outbox), F5 (scheduler), métricas, autenticação.
- Correção automática de divergências reais (mantém-se reportar/nunca corrigir).
- Migrations ou mudanças de schema.
- Mudança no contrato HTTP ou nos eventos de log.

## Decisions

1. **Uma statement, um snapshot** — a consulta combinada:

   ```sql
   SELECT w.balance, w.currency,
          count(e.id)::int,
          coalesce(sum(CASE WHEN e.direction = 'CREDIT' THEN e.amount ELSE -e.amount END), 0)
   FROM wagering.wallet w
   LEFT JOIN wagering.wallet_ledger_entry e ON e.wallet_id = w.id
   WHERE w.id = $1
   GROUP BY w.id
   ```

   Executada via MikroORM QueryBuilder (`createQueryBuilder(WalletSchema, 'w')` + `leftJoin(WalletLedgerEntrySchema, 'e', { 'e.walletId': raw('w.id') })` + `select` misto com `raw()` + `where({ id })` + `groupBy('id')` + `execute('all')`): o `wallet_id` permanece parâmetro vinculado; `raw()` só aparece em agregados internos do select, sem interpolação de valores. No PostgreSQL, qualquer statement única opera sob um snapshot de statement — mesmo sob READ COMMITTED — e a unicidade da leitura é garantida pelo protocolo, não por convenção de código. `GROUP BY` na PK de `w` permite projetar `w.balance`/`w.currency` (dependência funcional). `LEFT JOIN` + `count(e.id)` (não `count(*)`) dão `checkedEntries = 0` e soma `0` para ledger vazio. Linha ausente → `WalletNotFoundError` (mesmo 404 de antes).

   *Alternativa rejeitada*: transação `REPEATABLE READ` explícita com duas consultas — também correta (snapshot de transação), mas: exige abrir/encerrar transação no EM por request de leitura, aumenta tempo de vida de conexão e complexidade de rollback para um único par de leituras, e qualquer refactor futuro que quebre a transação volta a expor a corrida. A statement única é atômica por construção e mais simples de revisar. Decisão registrada aqui por exigência do pedido de correção.

2. **Sem lock algum** — nenhuma `FOR UPDATE`, nenhuma espera por concorrência: conciliação não bloqueia `ProcessWagerTransaction` nem outras wallets; leitura não bloqueante também não sofre deadlock nem segura conexão em espera (requisito 5).

3. **Exatidão preservada** — a agregação continua `NUMERIC` no banco (`sum` sobre `amount NUMERIC(20,2)`); `Money.from` reidrata strings; `difference = stored.subtract(calculated)` em decimal.js. Nenhum caminho converte dinheiro para `number`.

4. **Contrato e log inalterados** — mesma interface `ReconcileWalletResult`, mesmos campos da resposta, mesmo evento `reconciliation.divergence` (warn) com os mesmos campos, mesma leitura-only (nenhum `insert`/`update` no use case; garantia reafirmada por teste que compara wallet, version e ledger antes/depois).

5. **Testes determinísticos de concorrência** — dois mecanismos, nenhum com sleep arbitrário:
   - *Conexão controlada* (`pg.Client` própria no teste, sobre `infra.databaseUrl('app')`): `BEGIN` + mutação completa simulada (transaction + ledger + wallet, espelhando o commit atômico do domínio) mantida **sem commit**; enquanto pendurada, reconciliação HTTP deve enxergar o estado antigo consistente (proof: snapshot de statement não enxerga linhas não confirmadas); `COMMIT`; reconciliação HTTP deve enxergar o estado novo consistente. Com a implementação antiga de duas leituras, este cenário é exatamente a janela que produz divergência falsa se o commit cair entre as leituras.
   - *Rajada paralela* (`Promise.all` de apostas concorrentes + reconciliações concorrentes na mesma wallet): **todas** as respostas de reconciliação devem ser `consistent: true` — com snapshot único é invariante; com leituras misturadas seria corrida perdível. Sincronização explícita: as apostas serializam no lock de wallet do domínio; as reconciliações não bloqueiam nem são bloqueadas.

6. **Documentação cirúrgica** — README: apenas o bloco "Operação da implementação — fundação P0" e o parágrafo final de "Testes e aceite" (afirmações já falsas: "não processa dinheiro ou apostas", "Nenhum teste atual comprova invariantes financeiras"). Enunciado (§1–§14) intocado. ARCHITECTURE: D4 removida a afirmação de `wagering.inbox_message` (nenhuma migration criou a tabela; será F3); D5/D7/D10 atualizadas com a estratégia de snapshot e a cobertura nova; linha de status ampliada.

## Risks / Trade-offs

- [Trade-off] `raw()` em select é a mesma técnica já provada pela F6 (soma do ledger) — o risco novo é o `leftJoin` com condição objeto `{ 'e.walletId': raw('w.id') }`; mitigado pelo typecheck e pelos testes de integração contra PostgreSQL real que falhariam imediatamente se a condição gerasse SQL errado.
- [Trade-off] `GROUP BY` na PK depende da regra de dependência funcional do PostgreSQL (correta e estável) — aceito; alternativa `GROUP BY w.id, w.balance, w.currency` é defensiva mas redundante.
- [Risk] Teste com conexão pendurada segura um lock de linha na wallet (UPDATE pendurado) durante o passeio HTTP — reconciliação não sofre lock wait (só leitura MVCC), então o cenário não vira deadlock nem timeout; documentado no teste.
- [Limitação] Divergência real seedada continua não-corrigível por design; a change apenas elimina a classe de falso positivo por leitura misturada — não introduz métricas (fora de escopo).
