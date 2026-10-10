import { dualFromPure, dualFromRial } from '@gold/core-calc';
import type { DualAmount } from '@gold/core-calc';
import type { PartyBalanceReport, PartyBalanceReportQuery, PartyReportDirection } from '@/api/contracts';

/**
 * توابع خالص و متن‌های فهرست بدهکاران (FE-072) و بستانکاران (FE-073).
 *
 * قرارداد علامت سرور (`directionFor` در `party-balance-report.service.ts`):
 * مثبت = شخص به فروشگاه بدهکار، منفی = فروشگاه به شخص بدهکار (شخص
 * بستانکار). در نمایش هیچ علامت منفی‌ای معنا حمل نمی‌کند: هر مبلغ با
 * **اندازه** و یک برچسب جهت صریح نشان داده می‌شود، تا «−۵ گرم» در فهرست
 * بستانکاران با بدهی اشتباه گرفته نشود.
 */

export type PartyBalanceReportItem = PartyBalanceReport['items'][number];
export type ConvertibleDirection = PartyBalanceReportItem['convertibleDirection'];

export const CONVERTIBLE_DIRECTION_LABEL: Record<ConvertibleDirection, string> = {
  DEBTOR: 'بدهکار',
  CREDITOR: 'بستانکار',
  SETTLED: 'تسویه',
};

export interface ReportCopy {
  readonly title: string;
  /** اسم شمارش در «۱۲ بدهکار». */
  readonly countNoun: string;
  /** یک جمله که جهت را بی‌ابهام می‌گوید. */
  readonly meaning: string;
  readonly sort: Record<PartyBalanceReportQuery['sortDirection'], string>;
  readonly coinOnlyNote: string;
  readonly emptyTitle: string;
  readonly emptyIdle: string;
  readonly emptySearch: string;
  readonly loadError: string;
  readonly mismatch: string;
  readonly loading: string;
  readonly pagination: string;
  readonly noMazneh: string;
}

export const REPORT_COPY: Record<PartyReportDirection, ReportCopy> = {
  DEBTOR: {
    title: 'بدهکاران',
    countNoun: 'بدهکار',
    meaning: 'بدهکار یعنی این شخص به فروشگاه بدهکار است.',
    sort: { DESC: 'بیشترین بدهی', ASC: 'کمترین بدهی' },
    coinOnlyNote: 'به‌خاطر سکه‌ی بدهکار در فهرست است',
    emptyTitle: 'بدهکاری پیدا نشد',
    emptyIdle: 'در حال حاضر هیچ شخصی به فروشگاه بدهکار نیست.',
    emptySearch: 'با این جست‌وجو بدهکاری وجود ندارد.',
    loadError: 'دریافت فهرست بدهکاران ناموفق بود.',
    mismatch: 'پاسخ دریافتی فهرست بدهکاران نیست.',
    loading: 'در حال دریافت بدهکاران',
    pagination: 'صفحه‌بندی بدهکاران',
    noMazneh: 'فهرست بدهکاران ریال و طلا را با مظنه مرجع مقایسه می‌کند؛ ابتدا یک مظنه ثبت کنید.',
  },
  CREDITOR: {
    title: 'بستانکاران',
    countNoun: 'بستانکار',
    meaning: 'بستانکار یعنی فروشگاه به این شخص بدهکار است.',
    sort: { DESC: 'بیشترین طلب', ASC: 'کمترین طلب' },
    coinOnlyNote: 'به‌خاطر سکه‌ی بستانکار در فهرست است',
    emptyTitle: 'بستانکاری پیدا نشد',
    emptyIdle: 'در حال حاضر فروشگاه به هیچ شخصی بدهکار نیست.',
    emptySearch: 'با این جست‌وجو بستانکاری وجود ندارد.',
    loadError: 'دریافت فهرست بستانکاران ناموفق بود.',
    mismatch: 'پاسخ دریافتی فهرست بستانکاران نیست.',
    loading: 'در حال دریافت بستانکاران',
    pagination: 'صفحه‌بندی بستانکاران',
    noMazneh: 'فهرست بستانکاران ریال و طلا را با مظنه مرجع مقایسه می‌کند؛ ابتدا یک مظنه ثبت کنید.',
  },
};

/**
 * مانده‌ی قابل‌تبدیل (ریال + طلای خالص) به هر دو چهره، علامت‌دار، با مظنه‌ی
 * مرجع خود گزارش. فرمول دقیقاً همان `toSortableReportItem` سرور است:
 *   طلا = طلای خالص + معادل طلایی ریال
 *   ریال = ریال + معادل ریالی طلای خالص
 * چهره‌ای که سرور در `displayBalance` فرستاده مستقیم از همان خوانده می‌شود؛
 * فقط چهره‌ی دیگر این‌جا ساخته می‌شود تا کلید واحد بدون درخواست تازه کار کند.
 * سکه‌ها عمداً بیرون از این جمع‌اند.
 */
export function convertibleBalance(
  item: PartyBalanceReportItem,
  report: Pick<PartyBalanceReport, 'displayUnit' | 'referenceMazneh'>,
): DualAmount {
  const rate1000 = BigInt(report.referenceMazneh.goldRatePerGramRial);
  const rial = BigInt(item.rawBalances.rial);
  const pureGoldMg = BigInt(item.rawBalances.pureGoldMg);
  const display = BigInt(item.displayBalance);

  return {
    rial: report.displayUnit === 'RIAL' ? display : rial + dualFromPure(pureGoldMg, rate1000).rial,
    pureMg:
      report.displayUnit === 'GOLD' ? display : pureGoldMg + dualFromRial(rial, rate1000).pureMg,
    rate1000,
  };
}

export function magnitude(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** اندازه‌ی هر دو چهره؛ جهت جداگانه با برچسب گفته می‌شود. */
export function magnitudeDual(amount: DualAmount): DualAmount {
  return { rial: magnitude(amount.rial), pureMg: magnitude(amount.pureMg), rate1000: amount.rate1000 };
}

/** آیا شخص فقط به‌خاطر موقعیت سکه‌ای در این فهرست آمده است؟ */
export function listedByCoinOnly(item: PartyBalanceReportItem, direction: PartyReportDirection): boolean {
  return item.convertibleDirection !== direction;
}
