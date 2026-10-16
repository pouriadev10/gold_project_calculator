import { bubble, rial, type CoinType } from '@gold/core-calc';
import { describe, expect, it } from 'vitest';
import type { CoinTypeVersion } from '@/api/contracts';
import { COIN_TYPE_VERSIONS } from '@/mocks/handlers/fixtures';
import { formatCoinWeightUg, formatCoinsGrossWeight, toCoinType } from './coin-type';

const MINTED = COIN_TYPE_VERSIONS.find(
  (version) => version.isCentralBankMinted,
)! as CoinTypeVersion;
const PRIVATE: CoinTypeVersion = {
  ...MINTED,
  coinTypeId: 'f1000000-0000-4000-8000-000000000099',
  title: 'سکه پارسیان',
  mintType: 'PRIVATE_MINT',
  isCentralBankMinted: false,
} as CoinTypeVersion;

/** تنها مسیر رسیدن به `bubble()`؛ در نوع غیربانکی اصلاً صدا زده نمی‌شود (کامپایل هم نمی‌شود). */
function bubbleOf(coin: CoinType): bigint | null {
  return coin.isCentralBankMinted ? bubble(coin, rial(1_250_000_000n), rial(147_741_000n)) : null;
}

describe('toCoinType (FE-105)', () => {
  it('پرچم حباب فقط از خود نسخه‌ی کاتالوگ می‌آید', () => {
    expect(toCoinType(MINTED).isCentralBankMinted).toBe(true);
    expect(toCoinType(PRIVATE).isCentralBankMinted).toBe(false);
  });

  it('سکه‌ی ضرب بانک مرکزی حباب دارد؛ سکه‌ی خصوصی هیچ حبابی ندارد', () => {
    expect(bubbleOf(toCoinType(MINTED))).not.toBeNull();
    expect(bubbleOf(toCoinType(PRIVATE))).toBeNull();
  });

  it('شناسه، وزن میکروگرم و عیار بی‌تغییر منتقل می‌شوند — هر نوع بُعد مستقل خودش', () => {
    const coin = toCoinType(MINTED);
    expect(coin).toMatchObject({ kind: 'coin', id: MINTED.coinTypeId, karat: MINTED.karat });
    expect(coin.grossWeightUg).toBe(BigInt(MINTED.grossWeightUg));
    expect(toCoinType(PRIVATE).id).not.toBe(coin.id);
  });
});

describe('وزن سکه — فقط نمایش، بدون گرد کردن (FE-105)', () => {
  it('میکروگرم دقیق؛ سه یا شش رقم بسته به دقت', () => {
    expect(formatCoinWeightUg(8_133_000n)).toBe('۸٫۱۳۳');
    expect(formatCoinWeightUg(4_066_500n)).toBe('۴٫۰۶۶۵۰۰');
  });

  it('وزن چند سکه ضرب دقیق است، نه تقسیم صحیح که بی‌صدا گرد کند', () => {
    // ۳ نیم سکه = ۱۲٫۱۹۹۵ گرم؛ `÷ 1000n` ِ قبلی ۱۲٫۱۹۹ نشان می‌داد
    expect(formatCoinsGrossWeight(3n, { grossWeightUg: '4066500' })).toBe('۱۲٫۱۹۹۵۰۰');
    expect(formatCoinsGrossWeight(2n, { grossWeightUg: '8133000' })).toBe('۱۶٫۲۶۶');
  });
});
