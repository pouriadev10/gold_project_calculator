import { describe, expectTypeOf, it } from 'vitest';
import { bubble, intrinsicValue } from '../src/coin.js';
import type { BullionType, CoinType } from '../src/coin.js';
import { grossMg, karat, rial } from '../src/types.js';

const coin: CoinType = {
  kind: 'coin',
  id: 'bahar-azadi-new',
  label: 'تمام بهار آزادی',
  grossMg: grossMg(8133n),
  karat: karat(900),
};

const bar: BullionType = {
  kind: 'bullion',
  id: 'bar-995',
  label: 'شمش ۹۹۵',
  karat: karat(995),
};

const rate = rial(30_000_000n);
const market = rial(1_000_000_000n);

describe('قانون حباب در سطح نوع اجبار شده است', () => {
  it('bubble فقط CoinType می‌پذیرد', () => {
    expectTypeOf(bubble).parameter(0).toEqualTypeOf<CoinType>();
    expectTypeOf(bubble).parameter(0).not.toEqualTypeOf<BullionType>();
  });

  it('پاس دادن شمش به bubble خطای زمان کامپایل می‌دهد، نه صفر برمی‌گرداند', () => {
    // @ts-expect-error شمش حباب ندارد — این خط باید کامپایل نشود
    bubble(bar, market, rate);
  });

  it('پاس دادن شمش به intrinsicValue هم خطای کامپایل است', () => {
    // @ts-expect-error ارزش ذاتی سکه‌ای است؛ برای شمش از bullionPrice استفاده کن
    intrinsicValue(bar, rate);
  });

  it('سکه‌ی درست بدون خطا پذیرفته می‌شود', () => {
    expectTypeOf(bubble(coin, market, rate)).toEqualTypeOf<ReturnType<typeof bubble>>();
  });
});
