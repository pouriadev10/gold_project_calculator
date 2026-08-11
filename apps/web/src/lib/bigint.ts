import {
  formatGram,
  formatRial as formatCoreRial,
  formatScaled,
  toLatinDigits,
} from '@gold/core-calc';
import { bigIntStringSchema } from '@gold/contracts';

/**
 * Parses a user-entered integer after converting Persian and Arabic digits to
 * their canonical Latin form. Form state and API payloads should keep the
 * original numeric value as a string; use this only at calculation boundaries.
 */
export function parseBigIntString(value: string): bigint {
  return BigInt(bigIntStringSchema.parse(toLatinDigits(value)));
}

/** Formats a rial string for Persian display without passing through Number. */
export function formatRial(value: string): string {
  return formatCoreRial(parseBigIntString(value));
}

/** Formats a milligram weight string as grams for Persian display. */
export function formatWeightMg(value: string): string {
  return formatGram(parseBigIntString(value));
}

/** Formats a generic integer string with Persian digits and digit grouping. */
export function formatIntegerString(value: string): string {
  return formatScaled(parseBigIntString(value), 0);
}

export function compareBigIntStrings(left: string, right: string): -1 | 0 | 1 {
  const leftValue = parseBigIntString(left);
  const rightValue = parseBigIntString(right);

  if (leftValue < rightValue) {
    return -1;
  }

  if (leftValue > rightValue) {
    return 1;
  }

  return 0;
}

export function addBigIntStrings(left: string, right: string): string {
  return (parseBigIntString(left) + parseBigIntString(right)).toString();
}

export function subtractBigIntStrings(left: string, right: string): string {
  return (parseBigIntString(left) - parseBigIntString(right)).toString();
}
