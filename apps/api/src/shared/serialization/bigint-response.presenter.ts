/**
 * خروجی DTO را پیش از رسیدن به serializer فریم‌ورک به JSON-safe تبدیل می‌کند.
 *
 * این یک interceptor سراسری نیست: هر controller باید در presenter خودش آن را
 * فرا بخواند و DTO خروجی هم صریحاً `string` (مثل `RialString`) اعلام شود. پس
 * تبدیل bigint فقط روی مرز API و با قرارداد مشخص اتفاق می‌افتد، نه به‌صورت
 * مبهم روی همه‌ی داده‌های برنامه.
 */

export type BigIntSerialized<T> = T extends bigint
  ? string
  : T extends Date
    ? Date
    : T extends readonly (infer Item)[]
      ? BigIntSerialized<Item>[]
      : T extends object
        ? { [Key in keyof T]: BigIntSerialized<T[Key]> }
        : T;

export class BigIntResponseSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BigIntResponseSerializationError';
  }
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/**
 * همه‌ی bigintهای یک DTO ساده را به رشته‌ی دهدهی دقیق تبدیل می‌کند.
 *
 * Date عمداً دست‌نخورده می‌ماند تا serializer HTTP آن را مطابق قرارداد معمول
 * JSON به ISO string تبدیل کند. Set، Map و instanceهای سفارشی DTO معتبر نیستند
 * و خطای روشن می‌گیرند؛ تبدیل مخفی آن‌ها می‌تواند پاسخ API را ناقص کند.
 */
export function presentBigIntResponse<T>(value: T): BigIntSerialized<T> {
  return present(value, new WeakSet<object>()) as BigIntSerialized<T>;
}

function present(value: unknown, ancestors: WeakSet<object>): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (ancestors.has(value)) {
    throw new BigIntResponseSerializationError('DTO پاسخ API نمی‌تواند حلقوی باشد');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => present(item, ancestors));
    }
    if (!isPlainRecord(value)) {
      throw new BigIntResponseSerializationError(
        'DTO پاسخ API باید object ساده، array، Date یا مقدار ابتدایی باشد',
      );
    }

    const serialized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      serialized[key] = present(item, ancestors);
    }
    return serialized;
  } finally {
    ancestors.delete(value);
  }
}
