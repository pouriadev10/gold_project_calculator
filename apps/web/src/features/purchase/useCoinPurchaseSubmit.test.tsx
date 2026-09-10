import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkError } from '@/api/api-error';
import { queryKeys } from '@/api/query-keys';
import { useCoinPurchaseSubmit } from './useCoinPurchaseSubmit';

const createPurchaseMock = vi.fn();
vi.mock('@/api/purchase', () => ({ createSecondHandCoinPurchase: (...args: unknown[]) => createPurchaseMock(...args) }));

const input = { partyId: 'a1000000-0000-4000-8000-000000000001', coinTypeId: 'd1000000-0000-4000-8000-000000000001',
  count: 2, purchaseUnitPriceRial: '100000000', quoteId: 'c1000000-0000-4000-8000-000000000001',
  paidRial: '0', effectiveAt: '2026-09-09T10:00:00.000Z' };
const result = { secondHandPurchaseId: 'f1000000-0000-4000-8000-000000000001',
  ledgerTransactionId: 'f2000000-0000-4000-8000-000000000001', inventoryMovementId: 'f3000000-0000-4000-8000-000000000001',
  coinTypeId: input.coinTypeId, count: 2, purchaseUnitPriceRial: '100000000', purchaseAmountRial: '200000000',
  paidRial: '0', payableRial: '200000000', intrinsicValueRial: '73197000', bubbleRial: '26803000' };

function wrapper(client: QueryClient) { return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>; }

beforeEach(() => createPurchaseMock.mockReset());

describe('useCoinPurchaseSubmit', () => {
  it('دو ارسال هم‌زمان را به یک درخواست محدود و cacheهای موجودی و شخص را تازه می‌کند', async () => {
    let resolve!: (value: typeof result) => void;
    createPurchaseMock.mockReturnValue(new Promise((done) => { resolve = done; }));
    const client = new QueryClient(); const invalidate = vi.spyOn(client, 'invalidateQueries');
    const onSuccess = vi.fn(); const hook = renderHook(() => useCoinPurchaseSubmit(onSuccess), { wrapper: wrapper(client) });
    let first!: Promise<void>;
    act(() => { first = hook.result.current.submit(input, 100_000_000n); void hook.result.current.submit(input, 100_000_000n); });
    expect(createPurchaseMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.isSubmitting).toBe(true);
    await act(async () => { resolve(result); await first; });
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(hook.result.current.receipt?.purchase).toEqual(result);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.inventoryBalances.all() }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.parties.all() });
  });

  it('پس از پاسخ نامشخص همان بدنه و کلید تلاش اول را دوباره می‌فرستد', async () => {
    createPurchaseMock.mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce(result);
    const hook = renderHook(() => useCoinPurchaseSubmit(vi.fn()), { wrapper: wrapper(new QueryClient()) });
    await act(async () => { await hook.result.current.submit(input, 100_000_000n); });
    const firstCall = createPurchaseMock.mock.calls[0];
    expect(hook.result.current.attempt).not.toBeNull();
    await act(async () => { await hook.result.current.submit({ ...input, count: 9 }, 999n); });
    expect(createPurchaseMock.mock.calls[1]).toEqual(firstCall);
    expect(hook.result.current.receipt?.rate1000).toBe(100_000_000n);
  });
});
