import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/api-error';
import type { Party } from '@/api/contracts';
import { useToastStore } from '@/stores/toast-store';
import { PartyFormDialog } from './PartyFormDialog';

/**
 * FE-033 — فرم کامل ایجاد/ویرایش شخص.
 *
 * `createParty`/`updateParty` مستقیم mock می‌شوند (همان الگوی
 * `CreatePartyDialog.test.tsx`) — این تست فقط رفتار خودِ گفت‌وگو را
 * می‌سنجد: انتخاب حالت با/بدون `party`، اعتبارسنجی، payload هر دو حالت،
 * نرمال‌سازی فارسی، و ماندگاری خطای سرور.
 */
const createPartyMock = vi.fn();
const updatePartyMock = vi.fn();
vi.mock('@/api/parties', () => ({
  createParty: (...args: unknown[]) => createPartyMock(...args),
  updateParty: (...args: unknown[]) => updatePartyMock(...args),
}));

const EXISTING_PARTY: Party = {
  id: 'p-1',
  type: 'CONSUMER',
  displayName: 'حسین مرادی',
  mobile: '09121234567',
  nationalId: '0012345678',
  linkedTenantId: null,
  status: 'ACTIVE',
  notes: 'مشتری قدیمی',
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

function renderDialog(props: { party?: Party; onOpenChange?: ReturnType<typeof vi.fn> } = {}) {
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <PartyFormDialog open onOpenChange={onOpenChange} {...(props.party ? { party: props.party } : {})} />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

beforeEach(() => {
  mockDesktopViewport();
  useToastStore.setState({ toasts: [] });
  createPartyMock.mockReset();
  updatePartyMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PartyFormDialog — حالت ایجاد (بدون party)', () => {
  it('بدون نام، خطای فیلد نشان می‌دهد و API صدا زده نمی‌شود', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'ایجاد شخص' }));

    expect(await screen.findByText('نام الزامی است')).toBeInTheDocument();
    expect(createPartyMock).not.toHaveBeenCalled();
  });

  it('فقط با نام، فیلدهای اختیاری از payload حذف می‌شوند', async () => {
    createPartyMock.mockResolvedValue(EXISTING_PARTY);
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('نام'), 'مریم احمدی');
    await user.click(screen.getByRole('button', { name: 'ایجاد شخص' }));

    await waitFor(() => expect(createPartyMock).toHaveBeenCalledTimes(1));
    expect(createPartyMock).toHaveBeenCalledWith(
      { type: 'CONSUMER', displayName: 'مریم احمدی' },
      expect.any(String),
    );
  });

  it('با همه‌ی فیلدها پرشده، ارقام فارسی کد ملی به لاتین نرمال می‌شود', async () => {
    createPartyMock.mockResolvedValue(EXISTING_PARTY);
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('نام'), 'مریم احمدی');
    await user.type(screen.getByLabelText('موبایل (اختیاری)'), '09121234567');
    await user.type(screen.getByLabelText('کد ملی (اختیاری)'), '۰۰۱۲۳۴۵۶۷۸');
    await user.type(screen.getByLabelText('یادداشت (اختیاری)'), 'مشتری جدید');
    await user.click(screen.getByRole('button', { name: 'ایجاد شخص' }));

    await waitFor(() => expect(createPartyMock).toHaveBeenCalledTimes(1));
    expect(createPartyMock).toHaveBeenCalledWith(
      {
        type: 'CONSUMER',
        displayName: 'مریم احمدی',
        mobile: '09121234567',
        nationalId: '0012345678',
        notes: 'مشتری جدید',
      },
      expect.any(String),
    );
    expect(updatePartyMock).not.toHaveBeenCalled();
  });

  it('شکست ثبت، پیام خطا را داخل گفت‌وگو نگه می‌دارد و گفت‌وگو بسته نمی‌شود', async () => {
    createPartyMock.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'خطا'));
    const user = userEvent.setup();
    const onOpenChange = renderDialog();

    await user.type(screen.getByLabelText('نام'), 'مریم احمدی');
    await user.click(screen.getByRole('button', { name: 'ایجاد شخص' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('خطا در انجام عملیات');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('دو کلیک سریع فقط یک فراخوانی می‌سازد', async () => {
    let resolveSubmit: (value: Party) => void = () => {};
    createPartyMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('نام'), 'مریم احمدی');
    const submitButton = screen.getByRole('button', { name: 'ایجاد شخص' });
    await user.click(submitButton);
    await user.click(submitButton);

    expect(createPartyMock).toHaveBeenCalledTimes(1);
    resolveSubmit(EXISTING_PARTY);
    await waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(0));
  });
});

describe('PartyFormDialog — حالت ویرایش (با party)', () => {
  it('فیلدها با مقدار فعلی شخص از پیش پر می‌شوند', () => {
    renderDialog({ party: EXISTING_PARTY });

    expect(screen.getByLabelText('نام')).toHaveValue('حسین مرادی');
    expect(screen.getByLabelText('موبایل (اختیاری)')).toHaveValue('09121234567');
    expect(screen.getByLabelText('کد ملی (اختیاری)')).toHaveValue('0012345678');
    expect(screen.getByLabelText('یادداشت (اختیاری)')).toHaveValue('مشتری قدیمی');
    expect(screen.getByRole('button', { name: 'ذخیره تغییرات' })).toBeInTheDocument();
  });

  it('ویرایش نام، شناسه‌ی همان شخص را با updateParty ارسال می‌کند', async () => {
    updatePartyMock.mockResolvedValue({ ...EXISTING_PARTY, displayName: 'حسین مرادی نو' });
    const user = userEvent.setup();
    renderDialog({ party: EXISTING_PARTY });

    const nameInput = screen.getByLabelText('نام');
    await user.clear(nameInput);
    await user.type(nameInput, 'حسین مرادی نو');
    await user.click(screen.getByRole('button', { name: 'ذخیره تغییرات' }));

    await waitFor(() => expect(updatePartyMock).toHaveBeenCalledTimes(1));
    expect(updatePartyMock).toHaveBeenCalledWith(
      'p-1',
      {
        type: 'CONSUMER',
        displayName: 'حسین مرادی نو',
        mobile: '09121234567',
        nationalId: '0012345678',
        notes: 'مشتری قدیمی',
      },
      expect.any(String),
    );
    expect(createPartyMock).not.toHaveBeenCalled();
  });

  it('پاک‌کردن یک فیلد اختیاری، آن را به‌جای حذف از payload، صریح null می‌فرستد', async () => {
    updatePartyMock.mockResolvedValue(EXISTING_PARTY);
    const user = userEvent.setup();
    renderDialog({ party: EXISTING_PARTY });

    await user.clear(screen.getByLabelText('یادداشت (اختیاری)'));
    await user.click(screen.getByRole('button', { name: 'ذخیره تغییرات' }));

    await waitFor(() => expect(updatePartyMock).toHaveBeenCalledTimes(1));
    expect(updatePartyMock).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ notes: null }),
      expect.any(String),
    );
  });

  it('شکست ویرایش، پیام خطا را داخل گفت‌وگو نگه می‌دارد', async () => {
    updatePartyMock.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'خطا'));
    const user = userEvent.setup();
    const onOpenChange = renderDialog({ party: EXISTING_PARTY });

    await user.click(screen.getByRole('button', { name: 'ذخیره تغییرات' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('خطا در انجام عملیات');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
