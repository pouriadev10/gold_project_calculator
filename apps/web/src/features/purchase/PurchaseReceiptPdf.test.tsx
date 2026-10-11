import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type { B2cBuyback, SecondHandGoldPurchase } from '@gold/contracts';
import { ApiError } from '@/api/api-error';
import type * as PurchaseApi from '@/api/purchase';
import { B2cBuybackReceipt } from '@/features/sales/B2cBuybackReceipt';
import { PurchaseReceipt } from './PurchaseReceipt';

/** FE-078 — PDF رسید خرید دست‌دوم روی رسیدهای خرید. */

const getSecondHandPurchasePdfMock = vi.fn();
vi.mock('@/api/purchase', async (importOriginal) => ({
  ...(await importOriginal<typeof PurchaseApi>()),
  getSecondHandPurchasePdf: (...args: unknown[]) => getSecondHandPurchasePdfMock(...args),
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

const PURCHASE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const GOLD_RECEIPT: SecondHandGoldPurchase = {
  secondHandPurchaseId: PURCHASE_ID,
  ledgerTransactionId: 'a1000000-0000-4000-8000-000000000101',
  inventoryMovementId: 'a1000000-0000-4000-8000-000000000102',
  pureWeightMg: '7400',
  goldRatePerGramRial: '4800000',
  grossPurchaseAmountRial: '35520000',
  feeRial: '0',
  finalAmountRial: '35520000',
  paidRial: '35520000',
  payableRial: '0',
};

let clickSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getSecondHandPurchasePdfMock.mockReset();
  getSecondHandPurchasePdfMock.mockResolvedValue({ content: new Blob(['%PDF-1.4']), fileName: `invoice-${PURCHASE_ID}.pdf` });
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:p'), revokeObjectURL: vi.fn() });
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PurchaseReceiptPdf — FE-078', () => {
  it('sits on the gold purchase receipt and downloads that purchase with a meaningful name', async () => {
    render(<PurchaseReceipt receipt={GOLD_RECEIPT} />);
    const receipt = screen.getByLabelText('رسید خرید');

    await userEvent.click(within(receipt).getByRole('button', { name: 'دریافت PDF' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());
    expect(getSecondHandPurchasePdfMock).toHaveBeenCalledWith(PURCHASE_ID, expect.any(AbortSignal));
    expect((clickSpy.mock.contexts[0] as HTMLAnchorElement).download).toBe('purchase-receipt-7c9e6679.pdf');
  });

  it('sits on the B2C buyback receipt (also a second-hand purchase) and previews it', async () => {
    const buyback = {
      secondHandPurchaseId: PURCHASE_ID,
      sourceInvoiceId: 'd5000000-0000-4000-8000-000000000001',
      goldRatePerGramRial: '4800000',
      pureWeightMg: '7400',
      paidRial: '0',
      payableRial: '35520000',
      breakdown: { todayPurchaseAmountRial: '35520000' },
    } as unknown as B2cBuyback;
    render(<B2cBuybackReceipt receipt={buyback} />);

    await userEvent.click(screen.getByRole('button', { name: 'پیش‌نمایش' }));

    const panel = await screen.findByRole('region', { name: 'پیش‌نمایش رسید خرید' });
    expect(within(panel).getByText('purchase-receipt-7c9e6679.pdf')).toBeInTheDocument();
    expect(getSecondHandPurchasePdfMock).toHaveBeenCalledWith(PURCHASE_ID, expect.any(AbortSignal));
  });

  it('shows the not-found message for another tenant’s purchase', async () => {
    getSecondHandPurchasePdfMock.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'not found'));
    render(<PurchaseReceipt receipt={GOLD_RECEIPT} />);

    await userEvent.click(screen.getByRole('button', { name: 'دریافت PDF' }));

    expect(await screen.findByText('PDF این سند در دسترس نیست')).toBeInTheDocument();
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
