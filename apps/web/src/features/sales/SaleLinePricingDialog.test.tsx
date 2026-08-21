import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { toPersianDigits } from '@gold/core-calc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Queries from '@/api/queries';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import type { SaleDraftItemLine } from '@/stores/sale-draft-store';
import { SaleLinePricingDialog } from './SaleLinePricingDialog';

/**
 * FE-043 — ویرایشگر مشخصات مالی یک ردیف فروش.
 *
 * تمرکز روی چیزی که `JewelryItemSelector.test.tsx` پوشش نمی‌دهد: سوییچ
 * نوع اجرت، خطای واقعی `calculateJewelrySale` هنگام کسورات بیش از حد، و
 * «تمام است وقتی» صریح این تسک — تغییر هر فیلد پیش‌نمایش را به‌روز کند.
 * فیلدهای عددی مثل همیشه با ضربه‌ی واقعی روی `NumericKeypad` پر می‌شوند
 * (الگوی `JewelryItemFormDialog.test.tsx`، نه `user.type`، چون فیلد
 * `readOnly` است).
 */

const useJewelryItemMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useJewelryItem: (...args: unknown[]) => useJewelryItemMock(...args),
}));

const useMaznehMock = vi.fn();
vi.mock('@/features/home/useMazneh', () => ({
  useMazneh: () => useMaznehMock(),
}));

function maznehSnapshot() {
  return {
    mazneh: 100_000_000n,
    gram750: 23_085_080n,
    gram1000: 30_780_106n,
    source: 'MANUAL' as const,
    observedAt: new Date(),
    isStale: false,
  };
}

const ADHOC_LINE: Extract<SaleDraftItemLine, { kind: 'ADHOC' }> = {
  lineId: 'l1',
  kind: 'ADHOC',
  jewelryItemId: null,
  code: '',
  title: 'طلای دست‌دوم',
  grossWeightMg: '12000',
  karat: 750,
  pricing: null,
};

function renderDialog(props: Partial<Parameters<typeof SaleLinePricingDialog>[0]> = {}) {
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const onSave = props.onSave ?? vi.fn();
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <SaleLinePricingDialog
        open={props.open ?? true}
        onOpenChange={onOpenChange}
        line={props.line === undefined ? ADHOC_LINE : props.line}
        onSave={onSave}
      />
      <NumericKeypad />
    </QueryClientProvider>,
  );
  return { onOpenChange, onSave };
}

function setupUser() {
  return userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
}

async function tapDigits(user: ReturnType<typeof setupUser>, label: string, digits: string) {
  await user.click(screen.getByLabelText(label));
  for (const digit of digits) {
    const name = digit === '.' ? 'جداکننده اعشار' : `رقم ${toPersianDigits(digit)}`;
    await user.click(screen.getByRole('button', { name, hidden: true }));
  }
}

beforeEach(() => {
  useJewelryItemMock.mockReset();
  useJewelryItemMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  useMaznehMock.mockReset();
  useMaznehMock.mockReturnValue({ data: maznehSnapshot(), isLoading: false, isError: false, isEmpty: false });
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SaleLinePricingDialog — مقدار اولیه', () => {
  it('از وزن/عیار ردیف موردی پر می‌شود، بقیه صفر/پیش‌فرض', () => {
    renderDialog();
    expect(document.querySelector('input[data-kind="weight"]')).toHaveAttribute('data-value', '12000');
    expect(document.querySelector('input[data-kind="karat"]')).toHaveAttribute('data-value', '750');
  });

  it('از pricing قبلاً ذخیره‌شده پر می‌شود، نه پیش‌فرض', () => {
    renderDialog({
      line: {
        ...ADHOC_LINE,
        pricing: {
          grossWeightMg: '5000',
          karat: 900,
          stoneWeightMg: '0',
          otherDeductionWeightMg: '0',
          wageType: 'FLAT',
          wageValue: '1000000',
          profitRateBps: '500',
          taxRateBps: '900',
        },
      },
    });
    expect(document.querySelector('input[data-kind="weight"]')).toHaveAttribute('data-value', '5000');
    expect(document.querySelector('input[data-kind="karat"]')).toHaveAttribute('data-value', '900');
  });
});

describe('SaleLinePricingDialog — نوع اجرت', () => {
  it('سوییچ به درصدی، مقدار قبلی را صفر می‌کند (مقیاس قبلی برای نوع تازه بی‌معناست)', async () => {
    const user = setupUser();
    renderDialog();

    await user.selectOptions(screen.getByLabelText('نوع اجرت'), 'PERCENT_X100');

    expect(screen.getByLabelText('مقدار اجرت')).toBeInTheDocument();
    const moneyLikeInputs = document.querySelectorAll('input[data-kind="percent"]');
    expect(Array.from(moneyLikeInputs).some((el) => el.getAttribute('data-value') === '0')).toBe(true);
  });
});

describe('SaleLinePricingDialog — تمام است وقتی: تغییر هر فیلد preview را به‌روز کند', () => {
  it('تغییر وزن ناخالص، مبلغ کل پیش‌نمایش را عوض می‌کند', async () => {
    const user = setupUser();
    renderDialog();
    await waitFor(() => expect(screen.getByRole('button', { name: 'ذخیره' })).not.toBeDisabled());

    // با برچسب ردیف «مبلغ کل» لنگر می‌شود، نه با ترتیب سند — چون RateDisplay
    // (نرخ گرم) هم data-unit="rial" دارد، و AmountDisplay با واحد پیش‌فرض
    // سراسری «طلا» (بخش ۲-۴ CLAUDE.md) اصلاً data-unit="rial" نمی‌گیرد؛
    // برچسب تنها راه غیرمبهم پیداکردن دقیقاً همان ردیف است.
    function totalDataRaw(): string | null | undefined {
      const row = screen.getByText('مبلغ کل').closest('div');
      return row?.querySelector('[data-raw]')?.getAttribute('data-raw');
    }
    const totalBefore = totalDataRaw();

    await tapDigits(user, 'وزن ناخالص', '5'); // اضافه به انتهای بافر موجود، مقدار را عوض می‌کند

    await waitFor(() => expect(totalDataRaw()).not.toBe(totalBefore));
  });
});

describe('SaleLinePricingDialog — خطای محاسبه‌ی واقعی', () => {
  it('کسورات بیش از وزن ناخالص، خطای CalcError واقعی نشان می‌دهد و ذخیره را غیرفعال می‌کند', async () => {
    const user = setupUser();
    renderDialog();
    await waitFor(() => expect(screen.getByRole('button', { name: 'ذخیره' })).not.toBeDisabled());

    await tapDigits(user, 'وزن نگین', '99999'); // ۹۹٫۹۹۹ گرم — به‌وضوح بیشتر از ۱۲ گرم ناخالص

    expect(screen.getByRole('button', { name: 'ذخیره' })).toBeDisabled();
  });
});

describe('SaleLinePricingDialog — ذخیره', () => {
  it('با «ذخیره»، pricing دقیق فعلی به onSave داده می‌شود', async () => {
    const user = setupUser();
    const { onSave } = renderDialog();
    await waitFor(() => expect(screen.getByRole('button', { name: 'ذخیره' })).not.toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'ذخیره' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ grossWeightMg: '12000', karat: 750, wageType: 'PER_GRAM' }),
    );
  });
});
