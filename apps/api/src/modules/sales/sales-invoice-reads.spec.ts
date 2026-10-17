import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  salesInvoiceDetailSchema,
  salesInvoiceListItemSchema,
  salesInvoiceListQuerySchema,
} from '@gold/contracts';
import { ROLES_METADATA_KEY } from '../../platform/auth/roles.decorator';
import { LockedSnapshotInvalidError, lockedGoldRate1000 } from '../pricing/locked-gold-rate';
import { SalesInvoiceReadsController } from './sales-invoice-reads.controller';
import {
  toSalesInvoiceDetail,
  toSalesInvoiceListItem,
  type SalesInvoiceDetailHeader,
  type SalesInvoiceDetailItemRow,
  type SalesInvoiceDetailVersionRow,
  type SalesInvoiceListRow,
} from './sales-invoice-reads.service';
import { SalesInvoiceNotFoundError } from './sales-invoices.errors';
import type { SalesInvoiceReadsService } from './sales-invoice-reads.service';
import type { RequestContextService } from '../../platform/request-context/request-context.service';

/** FE-106b — فهرست و جزئیات فقط‌خواندنی فاکتور فروش، از snapshot ِ خود سند. */

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const INVOICE = 'b0000000-0000-4000-8000-000000000001';
const PARTY = 'c0000000-0000-4000-8000-000000000001';
const USER = 'd0000000-0000-4000-8000-000000000001';
const JEWELRY = 'e0000000-0000-4000-8000-000000000001';
const V1 = 'f0000000-0000-4000-8000-000000000001';
const V2 = 'f0000000-0000-4000-8000-000000000002';
const DIM_RIAL = '90000000-0000-4000-8000-000000000001';
const DIM_GOLD = '90000000-0000-4000-8000-000000000002';
const FINALIZED_AT = new Date('2026-09-01T08:30:00.000Z');
const MAZNEH = 412_500_000n;

const JEWELRY_SETTINGS = {
  baseQuoteKarat: '705',
  mithqalGrams: '4.6083',
  roundingUnitRial: '1000',
  roundingPolicy: 'HALF_UP',
  profitRateBps: '700',
  taxRateBps: '1000',
};
const COIN_SETTINGS = { baseQuoteKarat: '705', mithqalGrams: '4.6083' };

function listRow(overrides: Partial<SalesInvoiceListRow> = {}): SalesInvoiceListRow {
  return {
    id: INVOICE,
    invoiceNumber: 42,
    status: 'FINALIZED',
    currentVersion: 1,
    partyId: PARTY,
    partyDisplayName: 'زهرا کریمی',
    quoteAmountRial: MAZNEH,
    finalizedAt: FINALIZED_AT,
    createdAt: new Date('2026-09-01T08:29:59.000Z'),
    totalsSnapshot: { payableRial: '125000000', pureWeightMg: '9250' },
    settingsSnapshot: JEWELRY_SETTINGS,
    ...overrides,
  };
}

describe('toSalesInvoiceListItem', () => {
  it('فاکتور نهایی: مبلغ از snapshot ِ نسخه‌ی جاری و نرخ گرم ۱۰۰۰ ِ قفل‌شده', () => {
    const item = toSalesInvoiceListItem(listRow());
    expect(item).toEqual({
      id: INVOICE,
      invoiceNumber: 42,
      status: 'FINALIZED',
      currentVersion: 1,
      party: { id: PARTY, displayName: 'زهرا کریمی' },
      payableRial: '125000000',
      goldRatePerGramRial: lockedGoldRate1000(MAZNEH, JEWELRY_SETTINGS).toString(),
      occurredAt: FINALIZED_AT.toISOString(),
    });
    expect(salesInvoiceListItemSchema.parse(item)).toEqual(item);
  });

  it('پیش‌نویس: بدون مبلغ، نرخ و شماره؛ زمان = زمان ساخت', () => {
    const createdAt = new Date('2026-09-02T10:00:00.000Z');
    const item = toSalesInvoiceListItem(
      listRow({
        status: 'DRAFT',
        invoiceNumber: null,
        currentVersion: 0,
        quoteAmountRial: null,
        finalizedAt: null,
        createdAt,
        totalsSnapshot: null,
        settingsSnapshot: null,
      }),
    );
    expect(item).toMatchObject({ payableRial: null, goldRatePerGramRial: null, occurredAt: createdAt.toISOString() });
    expect(salesInvoiceListItemSchema.parse(item)).toEqual(item);
  });

  it('فاکتور نهایی بی‌snapshot یا بی‌مبلغ خطای صریح است، نه عدد ساختگی', () => {
    expect(() => toSalesInvoiceListItem(listRow({ totalsSnapshot: null }))).toThrow(LockedSnapshotInvalidError);
    expect(() => toSalesInvoiceListItem(listRow({ totalsSnapshot: {} }))).toThrow(LockedSnapshotInvalidError);
    expect(() => toSalesInvoiceListItem(listRow({ settingsSnapshot: {} }))).toThrow(LockedSnapshotInvalidError);
  });
});

