/** Structural payload problems raised at the HTTP boundary (400). */
export class InvalidPayloadError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidPayloadError';
  }
}
