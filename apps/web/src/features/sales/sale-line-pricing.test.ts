import { describe, expect, it } from 'vitest';
import type { JewelryItemVersion } from '@/api/contracts';
import type { SaleDraftItemLine, SaleLinePricingInput } from '@/stores/sale-draft-store';
import {
  calculateLinePricing,
  defaultPricingFromAdhoc,
  defaultPricingFromCatalog,
} from './sale-line-pricing';

/**
 * FE-043 — «تمام است وقتی: Golden cases فرانت با core-calc یکسان باشند».
 *
 * ورودی/خروجی این فایل عیناً `packages/core-calc/test/jewelry-sale.test.ts`
 * (fixture `baseInput`) است — همان اعداد، فقط به شکل رشته‌ای
 * `SaleLinePricingInput` که این تسک ذخیره می‌کند. اگر آن فایل تغییر کند،
 * این فایل هم باید دستی هم‌گام شود (بدون تأیید صریح تغییر نکند — بخش ۷
 * CLAUDE.md، «Golden tests... بدون تأیید صریح تغییر نمی‌کنند»).
 */
const GOLDEN_PRICING: SaleLinePricingInput = {
  grossWeightMg: '12000',
  karat: 750,
  stoneWeightMg: '2000',
  otherDeductionWeightMg: '0',
  wageType: 'PER_GRAM',
  wageValue: '350000',
  profitRateBps: '700',
  taxRateBps: '1000',
};
const GOLDEN_MAZNEH_RIAL = 100_000_000n;

describe('calculateLinePricing — Golden case (هم‌گام با jewelry-sale.test.ts هسته‌ی محاسبه)', () => {
  it('عیناً همان خروجی calculateJewelrySale واقعی را می‌دهد', () => {
    const result = calculateLinePricing(GOLDEN_PRICING, GOLDEN_MAZNEH_RIAL);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.calc).toEqual({
      pureWeightMg: 7_500n,
      goldRatePerGramRial: 23_085_080n,
      goldValueRial: 230_850_800n,
      wageRial: 3_500_000n,
      profitRial: 16_404_556n,
      taxRial: 1_990_456n,
      payableBeforeRoundingRial: 252_745_812n,
      payableRial: 252_746_000n,
    });
  });

  it('نوع اجرت درصدی، نتیجه‌ی متفاوت اما همچنان دقیق می‌دهد (هم‌گام با پارامتری‌شده‌ی core-calc)', () => {
    const result = calculateLinePricing(
      { ...GOLDEN_PRICING, wageType: 'PERCENT_X100', wageValue: '700' },
      GOLDEN_MAZNEH_RIAL,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.calc.profitRial).toBe(17_290_725n);
  });

  it('وقتی کسورات از وزن ناخالص بیشتر شود، خطای قابل‌نمایش برمی‌گرداند نه استثنای دست‌نخورده', () => {
    const result = calculateLinePricing(
      { ...GOLDEN_PRICING, stoneWeightMg: '999999999' },
      GOLDEN_MAZNEH_RIAL,
    );

    expect(result.ok).toBe(false);
  });

  it('هیچ مقدار میانی گرد نمی‌شود — payableBeforeRoundingRial همیشه دقیق و متفاوت از payableRial باقی می‌ماند', () => {
    const result = calculateLinePricing(GOLDEN_PRICING, GOLDEN_MAZNEH_RIAL);
    if (!result.ok) throw new Error('expected ok');
    expect(result.calc.payableBeforeRoundingRial).not.toBe(result.calc.payableRial);
  });
});

function catalogVersion(overrides: Partial<JewelryItemVersion> = {}): JewelryItemVersion {
  return {
    id: 'v1',
    jewelryItemId: 'j1',
    code: 'R-100',
    title: 'انگشتر سادگی',
    grossWeightMg: '12000',
    karat: 750,
    stoneWeightMg: '2000',
    otherDeductionWeightMg: '0',
    wageType: 'PER_GRAM',
    wageValue: '350000',
    validFrom: '2026-01-01T00:00:00+00:00',
    validTo: null,
    version: 1,
    active: true,
    ...overrides,
  };
}

describe('defaultPricingFromCatalog', () => {
  it('مشخصات مالی نسخه‌ی کاتالوگ را عیناً کپی می‌کند و نرخ سود/مالیات پیش‌فرض می‌گذارد', () => {
    const pricing = defaultPricingFromCatalog(catalogVersion());
    expect(pricing).toEqual(GOLDEN_PRICING);
  });
});

describe('defaultPricingFromAdhoc', () => {
  it('وزن/عیار «ورود سریع» را نگه می‌دارد و بقیه را صفر/پیش‌فرض می‌گذارد', () => {
    const line: Extract<SaleDraftItemLine, { kind: 'ADHOC' }> = {
      lineId: 'l1',
      kind: 'ADHOC',
      jewelryItemId: null,
      code: '',
      title: 'طلای دست‌دوم',
      grossWeightMg: '3500',
      karat: 740,
      pricing: null,
    };

    expect(defaultPricingFromAdhoc(line)).toEqual({
      grossWeightMg: '3500',
      karat: 740,
      stoneWeightMg: '0',
      otherDeductionWeightMg: '0',
      wageType: 'PER_GRAM',
      wageValue: '0',
      profitRateBps: '700',
      taxRateBps: '1000',
    });
  });
});
