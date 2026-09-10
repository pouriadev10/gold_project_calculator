import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toPersianDigits } from '@gold/core-calc';
import { ApiError } from '@/api/api-error';
import type * as Queries from '@/api/queries';
import type { CoinTypeVersion, InventoryBalance, Party, PriceQuote } from '@/api/contracts';
import type { ReactNode } from 'react';
import type * as Router from '@tanstack/react-router';
import { useRecentPartiesStore } from '@/stores/recent-parties-store';
import CoinPurchaseForm from './CoinPurchaseForm';

const createPurchaseMock = vi.fn();
vi.mock('@/api/purchase', () => ({ createSecondHandCoinPurchase: (...args: unknown[]) => createPurchaseMock(...args) }));
const useCoinTypesMock = vi.fn(); const useInventoryBalancesMock = vi.fn(); const useLatestPriceQuoteMock = vi.fn(); const usePartiesMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({ ...(await importOriginal<typeof Queries>()),
  useCoinTypes: () => useCoinTypesMock(), useInventoryBalances: (...args: unknown[]) => useInventoryBalancesMock(...args),
  useLatestPriceQuote: (...args: unknown[]) => useLatestPriceQuoteMock(...args), useParties: (...args: unknown[]) => usePartiesMock(...args),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({ ...(await importOriginal<typeof Router>()), useBlocker: vi.fn(),
  Link: ({ children, activeProps: _activeProps, activeOptions: _activeOptions, ...props }: { children: ReactNode; activeProps?: unknown; activeOptions?: unknown; to: string }) => <a href={props.to}>{children}</a>,
}));

const PARTY_ID = 'a1000000-0000-4000-8000-000000000001';
const COIN_ID = 'd1000000-0000-4000-8000-000000000001';
const PRIVATE_COIN_ID = 'd1000000-0000-4000-8000-000000000002';
const QUOTE_ID = 'c1000000-0000-4000-8000-000000000001';
const consumer: Party = { id: PARTY_ID, type: 'CONSUMER', displayName: 'حسین مرادی', mobile: '09121234567',
  nationalId: null, linkedTenantId: null, status: 'ACTIVE', notes: null,
  createdAt: '2026-08-01T08:00:00Z', updatedAt: '2026-08-01T08:00:00Z' };
const business: Party = { ...consumer, id: 'a1000000-0000-4000-8000-000000000002', type: 'BUSINESS', displayName: 'همکار بازار' };
const central: CoinTypeVersion = { id: 'e1000000-0000-4000-8000-000000000001', coinTypeId: COIN_ID,
  code: 'BAHAR', title: 'تمام بهار آزادی', grossWeightUg: '8133000', karat: 900,
  validFrom: '2026-08-01T08:00:00Z', validTo: null, version: 1, active: true,
  mintType: 'CENTRAL_BANK', isCentralBankMinted: true };
const privateCoin: CoinTypeVersion = { ...central, id: 'e1000000-0000-4000-8000-000000000002',
  coinTypeId: PRIVATE_COIN_ID, code: 'PRIVATE', title: 'سکه خصوصی', mintType: 'PRIVATE_MINT', isCentralBankMinted: false };
const quote: PriceQuote = { id: QUOTE_ID, quoteType: 'MAZNEH', amountRial: 324_885_150n,
  source: 'MANUAL', observedAt: new Date().toISOString(), createdBy: null, createdAt: new Date().toISOString() };
const balance: InventoryBalance = { itemType: 'COIN', itemId: COIN_ID, quantity: '3' };
const result = { secondHandPurchaseId: 'f1000000-0000-4000-8000-000000000001',
  ledgerTransactionId: 'f2000000-0000-4000-8000-000000000001', inventoryMovementId: 'f3000000-0000-4000-8000-000000000001',
  coinTypeId: COIN_ID, count: 2, purchaseUnitPriceRial: '100000000', purchaseAmountRial: '200000000',
  paidRial: '200000000', payableRial: '0', intrinsicValueRial: '73197000', bubbleRial: '26803000' };

function renderForm() {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}><CoinPurchaseForm /></QueryClientProvider>);
}

async function chooseRecentParty(user: ReturnType<typeof userEvent.setup>, party: Party) {
  act(() => useRecentPartiesStore.getState().recordSelection({ id: party.id, displayName: party.displayName, mobile: party.mobile,
    type: party.type, status: party.status }));
  await user.click(screen.getByLabelText('فروشنده'));
  await user.click(screen.getByText(party.displayName));
}

