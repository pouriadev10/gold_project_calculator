import { dualFromPure, dualFromRial } from '@gold/core-calc';
import { describe, expect, it } from 'vitest';
import { partyBalanceReportSchema } from '@/api/contracts';
import { partyBalanceReportFor, partyRecords } from '@/mocks/handlers/fixtures';
import { convertibleBalance, listedByCoinOnly, type PartyBalanceReportItem } from './party-balance-report';

/** FE-072 — توابع خالص فهرست بدهکاران. */

const RATE = 4_800_000n;
const REFERENCE = {
  id: 'c1000000-0000-4000-8000-000000000001',
  amountRial: '480000000',
  observedAt: '2026-10-10T08:00:00.000Z',
  goldRatePerGramRial: RATE.toString(),
};

function item(rial: bigint, pureGoldMg: bigint, displayBalance: bigint): PartyBalanceReportItem {
  return {
    party: {
      id: 'a1000000-0000-4000-8000-000000000001',
      displayName: 'حسین مرادی',
      type: 'CONSUMER',
      status: 'ACTIVE',
      mobile: null,
    },
    rawBalances: { rial: rial.toString(), pureGoldMg: pureGoldMg.toString(), coins: [] },
    displayBalance: displayBalance.toString(),
    convertibleDirection: 'DEBTOR',
    coinsRemainSeparate: true,
  };
}

describe('convertibleBalance', () => {
  it('چهره‌ی طلایی را از displayBalance سرور و چهره‌ی ریالی را با فرمول سرور می‌سازد', () => {
    const rial = 12_000_000n;
    const pure = 2_500n;
    const serverGold = pure + dualFromRial(rial, RATE).pureMg;

    expect(convertibleBalance(item(rial, pure, serverGold), { displayUnit: 'GOLD', referenceMazneh: REFERENCE })).toEqual({
      rial: rial + dualFromPure(pure, RATE).rial,
      pureMg: serverGold,
      rate1000: RATE,
    });
  });

  it('وقتی سرور ریالی فرستاده، چهره‌ی ریالی همان displayBalance است', () => {
    const rial = -3_000_000n;
    const pure = 1_000n;
    const serverRial = rial + dualFromPure(pure, RATE).rial;

    expect(convertibleBalance(item(rial, pure, serverRial), { displayUnit: 'RIAL', referenceMazneh: REFERENCE })).toEqual({
      rial: serverRial,
      pureMg: pure + dualFromRial(rial, RATE).pureMg,
      rate1000: RATE,
    });
  });

  it('حضور فقط به‌خاطر سکه را تشخیص می‌دهد', () => {
    expect(listedByCoinOnly(item(0n, 1n, 1n), 'DEBTOR')).toBe(false);
    expect(listedByCoinOnly({ ...item(0n, 0n, 0n), convertibleDirection: 'SETTLED' }, 'DEBTOR')).toBe(true);
    expect(listedByCoinOnly({ ...item(0n, -5n, -5n), convertibleDirection: 'CREDITOR' }, 'DEBTOR')).toBe(true);
  });
});

describe('mock MSW فهرست بدهکاران', () => {
  const report = partyBalanceReportFor('DEBTOR', partyRecords, REFERENCE, {
    search: null,
    displayUnit: 'GOLD',
    sortDirection: 'DESC',
    limit: 200,
    offset: 0,
  });

  it('با قرارداد واقعی BE-058 سازگار است', () => {
    expect(partyBalanceReportSchema.parse(report)).toEqual(report);
  });

  it('فقط بدهکاران (یا دارندگان سکه‌ی بدهکار) را به ترتیب نزولی مانده می‌دهد', () => {
    expect(report.items.length).toBeGreaterThan(0);
    for (const row of report.items) {
      const hasDebtorCoin = row.rawBalances.coins.some((coin) => coin.count > 0);
      expect(row.convertibleDirection === 'DEBTOR' || hasDebtorCoin).toBe(true);
    }
    const magnitudes = report.items
      .filter((row) => row.convertibleDirection === 'DEBTOR')
      .map((row) => BigInt(row.displayBalance));
    expect([...magnitudes].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))).toEqual(magnitudes);
  });
});
