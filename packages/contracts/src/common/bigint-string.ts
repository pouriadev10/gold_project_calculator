import { z } from 'zod';

/**
 * پول و وزن روی سیم **رشته** هستند، نه `number` — قاعده‌ی ۲-۱ فایل CLAUDE.md.
 *
 * `number` جاوااسکریپت بالای ۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۱ دقت را از دست می‌دهد و
 * مانده‌ی ریالی یک مغازه‌ی طلا به‌راحتی از آن رد می‌شود. `bigint` هم در JSON
 * سریالایز نمی‌شود. پس قرارداد رشته است و تبدیل دقیقاً روی همین مرز رخ می‌دهد.
 */

/**
 * فقط **شکل متعارف** پذیرفته می‌شود، نه هر رشته‌ای که `BigInt()` قبولش دارد.
 *
 * یعنی `"007"`، `"+7"`، `"-0"` و `" 12 "` رد می‌شوند، هرچند `BigInt()` سه‌تای
 * اول را می‌پذیرد. دلیلش BE-013 است: هش درخواست برای `Idempotency-Key`
 * روی بایت‌های ورودی محاسبه می‌شود، و اگر دو نوشتار از یک عدد مجاز باشد،
 * یک تراکنش دوبار ثبت‌شده از تور تکرارناپذیری رد می‌شود.
 *
 * ارقام فارسی و عربی (`"۱۲۳"`) هم اینجا نامعتبرند — `[0-9]` فقط ASCII است.
 * نرمال‌سازی وظیفه‌ی لایه‌ی ورودی است (BE-016) و **پیش از** اعتبارسنجی انجام
 * می‌شود، نه داخل این schema؛ وگرنه هر schema باید نرمال‌سازی را تکرار کند.
 */
/**
 * سقف تعداد ارقام هم داخل همین الگوست. یک مرز ایمنی است، نه عدد صنفی:
 * تجزیه‌ی `BigInt` روی رشته‌ی چندهزار رقمی هزینه‌ی فرامتناسب دارد و مسیر
 * ساده‌ای برای DoS است. ۴۰ رقم یعنی تا ۱۰^۳۹ — چند مرتبه بزرگ‌تر از هر
 * مبلغ یا وزنی که این دامنه به خودش می‌بیند.
 */
const CANONICAL_INTEGER = /^(0|-?[1-9][0-9]{0,39})$/;

/** سقف طول رشته: ۴۰ رقم به‌علاوه‌ی علامت. پیش از regex جلوی ورودی غول را می‌گیرد. */
const MAX_LENGTH = 41;

/** رشته‌ی عدد صحیح با علامت — مبنای همه‌ی مقادیر پولی و وزنی. */
export const bigIntStringSchema = z
  .string()
  .max(MAX_LENGTH, 'حداکثر ۴۰ رقم مجاز است')
  .regex(CANONICAL_INTEGER, 'مقدار باید رشته‌ی عدد صحیح باشد، بدون اعشار و صفر ابتدایی');

/** رشته‌ی عدد صحیح صفر یا بزرگ‌تر — وزن، موجودی، مبلغ فاکتور. */
export const nonNegativeBigIntStringSchema = bigIntStringSchema.refine(
  (value) => !value.startsWith('-'),
  'مقدار نمی‌تواند منفی باشد',
);

/** رشته‌ی عدد صحیح اکیداً بزرگ‌تر از صفر — مقادیری که صفر بودنشان بی‌معناست. */
export const positiveBigIntStringSchema = bigIntStringSchema.refine(
  (value) => !value.startsWith('-') && value !== '0',
  'مقدار باید بزرگ‌تر از صفر باشد',
);

export type BigIntString = z.infer<typeof bigIntStringSchema>;
export type NonNegativeBigIntString = z.infer<typeof nonNegativeBigIntStringSchema>;
export type PositiveBigIntString = z.infer<typeof positiveBigIntStringSchema>;

/**
 * نام‌های دامنه‌ای برای همان قرارداد رشته‌ای.
 *
 * اینجا عمداً برند نوعی نمی‌گذاریم: این‌ها نوع **روی سیم** هستند و بلافاصله
 * پس از تجزیه به `bigint`های برنددار `packages/core-calc` (`Rial`، `PureMg`، …)
 * تبدیل می‌شوند. تفکیک واقعی نوع‌ها آنجا اتفاق می‌افتد، نه در DTO.
 */

/** مبلغ ریالی — عدد صحیح، بدون اعشار. */
export type RialString = BigIntString;

/** وزن بر حسب میلی‌گرم. */
export type WeightMgString = BigIntString;

/** وزن مشخصات مرجع سکه بر حسب میکروگرم. */
export type WeightUgString = BigIntString;

/** مقدار یک بُعد دفتر کل. برای سکه تعداد است و برای طلا میلی‌گرم خالص. */
export type QuantityString = BigIntString;
