import { expect, test } from 'bun:test';
import { Money } from '../../../../src/domain/wallet/money.js';

test('creates valid money and serializes to a fixed 2-decimal string', () => {
  const m1 = Money.from({ amount: '10.5', currency: 'USD' });
  expect(m1.amountString).toBe('10.50');
  expect(m1.toString()).toBe('10.50');
  expect(m1.currency).toBe('USD');

  expect(Money.from({ amount: '100', currency: 'EUR' }).amountString).toBe('100.00');
  expect(Money.from({ amount: '0', currency: 'BRL' }).amountString).toBe('0.00');
  expect(Money.from({ amount: '-0', currency: 'BRL' }).isZero()).toBe(true);
  expect(Money.from({ amount: '-0', currency: 'BRL' }).isNegative()).toBe(false);
});

test('rejects scientific notation in both directions', () => {
  expect(() => Money.from({ amount: '1e2', currency: 'USD' })).toThrow(/Invalid money amount format/);
  expect(() => Money.from({ amount: '1e-2', currency: 'USD' })).toThrow(/Invalid money amount format/);
});

test('rejects excess scale without silent rounding', () => {
  expect(() => Money.from({ amount: '10.555', currency: 'USD' })).toThrow(/Invalid money amount format/);
});

test('rejects NaN, Infinity and empty strings', () => {
  expect(() => Money.from({ amount: 'NaN', currency: 'USD' })).toThrow(/Invalid money amount format/);
  expect(() => Money.from({ amount: 'Infinity', currency: 'USD' })).toThrow(/Invalid money amount format/);
  expect(() => Money.from({ amount: '-Infinity', currency: 'USD' })).toThrow(/Invalid money amount format/);
  expect(() => Money.from({ amount: '', currency: 'USD' })).toThrow(/Invalid money amount format/);
});

test('rejects invalid ISO 4217 currencies', () => {
  expect(() => Money.from({ amount: '10.00', currency: 'usd' })).toThrow(/Invalid ISO 4217 currency/);
  expect(() => Money.from({ amount: '10.00', currency: 'US' })).toThrow(/Invalid ISO 4217 currency/);
  expect(() => Money.from({ amount: '10.00', currency: 'BRLX' })).toThrow(/Invalid ISO 4217 currency/);
});

test('rejects fictional or non-currency ISO 4217-style codes', () => {
  for (const currency of ['ZZZ', 'XXX', 'XTS', 'TST', 'FAKE', 'XBT', 'XAU']) {
    expect(() => Money.from({ amount: '10.00', currency })).toThrow(/Invalid ISO 4217 currency/);
  }
});

test('keeps multi-currency support with real ISO 4217 codes', () => {
  for (const currency of ['BRL', 'USD', 'EUR', 'JPY', 'GBP', 'CHF', 'CAD', 'AUD']) {
    expect(Money.from({ amount: '10.00', currency }).currency).toBe(currency);
  }
});

test('add is immutable and isolated by currency', () => {
  const m1 = Money.from({ amount: '10.00', currency: 'USD' });
  const m2 = Money.from({ amount: '5.50', currency: 'USD' });

  const m3 = m1.add(m2);
  expect(m3.amountString).toBe('15.50');
  expect(m1.amountString).toBe('10.00');

  const eur = Money.from({ amount: '5.50', currency: 'EUR' });
  expect(() => m1.add(eur)).toThrow(/Currency mismatch/);
});

test('subtract is immutable and may produce negative internal results', () => {
  const m1 = Money.from({ amount: '10.00', currency: 'USD' });
  const m2 = Money.from({ amount: '5.50', currency: 'USD' });

  const m3 = m1.subtract(m2);
  expect(m3.amountString).toBe('4.50');
  expect(m1.amountString).toBe('10.00');

  const negative = m2.subtract(m1);
  expect(negative.amountString).toBe('-4.50');
  expect(negative.isNegative()).toBe(true);
  expect(negative.isPositive()).toBe(false);
});

test('negate returns the opposite amount without mutating the original', () => {
  const m = Money.from({ amount: '7.25', currency: 'BRL' });
  const n = m.negate();
  expect(n.amountString).toBe('-7.25');
  expect(m.amountString).toBe('7.25');
  expect(n.negate().equals(m)).toBe(true);
});

test('handles amounts far above Number.MAX_SAFE_INTEGER cents exactly', () => {
  // Number.MAX_SAFE_INTEGER cents ≈ 90,071,992,547,409.91
  const aboveSafe = '123456789012345678.90';
  const m1 = Money.from({ amount: aboveSafe, currency: 'USD' });
  const m2 = Money.from({ amount: '0.10', currency: 'USD' });

  expect(m1.add(m2).amountString).toBe('123456789012345679.00');
  expect(m1.subtract(m2).amountString).toBe('123456789012345678.80');

  const max = Money.from({ amount: '999999999999999999.99', currency: 'USD' });
  expect(max.amountString).toBe('999999999999999999.99');
});

test('enforces the NUMERIC(20,2) upper bound', () => {
  expect(() => Money.from({ amount: '1000000000000000000.00', currency: 'USD' }))
    .toThrow(/NUMERIC\(20,2\) limit/);
  expect(() => Money.from({ amount: '999999999999999999.995', currency: 'USD' }))
    .toThrow(/Invalid money amount format/);
  // Sums beyond the bound are rejected when the result instance is built.
  const max = Money.from({ amount: '999999999999999999.99', currency: 'USD' });
  const cent = Money.from({ amount: '0.01', currency: 'USD' });
  expect(() => max.add(cent)).toThrow(/NUMERIC\(20,2\) limit/);
});

test('zero factory and predicates', () => {
  const zero = Money.zero('BRL');
  expect(zero.amountString).toBe('0.00');
  expect(zero.isZero()).toBe(true);
  expect(zero.isPositive()).toBe(false);
  expect(zero.isNegative()).toBe(false);

  const positive = Money.from({ amount: '0.01', currency: 'BRL' });
  expect(positive.isPositive()).toBe(true);
  expect(zero.isLessThan(positive)).toBe(true);
  expect(positive.isLessThan(zero)).toBe(false);
  expect(() => zero.isLessThan(Money.from({ amount: '1.00', currency: 'USD' }))).toThrow(/Currency mismatch/);
});

test('equals compares value and currency', () => {
  expect(Money.from({ amount: '10', currency: 'USD' }).equals(Money.from({ amount: '10.00', currency: 'USD' }))).toBe(true);
  expect(Money.from({ amount: '10', currency: 'USD' }).equals(Money.from({ amount: '10.00', currency: 'EUR' }))).toBe(false);
  expect(Money.from({ amount: '10', currency: 'USD' }).equals(Money.from({ amount: '10.01', currency: 'USD' }))).toBe(false);
});

test('serializes to a stable JSON contract', () => {
  expect(Money.from({ amount: '25', currency: 'BRL' }).toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
  expect(JSON.stringify(Money.from({ amount: '25', currency: 'BRL' }))).toBe('{"amount":"25.00","currency":"BRL"}');
});
