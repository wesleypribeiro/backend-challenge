/** Application errors of wagering queries, mapped to HTTP by the filter. */

export class TransactionNotFoundError extends Error {
  constructor(readonly subject: string) {
    super(`Wagering transaction ${subject} not found`);
    this.name = 'TransactionNotFoundError';
  }
}