async function enterDigits(user: ReturnType<typeof userEvent.setup>, label: string, digits: string) {
  await user.click(screen.getByLabelText(label));
  for (const digit of digits) await user.click(screen.getByRole('button', { name: `رقم ${toPersianDigits(digit)}` }));
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await chooseRecentParty(user, consumer);
  await user.selectOptions(screen.getByLabelText('نوع سکه'), central.title);
  await enterDigits(user, 'تعداد', '2');
  await enterDigits(user, 'نرخ خرید هر سکه', '100000000');
}

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); useRecentPartiesStore.setState({ recent: [] });
  createPurchaseMock.mockReset(); useCoinTypesMock.mockReset(); useInventoryBalancesMock.mockReset(); useLatestPriceQuoteMock.mockReset(); usePartiesMock.mockReset();
  useCoinTypesMock.mockReturnValue({ data: [central, privateCoin], isLoading: false, isError: false, refetch: vi.fn() });
  useInventoryBalancesMock.mockReturnValue({ data: [balance], isLoading: false, isError: false, refetch: vi.fn() });
  useLatestPriceQuoteMock.mockReturnValue({ data: quote, isLoading: false, isError: false, isSuccess: true });
  usePartiesMock.mockReturnValue({ data: { items: [consumer, business] }, isLoading: false, isError: false, refetch: vi.fn() });
});

describe('CoinPurchaseForm — خرید سکه از مصرف‌کننده (FE-060)', () => {
  it('نرخ خرید را مستقل توضیح می‌دهد و حباب را فقط برای سکه بانک مرکزی نشان می‌دهد', async () => {
    const user = userEvent.setup(); renderForm();
    expect(screen.getByText('این نرخ مستقل از نرخ فروش است و فقط برای همین خرید ثبت می‌شود.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('نوع سکه'), central.title);
    expect(screen.getByText('حباب خرید')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('نوع سکه'), privateCoin.title);
    expect(screen.queryByText('حباب خرید')).not.toBeInTheDocument();
  });

  it('خرید را با تعداد صحیح و رشته‌های ریالی ثبت و پاسخ سرور را در رسید نمایش می‌دهد', async () => {
    createPurchaseMock.mockResolvedValue(result);
    const user = userEvent.setup(); renderForm(); await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'پرداخت کامل' }));
    await user.click(screen.getByRole('button', { name: 'ثبت خرید سکه' }));
    await waitFor(() => expect(createPurchaseMock).toHaveBeenCalledTimes(1));
    const [input, key] = createPurchaseMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(input).toMatchObject({ partyId: PARTY_ID, coinTypeId: COIN_ID, count: 2,
      purchaseUnitPriceRial: '100000000', quoteId: QUOTE_ID, paidRial: '200000000' });
    expect(typeof key).toBe('string');
    expect(await screen.findByText('خرید سکه ثبت شد')).toBeInTheDocument();
    expect(screen.getByText(result.secondHandPurchaseId)).toBeInTheDocument();
    expect(screen.getByText('حباب هر سکه')).toBeInTheDocument();
  });

  it('فروشنده همکار را رد می‌کند', async () => {
    const user = userEvent.setup(); renderForm(); await chooseRecentParty(user, business);
    expect(screen.getByRole('alert')).toHaveTextContent('فروشنده باید مصرف‌کننده باشد');
    expect(screen.getByRole('button', { name: 'ثبت خرید سکه' })).toBeDisabled();
  });

  it('پرداخت بیشتر از خرید را کنار فیلد اعلام و ثبت را مسدود می‌کند', async () => {
    const user = userEvent.setup(); renderForm(); await fillRequired(user);
    await enterDigits(user, 'پرداخت اکنون', '300000000');
    expect(screen.getByText('پرداخت نمی‌تواند بیشتر از مبلغ خرید باشد.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ثبت خرید سکه' })).toBeDisabled();
  });

  it('پس از رد قطعی سرور فرم را برای اصلاح باز نگه می‌دارد', async () => {
    createPurchaseMock.mockRejectedValue(new ApiError(400, 'INVALID_INPUT', 'نرخ خرید پذیرفته نشد'));
    const user = userEvent.setup(); renderForm(); await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'ثبت خرید سکه' }));
    expect(await screen.findByText('موارد مشخص‌شده را اصلاح و دوباره ثبت کنید.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ثبت خرید سکه' })).toBeEnabled();
  });
});
