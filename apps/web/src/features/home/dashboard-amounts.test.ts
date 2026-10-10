import { dualFromPure, dualFromRial } from '@gold/core-calc';
import { describe, expect, it } from 'vitest';
import { dashboardSchema } from '@/api/contracts';
import { dashboardFor } from '@/mocks/handlers/fixtures';
import { dashboardAmount, magnitudeOf } from './dashboard-amounts';

/** FE-074 — توابع خالص داشبورد اصلی. */

const RATE = 4_800_000n;
const MAZNEH = {
  id: 'c1000000-0000-4000-8000-000000000001',
  amountRial: '480000000',
  observedAt: '2026-10-10T08:00:00.000Z',
  goldRatePerGramRial: RATE.toString(),
};

describe('dashboardAmount', () => {
  it('چهره‌ی طلایی را از displayAmount سرور و چهره‌ی ریالی را با فرمول سرور می‌سازد', () => {
    const raw = { rial: '12000000', pureGoldMg: '2500' };
    const serverGold = 2500n + dualFromRial(12_000_000n, RATE).pureMg;
    expect(
      dashboardAmount(
        { raw, displayAmount: serverGold.toString() },
        { displayUnit: 'GOLD', currentMazneh: MAZNEH },
      ),
    ).toEqual({ rial: 12_000_000n + dualFromPure(2500n, RATE).rial, pureMg: serverGold, rate1000: RATE });
  });

  it('برای پاسخ ریالی، چهره‌ی ریالی همان displayAmount است', () => {
    const raw = { rial: '-3000000', pureGoldMg: '0' };
    expect(
      dashboardAmount({ raw, displayAmount: '-3000000' }, { displayUnit: 'RIAL', currentMazneh: MAZNEH }),
    ).toEqual({ rial: -3_000_000n, pureMg: dualFromRial(-3_000_000n, RATE).pureMg, rate1000: RATE });
  });

  it('بدون مظنه یا نرخ نامعتبر معادل نمی‌سازد', () => {
    const card = { raw: { rial: '1', pureGoldMg: '0' }, displayAmount: null };
    expect(dashboardAmount(card, { displayUnit: 'GOLD', currentMazneh: null })).toBeNull();
    expect(
      dashboardAmount(
        { ...card, displayAmount: '1' },
        { displayUnit: 'GOLD', currentMazneh: { ...MAZNEH, goldRatePerGramRial: '0' } },
      ),
    ).toBeNull();
    expect(dashboardAmount(card, { displayUnit: 'GOLD', currentMazneh: MAZNEH })).toBeNull();
  });

  it('اندازه را بدون علامت می‌دهد', () => {
    expect(magnitudeOf({ rial: -10n, pureMg: -2n, rate1000: RATE })).toEqual({ rial: 10n, pureMg: 2n, rate1000: RATE });
    expect(magnitudeOf({ rial: 10n, pureMg: 2n, rate1000: RATE })).toEqual({ rial: 10n, pureMg: 2n, rate1000: RATE });
  });
});

describe('mock MSW داشبورد', () => {
  it('با قرارداد واقعی BE-059 سازگار است و معنای علامت سرور را دارد', () => {
    const dashboard = dashboardFor('GOLD');
    expect(dashboardSchema.parse(dashboard)).toEqual(dashboard);
    // جریان‌های امروز فقط ریالی‌اند.
    expect(dashboard.today.sales.raw.pureGoldMg).toBe('0');
    // جمع بدهکاران مثبت و جمع بستانکاران منفی است.
    expect(BigInt(dashboard.partyBalances.debtors.displayAmount)).toBeGreaterThan(0n);
    expect(BigInt(dashboard.partyBalances.creditors.displayAmount)).toBeLessThan(0n);
  });
});
