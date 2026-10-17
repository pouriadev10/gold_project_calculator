import { gramRate1000, karat, rateDivisorFromMarketSettings, type Karat } from '@gold/core-calc';

/**
 * Snapshot-only reads of the market settings that were locked into a source
 * document (sales invoice or second-hand purchase) — FE-106b.
 *
 * Read models must never price a historical document with today's settings or
 * today's mazneh (rule 2-8). The only inputs here are the document's own locked
 * quote amount and its own settings snapshot; the arithmetic is `core-calc`'s,
 * exactly as the sale itself computed it.
 */

/** JSON-safe snapshot value as stored on source documents (no `number`). */
export type LockedSnapshotValue =
  | boolean
  | null
  | string
  | readonly LockedSnapshotValue[]
  | { readonly [key: string]: LockedSnapshotValue };

export class LockedSnapshotInvalidError extends Error {
  constructor(message: string) {
    super(`Locked document snapshot is invalid: ${message}`);
    this.name = 'LockedSnapshotInvalidError';
  }
}

function snapshotRecord(
  value: LockedSnapshotValue,
): Readonly<Record<string, LockedSnapshotValue>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, LockedSnapshotValue>>;
}

/** A non-negative canonical integer string from a snapshot, or `null` when absent/invalid. */
export function snapshotDigits(value: LockedSnapshotValue, key: string): string | null {
  const candidate = snapshotRecord(value)?.[key];
  return typeof candidate === 'string' && /^(0|[1-9]\d*)$/u.test(candidate) ? candidate : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** A UUID reference (e.g. the priced item version) from a snapshot, or `undefined`. */
export function snapshotUuid(value: LockedSnapshotValue, key: string): string | undefined {
  const candidate = snapshotRecord(value)?.[key];
  return typeof candidate === 'string' && UUID_PATTERN.test(candidate) ? candidate : undefined;
}

/** A non-blank string from a snapshot, or `null`. */
export function snapshotText(value: LockedSnapshotValue, key: string): string | null {
  const candidate = snapshotRecord(value)?.[key];
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : null;
}

/** `"4.6083"` → `"46083"` (grams × 10 000), or `null` when absent/invalid. */
export function snapshotMithqalGramsX10k(value: LockedSnapshotValue): string | null {
  const candidate = snapshotRecord(value)?.['mithqalGrams'];
  if (typeof candidate !== 'string') return null;
  const match = /^(\d+)\.(\d{4})$/u.exec(candidate);
  if (match === null) return null;
  const x10k = BigInt(`${match[1]}${match[2]}`);
  return x10k > 0n ? x10k.toString() : null;
}

function baseKaratOf(value: string): Karat {
  try {
    return karat(Number.parseInt(value, 10));
  } catch {
    throw new LockedSnapshotInvalidError('settings snapshot.baseQuoteKarat is out of range');
  }
}

/**
 * Gram-1000 rate locked at the document's event: its own mazneh priced with
 * its own base-quote karat and mithqal snapshot.
 */
export function lockedGoldRate1000(quoteAmountRial: bigint, settingsSnapshot: LockedSnapshotValue): bigint {
  if (quoteAmountRial <= 0n) {
    throw new LockedSnapshotInvalidError('locked quote amount must be positive');
  }
  const baseQuoteKarat = snapshotDigits(settingsSnapshot, 'baseQuoteKarat');
  if (baseQuoteKarat === null || baseQuoteKarat.length > 4) {
    throw new LockedSnapshotInvalidError('settings snapshot.baseQuoteKarat is missing or invalid');
  }
  const mithqalGramsX10k = snapshotMithqalGramsX10k(settingsSnapshot);
  if (mithqalGramsX10k === null) {
    throw new LockedSnapshotInvalidError('settings snapshot.mithqalGrams is missing or invalid');
  }
  const rate1000 = gramRate1000(
    quoteAmountRial,
    rateDivisorFromMarketSettings(baseKaratOf(baseQuoteKarat), BigInt(mithqalGramsX10k)),
  );
  if (rate1000 <= 0n) {
    throw new LockedSnapshotInvalidError('locked gram-1000 rate is not positive');
  }
  return rate1000;
}
