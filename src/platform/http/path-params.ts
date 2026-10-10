import { InvalidPayloadError } from './invalid-payload.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Path params shared by the financial endpoints: UUID or 400 naming the field. */
export function parseUuidPath(field: string, value: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new InvalidPayloadError(field, `${field} must be a UUID`);
  }
  return value;
}

/** Non-empty, size-bounded path segment (provider identity, external ids). */
export function parseIdentifierPath(field: string, value: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    throw new InvalidPayloadError(field, `${field} must not be empty`);
  }
  if (value.length > maxLength) {
    throw new InvalidPayloadError(field, `${field} must have at most ${maxLength} characters`);
  }
  return value;
}
