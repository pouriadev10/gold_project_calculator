import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { formatGram, toPersianDigits } from '@gold/core-calc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/api-error';
import type { JewelryItemVersion } from '@/api/contracts';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { useToastStore } from '@/stores/toast-store';
import { JewelryItemFormDialog } from './JewelryItemFormDialog';

/**
 * FE-036 — فرم ایجاد/ویرایش کالای زیورآلات. FE-037 پوشش وزن نگین، سایر
 * کسورات و پیش‌نمایش دقیق (با کسورات) را اضافه کرد.
 *
 * `createJewelryItem`/`updateJewelryItem` مستقیم mock می‌شوند (الگوی
 * `PartyFormDialog.test.tsx`). برخلاف آن فرم، فیلدهای عددی اینجا
 * `react-hook-form` ندارند (همان الگوی `ManualQuoteForm.tsx`) — تعامل با
 * آن‌ها یعنی کلیک روی فیلد برای فوکوس، بعد ضربه روی دکمه‌های `NumericKeypad`
 * مشترک (این فایل خودش را رندر می‌کند، مثل `JewelryItemsPage`).
 */
const createJewelryItemMock = vi.fn();
const updateJewelryItemMock = vi.fn();
vi.mock('@/api/jewelry-items', () => ({
  createJewelryItem: (...args: unknown[]) => createJewelryItemMock(...args),
  updateJewelryItem: (...args: unknown[]) => updateJewelryItemMock(...args),
}));

const EXISTING_ITEM: JewelryItemVersion = {
  id: 'v1',
  jewelryItemId: 'i1',
  code: 'BR-750-12',
  title: 'دستبند ۱۸ عیار',
  grossWeightMg: '12350',
  karat: 750,
  stoneWeightMg: '0',
  otherDeductionWeightMg: '0',
  wageType: 'PER_GRAM',
  wageValue: '3500000',
  validFrom: '2026-07-30T09:00:00+00:00',
  validTo: null,
  version: 1,
  active: true,
};

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

/**
 * وقتی گفت‌وگو باز است، react-remove-scroll (داخل Radix Dialog) روی `<body>`
 * صفحه `pointer-events:none` می‌گذارد و فقط محتوای خودِ دیالوگ را صریح
 * سوراخ می‌کند (`NumericKeypad.tsx` برای همین `pointer-events-auto` دارد).
 * ولی jsdom اصلاً Tailwind را کامپایل نمی‌کند (`vite.config.ts`: `test.css`
 * تنظیم نشده)، پس آن کلاس در تست بی‌اثر است و چک پیش‌فرض pointer-events
 * روی دکمه‌های کیپد (که هم‌سطح دیالوگ‌اند) به‌غلط رد می‌شود. این پروژه‌ی
 * واقعی مرورگر است، نه نبود کدِ محصول — بنابراین این چک، نه CSS واقعی،
 * غیرفعال می‌شود.
 */
function setupUser() {
  return userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
}

