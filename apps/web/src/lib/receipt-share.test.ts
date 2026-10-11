import { describe, expect, it } from 'vitest';
import { purchaseReceiptShareText, saleReceiptShareText, stripUrls } from './receipt-share';

/** FE-079 — متن کوتاه اشتراک رسید. */

const ISSUED = new Date('2026-10-10T08:12:00.000Z');

describe('saleReceiptShareText', () => {
  it('builds a short multi-line text with the server numbers', () => {
    const share = saleReceiptShareText({
      shopName: 'زرگری نمونه',
      invoiceNumber: 123,
      issuedAt: ISSUED,
      customerName: 'حسین مرادی',
      payableRial: 125_000_000n,
      paidRial: 100_000_000n,
      receivableRial: 25_000_000n,
      pureWeightMg: 7_400n,
    });
    expect(share.title).toBe('رسید فروش زرگری نمونه');
    const lines = share.text.split('\n');
    expect(lines[0]).toBe('رسید فروش زرگری نمونه');
    expect(lines).toContain('فاکتور شماره ۱۲۳');
    expect(lines).toContain('مشتری: حسین مرادی');
    expect(lines).toContain('وزن خالص: ۷٫۴۰۰ گرم');
    expect(lines).toContain('جمع فاکتور: ۱۲۵٬۰۰۰٬۰۰۰ ریال');
    expect(lines).toContain('پرداخت‌شده: ۱۰۰٬۰۰۰٬۰۰۰ ریال');
    expect(lines).toContain('مانده: ۲۵٬۰۰۰٬۰۰۰ ریال');
    expect(lines.some((line) => line.startsWith('تاریخ: '))).toBe(true);
  });

  it('omits unknown or zero lines and works without a shop name', () => {
    const share = saleReceiptShareText({
      shopName: null,
      invoiceNumber: 5,
      issuedAt: ISSUED,
      customerName: null,
      payableRial: null,
      paidRial: null,
      receivableRial: 0n,
      pureWeightMg: null,
    });
    expect(share.title).toBe('رسید فروش');
    expect(share.text).not.toContain('مشتری');
    expect(share.text).not.toContain('مانده');
    expect(share.text).not.toContain('جمع فاکتور');
  });

  it('never carries a URL, even if one sneaks in through a name', () => {
    const share = saleReceiptShareText({
      shopName: 'زرگری https://evil.example/login نمونه',
      invoiceNumber: 1,
      issuedAt: ISSUED,
      customerName: 'www.track.me/x علی',
      payableRial: 1n,
      paidRial: 1n,
      receivableRial: 0n,
      pureWeightMg: null,
    });
    expect(share.text).not.toMatch(/https?:|www\./u);
    expect(share.title).toBe('رسید فروش زرگری نمونه');
    expect(share.text).toContain('مشتری: علی');
  });

  it('caps very long text', () => {
    const share = saleReceiptShareText({
      shopName: 'ز'.repeat(1000),
      invoiceNumber: 1,
      issuedAt: ISSUED,
      customerName: null,
      payableRial: null,
      paidRial: null,
      receivableRial: null,
      pureWeightMg: null,
    });
    expect(share.text.length).toBeLessThanOrEqual(600);
    expect(share.text.endsWith('…')).toBe(true);
  });
});

describe('purchaseReceiptShareText', () => {
  it('uses only a short document reference and the seller balance when owed', () => {
    const share = purchaseReceiptShareText({
      shopName: 'زرگری نمونه',
      kindLabel: 'خرید سکه',
      purchaseId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      amountRial: 900_000_000n,
      paidRial: 800_000_000n,
      payableRial: 100_000_000n,
      coinCount: 2,
    });
    expect(share.title).toBe('رسید خرید سکه زرگری نمونه');
    // شناسه‌ی لاتین با FSI…PDI از متن فارسی اطرافش جدا می‌شود (FE-083).
    expect(share.text).toContain('شماره سند: ⁨7c9e6679⁩');
    expect(share.text).not.toContain('7425-40de');
    expect(share.text).toContain('تعداد: ۲ عدد');
    expect(share.text).toContain('مانده طلب فروشنده: ۱۰۰٬۰۰۰٬۰۰۰ ریال');
    expect(share.text).not.toContain('وزن خالص');
  });

  it('shows pure weight for gold and hides a settled balance', () => {
    const share = purchaseReceiptShareText({
      shopName: null,
      kindLabel: 'خرید طلای دست‌دوم',
      purchaseId: 'abcdef01-0000-4000-8000-000000000000',
      amountRial: 35_520_000n,
      paidRial: 35_520_000n,
      payableRial: 0n,
      pureWeightMg: 7_400n,
    });
    expect(share.text).toContain('وزن خالص: ۷٫۴۰۰ گرم');
    expect(share.text).not.toContain('مانده');
  });
});

describe('stripUrls', () => {
  it('removes http(s) and www links and tidies spaces', () => {
    expect(stripUrls('الف http://a.b/c ب www.x.y ج')).toBe('الف ب ج');
  });
});
