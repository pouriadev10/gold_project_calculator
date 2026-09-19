import { describe, expect, it } from 'vitest';
import { salesInvoiceDetailRecords } from '@/mocks/handlers/fixtures';
import { salesInvoiceDetailSchema } from './contracts';

const finalizedDetail = {
  id: 'd5000000-0000-4000-8000-000000000001',
  invoiceNumber: 122,
  status: 'FINALIZED' as const,
  currentVersion: 1,
  party: {
    id: 'a1000000-0000-4000-8000-000000000001',
    displayName: 'حسین مرادی',
    type: 'CONSUMER' as const,
    status: 'ACTIVE' as const,
  },
  occurredAt: '2026-09-18T08:00:00.000Z',
  quoteSnapshot: {
    amountRial: '480000000',
    goldRatePerGramRial: '147744518',
    observedAt: '2026-09-18T07:59:00.000Z',
  },
  versions: [
    {
      version: 1,
      reason: null,
      reasonDetail: null,
      actor: null,
      createdAt: '2026-09-18T08:00:00.000Z',
      payableRial: '1950000000',
      paidRial: '1500000000',
      receivableRial: '450000000',
      pureWeightMg: '4250',
      items: [
        {
          itemType: 'JEWELRY' as const,
          itemId: 'b1000000-0000-4000-8000-000000000001',
          title: 'دستبند ۱۸ عیار',
          quantity: '1',
          pureWeightMg: '4250',
          karat: 750,
          payableRial: '1950000000',
        },
      ],
      settingsSnapshot: {
        baseQuoteKarat: '705',
        mithqalGramsX10k: '46083',
        roundingUnitRial: '1000',
        roundingPolicy: 'ROUND_HALF_UP',
        profitRateBps: '700',
        taxRateBps: '1000',
      },
      ledgerSummary: { transactionCount: 1, entryCount: 5, balanced: true },
    },
  ],
};

describe('قرارداد جزئیات فاکتور فروش — FE-065', () => {
  it('تمام fixtureهای صفحه با قرارداد یکی هستند', () => {
    expect(salesInvoiceDetailRecords.length).toBeGreaterThan(0);
    for (const detail of salesInvoiceDetailRecords) {
      expect(salesInvoiceDetailSchema.safeParse(detail).success).toBe(true);
    }
  });

  it('snapshot کامل نسخه جاری را می‌پذیرد', () => {
    expect(salesInvoiceDetailSchema.parse(finalizedDetail)).toEqual(finalizedDetail);
  });

  it('پول و وزن را به‌صورت number نمی‌پذیرد', () => {
    const invalid = {
      ...finalizedDetail,
      versions: [{ ...finalizedDetail.versions[0], payableRial: 1_950_000_000 }],
    };
    expect(salesInvoiceDetailSchema.safeParse(invalid).success).toBe(false);
  });

  it('نسخه جاری باید دقیقاً میان نسخه‌های فاکتور وجود داشته باشد', () => {
    expect(
      salesInvoiceDetailSchema.safeParse({ ...finalizedDetail, currentVersion: 2 }).success,
    ).toBe(false);
  });

  it('پیش‌نویس بدون شماره، نرخ و نسخه معتبر است اما snapshot مالی روی آن رد می‌شود', () => {
    const draft = {
      ...finalizedDetail,
      invoiceNumber: null,
      status: 'DRAFT' as const,
      currentVersion: 0,
      quoteSnapshot: null,
      versions: [],
    };
    expect(salesInvoiceDetailSchema.safeParse(draft).success).toBe(true);
    expect(
      salesInvoiceDetailSchema.safeParse({ ...draft, quoteSnapshot: finalizedDetail.quoteSnapshot })
        .success,
    ).toBe(false);
  });
});
