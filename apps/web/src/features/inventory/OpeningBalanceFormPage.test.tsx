import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCoinCount, toPersianDigits } from '@gold/core-calc';
import type * as Queries from '@/api/queries';
import type * as OpeningBalancesApi from '@/api/opening-balances';
import type { CoinTypeVersion, JewelryItemVersion, OpeningBalance } from '@/api/contracts';
import OpeningBalanceFormPage from './OpeningBalanceFormPage';

/**
 * FE-039 — ثبت موجودی افتتاحیه.
 *
 * `createOpeningBalance` مستقیم mock می‌شود (الگوی `ManualQuoteForm.test.tsx`)،
 * `useCoinTypes`/`useJewelryItems` هم مثل `CoinInventoryPage.test.tsx`.
 * تمرکز اینجا روی «تمام است وقتی» خودِ تسک است: نتیجه‌ی ثبت نمایش داده
 * شود، شکست هیچ وضعیت موفق کاذبی نسازد، و خط‌های ساخته‌شده دقیقاً با
 * `createOpeningBalanceSchema` واقعی بخواند (فقط تعداد مثبت، شکل هر
 * itemType درست).
 */

const useCoinTypesMock = vi.fn();
const useJewelryItemsMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useCoinTypes: () => useCoinTypesMock(),
  useJewelryItems: (...args: unknown[]) => useJewelryItemsMock(...args),
}));

const createOpeningBalanceMock = vi.fn();
vi.mock('@/api/opening-balances', async (importOriginal) => ({
  ...(await importOriginal<typeof OpeningBalancesApi>()),
  createOpeningBalance: (...args: unknown[]) => createOpeningBalanceMock(...args),
}));

function jewelryItem(overrides: Partial<JewelryItemVersion> = {}): JewelryItemVersion {
  return {
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
    ...overrides,
  };
}

const COIN_A: CoinTypeVersion = {
  id: 'cv-a',
  coinTypeId: 'c-a',
  code: 'BAHAR',
  title: 'تمام بهار آزادی',
  grossWeightUg: '8133000',
  karat: 900,
  validFrom: '2026-07-30T09:00:00+00:00',
  validTo: null,
  version: 1,
  active: true,
  mintType: 'CENTRAL_BANK',
  isCentralBankMinted: true,
};
const COIN_B: CoinTypeVersion = { ...COIN_A, coinTypeId: 'c-b', code: 'NIM', title: 'نیم سکه' };

function openingBalanceResult(): OpeningBalance {
  return {
    id: 'ob1',
    ledgerTransactionId: 'tx1',
    effectiveAt: '2026-08-20T08:00:00+00:00',
    description: 'موجودی افتتاحیه',
    createdAt: '2026-08-20T08:00:00+00:00',
  };
}

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <OpeningBalanceFormPage />
    </QueryClientProvider>,
  );
}

async function typeDigits(user: ReturnType<typeof userEvent.setup>, label: string, digits: string) {
  await user.click(screen.getByLabelText(label));
  for (const digit of digits) {
    if (digit === '.') {
      await user.click(screen.getByRole('button', { name: 'جداکننده اعشار' }));
    } else {
      await user.click(screen.getByRole('button', { name: `رقم ${toPersianDigits(digit)}` }));
    }
  }
}

