import { describe, expectTypeOf, it } from 'vitest';
import { bubble, intrinsicValue } from '../src/coin.js';
import type {
  BullionType,
  CentralBankMintedCoinType,
  NonCentralBankCoinType,
} from '../src/coin.js';
import { grossUg, karat, rial } from '../src/types.js';

const coin: CentralBankMintedCoinType = {
  kind: 'coin',
  id: 'bahar-azadi-new',
  label: 'تمام بهار آزادی',
  grossWeightUg: grossUg(8_133_000n),
  karat: karat(900),
  isCentralBankMinted: true,
};

const nonBankCoin: NonCentralBankCoinType = {
  kind: 'coin',
  id: 'private-token',
  label: 'non-bank coin',
  grossWeightUg: grossUg(1_000_000n),
  karat: karat(900),
  isCentralBankMinted: false,
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
    expectTypeOf(bubble).parameter(0).toEqualTypeOf<CentralBankMintedCoinType>();
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

describe('non-bank coin bubble exclusion', () => {
  it('does not allow a non-bank coin in bubble', () => {
    // @ts-expect-error Bubbles belong only to central-bank-minted coins.
    bubble(nonBankCoin, market, rate);
  });
});
