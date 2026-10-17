import { describe, expect, it } from 'vitest';
import { gramRate1000 } from '@gold/core-calc';
import {
  LockedSnapshotInvalidError,
  lockedGoldRate1000,
  snapshotDigits,
  snapshotMithqalGramsX10k,
  snapshotText,
  snapshotUuid,
} from './locked-gold-rate';

/** FE-106b — نرخ گرم ۱۰۰۰ ِ قفل‌شده فقط از snapshot ِ خود سند. */

const MAZNEH = 412_500_000n;
const MARKET = { baseQuoteKarat: '705', mithqalGrams: '4.6083' };

describe('lockedGoldRate1000', () => {
  it('با تنظیمات پیش‌فرض بازار همان نرخ استاندارد core-calc را می‌دهد', () => {
    expect(lockedGoldRate1000(MAZNEH, MARKET)).toBe(gramRate1000(MAZNEH));
  });

  it('عیار پایه و مثقال ِ snapshot را به‌کار می‌برد، نه مقدار پیش‌فرض را', () => {
    const standard = lockedGoldRate1000(MAZNEH, MARKET);
    expect(lockedGoldRate1000(MAZNEH, { ...MARKET, baseQuoteKarat: '750' })).toBeLessThan(standard);
    expect(lockedGoldRate1000(MAZNEH, { ...MARKET, mithqalGrams: '4.0000' })).toBeGreaterThan(standard);
  });

  it.each([
    ['بدون عیار پایه', { mithqalGrams: '4.6083' }],
    ['عیار پایه‌ی غیرعددی', { ...MARKET, baseQuoteKarat: '70.5' }],
    ['عیار پایه‌ی صفر', { ...MARKET, baseQuoteKarat: '0' }],
    ['عیار پایه‌ی بیش از ۱۰۰۰', { ...MARKET, baseQuoteKarat: '1005' }],
    ['بدون مثقال', { baseQuoteKarat: '705' }],
    ['مثقال بدون چهار رقم اعشار', { ...MARKET, mithqalGrams: '4.608' }],
    ['مثقال صفر', { ...MARKET, mithqalGrams: '0.0000' }],
    ['snapshot ِ غیرشیء', null],
    ['snapshot ِ آرایه', ['705']],
  ])('%s → خطای snapshot ِ نامعتبر', (_label, snapshot) => {
    expect(() => lockedGoldRate1000(MAZNEH, snapshot)).toThrow(LockedSnapshotInvalidError);
  });

  it('مظنه‌ی نامثبت را نمی‌پذیرد', () => {
    expect(() => lockedGoldRate1000(0n, MARKET)).toThrow(LockedSnapshotInvalidError);
  });

  it('نرخی که به صفر گرد شود را نمی‌پذیرد', () => {
    expect(() => lockedGoldRate1000(1n, MARKET)).toThrow(LockedSnapshotInvalidError);
  });
});

describe('خواندن snapshot', () => {
  const snapshot = {
    payableRial: '125000000',
    zero: '0',
    negative: '-5',
    padded: '007',
    blank: '  ',
    policy: 'HALF_UP',
    versionId: '0b5b8c6e-1d1f-4c3a-9a77-2f3e8d9c1a00',
    notUuid: 'abc',
  };

  it('snapshotDigits فقط عدد صحیح نامنفی ِ متعارف', () => {
    expect(snapshotDigits(snapshot, 'payableRial')).toBe('125000000');
    expect(snapshotDigits(snapshot, 'zero')).toBe('0');
    expect(snapshotDigits(snapshot, 'negative')).toBeNull();
    expect(snapshotDigits(snapshot, 'padded')).toBeNull();
    expect(snapshotDigits(snapshot, 'missing')).toBeNull();
    expect(snapshotDigits('125', 'payableRial')).toBeNull();
  });

  it('snapshotText متن ناتهی', () => {
    expect(snapshotText(snapshot, 'policy')).toBe('HALF_UP');
    expect(snapshotText(snapshot, 'blank')).toBeNull();
    expect(snapshotText(snapshot, 'missing')).toBeNull();
  });

  it('snapshotUuid فقط uuid ِ معتبر — پیش از رسیدن به ستون uuid ِ دیتابیس', () => {
    expect(snapshotUuid(snapshot, 'versionId')).toBe(snapshot.versionId);
    expect(snapshotUuid(snapshot, 'notUuid')).toBeUndefined();
    expect(snapshotUuid(null, 'versionId')).toBeUndefined();
  });

  it('snapshotMithqalGramsX10k', () => {
    expect(snapshotMithqalGramsX10k(MARKET)).toBe('46083');
    expect(snapshotMithqalGramsX10k({ mithqalGrams: 4.6083 as unknown as string })).toBeNull();
    expect(snapshotMithqalGramsX10k({})).toBeNull();
  });
});
