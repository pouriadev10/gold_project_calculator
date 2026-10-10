import type { LedgerProfitReport } from '@/api/contracts';
import type { MoneyUnit } from '@/stores/unit-store';

/**
 * توابع خالص گزارش سود — FE-075، روی `GET /reporting/profit` (BE-060).
 *
 * فرانت هیچ عددی را دوباره حساب نمی‌کند: هر سطر یک فیلد پاسخ سرور است و
 * هر فیلد هر دو چهره را دارد — `rial` و `goldEquivalentMg` که سرور برای
 * **هر رویداد با مظنه‌ی قفل‌شده‌ی همان رویداد** تبدیل کرده است. کلید واحد
 * فقط چهره را انتخاب می‌کند؛ هیچ تبدیلی با مظنه‌ی امروز انجام نمی‌شود.
 */

export type ProfitMeasureKey = Exclude<keyof LedgerProfitReport, 'from' | 'to'>;
export type ProfitMeasure = LedgerProfitReport[ProfitMeasureKey];

export interface ProfitRow {
  readonly key: ProfitMeasureKey;
  readonly label: string;
  /** رابطه‌ای که سرور با آن این سطر را ساخته، برای فهم breakdown. */
  readonly description: string;
  /** سود/زیان یا اثر — علامت معنا دارد و منفی یعنی کاهش سود. */
  readonly signed: boolean;
  /** سطرهای جمع — با خط جداکننده و وزن بیشتر. */
  readonly subtotal: boolean;
}

/**
 * ترتیب و روابط دقیقاً همان `ProfitReportService.getProfit`:
 *   سود ناخالص  = درآمد − بهای تمام‌شده
 *   سود عملیاتی = سود ناخالص − اثر حباب سکه
 *   سود کل      = سود ناخالص + اثر نوسان طلا
 */
export const PROFIT_ROWS: readonly ProfitRow[] = [
  {
    key: 'revenue',
    label: 'درآمد',
    description: 'مبلغ نهایی فاکتورهای فروش در این بازه.',
    signed: false,
    subtotal: false,
  },
  {
    key: 'costOfGoods',
    label: 'بهای تمام‌شده',
    description: 'ارزش طلای خالص زیورآلات و ارزش ذاتی سکه‌های فروخته‌شده، با مظنه‌ی همان فاکتور.',
    signed: false,
    subtotal: false,
  },
  {
    key: 'grossProfit',
    label: 'سود ناخالص',
    description: 'درآمد منهای بهای تمام‌شده.',
    signed: true,
    subtotal: true,
  },
  {
    key: 'coinBubbleEffect',
    label: 'اثر حباب سکه',
    description: 'بخشی از سود ناخالص که از حباب بازار سکه آمده؛ فقط سکه‌های ضرب بانک مرکزی حباب دارند.',
    signed: true,
    subtotal: false,
  },
  {
    key: 'operatingProfit',
    label: 'سود عملیاتی',
    description: 'سود ناخالص منهای اثر حباب سکه — حاصل اجرت و حاشیه‌ی فروش.',
    signed: true,
    subtotal: true,
  },
  {
    key: 'goldPriceEffect',
    label: 'اثر نوسان طلا',
    description: 'اثر تغییر مظنه روی خرید دست‌دوم کالاهای فروخته‌شده؛ مظنه‌ی بالاتر هنگام خرید یعنی اثر منفی.',
    signed: true,
    subtotal: false,
  },
  {
    key: 'totalProfit',
    label: 'سود کل',
    description: 'سود ناخالص به‌علاوه‌ی اثر نوسان طلا.',
    signed: true,
    subtotal: true,
  },
];

/** چهره‌ی خواسته‌شده‌ی یک سنجه — بدون هیچ تبدیل. */
export function measureFace(measure: ProfitMeasure, unit: MoneyUnit): bigint {
  return BigInt(unit === 'gold' ? measure.goldEquivalentMg : measure.rial);
}

/** بازه‌ای که هیچ فروش یا خرید دست‌دوم مرتبطی ندارد. */
export function isEmptyProfitReport(report: LedgerProfitReport): boolean {
  return PROFIT_ROWS.every(
    ({ key }) => BigInt(report[key].rial) === 0n && BigInt(report[key].goldEquivalentMg) === 0n,
  );
}
