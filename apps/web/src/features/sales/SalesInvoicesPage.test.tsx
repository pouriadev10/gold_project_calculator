import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type { SessionResponse } from '@/api/contracts';
import type * as Queries from '@/api/queries';
import { useSessionStore } from '@/stores/session-store';
import { useUnitStore } from '@/stores/unit-store';
import SalesInvoicesPage, { normalizeInvoiceSearch } from './SalesInvoicesPage';

const useSalesInvoicesMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useSalesInvoices: (...args: unknown[]) => useSalesInvoicesMock(...args),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

/** دوشنبه ۲۰ مهر ۱۴۰۵ — فقط `Date` جعلی می‌شود تا debounce و userEvent واقعی بمانند. */
const NOW = new Date('2026-10-12T08:00:00.000Z');

const SESSION: SessionResponse = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'owner@example.com', displayName: 'مالک' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
  role: 'OWNER',
};

function lastQuery(): Record<string, unknown> | undefined {
  const call = useSalesInvoicesMock.mock.calls.at(-1) as [Record<string, unknown>] | undefined;
  return call?.[0];
}

beforeEach(() => {
  useSalesInvoicesMock.mockReset();
  useSalesInvoicesMock.mockReturnValue({
    data: {
      items: [
        {
          id: 'd5000000-0000-4000-8000-000000000001',
          invoiceNumber: 122,
          invoicePeriod: '1405',
          status: 'FINALIZED',
          currentVersion: 1,
          party: {
            id: 'a1000000-0000-4000-8000-000000000001',
            displayName: 'حسین مرادی',
          },
          payableRial: '1950000000',
          goldRatePerGramRial: '100000000',
          occurredAt: '2026-09-18T08:00:00.000Z',
        },
      ],
      total: 14,
      limit: 10,
      offset: 0,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  useUnitStore.setState({ unit: 'gold' });
  useSessionStore.setState({ session: SESSION });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  useSessionStore.setState({ session: null });
});

describe('SalesInvoicesPage — FE-064', () => {
  it('عنوان، کلید سراسری واحد و query اولیه را نشان می‌دهد', () => {
    render(<SalesInvoicesPage />);
    expect(screen.getByText('فاکتورهای فروش')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'واحد نمایش اعداد' })).toBeInTheDocument();
    expect(lastQuery()).toEqual({ limit: 10, offset: 0 });
  });

  it('شماره‌ی فارسی را پس از debounce به رقم لاتین تبدیل می‌کند', async () => {
    const user = userEvent.setup();
    render(<SalesInvoicesPage />);

    await user.type(screen.getByLabelText('جست‌وجوی شماره فاکتور'), '۱۲۲');
    await waitFor(() =>
      expect(lastQuery()).toEqual({ limit: 10, offset: 0, invoiceNumber: '122' }),
    );
  });

  it('D-02: شناسه‌ی «سال-شماره» با خط تیره به query می‌رود، نه چسبیده', async () => {
    const user = userEvent.setup();
    render(<SalesInvoicesPage />);

    await user.type(screen.getByLabelText('جست‌وجوی شماره فاکتور'), '۱۴۰۵-۱۲۲');
    await waitFor(() =>
      expect(lastQuery()).toEqual({ limit: 10, offset: 0, invoiceNumber: '1405-122' }),
    );
  });

  it.each([
    ['۱۲۲', '122'],
    ['۱۴۰۵-۱۲۲', '1405-122'],
    ['۱۴۰۵/۱۲۲', '1405-122'],
    ['1405–122', '1405-122'],
    ['1405--12-2', '1405-122'],
    ['۱۴۰۵-', '1405-'],
    ['-', ''],
    ['abc', ''],
  ])('normalizeInvoiceSearch(%s) → %s', (raw, expected) => {
    expect(normalizeInvoiceSearch(raw)).toBe(expected);
  });

  it('فیلتر شخص، وضعیت و بازه‌ی شمسی را با مرز روز منطقه‌ی مستأجر به query می‌فرستد', async () => {
    const user = userEvent.setup();
    render(<SalesInvoicesPage />);

    await user.type(screen.getByLabelText('شخص'), 'مرادی');
    await user.selectOptions(screen.getByLabelText('وضعیت'), 'FINALIZED');
    await user.click(screen.getByRole('button', { name: 'این ماه' }));

    // مهر ۱۴۰۵ در تهران (+۰۳:۳۰): از نیمه‌شب ۱ مهر تا آخرین میلی‌ثانیه‌ی ۳۰ مهر.
    await waitFor(() =>
      expect(lastQuery()).toEqual({
        limit: 10,
        offset: 0,
        partySearch: 'مرادی',
        status: 'FINALIZED',
        from: '2026-09-22T20:30:00.000Z',
        to: '2026-10-22T20:29:59.999Z',
      }),
    );
  });

  it('بازه‌ی وارونه را اعلام می‌کند و تا اصلاح آن درخواست تازه نمی‌سازد', async () => {
    const user = userEvent.setup();
    render(<SalesInvoicesPage />);

    await user.click(screen.getByRole('button', { name: /از تاریخ/ }));
    await user.click(screen.getByRole('button', { name: '۱۹ مهر ۱۴۰۵' }));
    const callsBeforeInvalidRange = useSalesInvoicesMock.mock.calls.length;
    await user.click(screen.getByRole('button', { name: '۱ مهر ۱۴۰۵' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'تاریخ پایان نمی‌تواند پیش از تاریخ شروع باشد.',
    );
    expect(useSalesInvoicesMock).toHaveBeenCalledTimes(callsBeforeInvalidRange);
  });

  it('تغییر فیلتر، صفحه‌بندی را به صفحه‌ی اول برمی‌گرداند', async () => {
    const user = userEvent.setup();
    render(<SalesInvoicesPage />);

    await user.click(screen.getByRole('button', { name: /بعدی/ }));
    expect(lastQuery()).toEqual({ limit: 10, offset: 10 });

    await user.selectOptions(screen.getByLabelText('وضعیت'), 'DRAFT');
    expect(lastQuery()).toEqual({ limit: 10, offset: 0, status: 'DRAFT' });
  });

  it('پاک‌کردن فیلترها query اولیه را برمی‌گرداند', async () => {
    const user = userEvent.setup();
    render(<SalesInvoicesPage />);

    await user.selectOptions(screen.getByLabelText('وضعیت'), 'FINALIZED');
    await user.click(screen.getByRole('button', { name: 'پاک‌کردن فیلترها' }));
    expect(lastQuery()).toEqual({ limit: 10, offset: 0 });
  });
});
