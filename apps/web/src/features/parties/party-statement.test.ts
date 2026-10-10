import { RATE_DIVISOR, gramRate1000 } from '@gold/core-calc';
import { describe, expect, it } from 'vitest';
import {
  collectDimensions,
  convertibleUnit,
  debtorCreditorLabel,
  dimensionLabel,
  lockedStatementRate,
} from './party-statement';
import type { PartyStatementDimension, PartyStatementEntry } from './party-statement';

/** FE-070 — توابع خالص صورت‌حساب شخص. */

const GOLD: PartyStatementDimension = {
  id: 'd2000000-0000-4000-8000-000000000001',
  code: 'GOLD-1000',
  kind: 'GOLD',
  coinTypeId: null,
  coinCode: null,
};
const RIAL: PartyStatementDimension = {
  id: 'd2000000-0000-4000-8000-000000000002',
  code: 'RIAL',
  kind: 'RIAL',
  coinTypeId: null,
  coinCode: null,
};
const COIN: PartyStatementDimension = {
  id: 'd2000000-0000-4000-8000-000000000003',
  code: 'COIN-BAHAR',
  kind: 'COIN',
  coinTypeId: 'c3000000-0000-4000-8000-000000000001',
  coinCode: 'BAHAR',
};

const MAZNEH = 480_000_000n;

function entry(snapshots: PartyStatementEntry['documentRateSnapshots']): PartyStatementEntry {
  return {
    ledgerTransactionId: 'e1000000-0000-4000-8000-000000000001',
    source: { type: 'SALES_INVOICE', id: 'f1000000-0000-4000-8000-000000000001' },
    effectiveAt: '2026-10-01T10:00:00.000Z',
    description: 'sale',
    dimension: GOLD,
    quantity: '1000',
    runningBalance: '1000',
    documentRateSnapshots: snapshots,
  };
}

function snapshot(pricingSnapshot: unknown, quoteAmountRial: string | null = MAZNEH.toString()) {
  return {
    quoteId: 'c1000000-0000-4000-8000-000000000001',
    quoteAmountRial,
    quoteObservedAt: '2026-10-01T09:00:00.000Z',
    pricingSnapshot,
  };
}

describe('lockedStatementRate', () => {
  it('rebuilds the rate from a sales invoice settings snapshot', () => {
    const rate = lockedStatementRate(
      entry([snapshot({ totals: {}, settings: { baseQuoteKarat: '705', mithqalGrams: '4.6083' } })]),
    );
    expect(rate).toEqual({
      rate1000: gramRate1000(MAZNEH, RATE_DIVISOR),
      maznehRial: MAZNEH,
      observedAt: '2026-10-01T09:00:00.000Z',
    });
  });

  it('uses the locked divisor of the document, not today’s default', () => {
    const lockedDivisor = 32_000_000n;
    const rate = lockedStatementRate(entry([snapshot({ rateDivisor: lockedDivisor.toString() })]));
    expect(rate?.rate1000).toBe(gramRate1000(MAZNEH, lockedDivisor));
    expect(rate?.rate1000).not.toBe(gramRate1000(MAZNEH));
  });

  it('returns null when the snapshot has no usable divisor or mazneh', () => {
    expect(lockedStatementRate(entry([]))).toBeNull();
    expect(lockedStatementRate(entry([snapshot(null)]))).toBeNull();
    expect(lockedStatementRate(entry([snapshot(['705'])]))).toBeNull();
    expect(lockedStatementRate(entry([snapshot({ rateDivisor: '0' })]))).toBeNull();
    expect(lockedStatementRate(entry([snapshot({ rateDivisor: '1.5' })]))).toBeNull();
    expect(
      lockedStatementRate(entry([snapshot({ baseQuoteKarat: '705', mithqalGrams: '4.6' })])),
    ).toBeNull();
    expect(
      lockedStatementRate(entry([snapshot({ baseQuoteKarat: '0', mithqalGrams: '4.6083' })])),
    ).toBeNull();
    expect(
      lockedStatementRate(entry([snapshot({ baseQuoteKarat: '705', mithqalGrams: '0.0000' })])),
    ).toBeNull();
    expect(lockedStatementRate(entry([snapshot({ rateDivisor: '32488515' }, null)]))).toBeNull();
    expect(lockedStatementRate(entry([snapshot({ rateDivisor: '32488515' }, '0')]))).toBeNull();
  });

  it('refuses to guess between conflicting rates of one document', () => {
    expect(
      lockedStatementRate(
        entry([snapshot({ rateDivisor: '32488515' }), snapshot({ rateDivisor: '32000000' })]),
      ),
    ).toBeNull();
  });

  it('accepts repeated identical snapshots and skips unusable ones', () => {
    const rate = lockedStatementRate(
      entry([snapshot(null), snapshot({ rateDivisor: '32488515' }), snapshot({ rateDivisor: '32488515' })]),
    );
    expect(rate?.rate1000).toBe(gramRate1000(MAZNEH));
  });
});

describe('labels', () => {
  it('maps direction exactly like the server', () => {
    expect(debtorCreditorLabel(1n)).toBe('بدهکار');
    expect(debtorCreditorLabel(-1n)).toBe('بستانکار');
    expect(debtorCreditorLabel(0n)).toBe('تسویه');
  });

  it('names every dimension kind and keeps each coin separate', () => {
    expect(dimensionLabel(RIAL)).toBe('ریال');
    expect(dimensionLabel(GOLD)).toBe('طلای خالص');
    expect(dimensionLabel({ ...GOLD, kind: 'SILVER', code: 'SILVER-1000' })).toBe('نقره');
    expect(dimensionLabel(COIN)).toBe('سکه BAHAR');
    expect(dimensionLabel({ ...COIN, coinCode: null })).toBe('سکه COIN-BAHAR');
  });

  it('only converts rial and pure gold', () => {
    expect(convertibleUnit(RIAL)).toBe('rial');
    expect(convertibleUnit(GOLD)).toBe('gold');
    expect(convertibleUnit(COIN)).toBeNull();
    expect(convertibleUnit({ ...GOLD, kind: 'SILVER' })).toBeNull();
  });
});

describe('collectDimensions', () => {
  it('deduplicates by id in first-seen order and ignores empty slots', () => {
    expect(collectDimensions([GOLD, RIAL, GOLD], [null, undefined, COIN, RIAL])).toEqual([
      GOLD,
      RIAL,
      COIN,
    ]);
  });
});
