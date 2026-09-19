import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type { SalesInvoiceListItem } from '@/api/contracts';
import { useUnitStore } from '@/stores/unit-store';
import { SalesInvoiceList } from './SalesInvoiceList';

const useSalesInvoicesMock = vi.fn();
vi.mock('@/api/queries', () => ({
  useSalesInvoices: (...args: unknown[]) => useSalesInvoicesMock(...args),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      children,
      ...rest
    }: {
      to: string;
      params?: Record<string, string>;
      children?: ReactNode;
    }) => (
      <a href={`${to}/${params?.['invoiceId'] ?? ''}`} {...rest}>
        {children}
      </a>
    ),
  };
});

const FINALIZED: SalesInvoiceListItem = {
  id: 'd5000000-0000-4000-8000-000000000001',
  invoiceNumber: 122,
  status: 'FINALIZED',
  currentVersion: 2,
  party: {
    id: 'a1000000-0000-4000-8000-000000000001',
    displayName: 'حسین مرادی',
  },
  payableRial: '1950000000',
  goldRatePerGramRial: '100000000',
  occurredAt: '2026-09-18T08:00:00.000Z',
};

const DRAFT: SalesInvoiceListItem = {
  ...FINALIZED,
  id: 'd5000000-0000-4000-8000-000000000002',
  invoiceNumber: null,
  status: 'DRAFT',
  currentVersion: 0,
  payableRial: null,
  goldRatePerGramRial: null,
};

const query = { limit: 10, offset: 0 };

function page(items: SalesInvoiceListItem[], total = items.length, limit = 10, offset = 0) {
  return { items, total, limit, offset };
}

function mockViewport(desktop: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => ({
      matches: media.includes('640px') && desktop,
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    })),
  );
}

beforeEach(() => {
  useSalesInvoicesMock.mockReset();
  useUnitStore.setState({ unit: 'gold' });
  mockViewport(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SalesInvoiceList — وضعیت‌های پایه', () => {
  it('بارگذاری، خطا و تلاش دوباره را پوشش می‌دهد', async () => {
    const refetch = vi.fn();
    useSalesInvoicesMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch,
    });
    const { container, rerender } = render(
      <SalesInvoiceList query={query} onOffsetChange={vi.fn()} />,
    );
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);

    useSalesInvoicesMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    rerender(<SalesInvoiceList query={query} onOffsetChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('برای نتیجه‌ی خالی پیام مناسب نشان می‌دهد', () => {
    useSalesInvoicesMock.mockReturnValue({
      data: page([]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<SalesInvoiceList query={query} onOffsetChange={vi.fn()} />);
    expect(screen.getByText('فاکتوری پیدا نشد')).toBeInTheDocument();
  });
});

describe('SalesInvoiceList — نمای موبایل زیر ۶۴۰px', () => {
  it('کارت چهار فیلد اصلی، نسخه‌ی جاری و اصلاح‌شده بودن را نشان می‌دهد', () => {
    useSalesInvoicesMock.mockReturnValue({
      data: page([FINALIZED, DRAFT]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<SalesInvoiceList query={query} onOffsetChange={vi.fn()} />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /مشاهده فاکتور 122/ })).toHaveAttribute(
      'href',
      '/sales/invoices/$invoiceId/d5000000-0000-4000-8000-000000000001',
    );
    expect(screen.getAllByText('حسین مرادی')).toHaveLength(2);
    expect(screen.getByText('نسخه ۲')).toBeInTheDocument();
    expect(screen.getByText('اصلاح‌شده')).toBeInTheDocument();
    expect(screen.getByText('پیش‌نویس')).toBeInTheDocument();
    expect(screen.getByText('بدون شماره')).toBeInTheDocument();
    expect(document.querySelector('[data-unit="gold"]')).toHaveAttribute('data-raw', '19500');
  });
});

describe('SalesInvoiceList — نمای دسکتاپ و صفحه‌بندی', () => {
  it('از ۶۴۰px جدول با وضعیت و نسخه جاری رندر می‌کند', () => {
    mockViewport(true);
    useSalesInvoicesMock.mockReturnValue({
      data: page([FINALIZED]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<SalesInvoiceList query={query} onOffsetChange={vi.fn()} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'نسخه جاری' })).toBeInTheDocument();
    expect(screen.getByText('نهایی')).toBeInTheDocument();
  });

  it('صفحه‌ی بعد را با offset درست درخواست می‌کند', async () => {
    const onOffsetChange = vi.fn();
    useSalesInvoicesMock.mockReturnValue({
      data: page([FINALIZED], 14, 10, 0),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<SalesInvoiceList query={query} onOffsetChange={onOffsetChange} />);

    expect(screen.getByText('صفحه ۱ از ۲')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /بعدی/ }));
    expect(onOffsetChange).toHaveBeenCalledWith(10);
  });
});
