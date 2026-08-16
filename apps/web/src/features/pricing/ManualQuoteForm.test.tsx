import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toPersianDigits } from '@gold/core-calc';
import { ApiError } from '@/api/api-error';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { useToastStore } from '@/stores/toast-store';
import { ManualQuoteForm } from './ManualQuoteForm';

/**
 * FE-030 — فرم ثبت مظنه دستی.
 *
 * `createManualPriceQuote` مستقیم mock می‌شود (الگوی `LoginPage.test.tsx`
 * برای `login`) — این تست فقط رفتار خودِ فرم را می‌سنجد: گیت اعتبارسنجی،
 * گفت‌وگوی تأیید، idempotency و نمایش نتیجه/خطا.
 */
const createManualPriceQuoteMock = vi.fn();
vi.mock('@/api/pricing', () => ({
  createManualPriceQuote: (...args: unknown[]) => createManualPriceQuoteMock(...args),
}));

const QUOTE_RESPONSE = {
  id: 'q-1',
  quoteType: 'MAZNEH' as const,
  amountRial: 48_000_000n,
  source: 'MANUAL' as const,
  observedAt: new Date().toISOString(),
  createdBy: 'u1',
  createdAt: new Date().toISOString(),
};

/** ثابت روی حالت Dialog (دسکتاپ) — پاسخگویی Bottom Sheet/Dialog خودش در ResponsiveDialog.test.tsx پوشش دارد. */
function mockDesktopViewport() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('640px'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    })),
  );
}

function renderForm() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ManualQuoteForm />
    </QueryClientProvider>,
  );
}

async function tap(user: ReturnType<typeof userEvent.setup>, aria: string) {
  await user.click(screen.getByRole('button', { name: aria }));
}

/** `keys` با ارقام لاتین نوشته می‌شود؛ برچسب دکمه‌های کیپد فارسی است (الگوی MoneyInput.test.tsx). */
async function typeAmount(user: ReturnType<typeof userEvent.setup>, keys: string) {
  await user.click(screen.getByLabelText('مظنه مثقال'));
  for (const key of keys) {
    await tap(user, `رقم ${toPersianDigits(key)}`);
  }
}

beforeEach(() => {
  mockDesktopViewport();
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
  useToastStore.setState({ toasts: [] });
  createManualPriceQuoteMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ManualQuoteForm — اعتبارسنجی (تمام است وقتی: مقدار نامعتبر ارسال نشود)', () => {
  it('بدون مقدار، دکمه‌ی ثبت غیرفعال است و API صدا زده نمی‌شود', async () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'ثبت مظنه' })).toBeDisabled();
    expect(createManualPriceQuoteMock).not.toHaveBeenCalled();
  });

  it('با مقدار معتبر، دکمه فعال می‌شود', async () => {
    const user = userEvent.setup();
    renderForm();
    await typeAmount(user, '48000000');
    expect(screen.getByRole('button', { name: 'ثبت مظنه' })).toBeEnabled();
  });
});

describe('ManualQuoteForm — گفت‌وگوی تأیید', () => {
  it('کلیک روی «ثبت مظنه» مبلغ واردشده را برای تأیید نشان می‌دهد، بدون فراخوانی API', async () => {
    const user = userEvent.setup();
    renderForm();
    await typeAmount(user, '48000000');
    await tap(user, 'ثبت مظنه');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('تأیید مظنه')).toBeInTheDocument();
    expect(createManualPriceQuoteMock).not.toHaveBeenCalled();
  });

  it('«انصراف» بدون فراخوانی API گفت‌وگو را می‌بندد', async () => {
    const user = userEvent.setup();
    renderForm();
    await typeAmount(user, '48000000');
    await tap(user, 'ثبت مظنه');
    await screen.findByRole('dialog');

    await tap(user, 'انصراف');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(createManualPriceQuoteMock).not.toHaveBeenCalled();
  });
});

describe('ManualQuoteForm — ثبت موفق (تمام است وقتی: مظنه ثبت شود)', () => {
  it('تأیید نهایی API را با مبلغ و کلید idempotency صدا می‌زند و نتیجه را نشان می‌دهد', async () => {
    createManualPriceQuoteMock.mockResolvedValue(QUOTE_RESPONSE);
    const user = userEvent.setup();
    renderForm();

    await typeAmount(user, '48000000');
    await tap(user, 'ثبت مظنه');
    await screen.findByRole('dialog');
    await tap(user, 'تأیید و ثبت');

    await waitFor(() => expect(createManualPriceQuoteMock).toHaveBeenCalledTimes(1));
    expect(createManualPriceQuoteMock).toHaveBeenCalledWith(48_000_000n, expect.any(String));

    expect(await screen.findByRole('status')).toHaveTextContent('مظنه با موفقیت ثبت شد.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useToastStore.getState().toasts.some((t) => t.title === 'مظنه ثبت شد')).toBe(true);
  });
});

describe('ManualQuoteForm — جلوگیری از دوبار ثبت (تمام است وقتی: double submit سند تکراری نسازد)', () => {
  it('دو کلیک سریع روی «تأیید و ثبت» فقط یک فراخوانی می‌سازد', async () => {
    let resolveSubmit: (value: typeof QUOTE_RESPONSE) => void = () => {};
    createManualPriceQuoteMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    const user = userEvent.setup();
    renderForm();

    await typeAmount(user, '48000000');
    await tap(user, 'ثبت مظنه');
    await screen.findByRole('dialog');

    const confirmButton = screen.getByRole('button', { name: 'تأیید و ثبت' });
    await user.click(confirmButton);
    await user.click(confirmButton); // دکمه دیزیبل است، ولی قفل داخلی useIdempotentSubmit هم باید نگه دارد

    expect(createManualPriceQuoteMock).toHaveBeenCalledTimes(1);
    resolveSubmit(QUOTE_RESPONSE);
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });

  it('تلاش دوم بعد از شکست اول همان کلید idempotency را می‌فرستد، نه کلید تازه', async () => {
    createManualPriceQuoteMock.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'خطا'));
    const user = userEvent.setup();
    renderForm();

    await typeAmount(user, '48000000');
    await tap(user, 'ثبت مظنه');
    await screen.findByRole('dialog');
    await tap(user, 'تأیید و ثبت');

    await waitFor(() => expect(createManualPriceQuoteMock).toHaveBeenCalledTimes(1));
    const firstKey: unknown = createManualPriceQuoteMock.mock.calls[0]?.[1];

    createManualPriceQuoteMock.mockResolvedValueOnce(QUOTE_RESPONSE);
    await tap(user, 'ثبت مظنه');
    await screen.findByRole('dialog');
    await tap(user, 'تأیید و ثبت');

    await waitFor(() => expect(createManualPriceQuoteMock).toHaveBeenCalledTimes(2));
    expect(createManualPriceQuoteMock.mock.calls[1]?.[1]).toBe(firstKey);
  });
});

describe('ManualQuoteForm — خطای سرور', () => {
  it('شکست ثبت، پیام خطا را در صفحه نگه می‌دارد (نه فقط toast) و گفت‌وگو را می‌بندد', async () => {
    createManualPriceQuoteMock.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'خطا'));
    const user = userEvent.setup();
    renderForm();

    await typeAmount(user, '48000000');
    await tap(user, 'ثبت مظنه');
    await screen.findByRole('dialog');
    await tap(user, 'تأیید و ثبت');

    expect(await screen.findByRole('alert')).toHaveTextContent('خطا در انجام عملیات');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
