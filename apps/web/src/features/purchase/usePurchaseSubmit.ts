import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSecondHandGoldPurchaseSchema, type SecondHandGoldPurchase } from '@gold/contracts';
import { ApiError } from '@/api/api-error';
import { newIdempotencyKey } from '@/api/client';
import { createSecondHandGoldPurchase } from '@/api/purchase';
import { queryKeys } from '@/api/query-keys';
import { usePurchaseDraftStore } from '@/stores/purchase-draft-store';

export function usePurchaseSubmit(quoteId: string | undefined, isOnline: boolean) {
  const client = useQueryClient();
  const lock = useRef(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<SecondHandGoldPurchase | null>(null);
  const attempt = usePurchaseDraftStore((s) => s.attempt);

  async function submit() {
    if (lock.current || receipt || !isOnline) return;
    const draft = usePurchaseDraftStore.getState();
    const parsed = createSecondHandGoldPurchaseSchema.safeParse({
      partyId: draft.seller?.id,
      grossWeightMg: draft.grossWeightMg,
      stoneWeightMg: draft.stoneWeightMg,
      otherDeductionWeightMg: draft.otherDeductionWeightMg,
      purchaseKarat: draft.purchaseKarat,
      quoteId,
      feeRial: draft.feeRial,
      paidRial: draft.paidRial,
      effectiveAt: new Date().toISOString(),
    });
    if (!draft.attempt && (!parsed.success || draft.seller?.type !== 'CONSUMER' || draft.seller.status !== 'ACTIVE')) return;
    const request = draft.attempt ?? (parsed.success ? { key: newIdempotencyKey(), input: parsed.data } : null);
    if (!request) return;
    lock.current = true;
    setSubmitting(true);
    setError(null);
    draft.setAttempt(request);
    try {
      const result = await createSecondHandGoldPurchase(request.input, request.key);
      setReceipt(result);
      draft.reset();
      // Refresh failure must never turn a committed purchase into a failed submission.
      void Promise.allSettled([
        queryKeys.inventoryBalances.all(), queryKeys.inventoryMovements.all(),
        queryKeys.parties.all(), queryKeys.dashboard.all(), queryKeys.transactions.all(),
      ].map((queryKey) => client.invalidateQueries({ queryKey })));
    } catch (caught) {
      setError(caught);
      // These responses explicitly reject the operation. Timeouts/5xx/409 remain uncertain.
      if (caught instanceof ApiError && [400, 401, 403, 404, 422].includes(caught.status)) {
        draft.setAttempt(null);
      }
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  }

  return { submit, isSubmitting, error, receipt, attempt,
    startNew: () => { setReceipt(null); setError(null); usePurchaseDraftStore.getState().reset(); },
  };
}
