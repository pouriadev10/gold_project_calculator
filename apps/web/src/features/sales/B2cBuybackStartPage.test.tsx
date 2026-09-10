import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReactRouter from '@tanstack/react-router';
import type * as Queries from '@/api/queries';
import B2cBuybackStartPage from './B2cBuybackStartPage';

const useParamsMock = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return { ...actual, useParams: (...args: unknown[]) => useParamsMock(...args) };
});

const useInvoiceVersionsMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useInvoiceVersions: (...args: unknown[]) => useInvoiceVersionsMock(...args),
}));

const INVOICE_ID = 'd1000000-0000-4000-8000-000000000001';

beforeEach(() => {
  useParamsMock.mockReset();
  useInvoiceVersionsMock.mockReset();
  useParamsMock.mockReturnValue({ invoiceId: INVOICE_ID });
  useInvoiceVersionsMock.mockReturnValue({
    data: { invoiceId: INVOICE_ID, invoiceNumber: 123, versions: [] },
    isLoading: false,
    isError: false,
    error: null,
  });
});

describe('B2cBuybackStartPage — شروع خرید مجدد B2C (FE-061)', () => {
  it('فاکتور را فقط مرجع می‌داند و تفاوت آن را با برگشت فروش روشن می‌کند', () => {
    render(<B2cBuybackStartPage />);

    expect(screen.getByRole('heading', { name: 'خرید مجدد از مشتری' })).toBeInTheDocument();
    expect(screen.getByText(/خرید طلای دست‌دوم از مشتری است/)).toBeInTheDocument();
    expect(screen.getByText(/فروش قبلی را برنمی‌گرداند/)).toBeInTheDocument();
    expect(screen.getByText('شماره فاکتور').parentElement).toHaveTextContent('۱۲۳');
    expect(screen.getByRole('note')).toHaveTextContent(/فقط مرجع خرید جدید است/);
  });

  it('شناسه فاکتور URL را برای خواندن مرجع به query می‌دهد', () => {
    render(<B2cBuybackStartPage />);

    expect(useInvoiceVersionsMock).toHaveBeenCalledWith(INVOICE_ID);
  });
});
