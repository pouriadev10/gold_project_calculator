import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECENT_LIMIT,
  MAX_RECENT_LIMIT,
  recentInventoryMovementSchema,
  recentQuerySchema,
  recentTransactionSchema,
  salesInvoiceDetailSchema,
  salesInvoiceListItemSchema,
  salesInvoiceListQuerySchema,
} from '../src/index.js';

/** FE-106b — قراردادهای چهار endpoint ِ فقط‌خواندنی که از فرانت به این پکیج آمدند. */

const ID = '0b5b8c6e-1d1f-4c3a-9a77-2f3e8d9c1a00';
const AT = '2026-09-01T08:30:00.000Z';

describe('recentQuerySchema', () => {
  it('پیش‌فرض، coerce و سقف', () => {
    expect(recentQuerySchema.parse({})).toEqual({ limit: DEFAULT_RECENT_LIMIT });
    expect(recentQuerySchema.parse({ limit: String(MAX_RECENT_LIMIT) })).toEqual({ limit: MAX_RECENT_LIMIT });
    expect(recentQuerySchema.safeParse({ limit: String(MAX_RECENT_LIMIT + 1) }).success).toBe(false);
    expect(recentQuerySchema.safeParse({ limit: '2.5' }).success).toBe(false);
    expect(recentQuerySchema.safeParse({ offset: '1' }).success).toBe(false);
  });
});

describe('salesInvoiceListQuerySchema', () => {
  it('شماره فقط رقم، بازه‌ی وارونه رد', () => {
    expect(salesInvoiceListQuerySchema.parse({ invoiceNumber: '42', status: 'FINALIZED' })).toMatchObject({
      invoiceNumber: '42',
      status: 'FINALIZED',
    });
    expect(salesInvoiceListQuerySchema.safeParse({ invoiceNumber: '4_' }).success).toBe(false);
    expect(salesInvoiceListQuerySchema.safeParse({ from: AT, to: '2026-08-01T00:00:00.000Z' }).success).toBe(false);
  });
});

describe('salesInvoiceListItemSchema', () => {
  const finalized = {
    id: ID,
    invoiceNumber: 42,
    status: 'FINALIZED',
    currentVersion: 1,
    party: { id: ID, displayName: 'زهرا' },
    payableRial: '125000000',
    goldRatePerGramRial: '126964000',
    occurredAt: AT,
  };

  it('نهایی باید شماره، نسخه، مبلغ و نرخ مثبت داشته باشد', () => {
    expect(salesInvoiceListItemSchema.safeParse(finalized).success).toBe(true);
    expect(salesInvoiceListItemSchema.safeParse({ ...finalized, goldRatePerGramRial: '0' }).success).toBe(false);
    expect(salesInvoiceListItemSchema.safeParse({ ...finalized, payableRial: 125000000 }).success).toBe(false);
  });

  it('پیش‌نویس هیچ snapshot مالی ندارد', () => {
    const draft = { ...finalized, status: 'DRAFT', invoiceNumber: null, currentVersion: 0, payableRial: null, goldRatePerGramRial: null };
    expect(salesInvoiceListItemSchema.safeParse(draft).success).toBe(true);
    expect(salesInvoiceListItemSchema.safeParse({ ...draft, payableRial: '1' }).success).toBe(false);
  });
});

describe('salesInvoiceDetailSchema', () => {
  it('نهایی بدون نسخه‌ی جاری رد می‌شود', () => {
    expect(
      salesInvoiceDetailSchema.safeParse({
        id: ID,
        invoiceNumber: 42,
        status: 'FINALIZED',
        currentVersion: 1,
        party: { id: ID, displayName: 'زهرا', type: 'CONSUMER', status: 'ACTIVE' },
        occurredAt: AT,
        quoteSnapshot: { amountRial: '412500000', goldRatePerGramRial: '126964000', observedAt: AT },
        versions: [],
      }).success,
    ).toBe(false);
  });
});

describe('recentTransactionSchema', () => {
  const sale = {
    id: ID,
    partyName: 'حسین',
    kind: 'sale',
    title: 'دستبند',
    amount: { rial: '125000000', pureMg: '9845', rate1000: '12696400' },
    occurredAt: AT,
  };

  it('مبلغ علامت‌دار رشته است و نرخ مثبت', () => {
    expect(recentTransactionSchema.safeParse(sale).success).toBe(true);
    expect(
      recentTransactionSchema.safeParse({ ...sale, kind: 'second-hand', amount: { ...sale.amount, rial: '-1', pureMg: '-1' } })
        .success,
    ).toBe(true);
    expect(recentTransactionSchema.safeParse({ ...sale, amount: { ...sale.amount, rate1000: '0' } }).success).toBe(false);
    expect(recentTransactionSchema.safeParse({ ...sale, amount: { ...sale.amount, rial: 1 } }).success).toBe(false);
    expect(recentTransactionSchema.safeParse({ ...sale, id: 'TX-1' }).success).toBe(false);
  });
});

describe('recentInventoryMovementSchema', () => {
  it('همه‌ی منابع حرکت دیتابیس، برچسب ناتهی', () => {
    const base = { id: ID, itemType: 'MELTED_GOLD', itemLabel: 'آبشده', quantity: '45000', occurredAt: AT };
    for (const sourceType of ['SECOND_HAND_PURCHASE', 'SETTLEMENT', 'SALE']) {
      expect(recentInventoryMovementSchema.safeParse({ ...base, sourceType }).success).toBe(true);
    }
    expect(recentInventoryMovementSchema.safeParse({ ...base, sourceType: 'SALE', itemLabel: '' }).success).toBe(false);
  });
});