beforeEach(() => {
  useCoinTypesMock.mockReset();
  useJewelryItemsMock.mockReset();
  createOpeningBalanceMock.mockReset();

  useCoinTypesMock.mockReturnValue({
    data: [COIN_A, COIN_B],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  useJewelryItemsMock.mockReturnValue({
    data: { items: [jewelryItem()] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe('OpeningBalanceFormPage — اعتبارسنجی ثبت', () => {
  it('فرم خالی، دکمه‌ی ثبت غیرفعال است', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'مرور و ثبت موجودی افتتاحیه' })).toBeDisabled();
  });

  it('فقط با پرکردن وزن آبشده، دکمه فعال می‌شود', async () => {
    const user = userEvent.setup();
    renderPage();

    await typeDigits(user, 'وزن آبشده (طلای خالص ۱۰۰۰)', '5');
    expect(screen.getByRole('button', { name: 'مرور و ثبت موجودی افتتاحیه' })).not.toBeDisabled();
  });

  it('توضیحات خالی، حتی با وزن آبشده‌ی پرشده، دکمه را غیرفعال نگه می‌دارد', async () => {
    const user = userEvent.setup();
    renderPage();

    await typeDigits(user, 'وزن آبشده (طلای خالص ۱۰۰۰)', '5');
    await user.clear(screen.getByLabelText('توضیحات'));
    expect(screen.getByRole('button', { name: 'مرور و ثبت موجودی افتتاحیه' })).toBeDisabled();
  });
});

describe('OpeningBalanceFormPage — گفت‌وگوی تأیید', () => {
  it('هشدار تغییرناپذیری در گفت‌وگوی تأیید نمایش داده می‌شود', async () => {
    const user = userEvent.setup();
    renderPage();

    await typeDigits(user, 'وزن آبشده (طلای خالص ۱۰۰۰)', '5');
    await user.click(screen.getByRole('button', { name: 'مرور و ثبت موجودی افتتاحیه' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('هرگز قابل ویرایش یا حذف نیست');
  });

  it('هر نوع سکه با تعداد خودش؛ هیچ جمع تعدادی میان انواع نیست (FE-105، بخش ۲-۲)', async () => {
    const user = userEvent.setup();
    renderPage();

    await typeDigits(user, COIN_A.title, '3');
    await typeDigits(user, COIN_B.title, '2');
    await user.click(screen.getByRole('button', { name: 'مرور و ثبت موجودی افتتاحیه' }));

    const dialog = screen.getByRole('dialog');
    const rowOf = (title: string) => within(dialog).getByText(title, { selector: 'dt' }).parentElement!;
    expect(rowOf(COIN_A.title)).toHaveTextContent(`${formatCoinCount(3)} عدد`);
    expect(rowOf(COIN_B.title)).toHaveTextContent(`${formatCoinCount(2)} عدد`);
    // ۳ + ۲ = ۵ «عدد» یک تمام و یک نیم را هم‌ارز می‌شمرد
    expect(dialog).not.toHaveTextContent(`${formatCoinCount(5)} عدد`);
  });
});

describe('OpeningBalanceFormPage — ساخت خط‌ها و ثبت', () => {
  it('فقط خط‌های با تعداد مثبت ساخته می‌شوند — نوع سکه‌ی صفر حذف می‌شود', async () => {
    createOpeningBalanceMock.mockResolvedValue(openingBalanceResult());
    const user = userEvent.setup();
    renderPage();

    // زیورآلات: یک قلم با تعداد ۱ (پیش‌فرض افزودن)
    await user.click(screen.getByRole('button', { name: 'افزودن کالای زیورآلات' }));
    await user.click(screen.getByText('دستبند ۱۸ عیار'));
    // گفت‌وگوی افزودن عمداً باز می‌ماند (چندافزودن پشت‌سرهم) — برای ادامه باید بسته شود
    await user.keyboard('{Escape}');

    // آبشده: ۵ گرم = ۵۰۰۰ میلی‌گرم
    await typeDigits(user, 'وزن آبشده (طلای خالص ۱۰۰۰)', '5');

    // سکه: فقط «تمام بهار آزادی» با تعداد ۳؛ «نیم سکه» دست‌نخورده (صفر) می‌ماند
    await typeDigits(user, 'تمام بهار آزادی', '3');

    await user.click(screen.getByRole('button', { name: 'مرور و ثبت موجودی افتتاحیه' }));
    await user.click(screen.getByRole('button', { name: 'تأیید و ثبت' }));

    await waitFor(() => expect(createOpeningBalanceMock).toHaveBeenCalledTimes(1));
    const [input] = createOpeningBalanceMock.mock.calls[0] as [
      { effectiveAt: string; description: string; lines: unknown[] },
    ];
    expect(input.description).toBe('موجودی افتتاحیه');
    expect(typeof input.effectiveAt).toBe('string');
    expect(input.lines).toEqual([
      { itemType: 'JEWELRY', itemId: 'i1', quantity: '1' },
      { itemType: 'MELTED_GOLD', quantity: '5000' },
      { itemType: 'COIN', itemId: 'c-a', quantity: '3' },
    ]);
  });

  it('دو کلیک سریع روی «تأیید و ثبت» فقط یک فراخوانی می‌سازد', async () => {
    createOpeningBalanceMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(openingBalanceResult()), 50)),
    );
    const user = userEvent.setup();
    renderPage();

    await typeDigits(user, 'وزن آبشده (طلای خالص ۱۰۰۰)', '5');
    await user.click(screen.getByRole('button', { name: 'مرور و ثبت موجودی افتتاحیه' }));

    const confirmButton = screen.getByRole('button', { name: 'تأیید و ثبت' });
    await user.click(confirmButton);
    await user.click(confirmButton);

    await waitFor(() => expect(createOpeningBalanceMock).toHaveBeenCalledTimes(1));
  });
});

describe('OpeningBalanceFormPage — نتیجه‌ی ثبت', () => {
  it('ثبت موفق، پیام نتیجه را نشان و فرم را برای ورودی بعدی پاک می‌کند', async () => {
    createOpeningBalanceMock.mockResolvedValue(openingBalanceResult());
    const user = userEvent.setup();
    renderPage();

    await typeDigits(user, 'وزن آبشده (طلای خالص ۱۰۰۰)', '5');
    await user.click(screen.getByRole('button', { name: 'مرور و ثبت موجودی افتتاحیه' }));
    await user.click(screen.getByRole('button', { name: 'تأیید و ثبت' }));

    expect(await screen.findByRole('status')).toHaveTextContent('با موفقیت ثبت شد');
    expect(screen.getByLabelText('وزن آبشده (طلای خالص ۱۰۰۰)')).toHaveAttribute('data-value', '0');
    expect(screen.getByRole('button', { name: 'مرور و ثبت موجودی افتتاحیه' })).toBeDisabled();
  });

  it('شکست ثبت، هیچ وضعیت موفقی نشان نمی‌دهد و فرم را دست‌نخورده نگه می‌دارد', async () => {
    createOpeningBalanceMock.mockRejectedValue(new Error('خطای سرور'));
    const user = userEvent.setup();
    renderPage();

    await typeDigits(user, 'وزن آبشده (طلای خالص ۱۰۰۰)', '5');
    await user.click(screen.getByRole('button', { name: 'مرور و ثبت موجودی افتتاحیه' }));
    await user.click(screen.getByRole('button', { name: 'تأیید و ثبت' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('موجودی افتتاحیه با موفقیت ثبت شد.')).not.toBeInTheDocument();
    // فرم دست‌نخورده مانده — عدد وارد‌شده گم نشده
    expect(screen.getByLabelText('وزن آبشده (طلای خالص ۱۰۰۰)')).toHaveAttribute('data-value', '5000');
    // FE-100: خطای نامشخص (نه رد قطعی سرور) فرم را قفل و فقط تکرار همان درخواست را ممکن می‌کند
    expect(screen.getByRole('status')).toHaveTextContent('نتیجه‌ی ثبت قبلی هنوز مشخص نیست');
    expect(screen.getByLabelText('وزن آبشده (طلای خالص ۱۰۰۰)')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'بررسی نتیجه‌ی ثبت' })).not.toBeDisabled();
  });
});
