import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { toPersianDigits } from '@gold/core-calc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JewelryItemVersion } from '@/api/contracts';
import type * as Queries from '@/api/queries';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { useRecentJewelryItemsStore } from '@/stores/recent-jewelry-items-store';
import { useUnitStore } from '@/stores/unit-store';
import type { SaleDraftItemLine } from '@/stores/sale-draft-store';
import { JewelryItemSelector } from './JewelryItemSelector';

/**
 * FE-042 — انتخاب‌گر کالای فروش.
 *
 * `useJewelryItems`/`useInventoryBalances` مستقیم mock می‌شوند (الگوی
 * `PartySelector.test.tsx`، FE-035). فیلدهای عددی کالای موردی (وزن،
 * عیار) با ضربه‌ی واقعی روی دکمه‌های `NumericKeypad` پر می‌شوند، نه
 * `user.type` — فیلد `readOnly`/`inputMode="none"` است؛ الگو دقیقاً
 * `tapDigits` در `JewelryItemFormDialog.test.tsx` (FE-036) است، همراه
 * با `pointerEventsCheck: Never` که همان‌جا مستند شده: کیپد به‌خاطر
 * `pointer-events-auto` (کلاس Tailwind، در jsdom کامپایل نمی‌شود) واقعاً
 * قابل‌کلیک است، ولی چک پیش‌فرض userEvent این را نمی‌داند.
 */

const useJewelryItemsMock = vi.fn();
const useInventoryBalancesMock = vi.fn();
const useJewelryItemMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useJewelryItems: (...args: unknown[]) => useJewelryItemsMock(...args),
  useInventoryBalances: (...args: unknown[]) => useInventoryBalancesMock(...args),
  useJewelryItem: (...args: unknown[]) => useJewelryItemMock(...args),
}));

// `SaleLinePricingDialog` (رندرشده همیشه، هرچند بسته) خودش `useMazneh` را صدا می‌زند
const useMaznehMock = vi.fn();
vi.mock('@/features/home/useMazneh', () => ({
  useMazneh: () => useMaznehMock(),
}));

function mockViewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('640px') && desktop,
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

function jewelryVersion(overrides: Partial<JewelryItemVersion> = {}): JewelryItemVersion {
  return {
    id: 'v1',
    jewelryItemId: 'j1',
    code: 'R-100',
    title: 'انگشتر سادگی',
    grossWeightMg: '5000',
    karat: 750,
    stoneWeightMg: '0',
    otherDeductionWeightMg: '0',
    wageType: 'PER_GRAM',
    wageValue: '0',
    validFrom: '2026-01-01T00:00:00+00:00',
    validTo: null,
    version: 1,
    active: true,
    ...overrides,
  };
}

