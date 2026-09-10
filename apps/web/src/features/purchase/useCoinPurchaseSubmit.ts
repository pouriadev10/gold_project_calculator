import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSecondHandCoinPurchaseSchema, type CreateSecondHandCoinPurchaseInput, type SecondHandCoinPurchase } from '@gold/contracts';
import { ApiError } from '@/api/api-error';
import { newIdempotencyKey } from '@/api/client';
import { createSecondHandCoinPurchase } from '@/api/purchase';
import { queryKeys } from '@/api/query-keys';

interface CoinPurchaseAttempt { key: string; input: CreateSecondHandCoinPurchaseInput; rate1000: bigint; }
export interface CoinPurchaseReceiptState { purchase: SecondHandCoinPurchase; rate1000: bigint; }

export function useCoinPurchaseSubmit(onSuccess: () => void) {
  const client = useQueryClient();
  const lock = useRef(false);
  const [attempt, setAttempt] = useState<CoinPurchaseAttempt | null>(null);
  const [receipt, setReceipt] = useState<CoinPurchaseReceiptState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  async function submit(candidate: unknown, rate1000: bigint) {
    if (lock.current || receipt) return;
    const request = attempt ?? (() => { const parsed = createSecondHandCoinPurchaseSchema.safeParse(candidate); return parsed.success ? { key: newIdempotencyKey(), input: parsed.data, rate1000 } : null; })();
    if (!request) return;
    lock.current = true; setSubmitting(true); setError(null); setAttempt(request);
    try {
      const purchase = await createSecondHandCoinPurchase(request.input, request.key);
      setReceipt({ purchase, rate1000: request.rate1000 }); setAttempt(null); onSuccess();
      void Promise.allSettled([queryKeys.inventoryBalances.all(), queryKeys.inventoryMovements.all(), queryKeys.parties.all(), queryKeys.dashboard.all(), queryKeys.transactions.all()].map((queryKey) => client.invalidateQueries({ queryKey })));
    } catch (caught) {
      setError(caught);
      if (caught instanceof ApiError && [400, 401, 403, 404, 422].includes(caught.status)) setAttempt(null);
    } finally { lock.current = false; setSubmitting(false); }
  }
  return { submit, attempt, receipt, error, isSubmitting, clearReceipt: () => { setReceipt(null); setError(null); setAttempt(null); } };
}
