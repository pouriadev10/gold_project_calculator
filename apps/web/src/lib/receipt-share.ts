import { formatCoinCount, formatCount, formatGram, formatRial } from '@gold/core-calc';
import { isolateBidi } from './bidi';
import { formatJalaliDateTime } from '@/lib/date';

/**
 * متن کوتاه اشتراک رسید — FE-079.
 *
 * متن برای پیام‌رسان (واتساپ، تلگرام، پیامک) است: چند خط، فقط آنچه مشتری
 * لازم دارد. **هیچ URL ای در متن نیست** — صفحه‌های برنامه پشت ورود و
 * مستأجرند و لینک آن‌ها یا کار نمی‌کند یا مسیر خصوصی را لو می‌دهد. برای
 * اطمینان، هر چیزی شبیه URL که از ورودی (مثلاً نام فروشگاه یا مشتری) برسد
 * هم حذف می‌شود. کد ملی و موبایل مشتری هرگز در متن نمی‌آیند.
 */

export interface ReceiptShareContent {
  readonly title: string;
  readonly text: string;
}

const URL_LIKE = /(?:https?:\/\/|www\.)\S+/giu;
const MAX_TEXT_LENGTH = 600;

export function stripUrls(value: string): string {
  return value.replace(URL_LIKE, '').replace(/[ \t]{2,}/gu, ' ').trim();
}

function build(title: string, lines: readonly (string | null)[]): ReceiptShareContent {
  const cleanTitle = stripUrls(title);
  const text = [cleanTitle, ...lines]
    .filter((line): line is string => line !== null)
    .map(stripUrls)
    .filter((line) => line.length > 0)
    .join('\n');
  return { title: cleanTitle, text: text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH - 1)}…` : text };
}

function rial(value: bigint): string {
  return `${formatRial(value)} ریال`;
}

export interface SaleReceiptShareInput {
  readonly shopName: string | null;
  readonly invoiceNumber: number;
  readonly issuedAt: Date;
  readonly customerName: string | null;
  readonly payableRial: bigint | null;
  readonly paidRial: bigint | null;
  readonly receivableRial: bigint | null;
  readonly pureWeightMg: bigint | null;
}

export function saleReceiptShareText(input: SaleReceiptShareInput): ReceiptShareContent {
  const title = `رسید فروش ${isolateBidi(stripUrls(input.shopName ?? ''))}`.trim();
  return build(title, [
    `فاکتور شماره ${formatCount(input.invoiceNumber)}`,
    `تاریخ: ${formatJalaliDateTime(input.issuedAt)}`,
    input.customerName ? `مشتری: ${isolateBidi(stripUrls(input.customerName))}` : null,
    input.pureWeightMg !== null && input.pureWeightMg > 0n ? `وزن خالص: ${formatGram(input.pureWeightMg)} گرم` : null,
    input.payableRial !== null ? `جمع فاکتور: ${rial(input.payableRial)}` : null,
    input.paidRial !== null ? `پرداخت‌شده: ${rial(input.paidRial)}` : null,
    input.receivableRial !== null && input.receivableRial > 0n ? `مانده: ${rial(input.receivableRial)}` : null,
  ]);
}

export interface PurchaseReceiptShareInput {
  readonly shopName: string | null;
  /** «خرید طلای دست‌دوم»، «خرید سکه»، … */
  readonly kindLabel: string;
  readonly purchaseId: string;
  readonly amountRial: bigint;
  readonly paidRial: bigint;
  /** بستانکاری فروشنده نزد فروشگاه. */
  readonly payableRial: bigint;
  readonly pureWeightMg?: bigint;
  readonly coinCount?: number;
}

export function purchaseReceiptShareText(input: PurchaseReceiptShareInput): ReceiptShareContent {
  const title = `رسید ${input.kindLabel} ${isolateBidi(stripUrls(input.shopName ?? ''))}`.trim();
  return build(title, [
    // فقط شناسه‌ی کوتاه برای پیگیری حضوری — نه لینک.
    `شماره سند: ${isolateBidi(input.purchaseId.slice(0, 8))}`,
    input.pureWeightMg !== undefined ? `وزن خالص: ${formatGram(input.pureWeightMg)} گرم` : null,
    input.coinCount !== undefined ? `تعداد: ${formatCoinCount(input.coinCount)} عدد` : null,
    `مبلغ خرید: ${rial(input.amountRial)}`,
    `پرداخت‌شده: ${rial(input.paidRial)}`,
    input.payableRial > 0n ? `مانده طلب فروشنده: ${rial(input.payableRial)}` : null,
  ]);
}
