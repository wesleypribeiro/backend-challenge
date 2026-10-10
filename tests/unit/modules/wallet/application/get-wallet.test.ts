import { expect, test } from 'bun:test';
import type { EntityManager } from '@mikro-orm/postgresql';
import { GetWallet } from '../../../../../src/modules/wallet/application/get-wallet.js';
import { WalletNotFoundError } from '../../../../../src/modules/wallet/application/errors.js';

const WALLET_ID = '22222222-2222-4222-8222-222222222222';
const PLAYER_ID = '11111111-1111-4111-8111-111111111111';

function fakeEm(row: unknown) {
  return {
    findOne: async () => row,
  } as unknown as EntityManager;
}

test('execute returns the wallet view with a normalized balance', async () => {
  const row = {
    id: WALLET_ID,
    playerId: PLAYER_ID,
    currency: 'EUR',
    balance: '12.50',
    version: 3,
  };
  const view = await new GetWallet(fakeEm(row)).execute(WALLET_ID);
  expect(view).toEqual({
    id: WALLET_ID,
    playerId: PLAYER_ID,
    balance: { amount: '12.50', currency: 'EUR' },
    version: 3,
  });
});

test('execute raises WalletNotFoundError for an unknown wallet', async () => {
  await expect(new GetWallet(fakeEm(null)).execute(WALLET_ID))
    .rejects.toBeInstanceOf(WalletNotFoundError);
});
