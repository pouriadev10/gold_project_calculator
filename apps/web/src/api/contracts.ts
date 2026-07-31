import { z } from 'zod';

/**
 * قرارداد API — منبع واحد حقیقت میان فرانت‌اند و بک‌اند.
 *
 * این فایل بعداً **عیناً با بک‌اند به اشتراک گذاشته می‌شود** (به
 * `packages/` منتقل می‌شود). تا آن روز، MSW همین اسکیماها را برمی‌گرداند،
 * پس هر صفحه‌ای که امروز نوشته می‌شود فردا بدون تغییر به سرور واقعی وصل می‌شود.
 *
 * ## قاعده‌ی طلایی این فایل
 *
 * **هیچ مقدار پولی یا وزنی روی سیم `number` نیست.** همه رشته‌ی ارقام‌اند.
 * `number` جاوااسکریپت بالای ۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۱ دقت را از دست می‌دهد و
 * مانده‌ی ریالی یک مغازه‌ی طلا به‌راحتی از آن رد می‌شود. `bigint` هم در
 * JSON سریالایز نمی‌شود. پس قرارداد رشته است، و تبدیل در همین مرز انجام می‌گیرد.
 */

/** رشته‌ی ارقام صحیح روی سیم → `bigint` در برنامه. */
const bigintString = z
  .string()
  .regex(/^-?\d+$/u, 'مقدار باید رشته‌ی ارقام صحیح باشد')
  .transform((value) => BigInt(value));

/** عیار — عدد صحیح کوچک، پس `number` اینجا بی‌خطر است. */
const karatNumber = z.number().int().min(1).max(1000);

const isoDate = z.string().datetime({ offset: true });

/* ── مبلغ دومقیاسه ─────────────────────────────────────────── */

export const dualAmountSchema = z.object({
  rial: bigintString,
  pureMg: bigintString,
  /** مظنه‌ی قفل‌شده در لحظه‌ی رویداد — قاعده‌ی ۲-۸ CLAUDE.md */
  rate1000: bigintString,
});
export type DualAmountDto = z.infer<typeof dualAmountSchema>;

/* ── GET /api/rates/current ────────────────────────────────── */

export const gramRateSchema = z.object({
  karat: karatNumber,
  rateRial: bigintString,
});

export const coinRateSchema = z.object({
  id: z.string(),
  label: z.string(),
  grossMg: bigintString,
  karat: karatNumber,
  marketPriceRial: bigintString,
});

export const currentRatesSchema = z.object({
  /** مظنه‌ی مثقال طلای آبشده */
  maznehRial: bigintString,
  /** زمان دریافت — همیشه نمایش داده می‌شود، هرگز وانمود نکن به‌روز است */
  fetchedAt: isoDate,
  gramRates: z.array(gramRateSchema),
  coins: z.array(coinRateSchema),
});
export type CurrentRates = z.infer<typeof currentRatesSchema>;

/* ── GET /api/parties ──────────────────────────────────────── */

/**
 * نوع طرف حساب — سیستم بر اساس همین، حالت مرجوعی را خودکار انتخاب می‌کند
 * (قاعده‌ی ۲-۵ CLAUDE.md: B2B برگشت است، B2C خرید دست‌دوم).
 */
export const partyKindSchema = z.enum(['consumer', 'colleague']);
export type PartyKind = z.infer<typeof partyKindSchema>;

export const partySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: partyKindSchema,
  /** کد ملی عمداً اختیاری است — بخش ۵ CLAUDE.md */
  nationalId: z.string().nullable(),
  phone: z.string().nullable(),
  balance: dualAmountSchema,
});
export type Party = z.infer<typeof partySchema>;

export const partyListSchema = z.object({
  items: z.array(partySchema),
  total: z.number().int().nonnegative(),
});

export const partyBalanceSummarySchema = z.object({
  credit: dualAmountSchema,
  debit: dualAmountSchema,
  net: dualAmountSchema,
  creditPartyCount: z.number().int().nonnegative(),
  debitPartyCount: z.number().int().nonnegative(),
});
export type PartyBalanceSummary = z.infer<typeof partyBalanceSummarySchema>;

/* ── GET /api/items ────────────────────────────────────────── */

/** مصنوع · آبشده · سکه — سکه هرگز به وزن تبدیل نمی‌شود */
export const itemKindSchema = z.enum(['article', 'melted', 'coin']);
export type ItemKind = z.infer<typeof itemKindSchema>;

export const itemSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  kind: itemKindSchema,
  karat: karatNumber.nullable(),
  /** وزن ناخالص — برای سکه `null` است، چون سکه شمارشی است نه وزنی */
  grossMg: bigintString.nullable(),
  /** موجودی: برای سکه تعداد، برای بقیه میلی‌گرم */
  stockCount: z.number().int().nullable(),
  stockMg: bigintString.nullable(),
});
export type Item = z.infer<typeof itemSchema>;

export const itemListSchema = z.object({
  items: z.array(itemSchema),
  total: z.number().int().nonnegative(),
});

/* ── GET /api/reports/profit ───────────────────────────────── */

export const profitPeriodSchema = z.enum(['today', 'month']);
export type ProfitPeriod = z.infer<typeof profitPeriodSchema>;

export const profitReportSchema = z.object({
  period: profitPeriodSchema,
  /** اجرت و حاشیه‌ی فروش */
  operational: dualAmountSchema,
  /** تغییر قیمت طلا روی موجودی — این مهارت نیست، بازار است */
  fluctuation: dualAmountSchema,
  /** فقط سکه‌ی ضرب بانک مرکزی حباب دارد */
  coinBubble: dualAmountSchema,
  total: dualAmountSchema,
  /** درصد در مقیاس ۱۰ — یک رقم اعشار، بدون شناور */
  percentX10: bigintString,
});
export type ProfitReport = z.infer<typeof profitReportSchema>;

/* ── GET /api/transactions/recent ──────────────────────────── */

export const transactionKindSchema = z.enum(['sale', 'purchase', 'second-hand', 'coin-sale']);
export type TransactionKind = z.infer<typeof transactionKindSchema>;

export const transactionSchema = z.object({
  id: z.string(),
  partyName: z.string(),
  kind: transactionKindSchema,
  title: z.string(),
  amount: dualAmountSchema,
  occurredAt: isoDate,
});
export type Transaction = z.infer<typeof transactionSchema>;

export const transactionListSchema = z.object({
  items: z.array(transactionSchema),
});

/* ── POST /api/invoices ────────────────────────────────────── */

export const invoiceLineInputSchema = z.object({
  itemId: z.string(),
  /** برای سکه تعداد، برای بقیه `null` */
  count: z.number().int().positive().nullable(),
  /** برای مصنوع و آبشده میلی‌گرم، برای سکه `null` */
  grossMg: bigintString.nullable(),
  karat: karatNumber.nullable(),
  wageRial: bigintString,
});

export const createInvoiceInputSchema = z.object({
  partyId: z.string(),
  lines: z.array(invoiceLineInputSchema).min(1),
  /** مظنه‌ی لحظه‌ی ثبت — سند نرخ خودش را حمل می‌کند */
  maznehRial: bigintString,
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceInputSchema>;

export const createInvoiceResultSchema = z.object({
  id: z.string(),
  /** شماره‌ی بدون شکاف — بخش ۵ CLAUDE.md */
  number: z.string(),
  total: dualAmountSchema,
  createdAt: isoDate,
});
export type CreateInvoiceResult = z.infer<typeof createInvoiceResultSchema>;

/* ── خطا ───────────────────────────────────────────────────── */

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
