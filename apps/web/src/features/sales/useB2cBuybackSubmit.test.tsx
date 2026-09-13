import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { B2cBuyback, CreateB2cBuybackInput } from '@gold/contracts';
import { ApiError } from '@/api/api-error';
import { queryKeys } from '@/api/query-keys';
import type * as PurchaseApi from '@/api/purchase';
import { useB2cBuybackSubmit } from './useB2cBuybackSubmit';

const createB2cBuybackMock = vi.fn();
vi.mock('@/api/purchase', async (importOriginal) => ({
  ...(await importOriginal<typeof PurchaseApi>()),
  createB2cBuyback: (...args: unknown[]) => createB2cBuybackMock(...args),
}));

const INVOICE_ID = 'd1000000-0000-4000-8000-000000000001';
const INPUT: CreateB2cBuybackInput = {
  grossWeightMg: '1000',
  stoneWeightMg: '0',
  otherDeductionWeightMg: '0',
  purchaseKarat: 740,
  quoteId: 'c1000000-0000-4000-8000-000000000001',
  paidRial: '20000000',
  effectiveAt: '2026-09-10T10:15:00.000Z',
};
const RECEIPT: B2cBuyback = {
  secondHandPurchaseId: 'e1000000-0000-4000-8000-000000000001',
  ledgerTransactionId: 'e2000000-0000-4000-8000-000000000001',
  inventoryMovementId: 'e3000000-0000-4000-8000-000000000001',
  sourceInvoiceId: INVOICE_ID,
  pureWeightMg: '740',
  goldRatePerGramRial: '218000000',
  paidRial: INPUT.paidRial,
  payableRial: '745000000',
  breakdown: {
    originalPurchaseAmountRial: '825000000',
    todayPurchaseAmountRial: '765000000',
    differenceRial: '-60000000',
    wageBurnedRial: '45000000',
    karatDifferenceRial: '-12000000',
    marketPriceDifferenceRial: '9000000',
    otherCalculationDifferenceRial: '-12000000',
  },
};

function setup(isOnline = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const hook = renderHook(() => useB2cBuybackSubmit(INVOICE_ID, isOnline), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { ...hook, invalidate };
}

beforeEach(() => {
  createB2cBuybackMock.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useB2cBuybackSubmit — ثبت امن Buyback B2C (FE-063)', () => {
  it('درخواست را یک بار ثبت و موجودی آبشده را تازه می‌کند، بدون دست‌زدن به فاکتور مرجع', async () => {
    let resolve!: (value: B2cBuyback) => void;
    createB2cBuybackMock.mockImplementation(
      () =>
        new Promise<B2cBuyback>((promiseResolve) => {
          resolve = promiseResolve;
        }),
    );
    const hook = setup();
    let pending!: Promise<void>;

    act(() => {
      pending = hook.result.current.submit(INPUT);
      void hook.result.current.submit(INPUT);
    });

    expect(hook.result.current.isSubmitting).toBe(true);
    expect(createB2cBuybackMock).toHaveBeenCalledTimes(1);
    expect(createB2cBuybackMock).toHaveBeenCalledWith(INVOICE_ID, INPUT, expect.any(String));

    await act(async () => {
      resolve(RECEIPT);
      await pending;
    });

    expect(hook.result.current.receipt).toEqual(RECEIPT);
    expect(hook.invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.inventoryBalances.byItemType('MELTED_GOLD'),
    });
    expect(hook.invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.parties.all() });
    expect(hook.invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.salesInvoices.all() });
  });

  it('پس از پاسخ نامطمئن و remount دقیقاً همان بدنه و کلید idempotency را تکرار می‌کند', async () => {
    createB2cBuybackMock.mockRejectedValueOnce(new TypeError('offline'));
    const first = setup();

    await act(() => first.result.current.submit(INPUT));
    const firstCall = createB2cBuybackMock.mock.calls[0]!;
    expect(first.result.current.attempt).not.toBeNull();
    first.unmount();

    createB2cBuybackMock.mockResolvedValueOnce(RECEIPT);
    const second = setup();
    await act(() => second.result.current.submit({ ...INPUT, paidRial: '0' }));
    const retryCall = createB2cBuybackMock.mock.calls[1]!;

    expect(retryCall[1]).toEqual(firstCall[1]);
    expect(retryCall[2]).toBe(firstCall[2]);
    await waitFor(() => expect(second.result.current.receipt).toEqual(RECEIPT));
    expect(sessionStorage.length).toBe(0);
  });

  it('پس از رد قطعی سرور، تلاش را آزاد می‌کند تا پرداخت اصلاح شود', async () => {
    createB2cBuybackMock.mockRejectedValueOnce(new ApiError(400, 'BAD_REQUEST', 'پرداخت نامعتبر'));
    const hook = setup();

    await act(() => hook.result.current.submit(INPUT));

    expect(hook.result.current.attempt).toBeNull();
    expect(hook.result.current.error).toBeTruthy();
    const corrected = { ...INPUT, paidRial: '0' };
    createB2cBuybackMock.mockResolvedValueOnce({ ...RECEIPT, paidRial: '0' });
    await act(() => hook.result.current.submit(corrected));

    expect(createB2cBuybackMock.mock.calls[1]![1]).toEqual(corrected);
  });
});
