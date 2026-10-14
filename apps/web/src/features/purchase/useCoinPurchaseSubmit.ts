import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { createSecondHandCoinPurchaseSchema, type CreateSecondHandCoinPurchaseInput, type SecondHandCoinPurchase } from '@gold/contracts';
import { createSecondHandCoinPurchase } from '@/api/purchase';
import { queryKeys } from '@/api/query-keys';
import { useFinancialSubmit } from '@/hooks/useFinancialSubmit';

interface CoinPurchaseAttempt { key: string; input: CreateSecondHandCoinPurchaseInput; rate1000: bigint; }
export interface CoinPurchaseReceiptState { purchase: SecondHandCoinPurchase; rate1000: bigint; }

/** نرخ رسید همراه بدنه سنجاق می‌شود؛ رشته است چون تلاش در sessionStorage (JSON) می‌ماند. */
const pinnedSchema = z.object({ input: createSecondHandCoinPurchaseSchema, rate1000: z.string().regex(/^\d+$/) });
type PinnedCoinPurchase = z.infer<typeof pinnedSchema>;

/**
 * FE-100: روی `useFinancialSubmit` — همان سنجاق کلید + بدنه و همان طبقه‌بندی «رد قطعی / نامطمئن»
 * که بقیه‌ی فرم‌های مالی دارند، به‌علاوه‌ی ماندن تلاش نامطمئن پس از ترک صفحه یا back/forward
 * (قبلاً فقط در state همین کامپوننت بود و با unmount گم می‌شد).
 */
export function useCoinPurchaseSubmit(onSuccess: () => void) {
  const client = useQueryClient();
  const [receipt, setReceipt] = useState<CoinPurchaseReceiptState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const submission = useFinancialSubmit(
    (key: string, pinned: PinnedCoinPurchase) => createSecondHandCoinPurchase(pinned.input, key),
    { persist: { scope: 'purchase:coin', schema: pinnedSchema } },
  );

  async function submit(candidate: unknown, rate1000: bigint) {
    if (receipt) return;
    // تلاش سنجاق‌شده بر فرم مقدم است — فرم پس از بازگشت به صفحه شاید خالی باشد
    let pinned = submission.pending?.payload;
    if (pinned === undefined) {
      const parsed = createSecondHandCoinPurchaseSchema.safeParse(candidate);
      if (!parsed.success) return;
      pinned = { input: parsed.data, rate1000: rate1000.toString() };
    }
    setError(null);
    try {
      const purchase = await submission.submit(pinned);
      if (!purchase) return;
      // نرخ رسید از همان تلاشی که ثبت شد، نه از فرم
      setReceipt({ purchase, rate1000: BigInt(pinned.rate1000) });
      submission.reset();
      onSuccess();
      void Promise.allSettled([queryKeys.inventoryBalances.all(), queryKeys.inventoryMovements.all(), queryKeys.parties.all(), queryKeys.dashboard.all(), queryKeys.transactions.all()].map((queryKey) => client.invalidateQueries({ queryKey })));
    } catch (caught) {
      setError(caught);
    }
  }

  const pending = submission.pending;
  const attempt: CoinPurchaseAttempt | null = pending
    ? { key: pending.key, input: pending.payload.input, rate1000: BigInt(pending.payload.rate1000) }
    : null;

  return {
    submit, attempt, receipt, error, isSubmitting: submission.isSubmitting,
    clearReceipt: () => { setReceipt(null); setError(null); submission.reset(); },
  };
}
