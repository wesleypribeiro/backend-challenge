import { Decimal } from 'decimal.js';

export interface MoneyProps {
  amount: string;
  currency: string;
}

const ISO_4217 = /^[A-Z]{3}$/;
const DECIMAL_STRING = /^-?\d+(\.\d{1,2})?$/;
/** NUMERIC(20,2) upper bound — mirrors the persistence column so the domain
 * rejects overflow before the database would round or fail. */
const NUMERIC_20_2_MAX = new Decimal('999999999999999999.99');

/**
 * Immutable exact-decimal money value object. Amounts are received and
 * serialized as decimal strings with a fixed 2-place scale; negatives are
 * representable for internal arithmetic (e.g. subtract results) but entry
 * contracts such as Wallet.open reject them explicitly.
 */
export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {
    Object.freeze(this);
  }

  static from(props: MoneyProps): Money {
    const { amount, currency } = props;
    if (typeof currency !== 'string' || !ISO_4217.test(currency)) {
      throw new Error(`Invalid ISO 4217 currency code: ${currency}`);
    }
    if (typeof amount !== 'string' || !DECIMAL_STRING.test(amount)) {
      throw new Error(
        `Invalid money amount format: ${amount}. Must be a decimal string with up to 2 decimal places, no scientific notation and no NaN/Infinity.`,
      );
    }
    const parsed = new Decimal(amount);
    if (parsed.abs().greaterThan(NUMERIC_20_2_MAX)) {
      throw new Error(`Money amount exceeds the NUMERIC(20,2) limit of ${NUMERIC_20_2_MAX.toFixed(2)}: ${amount}`);
    }
    // Normalize -0 to 0 so sign predicates stay coherent.
    return new Money(parsed.isZero() ? new Decimal(0) : parsed, currency);
  }

  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }

  /** Fixed 2-place decimal serialization. */
  get amountString(): string {
    return this.value.toFixed(2);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.from({ amount: this.value.plus(other.value).toFixed(2), currency: this.currency });
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.from({ amount: this.value.minus(other.value).toFixed(2), currency: this.currency });
  }

  negate(): Money {
    return Money.from({ amount: this.value.negated().toFixed(2), currency: this.currency });
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    if (this.currency !== other.currency) return false;
    return this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return { amount: this.amountString, currency: this.currency };
  }

  toString(): string {
    return this.amountString;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }
}