function idleJewelryItems(items: JewelryItemVersion[] = []) {
  return {
    data: { items, total: items.length, limit: 20, offset: 0 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

function catalogLine(overrides: Partial<Extract<SaleDraftItemLine, { kind: 'CATALOG' }>> = {}): SaleDraftItemLine {
  return {
    lineId: 'l1',
    kind: 'CATALOG',
    jewelryItemId: 'j1',
    code: 'R-100',
    title: 'انگشتر سادگی',
    pricing: null,
    ...overrides,
  };
}

function adhocLine(overrides: Partial<Extract<SaleDraftItemLine, { kind: 'ADHOC' }>> = {}): SaleDraftItemLine {
  return {
    lineId: 'l2',
    kind: 'ADHOC',
    jewelryItemId: null,
    code: '',
    title: 'طلای دست‌دوم',
    grossWeightMg: '3500',
    karat: 740,
    pricing: null,
    ...overrides,
  };
}

function renderSelector(props: Partial<Parameters<typeof JewelryItemSelector>[0]> = {}) {
  const onChange = props.onChange ?? vi.fn();
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <JewelryItemSelector items={props.items ?? []} onChange={onChange} />
      <NumericKeypad />
    </QueryClientProvider>,
  );
  return onChange;
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

/** بدون مظنه، تنها چیزی که پیش‌نمایش قیمت را می‌بندد — پیش‌فرض تست‌ها یک مظنه‌ی معتبر است. */
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

beforeEach(() => {
  mockViewport(true);
  useJewelryItemsMock.mockReset();
  useJewelryItemsMock.mockReturnValue(idleJewelryItems());
  useInventoryBalancesMock.mockReset();
  useInventoryBalancesMock.mockReturnValue({ data: [], isLoading: false, isError: false });
  useJewelryItemMock.mockReset();
  useJewelryItemMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  useMaznehMock.mockReset();
  useMaznehMock.mockReturnValue({ data: maznehSnapshot(), isLoading: false, isError: false, isEmpty: false });
  useRecentJewelryItemsStore.setState({ recent: [] });
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
  useUnitStore.setState({ unit: 'gold' });
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JewelryItemSelector — فهرست انتخاب‌شده‌ها', () => {
  it('بدون هیچ قلمی، راهنمای متن نشان داده می‌شود', () => {
    renderSelector();
    expect(screen.getByText('هنوز کالایی برای فروش انتخاب نشده.')).toBeInTheDocument();
  });

  it('قلم کاتالوگ و قلم موردی هر دو نمایش داده می‌شوند', () => {
    renderSelector({ items: [catalogLine(), adhocLine()] });

    expect(screen.getByText('انگشتر سادگی')).toBeInTheDocument();
    expect(screen.getByText('طلای دست‌دوم')).toBeInTheDocument();
    expect(screen.getByText('موردی')).toBeInTheDocument();
  });

  it('کلیک روی حذف، ردیف را از سبد کم می‌کند', async () => {
    const user = setupUser();
    const onChange = renderSelector({ items: [catalogLine({ lineId: 'l1' }), adhocLine({ lineId: 'l2' })] });

    await user.click(screen.getByRole('button', { name: 'حذف انگشتر سادگی' }));

    expect(onChange).toHaveBeenCalledWith([adhocLine({ lineId: 'l2' })]);
  });
});

describe('JewelryItemSelector — باز شدن و جست‌وجو', () => {
  it('کلیک روی «افزودن کالا»، گفت‌وگو را با فیلد جست‌وجو باز می‌کند', async () => {
    const user = setupUser();
    renderSelector();

    await user.click(screen.getByRole('button', { name: 'افزودن کالا' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'جست‌وجوی کد یا عنوان' })).toBeInTheDocument();
  });

  it('بدون جست‌وجو، useJewelryItems با enabled=false صدا زده می‌شود', async () => {
    const user = setupUser();
    renderSelector();
    await user.click(screen.getByRole('button', { name: 'افزودن کالا' }));

    expect(useJewelryItemsMock).toHaveBeenLastCalledWith(expect.objectContaining({ active: true }), false);
  });

  it('تایپ با تأخیر useJewelryItems را با search و active=true صدا می‌زند', async () => {
    const user = setupUser();
    renderSelector();
    await user.click(screen.getByRole('button', { name: 'افزودن کالا' }));

    await user.type(screen.getByRole('combobox', { name: 'جست‌وجوی کد یا عنوان' }), 'انگشتر');

    await waitFor(() =>
      expect(useJewelryItemsMock).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'انگشتر', active: true }),
        true,
      ),
    );
  });

  it('حین بارگذاری اسکلت، بعد از خطا پیام تلاش دوباره', async () => {
    const refetch = vi.fn();
    useJewelryItemsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    const user = setupUser();
    renderSelector();
    await user.click(screen.getByRole('button', { name: 'افزودن کالا' }));
    await user.type(screen.getByRole('combobox', { name: 'جست‌وجوی کد یا عنوان' }), 'x');

    expect(await screen.findByText('جست‌وجوی کالا ناموفق بود.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('بدون نتیجه، پیام «کالایی پیدا نشد»', async () => {
    useJewelryItemsMock.mockReturnValue(idleJewelryItems([]));
    const user = setupUser();
    renderSelector();
    await user.click(screen.getByRole('button', { name: 'افزودن کالا' }));
    await user.type(screen.getByRole('combobox', { name: 'جست‌وجوی کد یا عنوان' }), 'ناموجود');

    expect(await screen.findByText('کالایی پیدا نشد')).toBeInTheDocument();
  });
});

describe('JewelryItemSelector — انتخاب کالا از کاتالوگ (چندانتخابی)', () => {
  it('کلیک روی نتیجه، به سبد اضافه می‌کند، در اخیر ثبت می‌کند و گفت‌وگو باز می‌ماند', async () => {
    useJewelryItemsMock.mockReturnValue(idleJewelryItems([jewelryVersion()]));
    const user = setupUser();
    const onChange = renderSelector();
    await user.click(screen.getByRole('button', { name: 'افزودن کالا' }));
    await user.type(screen.getByRole('combobox', { name: 'جست‌وجوی کد یا عنوان' }), 'انگشتر');

    await user.click(await screen.findByRole('option', { name: /انگشتر سادگی/ }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'CATALOG', jewelryItemId: 'j1', code: 'R-100', title: 'انگشتر سادگی' }),
    ]);
    expect(useRecentJewelryItemsStore.getState().recent.map((i) => i.jewelryItemId)).toEqual(['j1']);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('کلیک دوباره روی همان کالا، ردیف تازه می‌سازد نه افزایش تعداد یک ردیف', async () => {
    useJewelryItemsMock.mockReturnValue(idleJewelryItems([jewelryVersion()]));
    const user = setupUser();
    const onChange = renderSelector();
    await user.click(screen.getByRole('button', { name: 'افزودن کالا' }));
    await user.type(screen.getByRole('combobox', { name: 'جست‌وجوی کد یا عنوان' }), 'انگشتر');
    const option = await screen.findByRole('option', { name: /انگشتر سادگی/ });

    await user.click(option);
    await user.click(option);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(1, [expect.objectContaining({ jewelryItemId: 'j1' })]);
    expect(onChange).toHaveBeenNthCalledWith(2, [expect.objectContaining({ jewelryItemId: 'j1' })]);
  });

  it('ردیف غیرفعال با کلیک انتخاب نمی‌شود (تمام است وقتی)', async () => {
    useJewelryItemsMock.mockReturnValue(idleJewelryItems([jewelryVersion({ active: false })]));
    const user = setupUser();
    const onChange = renderSelector();
    await user.click(screen.getByRole('button', { name: 'افزودن کالا' }));
    await user.type(screen.getByRole('combobox', { name: 'جست‌وجوی کد یا عنوان' }), 'x');

    const option = await screen.findByRole('option', { name: /انگشتر سادگی/ });
    expect(option).toHaveAttribute('aria-disabled', 'true');

    await user.click(option);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('فلش پایین و Enter، ردیف highlight‌شده را اضافه می‌کند', async () => {
    useJewelryItemsMock.mockReturnValue(
      idleJewelryItems([
        jewelryVersion({ jewelryItemId: 'j1', title: 'اول' }),
        jewelryVersion({ jewelryItemId: 'j2', title: 'دوم' }),
      ]),
    );
    const user = setupUser();
    const onChange = renderSelector();
    await user.click(screen.getByRole('button', { name: 'افزودن کالا' }));
    const input = screen.getByRole('combobox', { name: 'جست‌وجوی کد یا عنوان' });
    await user.type(input, 'x');
    await screen.findByRole('option', { name: /دوم/ });

    await user.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ jewelryItemId: 'j2' })]);
  });

  it('موجودی نمایش داده می‌شود و با تعداد داخل همین سبد کم می‌شود', async () => {
    useJewelryItemsMock.mockReturnValue(idleJewelryItems([jewelryVersion()]));
    useInventoryBalancesMock.mockReturnValue({
      data: [{ itemType: 'JEWELRY', itemId: 'j1', quantity: '3' }],
      isLoading: false,
      isError: false,
    });
    const user = setupUser();
    renderSelector({ items: [catalogLine({ lineId: 'l1', jewelryItemId: 'j1' })] });
    await user.click(screen.getByRole('button', { name: 'افزودن کالا' }));
    await user.type(screen.getByRole('combobox', { name: 'جست‌وجوی کد یا عنوان' }), 'انگشتر');

    expect(await screen.findByText('موجودی: ۲')).toBeInTheDocument();
  });
});

