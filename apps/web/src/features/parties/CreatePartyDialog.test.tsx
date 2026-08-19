import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/api-error';
import type { Party } from '@/api/contracts';
import { useToastStore } from '@/stores/toast-store';
import { CreatePartyDialog } from './CreatePartyDialog';

/**
 * FE-032 — ثبت سریع شخص.
 *
 * `createParty` مستقیم mock می‌شود (الگوی `ManualQuoteForm.test.tsx` برای
 * `createManualPriceQuote`) — این تست فقط رفتار خودِ گفت‌وگو را می‌سنجد:
 * گیت اعتبارسنجی، payload، idempotency، و ماندگاری خطای سرور.
 */
const createPartyMock = vi.fn();
vi.mock('@/api/parties', () => ({
  createParty: (...args: unknown[]) => createPartyMock(...args),
}));

const PARTY_RESPONSE = {
  id: 'p-1',
  type: 'CONSUMER' as const,
  displayName: 'حسین مرادی',
  mobile: null,
  nationalId: null,
  linkedTenantId: null,
  status: 'ACTIVE' as const,
  notes: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
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

function renderDialog(onOpenChange = vi.fn(), onCreated?: (party: Party) => void) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <CreatePartyDialog open onOpenChange={onOpenChange} {...(onCreated ? { onCreated } : {})} />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

async function fillName(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.type(screen.getByLabelText('نام'), name);
}

beforeEach(() => {
  mockDesktopViewport();
  useToastStore.setState({ toasts: [] });
  createPartyMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CreatePartyDialog — اعتبارسنجی (تمام است وقتی: مقدار نامعتبر ارسال نشود)', () => {
  it('بدون نام، خطای فیلد نشان می‌دهد و API صدا زده نمی‌شود', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'ثبت شخص' }));

    expect(await screen.findByText('نام الزامی است')).toBeInTheDocument();
    expect(createPartyMock).not.toHaveBeenCalled();
  });
});

describe('CreatePartyDialog — انصراف', () => {
  it('«انصراف» بدون فراخوانی API گفت‌وگو را می‌بندد', async () => {
    const user = userEvent.setup();
    const onOpenChange = renderDialog();

    await fillName(user, 'حسین مرادی');
    await user.click(screen.getByRole('button', { name: 'انصراف' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(createPartyMock).not.toHaveBeenCalled();
  });
});

describe('CreatePartyDialog — ثبت موفق (تمام است وقتی: شخص ثبت شود)', () => {
  it('بدون موبایل، آن کلید در payload نمی‌آید', async () => {
    createPartyMock.mockResolvedValue(PARTY_RESPONSE);
    const user = userEvent.setup();
    const onOpenChange = renderDialog();

    await fillName(user, 'حسین مرادی');
    await user.click(screen.getByRole('button', { name: 'ثبت شخص' }));

    await waitFor(() => expect(createPartyMock).toHaveBeenCalledTimes(1));
    expect(createPartyMock).toHaveBeenCalledWith(
      { type: 'CONSUMER', displayName: 'حسین مرادی' },
      expect.any(String),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(useToastStore.getState().toasts.some((t) => t.title === 'شخص ثبت شد')).toBe(true);
  });

  it('با موبایل پرشده، در payload می‌آید', async () => {
    createPartyMock.mockResolvedValue(PARTY_RESPONSE);
    const user = userEvent.setup();
    renderDialog();

    await fillName(user, 'حسین مرادی');
    await user.type(screen.getByLabelText('موبایل (اختیاری)'), '09121234567');
    await user.click(screen.getByRole('button', { name: 'ثبت شخص' }));

    await waitFor(() => expect(createPartyMock).toHaveBeenCalledTimes(1));
    expect(createPartyMock).toHaveBeenCalledWith(
      { type: 'CONSUMER', displayName: 'حسین مرادی', mobile: '09121234567' },
      expect.any(String),
    );
  });

  it('نوع همکار به‌درستی در payload می‌آید', async () => {
    createPartyMock.mockResolvedValue(PARTY_RESPONSE);
    const user = userEvent.setup();
    renderDialog();

    await user.selectOptions(screen.getByLabelText('نوع طرف حساب'), 'BUSINESS');
    await fillName(user, 'مهدی صادقی');
    await user.click(screen.getByRole('button', { name: 'ثبت شخص' }));

    await waitFor(() => expect(createPartyMock).toHaveBeenCalledTimes(1));
    expect(createPartyMock).toHaveBeenCalledWith(
      { type: 'BUSINESS', displayName: 'مهدی صادقی' },
      expect.any(String),
    );
  });

  it('onCreated با شخص تازه‌ساخته‌شده صدا زده می‌شود — برای انتخاب خودکار در PartySelector', async () => {
    createPartyMock.mockResolvedValue(PARTY_RESPONSE);
    const onCreated = vi.fn();
    const user = userEvent.setup();
    renderDialog(vi.fn(), onCreated);

    await fillName(user, 'حسین مرادی');
    await user.click(screen.getByRole('button', { name: 'ثبت شخص' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(PARTY_RESPONSE));
  });
});

describe('CreatePartyDialog — جلوگیری از دوبار ثبت (تمام است وقتی: double submit سند تکراری نسازد)', () => {
  it('دو کلیک سریع فقط یک فراخوانی می‌سازد', async () => {
    let resolveSubmit: (value: typeof PARTY_RESPONSE) => void = () => {};
    createPartyMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    const user = userEvent.setup();
    renderDialog();

    await fillName(user, 'حسین مرادی');
    const submitButton = screen.getByRole('button', { name: 'ثبت شخص' });
    await user.click(submitButton);
    await user.click(submitButton); // دکمه دیزیبل است، ولی قفل داخلی useIdempotentSubmit هم باید نگه دارد

    expect(createPartyMock).toHaveBeenCalledTimes(1);
    resolveSubmit(PARTY_RESPONSE);
    await waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(0));
  });

  it('تلاش دوم بعد از شکست اول همان کلید idempotency را می‌فرستد، نه کلید تازه', async () => {
    createPartyMock.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'خطا'));
    const user = userEvent.setup();
    renderDialog();

    await fillName(user, 'حسین مرادی');
    await user.click(screen.getByRole('button', { name: 'ثبت شخص' }));
    await waitFor(() => expect(createPartyMock).toHaveBeenCalledTimes(1));
    const firstKey: unknown = createPartyMock.mock.calls[0]?.[1];

    createPartyMock.mockResolvedValueOnce(PARTY_RESPONSE);
    await user.click(screen.getByRole('button', { name: 'ثبت شخص' }));

    await waitFor(() => expect(createPartyMock).toHaveBeenCalledTimes(2));
    expect(createPartyMock.mock.calls[1]?.[1]).toBe(firstKey);
  });
});

describe('CreatePartyDialog — خطای سرور', () => {
  it('شکست ثبت، پیام خطا را داخل گفت‌وگو نگه می‌دارد و گفت‌وگو بسته نمی‌شود', async () => {
    createPartyMock.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'خطا'));
    const user = userEvent.setup();
    const onOpenChange = renderDialog();

    await fillName(user, 'حسین مرادی');
    await user.click(screen.getByRole('button', { name: 'ثبت شخص' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('خطا در انجام عملیات');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
