/**
 * انواع پایه‌ی دامنه.
 *
 * قاعده‌ی ۱ BOOTSTRAP: هیچ‌جا `number` شناور برای پول یا وزن.
 * پول و وزن `bigint` هستند و با برند نوعی از هم تفکیک می‌شوند تا
 * جابه‌جا پاس دادنشان خطای زمان کامپایل بدهد.
 */

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

/** ریال — عدد صحیح، بدون اعشار. */
export type Rial = Brand<bigint, 'Rial'>;

/** وزن ناخالص بر حسب میلی‌گرم. */
export type GrossMg = Brand<bigint, 'GrossMg'>;

/**
 * وزن مشخصات مرجع سکه بر حسب میکروگرم.
 *
 * این واحد فقط برای مشخصات نسخه‌دار coin type است تا وزن‌های رسمیِ دارای
 * نیم‌میلی‌گرم دقیق بمانند؛ مقدار سکه در دفتر کل همچنان `CoinCount` است.
 */
export type GrossUg = Brand<bigint, 'GrossUg'>;

/** وزن طلای خالص ۱۰۰۰ بر حسب میلی‌گرم. */
export type PureMg = Brand<bigint, 'PureMg'>;

/** عیار — عدد صحیح بین ۱ و ۱۰۰۰. */
export type Karat = Brand<number, 'Karat'>;

/** تعداد سکه — عدد صحیح. سکه هرگز به وزن تبدیل نمی‌شود. */
export type CoinCount = Brand<number, 'CoinCount'>;

/**
 * ابعاد دفتر کل چندواحدی.
 * هر نوع سکه یک بُعد شمارشی مستقل است (قاعده‌ی ۲-۲ CLAUDE.md).
 */
export type AssetDimension = 'rial' | 'gold' | 'silver' | `coin:${string}`;

/** خطای دامنه‌ی محاسبات. */
export class CalcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalcError';
  }
}

/** بیشینه‌ی عیار — مبنای نرمال‌سازی وزن خالص. */
export const KARAT_BASE = 1000;

export function rial(value: bigint): Rial {
  return value as Rial;
}

export function grossMg(value: bigint): GrossMg {
  if (value < 0n) throw new CalcError('وزن ناخالص نمی‌تواند منفی باشد');
  return value as GrossMg;
}

export function grossUg(value: bigint): GrossUg {
  if (value < 0n) throw new CalcError('وزن ناخالص میکروگرم نمی‌تواند منفی باشد');
  return value as GrossUg;
}

export function pureMg(value: bigint): PureMg {
  if (value < 0n) throw new CalcError('وزن خالص نمی‌تواند منفی باشد');
  return value as PureMg;
}

export function karat(value: number): Karat {
  if (!Number.isInteger(value) || value < 1 || value > KARAT_BASE) {
    throw new CalcError(`عیار باید عدد صحیح بین ۱ و ${KARAT_BASE} باشد — دریافت شد: ${value}`);
  }
  return value as Karat;
}

export function coinCount(value: number): CoinCount {
  if (!Number.isInteger(value)) {
    throw new CalcError('تعداد سکه باید عدد صحیح باشد');
  }
  return value as CoinCount;
}

/** بُعد دفتر کل برای یک نوع سکه. */
export function coinDimension(coinId: string): AssetDimension {
  return `coin:${coinId}`;
}