function renderDialog(props: { item?: JewelryItemVersion; onOpenChange?: ReturnType<typeof vi.fn> } = {}) {
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <JewelryItemFormDialog open onOpenChange={onOpenChange} {...(props.item ? { item: props.item } : {})} />
      <NumericKeypad />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

async function tapDigits(user: ReturnType<typeof userEvent.setup>, label: string, digits: string) {
  await user.click(screen.getByLabelText(label));
  for (const digit of digits) {
    const name = digit === '.' ? 'جداکننده اعشار' : `رقم ${toPersianDigits(digit)}`;
    // hidden: true — گفت‌وگو با Radix باز است و NumericKeypad بیرون از آن (هم‌سطحش در
    // renderDialog) رندر می‌شود؛ Radix Dialog با modal پیش‌فرض روی محتوای بیرون از خودش
    // hideOthers می‌زند، پس کیپد از درخت دسترسی‌پذیری خارج می‌شود — روی کلیک واقعی موس/لمس
    // اثری ندارد (فقط aria-hidden، نه inert)، ولی getByRole پیش‌فرض آن را نمی‌بیند.
    await user.click(screen.getByRole('button', { name, hidden: true }));
  }
}

beforeEach(() => {
  mockDesktopViewport();
  useToastStore.setState({ toasts: [] });
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
  createJewelryItemMock.mockReset();
  updateJewelryItemMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JewelryItemFormDialog — حالت ایجاد (بدون item)', () => {
  it('بدون پرکردن فیلدها، دکمه‌ی ثبت غیرفعال است', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'ثبت کالا' })).toBeDisabled();
  });

  it('با همه‌ی فیلدهای لازم پرشده، createJewelryItem با payload درست صدا زده می‌شود', async () => {
    createJewelryItemMock.mockResolvedValue(EXISTING_ITEM);
    const user = setupUser();
    renderDialog();

    await user.type(screen.getByLabelText('کد کالا'), 'BR-750-12');
    await user.type(screen.getByLabelText('عنوان'), 'دستبند ۱۸ عیار');
    await tapDigits(user, 'وزن ناخالص', '12.35');
    await tapDigits(user, 'عیار', '750');
    await tapDigits(user, 'مقدار اجرت', '3500000');

    const submitButton = screen.getByRole('button', { name: 'ثبت کالا' });
    expect(submitButton).not.toBeDisabled();
    await user.click(submitButton);

    await waitFor(() => expect(createJewelryItemMock).toHaveBeenCalledTimes(1));
    expect(createJewelryItemMock).toHaveBeenCalledWith(
      {
        code: 'BR-750-12',
        title: 'دستبند ۱۸ عیار',
        grossWeightMg: '12350',
        karat: 750,
        // دست‌نخورده مانده‌اند (پیش‌فرض state، نه schema) — این تست نگینی تایپ نمی‌کند
        stoneWeightMg: '0',
        otherDeductionWeightMg: '0',
        wageType: 'PER_GRAM',
        wageValue: '3500000',
      },
      expect.any(String),
    );
  });

  it('با وزن نگین و سایر کسورات، وزن خالص را با کسر آن‌ها پیش‌نمایش و ارسال می‌کند', async () => {
    createJewelryItemMock.mockResolvedValue(EXISTING_ITEM);
    const user = setupUser();
    renderDialog();

    await user.type(screen.getByLabelText('کد کالا'), 'BR-750-12');
    await user.type(screen.getByLabelText('عنوان'), 'دستبند ۱۸ عیار');
    await tapDigits(user, 'وزن ناخالص', '12.35');
    await tapDigits(user, 'عیار', '750');
    await tapDigits(user, 'وزن نگین', '0.35');
    await tapDigits(user, 'مقدار اجرت', '3500000');

    // chargeable = 12350 − 350 − 0 = 12000mg؛ خالص = 12000 × 750 ÷ 1000 = 9000mg = ۹ گرم
    expect(screen.getByText(`وزن خالص: ${formatGram(9000n)}`)).toBeInTheDocument();

    const submitButton = screen.getByRole('button', { name: 'ثبت کالا' });
    expect(submitButton).not.toBeDisabled();
    await user.click(submitButton);

    await waitFor(() => expect(createJewelryItemMock).toHaveBeenCalledTimes(1));
    expect(createJewelryItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ stoneWeightMg: '350', otherDeductionWeightMg: '0' }),
      expect.any(String),
    );
  });

  it('وقتی مجموع کسورات از وزن ناخالص بیشتر شود، پیش‌نمایش قطع و ثبت غیرفعال می‌شود', async () => {
    const user = setupUser();
    renderDialog();

    // بقیه‌ی فرم را هم معتبر پر می‌کند تا تنها خطای روی صفحه همان خطای کسورات باشد،
    // نه خطای عمومی «فیلد لازم است» روی کد/عنوان خالی.
    await user.type(screen.getByLabelText('کد کالا'), 'BR-1');
    await user.type(screen.getByLabelText('عنوان'), 'تست');
    await tapDigits(user, 'وزن ناخالص', '1');
    await tapDigits(user, 'عیار', '750');
    await tapDigits(user, 'وزن نگین', '0.6');
    await tapDigits(user, 'سایر کسورات', '0.5');

    expect(screen.queryByText(/وزن خالص:/)).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('مجموع کسورات از وزن ناخالص بیشتر است');
    expect(screen.getByRole('button', { name: 'ثبت کالا' })).toBeDisabled();
  });

  it('انتخاب نوع اجرت درصدی، فیلد را به PercentInput عوض و مقدار قبلی را صفر می‌کند', async () => {
    const user = setupUser();
    renderDialog();

    await tapDigits(user, 'مقدار اجرت', '3500000');
    expect(screen.getByLabelText('مقدار اجرت')).toHaveAttribute('data-value', '3500000');

    await user.selectOptions(screen.getByLabelText('نوع اجرت'), 'PERCENT_X100');

    expect(screen.getByLabelText('مقدار اجرت')).toHaveAttribute('data-value', '0');
    expect(screen.getByLabelText('مقدار اجرت')).toHaveAttribute('data-kind', 'percent');
  });

  it('ثبت با نوع اجرت درصدی، مقیاس ×۱۰۰ درست را می‌فرستد', async () => {
    createJewelryItemMock.mockResolvedValue(EXISTING_ITEM);
    const user = setupUser();
    renderDialog();

    await user.type(screen.getByLabelText('کد کالا'), 'RG-750-04');
    await user.type(screen.getByLabelText('عنوان'), 'انگشتر');
    await tapDigits(user, 'وزن ناخالص', '4.18');
    await tapDigits(user, 'عیار', '750');
    await user.selectOptions(screen.getByLabelText('نوع اجرت'), 'PERCENT_X100');
    await tapDigits(user, 'مقدار اجرت', '7.5');

    await user.click(screen.getByRole('button', { name: 'ثبت کالا' }));

    await waitFor(() => expect(createJewelryItemMock).toHaveBeenCalledTimes(1));
    expect(createJewelryItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ wageType: 'PERCENT_X100', wageValue: '750' }),
      expect.any(String),
    );
  });

  it('دو کلیک سریع فقط یک فراخوانی می‌سازد', async () => {
    let resolveSubmit: (value: JewelryItemVersion) => void = () => {};
    createJewelryItemMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    const user = setupUser();
    renderDialog();

    await user.type(screen.getByLabelText('کد کالا'), 'BR-750-12');
    await user.type(screen.getByLabelText('عنوان'), 'دستبند');
    await tapDigits(user, 'وزن ناخالص', '12.35');
    await tapDigits(user, 'عیار', '750');
    await tapDigits(user, 'مقدار اجرت', '3500000');

    const submitButton = screen.getByRole('button', { name: 'ثبت کالا' });
    await user.click(submitButton);
    await user.click(submitButton);

    expect(createJewelryItemMock).toHaveBeenCalledTimes(1);
    resolveSubmit(EXISTING_ITEM);
    await waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(0));
  });

  it('شکست ثبت، پیام خطا را داخل گفت‌وگو نگه می‌دارد و گفت‌وگو بسته نمی‌شود', async () => {
    createJewelryItemMock.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'خطا'));
    const user = setupUser();
    const onOpenChange = renderDialog();

    await user.type(screen.getByLabelText('کد کالا'), 'BR-750-12');
    await user.type(screen.getByLabelText('عنوان'), 'دستبند');
    await tapDigits(user, 'وزن ناخالص', '12.35');
    await tapDigits(user, 'عیار', '750');
    await tapDigits(user, 'مقدار اجرت', '3500000');
    await user.click(screen.getByRole('button', { name: 'ثبت کالا' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('خطا در انجام عملیات');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('JewelryItemFormDialog — حالت ویرایش (با item)', () => {
  it('فیلدها با مقدار فعلی کالا از پیش پر می‌شوند و کد غیرفعال است', () => {
    renderDialog({ item: EXISTING_ITEM });

    expect(screen.getByLabelText('کد کالا')).toHaveValue('BR-750-12');
    expect(screen.getByLabelText('کد کالا')).toBeDisabled();
    expect(screen.getByLabelText('عنوان')).toHaveValue('دستبند ۱۸ عیار');
    expect(screen.getByLabelText('وزن ناخالص')).toHaveAttribute('data-value', '12350');
    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '750');
    expect(screen.getByLabelText('وزن نگین')).toHaveAttribute('data-value', '0');
    expect(screen.getByLabelText('سایر کسورات')).toHaveAttribute('data-value', '0');
    expect(screen.getByLabelText('مقدار اجرت')).toHaveAttribute('data-value', '3500000');
    expect(screen.getByRole('button', { name: 'ذخیره تغییرات' })).toBeInTheDocument();
  });

  it('ویرایش عنوان، updateJewelryItem را با شناسه‌ی پایدار کالا صدا می‌زند، بدون کد', async () => {
    updateJewelryItemMock.mockResolvedValue({ ...EXISTING_ITEM, title: 'دستبند ویرایش‌شده' });
    const user = setupUser();
    renderDialog({ item: EXISTING_ITEM });

    const titleInput = screen.getByLabelText('عنوان');
    await user.clear(titleInput);
    await user.type(titleInput, 'دستبند ویرایش‌شده');
    await user.click(screen.getByRole('button', { name: 'ذخیره تغییرات' }));

    await waitFor(() => expect(updateJewelryItemMock).toHaveBeenCalledTimes(1));
    expect(updateJewelryItemMock).toHaveBeenCalledWith(
      'i1',
      {
        title: 'دستبند ویرایش‌شده',
        grossWeightMg: '12350',
        karat: 750,
        stoneWeightMg: '0',
        otherDeductionWeightMg: '0',
        wageType: 'PER_GRAM',
        wageValue: '3500000',
      },
      expect.any(String),
    );
    expect(createJewelryItemMock).not.toHaveBeenCalled();
  });

  it('شکست ویرایش، پیام خطا را نگه می‌دارد', async () => {
    updateJewelryItemMock.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'خطا'));
    const user = setupUser();
    renderDialog({ item: EXISTING_ITEM });

    await user.click(screen.getByRole('button', { name: 'ذخیره تغییرات' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('خطا در انجام عملیات');
  });
});
