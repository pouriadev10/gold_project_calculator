import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type * as Queries from '@/api/queries';
import { useUnitStore } from '@/stores/unit-store';
import SalesInvoicesPage from './SalesInvoicesPage';

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

  it('فیلتر شخص، وضعیت و تاریخ را به query می‌فرستد', async () => {
    const user = userEvent.setup();
    render(<SalesInvoicesPage />);

    await user.type(screen.getByLabelText('شخص'), 'مرادی');
    await user.selectOptions(screen.getByLabelText('وضعیت'), 'FINALIZED');
    fireEvent.change(screen.getByLabelText('از تاریخ'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('تا تاریخ'), { target: { value: '2026-09-19' } });

    const expectedFrom = new Date('2026-09-01T00:00:00.000').toISOString();
    const expectedTo = new Date('2026-09-19T23:59:59.999').toISOString();
    await waitFor(() =>
      expect(lastQuery()).toEqual({
        limit: 10,
        offset: 0,
        partySearch: 'مرادی',
        status: 'FINALIZED',
        from: expectedFrom,
        to: expectedTo,
      }),
    );
  });

  it('بازه‌ی وارونه را اعلام می‌کند و تا اصلاح آن درخواست تازه نمی‌سازد', () => {
    render(<SalesInvoicesPage />);

    fireEvent.change(screen.getByLabelText('از تاریخ'), { target: { value: '2026-09-19' } });
    const callsBeforeInvalidRange = useSalesInvoicesMock.mock.calls.length;
    fireEvent.change(screen.getByLabelText('تا تاریخ'), { target: { value: '2026-09-01' } });

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
