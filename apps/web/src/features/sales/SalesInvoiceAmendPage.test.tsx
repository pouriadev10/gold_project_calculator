import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { SalesInvoiceDetail } from '@/api/contracts';
import { useUnitStore } from '@/stores/unit-store';
import SalesInvoiceAmendPage from './SalesInvoiceAmendPage';

const invoiceId = 'd5000000-0000-4000-8000-000000000001';
const partyId = 'a1000000-0000-4000-8000-000000000001';
const itemId = 'b1000000-0000-4000-8000-000000000001';
const amendMock = vi.fn();
const detailMock = vi.fn();
const policyMock = vi.fn();
const versionsMock = vi.fn();
const jewelryAtMock = vi.fn();
const coinTypesMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ invoiceId }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('@/api/queries', () => ({
  useSalesInvoiceDetail: () => detailMock(),
  useInvoiceAmendmentPolicy: () => policyMock(),
  useInvoiceVersions: () => versionsMock(),
  useJewelryItemAt: (...args: unknown[]) => jewelryAtMock(...args),
  useJewelryItems: () => ({
    data: { items: [{ jewelryItemId: itemId, title: 'دستبند', code: 'BR-1' }] },
    isError: false,
  }),
  useCoinTypes: () => coinTypesMock(),
}));
vi.mock('@/api/sales', () => ({ amendSalesInvoice: (...args: unknown[]) => amendMock(...args) }));
vi.mock('@/components/common/PartySelector', () => ({
  PartySelector: ({ value }: { value: { displayName: string } | null }) => (
    <p>مشتری: {value?.displayName}</p>
  ),
}));
vi.mock('@/components/keypad/NumericKeypad', () => ({ NumericKeypad: () => null }));
vi.mock('@/components/keypad/MoneyInput', () => ({
  MoneyInput: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: bigint;
    onChange: (value: bigint) => void;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value.toString()}
        onChange={(event) => onChange(BigInt(event.target.value || '0'))}
      />
    </label>
  ),
}));
vi.mock('@/components/keypad/CountInput', () => ({
  CountInput: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: bigint;
    onChange: (value: bigint) => void;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value.toString()}
        onChange={(event) => onChange(BigInt(event.target.value || '0'))}
      />
    </label>
  ),
}));

const DETAIL: SalesInvoiceDetail = {
  id: invoiceId,
  invoiceNumber: 122,
  status: 'FINALIZED',
  currentVersion: 1,
  party: { id: partyId, displayName: 'مشتری نمونه', type: 'CONSUMER', status: 'ACTIVE' },
  occurredAt: '2026-09-18T08:00:00.000Z',
  quoteSnapshot: {
    amountRial: '480000000',
    goldRatePerGramRial: '147744518',
    observedAt: '2026-09-18T07:59:00.000Z',
  },
  versions: [
    {
      version: 1,
      reason: null,
      reasonDetail: null,
      actor: null,
      createdAt: '2026-09-18T08:00:00.000Z',
      payableRial: '100000000',
      paidRial: '75000000',
      receivableRial: '25000000',
      pureWeightMg: '5000',
      items: [
        {
          itemType: 'JEWELRY',
          itemId,
          title: 'دستبند',
          quantity: '1',
          pureWeightMg: '5000',
          karat: 750,
          payableRial: '100000000',
        },
      ],
      settingsSnapshot: {
        baseQuoteKarat: '705',
        mithqalGramsX10k: '46083',
        roundingUnitRial: '1000',
        roundingPolicy: 'HALF_UP',
        profitRateBps: '700',
        taxRateBps: '1000',
      },
      ledgerSummary: { transactionCount: 1, entryCount: 4, balanced: true },
    },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <SalesInvoiceAmendPage />
    </QueryClientProvider>,
  );
  return {
    ...view,
    rerenderPage: () =>
      view.rerender(
        <QueryClientProvider client={client}>
          <SalesInvoiceAmendPage />
        </QueryClientProvider>,
      ),
  };
}

