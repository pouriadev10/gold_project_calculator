import { z } from 'zod';
import {
  bigIntStringSchema,
  isoDateTimeSchema,
  positiveBigIntStringSchema,
  uuidSchema,
} from '../common/index.js';

/**
 * آخرین معامله‌ها — `GET /transactions/recent`، FE-106b.
 *
 * تجمیع فقط‌خواندنی روی دو سند مبدأ فاز ۱: فاکتور فروش نهایی (زیورآلات/سکه)
 * و خرید دست‌دوم (طلا/سکه، از جمله مرجوعی B2C که خرید است، نه برگشت).
 * تسویه‌ها معامله نیستند و اینجا نمی‌آیند.
 *
 * - `sale` / `coin-sale`: فاکتور فروش با ردیف زیورآلات / سکه.
 * - `second-hand`: خرید از مصرف‌کننده.
 * - `purchase`: خرید از همکار (طرف حساب `BUSINESS`).
 */
export const recentTransactionKindSchema = z.enum(['sale', 'purchase', 'second-hand', 'coin-sale']);

/**
 * مبلغ دومقیاسه با نرخ قفل‌شده‌ی خود سند (قاعده‌ی ۲-۸). علامت جهت پول است:
 * فروش مثبت (دریافت)، خرید منفی (پرداخت). `pureMg` معادل همان ریال با همان
 * `rate1000` است و فقط در `core-calc` گرد می‌شود.
 */
export const recentTransactionAmountSchema = z.object({
  rial: bigIntStringSchema,
  pureMg: bigIntStringSchema,
  rate1000: positiveBigIntStringSchema,
});

export const recentTransactionSchema = z.object({
  /** شناسه‌ی سند مبدأ (فاکتور فروش یا خرید دست‌دوم). */
  id: uuidSchema,
  partyName: z.string().min(1),
  kind: recentTransactionKindSchema,
  title: z.string().min(1),
  amount: recentTransactionAmountSchema,
  occurredAt: isoDateTimeSchema,
});

export const recentTransactionListSchema = z.object({
  items: z.array(recentTransactionSchema),
});

export type RecentTransactionKind = z.infer<typeof recentTransactionKindSchema>;
export type RecentTransaction = z.infer<typeof recentTransactionSchema>;
export type RecentTransactionList = z.infer<typeof recentTransactionListSchema>;
