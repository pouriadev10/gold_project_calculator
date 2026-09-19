import { describe, expect, it } from 'vitest';
import {
  salesInvoiceListItemSchema,
  salesInvoiceListQuerySchema,
  salesInvoiceListSchema,
} from './contracts';

const finalizedInvoice = {
  id: 'd5000000-0000-4000-8000-000000000001',
  invoiceNumber: 122,
  status: 'FINALIZED' as const,
  currentVersion: 2,
  party: {
    id: 'a1000000-0000-4000-8000-000000000001',
    displayName: 'حسین مرادی',
  },
  payableRial: '1950000000',
  goldRatePerGramRial: '100000000',
  occurredAt: '2026-09-18T08:00:00.000Z',
};

describe('قرارداد فهرست فاکتورهای فروش — FE-064', () => {
  it('فاکتور نهایی و envelope صفحه‌بندی را می‌پذیرد', () => {
    expect(
      salesInvoiceListSchema.parse({
        items: [finalizedInvoice],
        total: 1,
        limit: 10,
        offset: 0,
      }),
    ).toEqual({ items: [finalizedInvoice], total: 1, limit: 10, offset: 0 });
  });

  it('پول روی سیم را فقط به‌صورت رشته می‌پذیرد', () => {
    expect(
      salesInvoiceListItemSchema.safeParse({ ...finalizedInvoice, payableRial: 1_950_000_000 })
        .success,
    ).toBe(false);
  });

  it('شکل پیش‌نویس و نهایی را با وضعیت آن‌ها سازگار نگه می‌دارد', () => {
    expect(
      salesInvoiceListItemSchema.safeParse({
        ...finalizedInvoice,
        status: 'DRAFT',
        invoiceNumber: null,
        currentVersion: 0,
        payableRial: null,
        goldRatePerGramRial: null,
      }).success,
    ).toBe(true);
    expect(
      salesInvoiceListItemSchema.safeParse({
        ...finalizedInvoice,
        status: 'DRAFT',
        invoiceNumber: null,
      }).success,
    ).toBe(false);
  });

  it('بازه‌ی تاریخ وارونه را رد می‌کند', () => {
    expect(
      salesInvoiceListQuerySchema.safeParse({
        limit: 10,
        offset: 0,
        from: '2026-09-19T00:00:00.000Z',
        to: '2026-09-18T23:59:59.999Z',
      }).success,
    ).toBe(false);
  });
});
