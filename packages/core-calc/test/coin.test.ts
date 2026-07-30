import { describe, expect, it } from 'vitest';
import {
  bubble,
  bullionPrice,
  coinPositionValue,
  dimensionOf,
  intrinsicValue,
} from '../src/coin.js';
import type { BullionType, CoinType } from '../src/coin.js';
import { gramRate1000 } from '../src/pricing.js';
import { mulDivHalfUp } from '../src/rounding.js';
import { grossMg, karat, rial } from '../src/types.js';

const MAZNEH = 100_000_000n;
const RATE_1000 = gramRate1000(MAZNEH);

// مشخصات سکه در تست پارامتر است، نه ثابت — قاعده‌ی ۲-۶ CLAUDE.md
const FULL_COIN: CoinType = {
  kind: 'coin',
  id: 'bahar-azadi-new',
  label: 'تمام بهار آزادی',
  grossMg: grossMg(8133n),
  karat: karat(900),
};

const GOLD_BAR: BullionType = {
  kind: 'bullion',
  id: 'bar-995',
  label: 'شمش ۹۹۵',
  karat: karat(995),
};

describe('سکه یک شیء است، نه یک وزن', () => {
  it('هر نوع سکه بُعد شمارشی مستقل خود را در دفتر کل دارد', () => {
    expect(dimensionOf(FULL_COIN)).toBe('coin:bahar-azadi-new');
  });

  it('ارزش موقعیت از ضرب تعداد می‌آید، نه از تبدیل به گرم', () => {
    expect(coinPositionValue(5, rial(1_000_000_000n))).toBe(5_000_000_000n);
  });
});

describe('ارزش ذاتی سکه', () => {
  it('برابر وزن خالص × نرخ گرم ۱۰۰۰ است', () => {
    // ۸۱۳۳ میلی‌گرم عیار ۹۰۰ → ۷۳۱۹.۷ ≈ ۷۳۲۰ میلی‌گرم خالص
    const pure = mulDivHalfUp(8133n, 900n, 1000n);
    expect(pure).toBe(7320n);
    expect(intrinsicValue(FULL_COIN, RATE_1000)).toBe(mulDivHalfUp(pure, RATE_1000, 1000n));
  });
});

describe('قانون حباب', () => {
  it('حباب = قیمت بازار − ارزش ذاتی', () => {
    const intrinsic = intrinsicValue(FULL_COIN, RATE_1000);
    const market = rial(intrinsic + 50_000_000n);
    expect(bubble(FULL_COIN, market, RATE_1000)).toBe(50_000_000n);
  });

  it('حباب منفی مجاز است — سکه زیر ارزش ذاتی خطا نیست', () => {
    const intrinsic = intrinsicValue(FULL_COIN, RATE_1000);
    const market = rial(intrinsic - 10_000_000n);
    expect(bubble(FULL_COIN, market, RATE_1000)).toBe(-10_000_000n);
  });
});

describe('شمش حباب ندارد — در هیچ حالتی', () => {
  it('قیمت شمش = وزن × عیار ÷ ۱۰۰۰ × نرخ گرم ۱۰۰۰، بدون پرمیوم', () => {
    const weight = grossMg(100_000n); // ۱۰۰ گرم
    const price = bullionPrice(weight, GOLD_BAR.karat, RATE_1000);

    // ۱۰۰ گرم عیار ۹۹۵ → ۹۹.۵ گرم خالص، بدون باقی‌مانده
    const pure = mulDivHalfUp(100_000n, 995n, 1000n);
    expect(pure).toBe(99_500n);
    expect(price).toBe(mulDivHalfUp(pure, RATE_1000, 1000n));
  });

  it('قیمت شمش دقیقاً برابر ارزش ذوب است — هیچ پرمیومی اضافه نمی‌شود', () => {
    const weight = grossMg(50_000n);
    const price = bullionPrice(weight, karat(750), RATE_1000);
    const meltOnly = mulDivHalfUp(mulDivHalfUp(50_000n, 750n, 1000n), RATE_1000, 1000n);
    expect(price - meltOnly).toBe(0n);
  });

  it('یک شمش و یک سکه با وزن خالص برابر، قیمت ذوب برابر دارند — تفاوت فقط حباب است', () => {
    const equivalentBar = grossMg(FULL_COIN.grossMg);
    const barPrice = bullionPrice(equivalentBar, FULL_COIN.karat, RATE_1000);
    expect(barPrice).toBe(intrinsicValue(FULL_COIN, RATE_1000));
  });

  it('شمش هیچ فیلد و مسیر حبابی ندارد', () => {
    expect(Object.keys(GOLD_BAR)).not.toContain('bubble');
  });
});
