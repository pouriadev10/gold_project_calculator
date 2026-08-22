import { describe, expect, it } from 'vitest';
import type { LockedMazneh, SaleDraftItemLine, SaleLinePricingInput } from '@/stores/sale-draft-store';
import type { PartySelection } from '@/stores/recent-parties-store';
import { calculateLinePricing } from './sale-line-pricing';
import { prepareJewelryCashSale, type SaleDraftSnapshot } from './sale-submit';

/**
 * FE-045 — ساخت payload ثبت فروش نقدی از پیش‌نویس.
 *
 * تابع خالص است و هیچ mockای لازم ندارد؛ `effectiveAt` هم آرگومان است،
 * پس هیچ‌جا به ساعت سیستم دست نمی‌خوریم.
 */

const PARTY: PartySelection = {
  id: 'a1000000-0000-4000-8000-000000000001',
  displayName: 'حسین مرادی',
  mobile: '09121234567',
  type: 'CONSUMER',
  status: 'ACTIVE',
};

const LOCKED: LockedMazneh = {
  quoteId: 'c1000000-0000-4000-8000-000000000001',
  mazneh: '480000000',
  source: 'MANUAL',
  observedAt: '2026-08-10T09:00:00.000Z',
};

const PRICING: SaleLinePricingInput = {
  grossWeightMg: '10000',
  karat: 750,
  stoneWeightMg: '0',
  otherDeductionWeightMg: '0',
  wageType: 'FLAT',
  wageValue: '5000000',
  profitRateBps: '700',
  taxRateBps: '1000',
};

const EFFECTIVE_AT = new Date('2026-08-22T10:30:00.000Z');

function catalogLine(overrides: Partial<Extract<SaleDraftItemLine, { kind: 'CATALOG' }>> = {}): SaleDraftItemLine {
  return {
    lineId: 'l1',
    kind: 'CATALOG',
    jewelryItemId: 'b1000000-0000-4000-8000-000000000001',
    code: 'RG-750-04',
    title: 'انگشتر ۱۸ عیار',
    pricing: PRICING,
    ...overrides,
  };
}

function adhocLine(): SaleDraftItemLine {
  return {
    lineId: 'l2',
    kind: 'ADHOC',
    jewelryItemId: null,
    code: '',
    title: 'قلم موردی',
    grossWeightMg: '4000',
    karat: 750,
    pricing: PRICING,
  };
}

function draft(overrides: Partial<SaleDraftSnapshot> = {}): SaleDraftSnapshot {
  return { party: PARTY, items: [catalogLine()], lockedMazneh: LOCKED, ...overrides };
}

describe('prepareJewelryCashSale — payload معتبر', () => {
  it('از یک ردیف کاتالوگی قیمت‌گذاری‌شده، دقیقاً چهار فیلد قرارداد را می‌سازد', () => {
    const result = prepareJewelryCashSale(draft(), EFFECTIVE_AT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.payload).toEqual({
      partyId: PARTY.id,
      jewelryItemId: 'b1000000-0000-4000-8000-000000000001',
      quoteId: LOCKED.quoteId,
      effectiveAt: '2026-08-22T10:30:00.000Z',
    });
  });

  it('هیچ عدد وزنی یا مالی در payload نمی‌گذارد — سرور خودش قیمت می‌زند', () => {
    const result = prepareJewelryCashSale(draft(), EFFECTIVE_AT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.plan.payload).sort()).toEqual([
      'effectiveAt',
      'jewelryItemId',
      'partyId',
      'quoteId',
    ]);
  });

  it('پیش‌نمایش مبلغ را با همان `calculateLinePricing` و نرخ قفل‌شده حساب می‌کند', () => {
    const expected = calculateLinePricing(PRICING, BigInt(LOCKED.mazneh));
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;

    const result = prepareJewelryCashSale(draft(), EFFECTIVE_AT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.previewPayableRial).toBe(expected.calc.payableRial);
  });

  it('اگر محاسبه‌ی محلی خطا بدهد، ثبت همچنان مجاز است و فقط پیش‌نمایش خالی می‌ماند', () => {
    // عیار صفر — `calculateJewelrySale` ردش می‌کند، ولی سرور از نسخه‌ی واقعی کالا قیمت می‌زند
    const broken = { ...PRICING, karat: 0 };
    const result = prepareJewelryCashSale(draft({ items: [catalogLine({ pricing: broken })] }), EFFECTIVE_AT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.previewPayableRial).toBeUndefined();
  });
});

describe('prepareJewelryCashSale — حالت‌های مسدود', () => {
  it('بدون مشتری ثبت نمی‌شود', () => {
    const result = prepareJewelryCashSale(draft({ party: null }), EFFECTIVE_AT);
    expect(result).toMatchObject({ ok: false, reason: 'NO_PARTY' });
  });

  it('بدون نرخ قفل‌شده ثبت نمی‌شود — `quoteId` وجود ندارد که فرستاده شود', () => {
    const result = prepareJewelryCashSale(draft({ lockedMazneh: null }), EFFECTIVE_AT);
    expect(result).toMatchObject({ ok: false, reason: 'NO_QUOTE' });
  });

  it('بدون هیچ قلمی ثبت نمی‌شود', () => {
    const result = prepareJewelryCashSale(draft({ items: [] }), EFFECTIVE_AT);
    expect(result).toMatchObject({ ok: false, reason: 'NO_ITEMS' });
  });

  it('با بیش از یک قلم مسدود می‌شود — قلم‌ها بی‌صدا انداخته نمی‌شوند', () => {
    const result = prepareJewelryCashSale(
      draft({ items: [catalogLine(), catalogLine({ lineId: 'l9' })] }),
      EFFECTIVE_AT,
    );
    expect(result).toMatchObject({ ok: false, reason: 'MULTIPLE_ITEMS' });
  });

  it('قلم موردی مسدود می‌شود — قرارداد فقط `jewelryItemId` می‌پذیرد', () => {
    const result = prepareJewelryCashSale(draft({ items: [adhocLine()] }), EFFECTIVE_AT);
    expect(result).toMatchObject({ ok: false, reason: 'ADHOC_ITEM' });
  });

  it('ردیف قیمت‌گذاری‌نشده مسدود می‌شود', () => {
    const result = prepareJewelryCashSale(draft({ items: [catalogLine({ pricing: null })] }), EFFECTIVE_AT);
    expect(result).toMatchObject({ ok: false, reason: 'ITEM_NOT_PRICED' });
  });

  it('هر حالت مسدود یک پیام فارسی برای نمایش دارد', () => {
    const blockedDrafts: SaleDraftSnapshot[] = [
      draft({ party: null }),
      draft({ lockedMazneh: null }),
      draft({ items: [] }),
      draft({ items: [catalogLine(), catalogLine({ lineId: 'l9' })] }),
      draft({ items: [adhocLine()] }),
      draft({ items: [catalogLine({ pricing: null })] }),
    ];

    for (const candidate of blockedDrafts) {
      const result = prepareJewelryCashSale(candidate, EFFECTIVE_AT);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});
