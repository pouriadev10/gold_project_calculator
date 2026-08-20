import { apiPost } from './client';
import { openingBalanceSchema, type CreateOpeningBalanceInput, type OpeningBalance } from './contracts';

/**
 * ثبت موجودی افتتاحیه — `POST /inventory/opening-balances` (BE-028، FE-039).
 *
 * سند **یک‌بارمصرف و تغییرناپذیر** است: بدون endpoint ویرایش یا حذف
 * (بخش ۲-۷ CLAUDE.md، دفتر کل append-only). همان الگوی `api/pricing.ts`:
 * نوشتنی که فرم مستقیم با `useIdempotentSubmit` می‌پوشاند.
 */
export function createOpeningBalance(
  input: CreateOpeningBalanceInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<OpeningBalance> {
  return apiPost('/inventory/opening-balances', input, openingBalanceSchema, idempotencyKey, signal);
}
