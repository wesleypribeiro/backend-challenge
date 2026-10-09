import { Decimal } from 'decimal.js';

export class Money {
  private readonly amount: Decimal;

  constructor(amount: string, public readonly currency: string) {
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error(`Invalid ISO 4217 currency code: ${currency}`);
    }

    if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) {
      throw new Error(`Invalid money amount format: ${amount}. Must be a valid decimal string with up to 2 decimal places and no scientific notation.`);
    }

    this.amount = new Decimal(amount);
  }

  get amountString(): string {
    return this.amount.toFixed(2);
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.plus(other.amount).toFixed(2), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.minus(other.amount).toFixed(2), this.currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  equals(other: Money): boolean {
    if (this.currency !== other.currency) return false;
    return this.amount.equals(other.amount);
  }
}
