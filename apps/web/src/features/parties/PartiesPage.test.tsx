import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReactRouter from '@tanstack/react-router';
import type * as Queries from '@/api/queries';
import type { ReactNode } from 'react';
import PartiesPage from './PartiesPage';

/**
 * FE-032 — سطح صفحه: سیم‌کشی فیلترها/جست‌وجو به `useParties`، و دکمه‌ی
 * «افزودن شخص». رفتار خودِ فهرست (اسکلت/خطا/خالی/جدول/کارت/pagination)
 * در `PartyList.test.tsx` پوشش دارد؛ `useParties` مستقیم mock می‌شود
 * (همان الگوی `PricingPage.test.tsx` برای `usePriceQuoteHistory`) تا این
 * فایل به fetch واقعی وابسته نباشد.
 */
const usePartiesMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useParties: (...args: unknown[]) => usePartiesMock(...args),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    Link: ({ to, params, children, ...rest }: { to: string; params?: Record<string, string>; children?: ReactNode }) => (
      <a href={`${to}/${params?.['partyId'] ?? ''}`} {...rest}>
        {children}
      </a>
    ),
  };
});

function partyPage(total: number, limit: number, offset: number) {
  return {
    items: Array.from({ length: Math.min(limit, Math.max(0, total - offset)) }, (_, i) => ({
      id: `p${offset + i}`,
      type: 'CONSUMER' as const,
      displayName: `شخص ${offset + i}`,
      mobile: null,
      nationalId: null,
      linkedTenantId: null,
      status: 'ACTIVE' as const,
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    total,
    limit,
    offset,
  };
}

function lastQuery() {
  const call = usePartiesMock.mock.calls.at(-1) as [Record<string, unknown>] | undefined;
  return call?.[0];
}

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <PartiesPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  usePartiesMock.mockReset();
  usePartiesMock.mockReturnValue({
    data: partyPage(14, 10, 0),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe('PartiesPage — عنوان و فیلترهای اولیه', () => {
  it('عنوان «اشخاص» را نشان می‌دهد و بدون فیلتر فراخوانی می‌شود', () => {
    renderPage();
    expect(screen.getByText('اشخاص')).toBeInTheDocument();
    expect(lastQuery()).toEqual({ limit: 10, offset: 0 });
  });
});

describe('PartiesPage — جست‌وجو (تمام است وقتی: debounce کنترل‌شده باشد)', () => {
  it('بلافاصله بعد از تایپ، هنوز فیلتر search به query اضافه نشده', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('جست‌وجوی اشخاص'), 'مهدی');
    expect(lastQuery()).toEqual({ limit: 10, offset: 0 });
  });

  it('بعد از سررسید تأخیر، جست‌وجو با مقدار واردشده فراخوانی می‌شود', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('جست‌وجوی اشخاص'), 'مهدی');
    await waitFor(() => expect(lastQuery()).toEqual({ search: 'مهدی', limit: 10, offset: 0 }));
  });
});

describe('PartiesPage — فیلتر نوع/وضعیت', () => {
  it('انتخاب نوع بلافاصله (بدون تأخیر) در query اثر می‌گذارد', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('فیلتر نوع'), 'BUSINESS');
    expect(lastQuery()).toEqual({ type: 'BUSINESS', limit: 10, offset: 0 });
  });

  it('انتخاب وضعیت در query اثر می‌گذارد', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('فیلتر وضعیت'), 'INACTIVE');
    expect(lastQuery()).toEqual({ status: 'INACTIVE', limit: 10, offset: 0 });
  });

  it('تغییر فیلتر، صفحه را به اول برمی‌گرداند', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /بعدی/ }));
    expect(lastQuery()).toEqual({ limit: 10, offset: 10 });

    await user.selectOptions(screen.getByLabelText('فیلتر نوع'), 'BUSINESS');
    expect(lastQuery()).toEqual({ type: 'BUSINESS', limit: 10, offset: 0 });
  });
});

describe('PartiesPage — افزودن شخص', () => {
  it('کلیک روی «افزودن شخص» گفت‌وگوی ثبت را باز می‌کند', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'افزودن شخص' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('نام')).toBeInTheDocument();
  });
});