const HEADER: SalesInvoiceDetailHeader = {
  id: INVOICE,
  invoiceNumber: 42,
  status: 'FINALIZED',
  currentVersion: 2,
  finalizedAt: FINALIZED_AT,
  createdAt: FINALIZED_AT,
  quoteAmountRial: MAZNEH,
  quoteObservedAt: new Date('2026-09-01T08:00:00.000Z'),
  party: { id: PARTY, displayName: 'زهرا کریمی', type: 'CONSUMER', status: 'ACTIVE' },
};

const VERSIONS: SalesInvoiceDetailVersionRow[] = [
  {
    id: V2,
    version: 2,
    reason: 'WEIGHT_ERROR',
    reasonDetail: null,
    createdAt: new Date('2026-09-01T09:00:00.000Z'),
    totalsSnapshot: { saleKind: 'JEWELRY', payableRial: '120000000', paidRial: '100000000', receivableRial: '20000000' },
    settingsSnapshot: JEWELRY_SETTINGS,
    actor: { id: USER, displayName: 'مدیر' },
  },
  {
    id: V1,
    version: 1,
    reason: null,
    reasonDetail: null,
    createdAt: FINALIZED_AT,
    // فروش نقدی: paid/receivable در snapshot نیست
    totalsSnapshot: { payableRial: '125000000', pureWeightMg: '9250' },
    settingsSnapshot: JEWELRY_SETTINGS,
    actor: null,
  },
];

function jewelryLine(versionId: string, pureWeightMg: string, payableRial: string): SalesInvoiceDetailItemRow {
  return {
    salesInvoiceVersionId: versionId,
    itemType: 'JEWELRY',
    itemId: JEWELRY,
    quantity: 1,
    lineSnapshot: { jewelryItemVersionId: '70000000-0000-4000-8000-000000000001', pureWeightMg, payableRial },
    title: 'دستبند ۱۸ عیار',
    karat: 750,
  };
}

const ITEMS = [jewelryLine(V1, '9250', '125000000'), jewelryLine(V2, '8900', '120000000')];

const LEDGER = [
  {
    version: 1,
    entries: [
      { dimensionId: DIM_RIAL, quantity: 125_000_000n },
      { dimensionId: DIM_RIAL, quantity: -125_000_000n },
      { dimensionId: DIM_GOLD, quantity: 9_250n },
      { dimensionId: DIM_GOLD, quantity: -9_250n },
    ],
  },
  { version: 2, entries: [{ dimensionId: DIM_GOLD, quantity: -350n }, { dimensionId: DIM_GOLD, quantity: 350n }] },
];

