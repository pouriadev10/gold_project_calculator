import { describe, expect, it } from 'vitest';
import type { LockedMazneh, SaleDraftItemLine, SaleLinePricingInput } from '@/stores/sale-draft-store';
import type { PartySelection } from '@/stores/recent-parties-store';
import { calculateLinePricing } from './sale-line-pricing';
import { prepareJewelrySale, type SaleDraftSnapshot } from './sale-submit';

/**
 * FE-045 (نقدی) و FE-047 (نسیه) — ساخت payload ثبت فروش از پیش‌نویس.
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
  return { party: PARTY, items: [catalogLine()], lockedMazneh: LOCKED, paidRial: null, ...overrides };
}

describe('prepareJewelrySale — payload نقدی', () => {
  it('از یک ردیف کاتالوگی قیمت‌گذاری‌شده، دقیقاً چهار فیلد قرارداد را می‌سازد', () => {
    const result = prepareJewelrySale(draft(), EFFECTIVE_AT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.payload).toEqual({
      mode: 'CASH',
      input: {
        partyId: PARTY.id,
        jewelryItemId: 'b1000000-0000-4000-8000-000000000001',
        quoteId: LOCKED.quoteId,
        effectiveAt: '2026-08-22T10:30:00.000Z',
      },
    });
  });

  it('هیچ عدد وزنی یا مالی در payload نمی‌گذارد — سرور خودش قیمت می‌زند', () => {
    const result = prepareJewelrySale(draft(), EFFECTIVE_AT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.plan.payload.input).sort()).toEqual([
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

    const result = prepareJewelrySale(draft(), EFFECTIVE_AT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.previewPayableRial).toBe(expected.calc.payableRial);
  });

  it('اگر محاسبه‌ی محلی خطا بدهد، ثبت همچنان مجاز است و فقط پیش‌نمایش خالی می‌ماند', () => {
    // عیار صفر — `calculateJewelrySale` ردش می‌کند، ولی سرور از نسخه‌ی واقعی کالا قیمت می‌زند
    const broken = { ...PRICING, karat: 0 };
    const result = prepareJewelrySale(draft({ items: [catalogLine({ pricing: broken })] }), EFFECTIVE_AT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.previewPayableRial).toBeUndefined();
  });
});

describe('prepareJewelrySale — payload نسیه (FE-047)', () => {
  it('هر مبلغ پرداختی — حتی صفر — مسیر نسیه را انتخاب می‌کند', () => {
    const result = prepareJewelrySale(draft({ paidRial: '0' }), EFFECTIVE_AT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.payload).toEqual({
      mode: 'CREDIT',
      input: {
        partyId: PARTY.id,
        jewelryItemId: 'b1000000-0000-4000-8000-000000000001',
        quoteId: LOCKED.quoteId,
        effectiveAt: '2026-08-22T10:30:00.000Z',
        paidRial: '0',
      },
    });
  });

  it('پرداخت جزئی همان رشته را بدون دست‌کاری می‌فرستد', () => {
    const result = prepareJewelrySale(draft({ paidRial: '250000000' }), EFFECTIVE_AT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.payload.mode).toBe('CREDIT');
    expect(result.plan.payload).toMatchObject({ input: { paidRial: '250000000' } });
  });

  it('`null` یعنی پرداخت کامل، نه نسیه‌ی صفر', () => {
    const result = prepareJewelrySale(draft({ paidRial: null }), EFFECTIVE_AT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.payload.mode).toBe('CASH');
  });

  it('پرداخت بیشتر از جمع کل پیش‌نمایش رد نمی‌شود — تصمیمش با سرور است', () => {
    const result = prepareJewelrySale(draft({ paidRial: '99999999999' }), EFFECTIVE_AT);
    expect(result.ok).toBe(true);
  });

  it('پرداخت منفی مسدود می‌شود', () => {
    const result = prepareJewelrySale(draft({ paidRial: '-1' }), EFFECTIVE_AT);
    expect(result).toMatchObject({ ok: false, reason: 'NEGATIVE_PAYMENT' });
  });
});

describe('prepareJewelrySale — حالت‌های مسدود', () => {
  it('بدون مشتری ثبت نمی‌شود', () => {
    const result = prepareJewelrySale(draft({ party: null }), EFFECTIVE_AT);
    expect(result).toMatchObject({ ok: false, reason: 'NO_PARTY' });
  });

  it('بدون نرخ قفل‌شده ثبت نمی‌شود — `quoteId` وجود ندارد که فرستاده شود', () => {
    const result = prepareJewelrySale(draft({ lockedMazneh: null }), EFFECTIVE_AT);
    expect(result).toMatchObject({ ok: false, reason: 'NO_QUOTE' });
  });

  it('بدون هیچ قلمی ثبت نمی‌شود', () => {
    const result = prepareJewelrySale(draft({ items: [] }), EFFECTIVE_AT);
    expect(result).toMatchObject({ ok: false, reason: 'NO_ITEMS' });
  });

  it('با بیش از یک قلم مسدود می‌شود — قلم‌ها بی‌صدا انداخته نمی‌شوند', () => {
    const result = prepareJewelrySale(
      draft({ items: [catalogLine(), catalogLine({ lineId: 'l9' })] }),
      EFFECTIVE_AT,
    );
    expect(result).toMatchObject({ ok: false, reason: 'MULTIPLE_ITEMS' });
  });

  it('قلم موردی مسدود می‌شود — قرارداد فقط `jewelryItemId` می‌پذیرد', () => {
    const result = prepareJewelrySale(draft({ items: [adhocLine()] }), EFFECTIVE_AT);
    expect(result).toMatchObject({ ok: false, reason: 'ADHOC_ITEM' });
  });

  it('ردیف قیمت‌گذاری‌نشده مسدود می‌شود', () => {
    const result = prepareJewelrySale(draft({ items: [catalogLine({ pricing: null })] }), EFFECTIVE_AT);
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
      draft({ paidRial: '-1' }),
    ];

    for (const candidate of blockedDrafts) {
      const result = prepareJewelrySale(candidate, EFFECTIVE_AT);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});