beforeEach(() => {
  useUnitStore.setState({ unit: 'gold' });
  amendMock.mockReset();
  detailMock.mockReset();
  policyMock.mockReset();
  versionsMock.mockReset();
  jewelryAtMock.mockReset();
  coinTypesMock.mockReset();
  detailMock.mockReturnValue({ data: DETAIL, isLoading: false, isError: false, refetch: vi.fn() });
  policyMock.mockReturnValue({
    data: {
      invoiceId,
      invoiceVersion: 1,
      allowed: true,
      restrictions: [],
      requiresManagerAuthorization: false,
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  });
  jewelryAtMock.mockReturnValue({
    data: {
      jewelryItemId: itemId,
      grossWeightMg: '7000',
      karat: 750,
      wageType: 'FLAT',
      wageValue: '1000000',
    },
    isLoading: false,
    isError: false,
  });
  coinTypesMock.mockReturnValue({ data: [], isError: false });
  versionsMock.mockReturnValue({
    data: {
      versions: [
        {
          version: 2,
          pureWeightMg: '6000',
          items: [{ itemType: 'JEWELRY', itemId, quantity: '1' }],
        },
      ],
    },
    isError: false,
  });
});

describe('SalesInvoiceAmendPage', () => {
  it('blocks the form when the backend rejects or returns an older version', () => {
    policyMock.mockReturnValue({
      data: { invoiceId, invoiceVersion: 0, allowed: true },
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    renderPage();
    expect(screen.queryByRole('button', { name: 'ثبت اصلاح فاکتور' })).not.toBeInTheDocument();
    expect(screen.getByText(/مجوز با نسخهٔ جاری/)).toBeInTheDocument();
  });

  it('sends only contract fields and shows the new server version with differences', async () => {
    amendMock.mockResolvedValue({
      invoiceId,
      invoiceNumber: 122,
      version: 2,
      payableRial: '120000000',
      receivableRial: '45000000',
      ledgerTransactionId: 'e1000000-0000-4000-8000-000000000001',
      inventoryMovementIds: [],
    });
    renderPage();
    expect(screen.getByText(/۷٫۰۰۰ گرم/)).toBeInTheDocument();
    expect(jewelryAtMock).toHaveBeenCalledWith(itemId, DETAIL.versions[0]!.createdAt);
    await userEvent.click(screen.getByRole('button', { name: 'ثبت اصلاح فاکتور' }));
    expect(screen.getByRole('alert')).toHaveTextContent('توضیح');
    fireEvent.change(screen.getByLabelText('توضیح دلیل'), {
      target: { value: 'ثبت اولیه نادرست بود' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'ثبت اصلاح فاکتور' }));
    await waitFor(() => expect(amendMock).toHaveBeenCalledOnce());
    expect(amendMock.mock.calls[0]?.[0]).toBe(invoiceId);
    expect(amendMock.mock.calls[0]?.[1]).toEqual({
      reason: 'OTHER',
      reasonDetail: 'ثبت اولیه نادرست بود',
      partyId,
      item: { itemType: 'JEWELRY', jewelryItemId: itemId, paidRial: '75000000' },
    });
    expect(typeof amendMock.mock.calls[0]?.[2]).toBe('string');
    expect(await screen.findByText('نسخهٔ جدید ثبت شد')).toBeInTheDocument();
    expect(screen.getByText(/فاکتور ۱۲۲ · نسخهٔ ۲/)).toBeInTheDocument();
    expect(screen.getByText(/اختلاف وزن خالص/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'ریال' }));
    expect(
      screen.getByText('اختلاف مبلغ').parentElement?.querySelector('[data-raw]'),
    ).toHaveAttribute('data-raw', '20000000');
    expect(
      screen.getByText('تغییر ماندهٔ مشتری').parentElement?.querySelector('[data-raw]'),
    ).toHaveAttribute('data-raw', '20000000');
    expect(screen.getByText(/نسخهٔ قبلی و سندهای آن تغییر نکرده‌اند/)).toBeInTheDocument();
  });

  it('does not submit while historical item facts are unavailable', async () => {
    jewelryAtMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'ثبت اصلاح فاکتور' }));
    expect(screen.getByRole('alert')).toHaveTextContent('مشخصات تاریخی');
    expect(amendMock).not.toHaveBeenCalled();
  });

  it('preserves entered fields while the policy is being rechecked, but disables submission', () => {
    const view = renderPage();
    fireEvent.change(screen.getByLabelText('توضیح دلیل'), { target: { value: 'جزئیات اصلاح' } });
    policyMock.mockReturnValue({
      data: { invoiceId, invoiceVersion: 1, allowed: true, restrictions: [] },
      isLoading: false,
      isFetching: true,
      isError: false,
    });
    view.rerenderPage();
    expect(screen.getByLabelText('توضیح دلیل')).toHaveValue('جزئیات اصلاح');
    expect(screen.getByText('در حال بررسی دوبارهٔ مجوز اصلاح…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ثبت اصلاح فاکتور' })).toBeDisabled();
  });

  it('submits coin count as an integer and market price as a string, without converting count to weight', async () => {
    detailMock.mockReturnValue({
      data: {
        ...DETAIL,
        versions: [
          {
            ...DETAIL.versions[0]!,
            pureWeightMg: null,
            items: [
              {
                itemType: 'COIN',
                itemId,
                title: 'سکه نمونه',
                quantity: '2',
                pureWeightMg: null,
                karat: 900,
                payableRial: '100000000',
              },
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    coinTypesMock.mockReturnValue({
      data: [{ coinTypeId: itemId, title: 'سکه نمونه', active: true }],
      isError: false,
    });
    versionsMock.mockReturnValue({
      data: {
        versions: [
          { version: 2, pureWeightMg: null, items: [{ itemType: 'COIN', itemId, quantity: '3' }] },
        ],
      },
      isError: false,
    });
    amendMock.mockResolvedValue({
      invoiceId,
      invoiceNumber: 122,
      version: 2,
      payableRial: '120000000',
      receivableRial: '45000000',
      ledgerTransactionId: 'e1000000-0000-4000-8000-000000000001',
      inventoryMovementIds: [],
    });
    renderPage();
    fireEvent.change(screen.getByLabelText('قیمت واحد بازار'), { target: { value: '60000000' } });
    fireEvent.change(screen.getByLabelText('توضیح دلیل'), { target: { value: 'اصلاح نوع سکه' } });
    await userEvent.click(screen.getByRole('button', { name: 'ثبت اصلاح فاکتور' }));
    await waitFor(() => expect(amendMock).toHaveBeenCalledOnce());
    expect(amendMock.mock.calls[0]?.[1].item).toEqual({
      itemType: 'COIN',
      coinTypeId: itemId,
      count: 2,
      marketUnitPriceRial: '60000000',
      paidRial: '75000000',
    });
    expect(await screen.findByText(/اختلاف تعداد سکه: ۱/)).toBeInTheDocument();
  });
});
