import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { dualFromRial } from '@gold/core-calc';
import { recentQuerySchema, recentTransactionListSchema } from '@gold/contracts';
import { ROLES_METADATA_KEY } from '../../platform/auth/roles.decorator';
import { LockedSnapshotInvalidError, lockedGoldRate1000 } from '../pricing/locked-gold-rate';
import { RecentTransactionsController } from './recent-transactions.controller';
import {
  mergeRecent,
  toRecentPurchase,
  toRecentSale,
  type RecentPurchaseRow,
  type RecentSaleRow,
} from './recent-transactions.service';
import type { RecentTransactionsService } from './recent-transactions.service';
import type { RequestContextService } from '../../platform/request-context/request-context.service';

/** FE-106b — آخرین معامله‌ها با مبلغ دومقیاسه به نرخ قفل‌شده‌ی هر سند. */

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const SALE = 'b0000000-0000-4000-8000-000000000001';
const PURCHASE = 'b0000000-0000-4000-8000-000000000002';
const SETTINGS = { baseQuoteKarat: '705', mithqalGrams: '4.6083' };
const SALE_MAZNEH = 412_500_000n;
const PURCHASE_MAZNEH = 420_000_000n;

function sale(overrides: Partial<RecentSaleRow> = {}): RecentSaleRow {
  return {
    id: SALE,
    partyName: 'حسین مرادی',
    occurredAt: new Date('2026-09-01T08:30:00.000Z'),
    quoteAmountRial: SALE_MAZNEH,
    totalsSnapshot: { payableRial: '125000000' },
    settingsSnapshot: SETTINGS,
    line: { itemType: 'JEWELRY', quantity: 1, title: 'دستبند ۱۸ عیار' },
    ...overrides,
  };
}

function purchase(overrides: Partial<RecentPurchaseRow> = {}): RecentPurchaseRow {
  return {
    id: PURCHASE,
    partyName: 'زهرا کریمی',
    partyType: 'CONSUMER',
    isBuyback: false,
    occurredAt: new Date('2026-09-01T09:00:00.000Z'),
    lockedQuoteAmountRial: PURCHASE_MAZNEH,
    finalAmountRial: 80_000_000n,
    settingsSnapshot: { ...SETTINGS, goldRatePerGramRial: '1' },
    coin: null,
    ...overrides,
  };
}

describe('toRecentSale', () => {
  it('فروش زیورآلات: مبلغ مثبت، معادل طلا با نرخ قفل‌شده‌ی همان فاکتور', () => {
    const rate1000 = lockedGoldRate1000(SALE_MAZNEH, SETTINGS);
    const dual = dualFromRial(125_000_000n, rate1000);
    expect(toRecentSale(sale())).toEqual({
      id: SALE,
      partyName: 'حسین مرادی',
      kind: 'sale',
      title: 'دستبند ۱۸ عیار',
      amount: { rial: '125000000', pureMg: dual.pureMg.toString(), rate1000: rate1000.toString() },
      occurredAt: '2026-09-01T08:30:00.000Z',
    });
  });

  it('فروش سکه: نوع coin-sale و عنوان با تعداد — سکه شمارشی است', () => {
    const item = toRecentSale(sale({ line: { itemType: 'COIN', quantity: 2, title: 'تمام بهار آزادی' } }));
    expect(item).toMatchObject({ kind: 'coin-sale', title: '۲ تمام بهار آزادی' });
  });

  it('بدون مبلغ قابل پرداخت خطای صریح است', () => {
    expect(() => toRecentSale(sale({ totalsSnapshot: {} }))).toThrow(LockedSnapshotInvalidError);
  });
});

describe('toRecentPurchase', () => {
  it('خرید از مصرف‌کننده: دست‌دوم، مبلغ منفی، نرخ از مظنه‌ی قفل‌شده‌ی خرید', () => {
    const rate1000 = lockedGoldRate1000(PURCHASE_MAZNEH, SETTINGS);
    const item = toRecentPurchase(purchase());
    expect(item).toMatchObject({ kind: 'second-hand', title: 'خرید طلای دست‌دوم' });
    expect(item.amount).toEqual({
      rial: '-80000000',
      pureMg: dualFromRial(-80_000_000n, rate1000).pureMg.toString(),
      rate1000: rate1000.toString(),
    });
    expect(BigInt(item.amount.pureMg)).toBeLessThan(0n);
  });

  it('مرجوعی B2C یک خرید است، نه برگشت فروش', () => {
    expect(toRecentPurchase(purchase({ isBuyback: true }))).toMatchObject({
      kind: 'second-hand',
      title: 'مرجوعی — خرید طلای دست‌دوم',
    });
  });

  it('خرید از همکار: purchase؛ خرید سکه با تعداد', () => {
    expect(toRecentPurchase(purchase({ partyType: 'BUSINESS' })).kind).toBe('purchase');
    expect(toRecentPurchase(purchase({ coin: { count: 3, title: 'ربع سکه بهار آزادی' } })).title).toBe(
      'خرید ۳ ربع سکه بهار آزادی',
    );
  });
});

describe('mergeRecent', () => {
  it('جدیدترین اول، با سقف تعداد، و قرارداد مشترک را می‌خواند', () => {
    const older = toRecentSale(sale({ occurredAt: new Date('2026-08-30T00:00:00.000Z') }));
    const newer = toRecentPurchase(purchase());
    const middle = toRecentSale(sale({ id: 'b0000000-0000-4000-8000-000000000003' }));
    const merged = mergeRecent([older, newer, middle], 2);
    expect(merged.map((item) => item.id)).toEqual([PURCHASE, 'b0000000-0000-4000-8000-000000000003']);
    expect(recentTransactionListSchema.parse({ items: merged })).toEqual({ items: merged });
  });

  it('هم‌زمان‌ها ترتیب پایدار بر اساس شناسه دارند', () => {
    const a = toRecentSale(sale({ id: 'b0000000-0000-4000-8000-00000000000a' }));
    const b = toRecentSale(sale({ id: 'b0000000-0000-4000-8000-00000000000b' }));
    expect(mergeRecent([a, b], 5).map((item) => item.id)).toEqual([b.id, a.id]);
  });
});

describe('RecentTransactionsController', () => {
  it('GET /transactions/recent، نقش‌دار، با limit ِ پیش‌فرض ۵ و سقف ۵۰', async () => {
    expect(Reflect.getMetadata('path', RecentTransactionsController)).toBe('transactions');
    expect(Reflect.getMetadata('path', RecentTransactionsController.prototype.recent)).toBe('recent');
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, RecentTransactionsController)).toEqual([
      'OWNER',
      'MANAGER',
      'CASHIER',
    ]);
    expect(recentQuerySchema.parse({})).toEqual({ limit: 5 });
    expect(recentQuerySchema.parse({ limit: '10' })).toEqual({ limit: 10 });
    expect(recentQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(recentQuerySchema.safeParse({ limit: '0' }).success).toBe(false);

    const service = { recent: vi.fn(async () => ({ items: [] })) } as unknown as RecentTransactionsService;
    const context = { getTenantId: () => TENANT } as RequestContextService;
    await new RecentTransactionsController(context, service).recent({ limit: 7 });
    expect(service.recent).toHaveBeenCalledWith(TENANT, 7);
  });
});
