import { expect, test } from 'bun:test';
import { Money } from '../../../../src/domain/wallet/money.js';

test('creates valid money and formats to 2 decimal places', () => {
  const m1 = new Money('10.5', 'USD');
  expect(m1.amountString).toBe('10.50');
  expect(m1.currency).toBe('USD');

  const m2 = new Money('100', 'EUR');
  expect(m2.amountString).toBe('100.00');

  const m3 = new Money('0', 'BRL');
  expect(m3.amountString).toBe('0.00');
});

test('rejects scientific notation', () => {
  expect(() => new Money('1e2', 'USD')).toThrow(/Invalid money amount format/);
});

test('rejects excess scale', () => {
  expect(() => new Money('10.555', 'USD')).toThrow(/Invalid money amount format/);
});

test('rejects invalid currency', () => {
  expect(() => new Money('10.00', 'usd')).toThrow(/Invalid ISO 4217 currency/);
  expect(() => new Money('10.00', 'US')).toThrow(/Invalid ISO 4217 currency/);
});

test('add operations are immutable and isolated by currency', () => {
  const m1 = new Money('10.00', 'USD');
  const m2 = new Money('5.50', 'USD');
  
  const m3 = m1.add(m2);
  expect(m3.amountString).toBe('15.50');
  expect(m1.amountString).toBe('10.00'); // Immutability check

  const eur = new Money('5.50', 'EUR');
  expect(() => m1.add(eur)).toThrow(/Currency mismatch/);
});

test('subtract operations are immutable', () => {
  const m1 = new Money('10.00', 'USD');
  const m2 = new Money('5.50', 'USD');
  
  const m3 = m1.subtract(m2);
  expect(m3.amountString).toBe('4.50');
  expect(m1.amountString).toBe('10.00'); // Immutability check
});

test('handles large numbers accurately above Number.MAX_SAFE_INTEGER cents', () => {
  // Number.MAX_SAFE_INTEGER is 9007199254740991
  // MAX_SAFE_INTEGER in cents is ~90,071,992,547,409.91
  const largeVal1 = '90071992547409.91';
  const largeVal2 = '0.10';
  
  const m1 = new Money(largeVal1, 'USD');
  const m2 = new Money(largeVal2, 'USD');
  
  const m3 = m1.add(m2);
  expect(m3.amountString).toBe('90071992547410.01');
  
  // Floating point would lose precision here.
});

test('equals method', () => {
  expect(new Money('10', 'USD').equals(new Money('10.00', 'USD'))).toBe(true);
  expect(new Money('10', 'USD').equals(new Money('10.00', 'EUR'))).toBe(false);
  expect(new Money('10', 'USD').equals(new Money('10.01', 'USD'))).toBe(false);
});
