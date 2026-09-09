import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { usePurchaseDraftStore } from '@/stores/purchase-draft-store';
import { queryKeys } from '@/api/query-keys';
import { usePurchaseSubmit } from './usePurchaseSubmit';

const quoteId = 'c1000000-0000-4000-8000-000000000001';
const result = {
  secondHandPurchaseId: 'a1000000-0000-4000-8000-000000000011',
  ledgerTransactionId: 'a1000000-0000-4000-8000-000000000012',
  inventoryMovementId: 'a1000000-0000-4000-8000-000000000013',
  pureWeightMg: '666', goldRatePerGramRial: '30000000',
  grossPurchaseAmountRial: '20000000', feeRial: '1000', finalAmountRial: '19999000',
  paidRial: '5000000', payableRial: '14999000',
};
const fetchMock = vi.fn<typeof fetch>();
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const hook = renderHook(() => usePurchaseSubmit(quoteId, true), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  return { ...hook, invalidate };
}
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  usePurchaseDraftStore.getState().reset();
  usePurchaseDraftStore.setState({ step: 'PAYMENT', grossWeightMg: '1000', stoneWeightMg: '100', feeRial: '1000', paidRial: '5000000',
    seller: { id: 'a1000000-0000-4000-8000-000000000001', displayName: 'فروشنده', mobile: null, type: 'CONSUMER', status: 'ACTIVE' } });
});
afterEach(() => vi.unstubAllGlobals());

describe('purchase submission through API client', () => {
  it('submits strings with an idempotency key, keeps pending locked, displays server result and refreshes balances', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const hook = setup();
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.submit(); void hook.result.current.submit(); });
    expect(hook.result.current.isSubmitting).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/purchase/second-hand/gold');
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBeTruthy();
    expect(JSON.parse(String(init?.body))).toMatchObject({ grossWeightMg: '1000', paidRial: '5000000', quoteId });
    await act(async () => { resolve(new Response(JSON.stringify(result), { status: 201 })); await pending; });
    expect(hook.result.current.receipt).toEqual(result);
    expect(usePurchaseDraftStore.getState().seller).toBeNull();
    expect(hook.invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.inventoryBalances.all() });
    expect(hook.invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.parties.all() });
  });

  it('replays the exact request and key after a lost response, including after remount', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const first = setup();
    await act(() => first.result.current.submit());
    const sent = fetchMock.mock.calls[0]![1];
    expect(first.result.current.attempt).not.toBeNull();
    first.unmount();
    usePurchaseDraftStore.setState({ paidRial: '1' });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 201 }));
    const second = setup();
    await act(() => second.result.current.submit());
    const retried = fetchMock.mock.calls[1]![1];
    expect(retried?.body).toBe(sent?.body);
    expect(new Headers(retried?.headers).get('Idempotency-Key')).toBe(new Headers(sent?.headers).get('Idempotency-Key'));
    expect(second.result.current.receipt).toEqual(result);
  });

  it('keeps a rejected draft editable and submits corrected data', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'invalid payment', code: 'BAD_REQUEST' }), { status: 400 }));
    const hook = setup();
    await act(() => hook.result.current.submit());
    expect(usePurchaseDraftStore.getState().grossWeightMg).toBe('1000');
    expect(hook.result.current.attempt).toBeNull();
    expect(hook.result.current.error).toBeTruthy();
    act(() => usePurchaseDraftStore.getState().setPaidRial('0'));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 201 }));
    await act(() => hook.result.current.submit());
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)).paidRial).toBe('0');
    await waitFor(() => expect(hook.result.current.receipt).toEqual(result));
  });
});
