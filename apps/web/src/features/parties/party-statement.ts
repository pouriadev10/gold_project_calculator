import { gramRate1000, karat, rateDivisorFromMarketSettings, toSafeNumber } from '@gold/core-calc';
import type { PartyStatement, PartyStatementSourceType } from '@/api/contracts';

/**
 * توابع خالص صورت‌حساب شخص — FE-034 (آخرین معاملات) و FE-070 (صورت‌حساب کامل).
 *
 * هیچ‌کدام به I/O وابسته نیستند تا بدون رندر صفحه تست شوند.
 */

export type PartyStatementEntry = PartyStatement['items'][number];
export type PartyStatementDimension = PartyStatementEntry['dimension'];
type RateSnapshot = PartyStatementEntry['documentRateSnapshots'][number];

export const SOURCE_LABEL: Record<PartyStatementSourceType, string> = {
  OPENING_BALANCE: 'مانده افتتاحیه',
  SALES_INVOICE: 'فاکتور فروش',
  SECOND_HAND_PURCHASE: 'خرید دست‌دوم',
  SETTLEMENT: 'تسویه',
  SALES_INVOICE_AMENDMENT: 'اصلاح فاکتور',
  LEDGER_REVERSAL: 'برگشت سند',
};

/**
 * بدهکار/بستانکار — دقیقاً آینه‌ی `directionFor` واقعی
 * (`apps/api/src/modules/reporting/party-balance-report.service.ts`):
 * مثبت یعنی شخص به فروشگاه بدهکار است، منفی یعنی فروشگاه به شخص
 * بستانکار است. برچسب جهت مستقل از واحد انتخابی می‌ماند؛ رنگ‌کردن مبلغ
 * صرفاً بر اساس علامت می‌توانست بدهکار را به‌اشتباه سبز نشان دهد.
 */
export function debtorCreditorLabel(raw: bigint): string {
  if (raw > 0n) return 'بدهکار';
  if (raw < 0n) return 'بستانکار';
  return 'تسویه';
}

/** نام نمایشی بُعد دفترکل؛ هر نوع سکه بُعد جدای خودش است و با کدش نام می‌گیرد. */
export function dimensionLabel(dimension: PartyStatementDimension): string {
  switch (dimension.kind) {
    case 'RIAL':
      return 'ریال';
    case 'GOLD':
      return 'طلای خالص';
    case 'SILVER':
      return 'نقره';
    case 'COIN':
      return `سکه ${dimension.coinCode ?? dimension.code}`;
  }
}

/**
 * فهرست یکتای بُعدها به ترتیب اولین دیده‌شدن. API فهرست جدای بُعد ندارد،
 * پس گزینه‌های فیلتر از خود ردیف‌های صورت‌حساب ساخته می‌شوند.
 */
export function collectDimensions(
  ...groups: ReadonlyArray<ReadonlyArray<PartyStatementDimension | null | undefined>>
): PartyStatementDimension[] {
  const byId = new Map<string, PartyStatementDimension>();
  for (const group of groups) {
    for (const dimension of group) {
      if (dimension && !byId.has(dimension.id)) byId.set(dimension.id, dimension);
    }
  }
  return [...byId.values()];
}

const DIGITS = /^\d+$/u;
const MITHQAL_GRAMS = /^(\d+)\.(\d{4})$/u;

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function digitsOf(value: unknown): bigint | null {
  return typeof value === 'string' && DIGITS.test(value) ? BigInt(value) : null;
}

/**
 * مخرج تبدیل مظنه‌ای که خودِ سند در لحظه‌ی ثبت قفل کرده است.
 *
 * شکل snapshot به نوع سند بستگی دارد: تسویه و خرید دست‌دوم `rateDivisor`
 * را مستقیم دارند؛ فاکتور فروش `settings.baseQuoteKarat` و
 * `settings.mithqalGrams` را. اگر هیچ‌کدام نبود `null` برمی‌گردد — هرگز
 * مخرج پیش‌فرض امروز جایگزین نمی‌شود، چون عدد صنفی نسخه‌دار است (۲-۶).
 */
function lockedDivisor(pricingSnapshot: unknown): bigint | null {
  const root = recordOf(pricingSnapshot);
  if (root === null) return null;

  for (const candidate of [root, recordOf(root['settings'])]) {
    if (candidate === null) continue;
    const divisor = digitsOf(candidate['rateDivisor']);
    if (divisor !== null && divisor > 0n) return divisor;

    const baseKarat = digitsOf(candidate['baseQuoteKarat']);
    const mithqal =
      typeof candidate['mithqalGrams'] === 'string'
        ? MITHQAL_GRAMS.exec(candidate['mithqalGrams'])
        : null;
    if (baseKarat !== null && baseKarat >= 1n && baseKarat <= 1000n && mithqal) {
      const mithqalX10k = BigInt(`${mithqal[1]}${mithqal[2]}`);
      if (mithqalX10k > 0n) {
        return rateDivisorFromMarketSettings(karat(toSafeNumber(baseKarat)), mithqalX10k);
      }
    }
  }
  return null;
}

function snapshotRate1000(snapshot: RateSnapshot): bigint | null {
  const mazneh = digitsOf(snapshot.quoteAmountRial);
  if (mazneh === null || mazneh <= 0n) return null;
  const divisor = lockedDivisor(snapshot.pricingSnapshot);
  if (divisor === null) return null;
  const rate = gramRate1000(mazneh, divisor);
  return rate > 0n ? rate : null;
}

export interface LockedStatementRate {
  /** نرخ گرم طلای ۱۰۰۰ همان سند. */
  readonly rate1000: bigint;
  /** مظنه‌ی قفل‌شده — برای نمایش با `RateDisplay`. */
  readonly maznehRial: bigint;
  readonly observedAt: string | null;
}

/**
 * نرخ قفل‌شده‌ی یک ردیف صورت‌حساب (قاعده‌ی ۲-۸): فقط از snapshot خودِ
 * سند، نه از مظنه‌ی امروز. اگر سند snapshot قابل‌استفاده ندارد (مانده
 * افتتاحیه، برگشت سند) یا چند snapshot ناهم‌نرخ دارد، `null` — آن ردیف
 * فقط مقدار خام را نشان می‌دهد، نه یک معادل حدسی.
 */
export function lockedStatementRate(entry: PartyStatementEntry): LockedStatementRate | null {
  let found: LockedStatementRate | null = null;
  for (const snapshot of entry.documentRateSnapshots) {
    const rate1000 = snapshotRate1000(snapshot);
    if (rate1000 === null) continue;
    if (found !== null && found.rate1000 !== rate1000) return null;
    found ??= {
      rate1000,
      maznehRial: BigInt(snapshot.quoteAmountRial ?? '0'),
      observedAt: snapshot.quoteObservedAt,
    };
  }
  return found;
}

/** فقط ریال و طلای خالص با مظنه معادل دارند؛ سکه و نقره هرگز با مظنه طلا تبدیل نمی‌شوند. */
export function convertibleUnit(dimension: PartyStatementDimension): 'rial' | 'gold' | null {
  if (dimension.kind === 'RIAL') return 'rial';
  if (dimension.kind === 'GOLD') return 'gold';
  return null;
}
