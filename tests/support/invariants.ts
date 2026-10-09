import { expect } from 'bun:test';

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;

/**
 * Reconstruction invariant: the wallet's stored balance equals the running
 * sum of every ledger entry (CREDIT +, DEBIT -), including OPENING.
 */
export async function assertLedgerInvariant(query: QueryFn, walletId: string): Promise<void> {
  const [stored] = (await query('select balance from wagering.wallet where id = $1', [walletId])).rows as Array<{ balance: string }>;
  const [sum] = (await query(
    `select coalesce(sum(case when direction = 'CREDIT' then amount else -amount end), 0)::text as reconstructed
     from wagering.wallet_ledger_entry where wallet_id = $1`, [walletId])).rows as Array<{ reconstructed: string }>;
  expect(stored!.balance).toBe(sum!.reconstructed);
}
