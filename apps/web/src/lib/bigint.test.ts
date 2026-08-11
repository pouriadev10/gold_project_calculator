import { toLatinDigits } from '@gold/core-calc';
import { describe, expect, it } from 'vitest';

import {
  addBigIntStrings,
  compareBigIntStrings,
  formatIntegerString,
  formatRial,
  formatWeightMg,
  parseBigIntString,
  subtractBigIntStrings,
} from './bigint';

const withoutSeparators = (value: string): string =>
  toLatinDigits(value).replaceAll('\u066C', '').replaceAll('\u066B', '.').replaceAll('\u2212', '-');

describe('BigInt string utilities', () => {
  it('normalizes Persian and Arabic digits before parsing', () => {
    expect(parseBigIntString('\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9\u06F0')).toBe(
      1234567890n,
    );
    expect(parseBigIntString('\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u0660')).toBe(
      1234567890n,
    );
  });

  it('rejects non-canonical integer strings', () => {
    expect(() => parseBigIntString('007')).toThrow();
    expect(() => parseBigIntString('+7')).toThrow();
    expect(() => parseBigIntString('12.5')).toThrow();
    expect(() => parseBigIntString('-0')).toThrow();
  });

  it('formats rial values larger than Number.MAX_SAFE_INTEGER precisely', () => {
    const value = '900719925474099312345678901234567890';

    expect(withoutSeparators(formatRial(value))).toBe(value);
  });

  it('formats milligram weights as grams without precision loss', () => {
    expect(withoutSeparators(formatWeightMg('123456789012345678901234567'))).toBe(
      '123456789012345678901234.567',
    );
  });

  it('formats zero and negative generic integers', () => {
    expect(withoutSeparators(formatIntegerString('0'))).toBe('0');
    expect(withoutSeparators(formatIntegerString('-90071992547409931234567890'))).toBe(
      '-90071992547409931234567890',
    );
  });

  it('compares integer strings exactly', () => {
    expect(compareBigIntStrings('-1', '0')).toBe(-1);
    expect(compareBigIntStrings('9007199254740993', '9007199254740993')).toBe(0);
    expect(compareBigIntStrings('9007199254740994', '9007199254740993')).toBe(1);
  });

  it('adds and subtracts integer strings exactly', () => {
    expect(addBigIntStrings('90071992547409931234567890', '10')).toBe('90071992547409931234567900');
    expect(subtractBigIntStrings('0', '90071992547409931234567890')).toBe(
      '-90071992547409931234567890',
    );
  });
});