describe('JewelryItemSelector — کالای موردی (تمام است وقتی: ورود سریع وزن)', () => {
  it('بدون وزن معتبر، دکمه‌ی افزودن غیرفعال است', async () => {
    const user = setupUser();
    renderSelector();
    await user.click(screen.getByRole('button', { name: 'افزودن کالا' }));

    await user.type(screen.getByLabelText('عنوان کالای موردی'), 'طلای دست‌دوم');
    expect(screen.getByRole('button', { name: 'افزودن کالای موردی' })).toBeDisabled();
  });

  it('با عنوان، وزن و عیار معتبر، کالای موردی به سبد اضافه و فرم پاک می‌شود', async () => {
    const user = setupUser();
    const onChange = renderSelector();
    await user.click(screen.getByRole('button', { name: 'افزودن کالا' }));

    await user.type(screen.getByLabelText('عنوان کالای موردی'), 'طلای دست‌دوم');
    await tapDigits(user, 'وزن ناخالص', '3.5');
    await tapDigits(user, 'عیار', '740');

    const addAdhoc = screen.getByRole('button', { name: 'افزودن کالای موردی' });
    expect(addAdhoc).not.toBeDisabled();
    await user.click(addAdhoc);

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'ADHOC', jewelryItemId: null, title: 'طلای دست‌دوم', karat: 740 }),
    ]);
    expect(screen.getByLabelText('عنوان کالای موردی')).toHaveValue('');
  });
});

