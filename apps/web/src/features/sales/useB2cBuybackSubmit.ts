import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  createB2cBuybackSchema,
  type B2cBuyback,
  type CreateB2cBuybackInput,
} from '@gold/contracts';
import { ApiError } from '@/api/api-error';
import { newIdempotencyKey } from '@/api/client';
import { createB2cBuyback } from '@/api/purchase';
import { queryKeys } from '@/api/query-keys';

interface B2cBuybackAttempt {
  readonly key: string;
  readonly input: CreateB2cBuybackInput;
}

const ATTEMPT_STORAGE_PREFIX = 'gold-ui-b2c-buyback-attempt:';

function attemptStorageKey(invoiceId: string): string {
  return `${ATTEMPT_STORAGE_PREFIX}${invoiceId}`;
}

function readAttempt(invoiceId: string): B2cBuybackAttempt | null {
  try {
    const raw = sessionStorage.getItem(attemptStorageKey(invoiceId));
    if (!raw) return null;
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== 'object' || stored === null) return null;
    const record = stored as Record<string, unknown>;
    const parsed = createB2cBuybackSchema.safeParse(record.input);
    return typeof record.key === 'string' && record.key.length > 0 && parsed.success
      ? { key: record.key, input: parsed.data }
      : null;
  } catch {
    return null;
  }
}

function persistAttempt(invoiceId: string, attempt: B2cBuybackAttempt | null): void {
  const key = attemptStorageKey(invoiceId);
  if (attempt) sessionStorage.setItem(key, JSON.stringify(attempt));
  else sessionStorage.removeItem(key);
}

/**
 * ثبت مستقل Buyback B2C با نگه‌داشتن دقیق بدنه و کلید تلاش نامطمئن.
 * فاکتور مرجع عمداً invalidate نمی‌شود؛ خرید، سندی تازه است نه اصلاح فروش.
 */
export function useB2cBuybackSubmit(invoiceId: string, isOnline: boolean) {
  const client = useQueryClient();
  const lock = useRef(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<B2cBuyback | null>(null);
  const [attempt, setAttempt] = useState<B2cBuybackAttempt | null>(() => readAttempt(invoiceId));

  async function submit(candidate: CreateB2cBuybackInput) {
    if (lock.current || receipt || !isOnline) return;

    const request =
      attempt ??
      (() => {
        const parsed = createB2cBuybackSchema.safeParse(candidate);
        return parsed.success ? { key: newIdempotencyKey(), input: parsed.data } : null;
      })();
    if (!request) return;

    lock.current = true;
    setSubmitting(true);
    setError(null);
    setAttempt(request);
    persistAttempt(invoiceId, request);

    try {
      const result = await createB2cBuyback(invoiceId, request.input, request.key);
      setReceipt(result);
      setAttempt(null);
      persistAttempt(invoiceId, null);
      void Promise.allSettled(
        [
          queryKeys.inventoryBalances.byItemType('MELTED_GOLD'),
          queryKeys.inventoryMovements.all(),
          queryKeys.parties.all(),
          queryKeys.dashboard.all(),
          queryKeys.transactions.all(),
        ].map((queryKey) => client.invalidateQueries({ queryKey })),
      );
    } catch (caught) {
      setError(caught);
      // پاسخ قطعی رد شده قابل اصلاح است؛ timeout/5xx/409 همان تلاش را نگه می‌دارند.
      if (caught instanceof ApiError && [400, 401, 403, 404, 422].includes(caught.status)) {
        setAttempt(null);
        persistAttempt(invoiceId, null);
      }
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  }

  return { submit, isSubmitting, error, receipt, attempt };
}
