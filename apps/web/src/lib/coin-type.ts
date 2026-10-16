import {
  formatGram,
  formatScaled,
  grossUg,
  karat as toKarat,
  type CoinType,
} from '@gold/core-calc';
import type { CoinTypeVersion } from '@/api/contracts';

/**
 * قانون سکه در فرانت — FE-105، بخش‌های ۲-۲ و ۲-۳ CLAUDE.md.
 *
 * `bubble()` در `core-calc` فقط `CentralBankMintedCoinType` می‌پذیرد؛ این امضا تنها ضامن قانون
 * حباب است، به شرطی که نسخه‌ی کاتالوگ درست به یکی از دو شکل نگاشت شود. پیش از این همین نگاشت
 * در چهار صفحه (فروش سکه، خرید سکه، تسویه با سکه، موجودی سکه) جداگانه کپی شده بود — یک کپی که
 * `isCentralBankMinted` را ثابت `true` بگذارد، برای سکه‌ی خصوصی حباب می‌ساخت. حالا یک نگاشت، با
 * آزمون، و پرچم فقط از خود نسخه می‌آید (که قرارداد آن را از `mintType` مشتق کرده است).
 */
export function toCoinType(version: CoinTypeVersion): CoinType {
  const shared = {
    kind: 'coin' as const,
    id: version.coinTypeId,
    label: version.title,
    grossWeightUg: grossUg(BigInt(version.grossWeightUg)),
    karat: toKarat(version.karat),
  };
  return version.isCentralBankMinted
    ? { ...shared, isCentralBankMinted: true }
    : { ...shared, isCentralBankMinted: false };
}

/**
 * میکروگرم → گرم؛ اگر دقیقاً به میلی‌گرم برسد سه رقم، وگرنه شش رقم. **بدون هیچ گرد کردنی** —
 * تقسیم فقط وقتی انجام می‌شود که باقی‌مانده صفر باشد.
 */
export function formatCoinWeightUg(ug: bigint): string {
  return ug % 1000n === 0n ? formatGram(ug / 1000n) : formatScaled(ug, 6);
}

/**
 * وزن ناخالص چند سکه از یک نوع — **فقط نمای گزارشی** (بخش ۲-۲). هرگز ذخیره یا ارسال نمی‌شود و
 * مبنای هیچ ارزش‌گذاری نیست؛ ارزش سکه همیشه تعداد × قیمت هر سکه است. ضرب میکروگرم در تعداد دقیق
 * می‌ماند (پیش از این `÷ 1000n` ِ صحیح وزن را بی‌صدا به پایین گرد می‌کرد — بیرون از `rounding.ts`).
 */
export function formatCoinsGrossWeight(
  count: bigint,
  version: Pick<CoinTypeVersion, 'grossWeightUg'>,
): string {
  return formatCoinWeightUg(count * BigInt(version.grossWeightUg));
}