describe('toSalesInvoiceDetail', () => {
  it('نسخه‌ها مرتب، هر عدد از snapshot ِ همان نسخه، و قرارداد مشترک را می‌خواند', () => {
    const detail = toSalesInvoiceDetail(HEADER, VERSIONS, ITEMS, LEDGER);
    expect(salesInvoiceDetailSchema.parse(detail)).toEqual(detail);
    expect(detail.quoteSnapshot).toEqual({
      amountRial: '412500000',
      goldRatePerGramRial: lockedGoldRate1000(MAZNEH, JEWELRY_SETTINGS).toString(),
      observedAt: '2026-09-01T08:00:00.000Z',
    });
    expect(detail.versions.map((version) => version.version)).toEqual([1, 2]);

    const [v1, v2] = detail.versions;
    expect(v1).toMatchObject({
      payableRial: '125000000',
      paidRial: '125000000',
      receivableRial: '0',
      pureWeightMg: '9250',
      actor: null,
      ledgerSummary: { transactionCount: 1, entryCount: 4, balanced: true },
      settingsSnapshot: {
        baseQuoteKarat: '705',
        mithqalGramsX10k: '46083',
        roundingUnitRial: '1000',
        roundingPolicy: 'HALF_UP',
        profitRateBps: '700',
        taxRateBps: '1000',
      },
    });
    expect(v1!.items).toEqual([
      {
        itemType: 'JEWELRY',
        itemId: JEWELRY,
        title: 'دستبند ۱۸ عیار',
        quantity: '1',
        pureWeightMg: '9250',
        karat: 750,
        payableRial: '125000000',
      },
    ]);
    expect(v2).toMatchObject({
      reason: 'WEIGHT_ERROR',
      payableRial: '120000000',
      paidRial: '100000000',
      receivableRial: '20000000',
      pureWeightMg: '8900',
      actor: { id: USER, displayName: 'مدیر' },
      ledgerSummary: { transactionCount: 1, entryCount: 2, balanced: true },
    });
  });

  it('سکه وزن ندارد و تنظیمات ناموجود فروش سکه null است', () => {
    const coinVersion: SalesInvoiceDetailVersionRow = {
      ...VERSIONS[1]!,
      totalsSnapshot: { payableRial: '900000000', paidRial: '900000000', receivableRial: '0', count: '2' },
      settingsSnapshot: COIN_SETTINGS,
    };
    const coinLine: SalesInvoiceDetailItemRow = {
      salesInvoiceVersionId: V1,
      itemType: 'COIN',
      itemId: JEWELRY,
      quantity: 2,
      lineSnapshot: { coinTypeVersionId: '70000000-0000-4000-8000-000000000002', count: '2', payableRial: '900000000' },
      title: 'تمام بهار آزادی',
      karat: 900,
    };
    const detail = toSalesInvoiceDetail({ ...HEADER, currentVersion: 1 }, [coinVersion], [coinLine], []);
    expect(salesInvoiceDetailSchema.parse(detail)).toEqual(detail);
    expect(detail.versions[0]).toMatchObject({
      pureWeightMg: null,
      items: [{ itemType: 'COIN', quantity: '2', pureWeightMg: null, karat: 900 }],
      settingsSnapshot: { roundingUnitRial: null, roundingPolicy: null, profitRateBps: null, taxRateBps: null },
      ledgerSummary: { transactionCount: 0, entryCount: 0, balanced: true },
    });
  });

  it('تراکنشی که در یک بُعد صفر نشود ناتراز گزارش می‌شود', () => {
    const detail = toSalesInvoiceDetail(HEADER, VERSIONS, ITEMS, [
      { version: 1, entries: [{ dimensionId: DIM_RIAL, quantity: 10n }, { dimensionId: DIM_GOLD, quantity: -10n }] },
    ]);
    expect(detail.versions[0]!.ledgerSummary.balanced).toBe(false);
  });

  it('پیش‌نویس: بدون نسخه و بدون snapshot ِ مظنه', () => {
    const detail = toSalesInvoiceDetail(
      { ...HEADER, status: 'DRAFT', invoiceNumber: null, currentVersion: 0, finalizedAt: null, quoteAmountRial: null, quoteObservedAt: null },
      [],
      [],
      [],
    );
    expect(detail).toMatchObject({ quoteSnapshot: null, versions: [] });
    expect(salesInvoiceDetailSchema.parse(detail)).toEqual(detail);
  });

  it('snapshot ِ ناقص خطای صریح است', () => {
    expect(() => toSalesInvoiceDetail({ ...HEADER, currentVersion: 3 }, VERSIONS, ITEMS, [])).toThrow(
      LockedSnapshotInvalidError,
    );
    expect(() =>
      toSalesInvoiceDetail(HEADER, VERSIONS, [{ ...ITEMS[0]!, title: undefined }], []),
    ).toThrow(LockedSnapshotInvalidError);
    expect(() =>
      toSalesInvoiceDetail(HEADER, [{ ...VERSIONS[1]!, totalsSnapshot: { payableRial: '10', paidRial: '20' } }, VERSIONS[0]!], [], []),
    ).toThrow(LockedSnapshotInvalidError);
  });
});

describe('salesInvoiceListQuerySchema', () => {
  it('پیش‌فرض صفحه‌بندی و رد کلید ناشناخته یا بازه‌ی وارونه', () => {
    expect(salesInvoiceListQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(salesInvoiceListQuerySchema.safeParse({ unknown: '1' }).success).toBe(false);
    expect(salesInvoiceListQuerySchema.safeParse({ invoiceNumber: '4%' }).success).toBe(false);
    expect(
      salesInvoiceListQuerySchema.safeParse({ from: '2026-09-02T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' })
        .success,
    ).toBe(false);
  });
});

describe('SalesInvoiceReadsController', () => {
  const context = { getTenantId: () => TENANT } as RequestContextService;

  it('مسیرها و نقش‌ها: فقط‌خواندنی، صندوق‌دار هم می‌بیند', () => {
    expect(Reflect.getMetadata('path', SalesInvoiceReadsController)).toBe('sales/invoices');
    expect(Reflect.getMetadata('path', SalesInvoiceReadsController.prototype.list)).toBe('/');
    expect(Reflect.getMetadata('path', SalesInvoiceReadsController.prototype.detail)).toBe(':invoiceId/detail');
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, SalesInvoiceReadsController)).toEqual([
      'OWNER',
      'MANAGER',
      'CASHIER',
    ]);
  });

  it('فهرست و جزئیات را با مستأجر درخواست صدا می‌زند', async () => {
    const reads = {
      list: vi.fn(async () => ({ items: [], total: 0, limit: 50, offset: 0 })),
      detail: vi.fn(async () => ({ id: INVOICE })),
    } as unknown as SalesInvoiceReadsService;
    const controller = new SalesInvoiceReadsController(context, reads);
    await controller.list({ limit: 50, offset: 0 });
    await controller.detail(INVOICE);
    expect(reads.list).toHaveBeenCalledWith(TENANT, { limit: 50, offset: 0 });
    expect(reads.detail).toHaveBeenCalledWith(TENANT, INVOICE);
  });

  it('فاکتور ناموجود یا مستأجر دیگر → 404', async () => {
    const reads = {
      detail: vi.fn(async () => {
        throw new SalesInvoiceNotFoundError(INVOICE);
      }),
    } as unknown as SalesInvoiceReadsService;
    await expect(new SalesInvoiceReadsController(context, reads).detail(INVOICE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
