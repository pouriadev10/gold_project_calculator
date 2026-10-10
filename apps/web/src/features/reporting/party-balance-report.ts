import { dualFromPure, dualFromRial } from '@gold/core-calc';
import type { DualAmount } from '@gold/core-calc';
import type { PartyBalanceReport } from '@/api/contracts';

/**
 * توابع خالص فهرست بدهکاران/بستانکاران — FE-072 (بدهکاران).
 */

export type PartyBalanceReportItem = PartyBalanceReport['items'][number];
export type ConvertibleDirection = PartyBalanceReportItem['convertibleDirection'];

export const CONVERTIBLE_DIRECTION_LABEL: Record<ConvertibleDirection, string> = {
  DEBTOR: 'بدهکار',
  CREDITOR: 'بستانکار',
  SETTLED: 'تسویه',
};

/**
 * مانده‌ی قابل‌تبدیل (ریال + طلای خالص) به هر دو چهره، با مظنه‌ی مرجع خود
 * گزارش. فرمول دقیقاً همان `toSortableReportItem` سرور است:
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

/** آیا شخص فقط به‌خاطر موقعیت سکه‌ای در این فهرست آمده است؟ */
export function listedByCoinOnly(item: PartyBalanceReportItem, direction: 'DEBTOR'): boolean {
  return item.convertibleDirection !== direction;
}
