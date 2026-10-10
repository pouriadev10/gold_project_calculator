import { dualFromPure, dualFromRial } from '@gold/core-calc';
import type { DualAmount } from '@gold/core-calc';
import type { Dashboard } from '@/api/contracts';

/**
 * توابع خالص داشبورد اصلی — FE-074، روی `GET /reporting/dashboard` (BE-059).
 */

type FinancialCard = Dashboard['today']['sales'];

/**
 * مبلغ دومقیاسه‌ی یک کارت مالی با مظنه‌ی جاری خود پاسخ. فرمول همان
 * `toFinancialCard` سرور است:
 *   طلا = طلای خالص + معادل طلایی ریال
 *   ریال = ریال + معادل ریالی طلای خالص
 * چهره‌ای که سرور در `displayAmount` فرستاده مستقیم از همان خوانده می‌شود؛
 * فقط چهره‌ی دیگر این‌جا ساخته می‌شود تا کلید واحد بدون درخواست تازه کار
 * کند. بدون مظنه‌ی جاری `null` است — معادل ساختگی صفر ساخته نمی‌شود.
 */
export function dashboardAmount(
  card: FinancialCard,
  dashboard: Pick<Dashboard, 'displayUnit' | 'currentMazneh'>,
): DualAmount | null {
  if (dashboard.currentMazneh === null || card.displayAmount === null) return null;
  const rate1000 = BigInt(dashboard.currentMazneh.goldRatePerGramRial);
  if (rate1000 <= 0n) return null;
  const rial = BigInt(card.raw.rial);
  const pureGoldMg = BigInt(card.raw.pureGoldMg);
  const display = BigInt(card.displayAmount);

  return {
    rial: dashboard.displayUnit === 'RIAL' ? display : rial + dualFromPure(pureGoldMg, rate1000).rial,
    pureMg:
      dashboard.displayUnit === 'GOLD' ? display : pureGoldMg + dualFromRial(rial, rate1000).pureMg,
    rate1000,
  };
}

/** اندازه‌ی هر دو چهره؛ جهت (بدهکار/بستانکار) را برچسب کارت می‌گوید، نه علامت. */
export function magnitudeOf(amount: DualAmount): DualAmount {
  return {
    rial: amount.rial < 0n ? -amount.rial : amount.rial,
    pureMg: amount.pureMg < 0n ? -amount.pureMg : amount.pureMg,
    rate1000: amount.rate1000,
  };
}
