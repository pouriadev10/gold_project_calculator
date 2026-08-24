import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReactRouter from '@tanstack/react-router';
import type * as Queries from '@/api/queries';
import type { Party, PartyBalances, PriceQuote } from '@/api/contracts';
import SettlementsNewPage from './SettlementsNewPage';

/**
 * FE-055 — صفحه‌ی ثبت تسویه‌ی شخص. این تست فقط **سیم‌کشی/اسمبل** را
 * می‌سنجد — کدام فرم برای کدام روش رندر می‌شود — نه رفتار داخلی هر فرم،
 * که هرکدام تست مستقل و کامل خودشان را دارند (FE-051..054). چهار
 * کامپوننت فرم به‌همین‌خاطر shallow mock می‌شوند.
 *
 * `useParams` واقعی به `RouterProvider` نیاز دارد — همان الگوی
 * `PartyDetailPage.test.tsx` (FE-034) — اینجا هم مستقیم mock می‌شود.
 */

const TEST_PARTY_ID = 'a1000000-0000-4000-8000-000000000001';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    useParams: () => ({ partyId: TEST_PARTY_ID }),
  };
});

vi.mock('@/features/payments/RialSettlementForm', () => ({
  RialSettlementForm: ({ partyId }: { partyId: string }) => <div>فرم ریالی برای {partyId}</div>,
}));
vi.mock('@/features/payments/GoldSettlementForm', () => ({
  GoldSettlementForm: ({ partyId }: { partyId: string }) => <div>فرم طلا برای {partyId}</div>,
}));
vi.mock('@/features/payments/CoinSettlementForm', () => ({
  CoinSettlementForm: ({ partyId }: { partyId: string }) => <div>فرم سکه برای {partyId}</div>,
}));
vi.mock('@/features/payments/MixedSettlementForm', () => ({
  MixedSettlementForm: ({ partyId }: { partyId: string }) => <div>فرم ترکیبی برای {partyId}</div>,
}));

const useLatestPriceQuoteMock = vi.fn();
const usePartyMock = vi.fn();
const usePartyBalancesMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useLatestPriceQuote: (...args: unknown[]) => useLatestPriceQuoteMock(...args),
  useParty: (...args: unknown[]) => usePartyMock(...args),
  usePartyBalances: (...args: unknown[]) => usePartyBalancesMock(...args),
}));

function party(): Party {
  return {
    id: TEST_PARTY_ID,
    type: 'CONSUMER',
    displayName: 'حسین مرادی',
    mobile: '09121234567',
    nationalId: null,
    linkedTenantId: null,
    status: 'ACTIVE',
    notes: null,
    createdAt: '2026-07-30T09:00:00+00:00',
    updatedAt: '2026-07-30T09:00:00+00:00',
  };
}

function balances(rial: string): PartyBalances {
  return {
    partyId: TEST_PARTY_ID,
    calculatedAt: new Date().toISOString(),
    defaultDisplayUnit: 'GOLD',
    rawBalances: { rial, pureGoldMg: '0', coins: [] },
    convertedView: null,
  };
}

function priceQuote(): PriceQuote {
  return {
    id: 'c1000000-0000-4000-8000-000000000001',
    quoteType: 'MAZNEH',
    amountRial: 324_885_150n,
    source: 'MANUAL',
    observedAt: '2026-08-20T08:00:00+00:00',
    createdBy: null,
    createdAt: '2026-08-20T08:00:00+00:00',
  };
}

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <SettlementsNewPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useLatestPriceQuoteMock.mockReset();
  usePartyMock.mockReset();
  usePartyBalancesMock.mockReset();

  useLatestPriceQuoteMock.mockReturnValue({ data: priceQuote(), isLoading: false, isSuccess: true });
  usePartyMock.mockReturnValue({ data: party(), isLoading: false, isError: false });
  usePartyBalancesMock.mockReturnValue({ data: balances('45000000'), isLoading: false, isError: false });
});

/**
 * `UnitToggle` (سربرگ صفحه) هم یک radiogroup با گزینه‌های «طلا»/«ریال»
 * است — همان برچسب‌های `PaymentMethodSelector` برای مفهومی کاملاً جدا
 * (واحد نمایش، نه روش تسویه). این اولین صفحه‌ای است که هر دو کنار هم
 * می‌نشینند، پس هر جستجویی باید صریح به radiogroup «روش پرداخت» محدود
 * شود، وگرنه با «چند عنصر پیدا شد» شکست می‌خورد.
 */
function methodSelector() {
  return screen.getByRole('radiogroup', { name: 'روش پرداخت' });
}

describe('SettlementsNewPage — ثبت تسویه‌ی شخص (FE-055)', () => {
  it('مانده فعلی و نام شخص را نشان می‌دهد', () => {
    renderPage();
    expect(screen.getByText('ثبت تسویه — حسین مرادی')).toBeInTheDocument();
    expect(screen.getByText('مانده فعلی')).toBeInTheDocument();
  });

  it('«نسیه» در انتخاب‌گر نیست — فقط چهار روش تسویه‌ی واقعی', () => {
    renderPage();
    const radios = within(methodSelector()).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(within(methodSelector()).queryByRole('radio', { name: 'نسیه' })).not.toBeInTheDocument();
  });

  it('پیش از انتخاب هیچ روشی، هیچ فرمی رندر نمی‌شود', () => {
    renderPage();
    expect(screen.queryByText(/فرم/)).not.toBeInTheDocument();
  });

  it.each([
    ['ریال', 'فرم ریالی برای'],
    ['طلا', 'فرم طلا برای'],
    ['سکه', 'فرم سکه برای'],
    ['ترکیبی', 'فرم ترکیبی برای'],
  ])('انتخاب «%s» فرم متناظرش را با partyId درست رندر می‌کند', async (methodLabel, expectedText) => {
    const user = userEvent.setup();
    renderPage();

    await user.click(within(methodSelector()).getByRole('radio', { name: methodLabel }));

    expect(screen.getByText(`${expectedText} ${TEST_PARTY_ID}`)).toBeInTheDocument();
  });
});