describe('JewelryItemSelector — ویرایش قیمت ردیف (FE-043)', () => {
  it('ردیف بدون قیمت‌گذاری راهنمای «قیمت‌گذاری نشده» نشان می‌دهد', () => {
    renderSelector({ items: [catalogLine()] });
    expect(screen.getByText('قیمت‌گذاری نشده')).toBeInTheDocument();
  });

  it('کلیک روی ویرایش، ویرایشگر را با عنوان همان ردیف باز می‌کند', async () => {
    const user = setupUser();
    renderSelector({ items: [catalogLine({ title: 'انگشتر سادگی' })] });

    await user.click(screen.getByRole('button', { name: 'ویرایش قیمت انگشتر سادگی' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('ویرایش قیمت — انگشتر سادگی')).toBeInTheDocument();
  });

  it('ردیف موردی بدون pricing با وزن/عیار «ورود سریع» خودش پر می‌شود', async () => {
    const user = setupUser();
    renderSelector({ items: [adhocLine({ grossWeightMg: '3500', karat: 740 })] });

    await user.click(screen.getByRole('button', { name: 'ویرایش قیمت طلای دست‌دوم' }));
    await screen.findByRole('dialog');

    expect(document.querySelector('input[data-kind="weight"]')).toHaveAttribute('data-value', '3500');
    expect(document.querySelector('input[data-kind="karat"]')).toHaveAttribute('data-value', '740');
  });

  it('ردیف کاتالوگ بدون pricing با نسخه‌ی واکشی‌شده از useJewelryItem پر می‌شود', async () => {
    useJewelryItemMock.mockReturnValue({
      data: {
        id: 'v1',
        jewelryItemId: 'j1',
        code: 'R-100',
        title: 'انگشتر سادگی',
        grossWeightMg: '12000',
        karat: 750,
        stoneWeightMg: '2000',
        otherDeductionWeightMg: '0',
        wageType: 'PER_GRAM',
        wageValue: '350000',
        validFrom: '2026-01-01T00:00:00+00:00',
        validTo: null,
        version: 1,
        active: true,
      },
      isLoading: false,
      isError: false,
    });
    const user = setupUser();
    renderSelector({ items: [catalogLine({ jewelryItemId: 'j1' })] });

    await user.click(screen.getByRole('button', { name: 'ویرایش قیمت انگشتر سادگی' }));
    await screen.findByRole('dialog');

    expect(useJewelryItemMock).toHaveBeenCalledWith('j1');
    expect(document.querySelector('input[data-kind="weight"]')).toHaveAttribute('data-value', '12000');
    await waitFor(() => expect(screen.getByRole('button', { name: 'ذخیره' })).not.toBeDisabled());
  });

  it('ذخیره، pricing ردیف را در سبد به‌روز می‌کند و گفت‌وگو را می‌بندد', async () => {
    const user = setupUser();
    const onChange = renderSelector({ items: [adhocLine({ lineId: 'l2', grossWeightMg: '3500', karat: 740 })] });

    await user.click(screen.getByRole('button', { name: 'ویرایش قیمت طلای دست‌دوم' }));
    await screen.findByRole('dialog');
    await waitFor(() => expect(screen.getByRole('button', { name: 'ذخیره' })).not.toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'ذخیره' }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        lineId: 'l2',
        pricing: expect.objectContaining({ grossWeightMg: '3500', karat: 740, wageType: 'PER_GRAM' }),
      }),
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('ردیف قیمت‌گذاری‌شده مبلغ کل محاسبه‌شده را نشان می‌دهد', () => {
    // پیش‌فرض واحد سراسری «طلا»ست (بخش ۲-۴ CLAUDE.md) — برای سنجش مقدار
    // ریالی دقیق (همان Golden case در sale-line-pricing.test.ts)، پیش از
    // رندر صریح به ریال سوییچ می‌شود؛ AmountDisplay از همین استور می‌خواند.
    useUnitStore.setState({ unit: 'rial' });
    renderSelector({
      items: [
        adhocLine({
          pricing: {
            grossWeightMg: '12000',
            karat: 750,
            stoneWeightMg: '2000',
            otherDeductionWeightMg: '0',
            wageType: 'PER_GRAM',
            wageValue: '350000',
            profitRateBps: '700',
            taxRateBps: '1000',
          },
        }),
      ],
    });

    expect(screen.queryByText('قیمت‌گذاری نشده')).not.toBeInTheDocument();
    expect(document.querySelector('[data-raw="252746000"]')).toBeInTheDocument();
  });
});
