import { describe, expect, it } from 'vitest';
import {
  MAX_SAFE_BIGINT,
  isSafeNumber,
  measurementToScaled,
  toSafeNumber,
} from '../src/number-bridge.js';
import { CalcError } from '../src/types.js';

describe('toSafeNumber', () => {
  it('مقادیر داخل محدوده را تبدیل می‌کند', () => {
    expect(toSafeNumber(0n)).toBe(0);
    expect(toSafeNumber(-14n)).toBe(-14);
    expect(toSafeNumber(MAX_SAFE_BIGINT)).toBe(9_007_199_254_740_991);
  });

  it('فراتر از محدوده خطا می‌دهد — بی‌صدا عدد غلط نمی‌سازد', () => {
    expect(() => toSafeNumber(MAX_SAFE_BIGINT + 1n)).toThrow(CalcError);
    expect(() => toSafeNumber(-MAX_SAFE_BIGINT - 1n)).toThrow('دقت را از دست می‌دهد');
  });

  it('مبلغ ریالی بزرگ که float خرابش می‌کند، اینجا خطا می‌گیرد', () => {
    // این عدد در number به ۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۲۰۰۰ گرد می‌شود
    expect(() => toSafeNumber(9_007_199_254_740_993_123n)).toThrow(CalcError);
  });
});

describe('measurementToScaled', () => {
  it('اندازه‌گیری اعشاری را به bigint مقیاس‌شده می‌برد', () => {
    expect(measurementToScaled(83.47, 1)).toBe(835n);
    expect(measurementToScaled(0, 1)).toBe(0n);
    expect(measurementToScaled(12.34, 2)).toBe(1234n);
  });

  it('مقدار نامعتبر خطا می‌دهد', () => {
    expect(() => measurementToScaled(Number.NaN, 1)).toThrow(CalcError);
    expect(() => measurementToScaled(Number.POSITIVE_INFINITY, 1)).toThrow(CalcError);
  });
});

describe('isSafeNumber', () => {
  it('مرزها را درست تشخیص می‌دهد', () => {
    expect(isSafeNumber(MAX_SAFE_BIGINT)).toBe(true);
    expect(isSafeNumber(-MAX_SAFE_BIGINT)).toBe(true);
    expect(isSafeNumber(MAX_SAFE_BIGINT + 1n)).toBe(false);
    expect(isSafeNumber(-MAX_SAFE_BIGINT - 1n)).toBe(false);
  });
});
