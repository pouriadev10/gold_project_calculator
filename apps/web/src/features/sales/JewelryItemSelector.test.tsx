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
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useJewelryItems: (...args: unknown[]) => useJewelryItemsMock(...args),
  useInventoryBalances: (...args: unknown[]) => useInventoryBalancesMock(...args),
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
  return { lineId: 'l1', kind: 'CATALOG', jewelryItemId: 'j1', code: 'R-100', title: 'انگشتر سادگی', ...overrides };
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

beforeEach(() => {
  mockViewport(true);
  useJewelryItemsMock.mockReset();
  useJewelryItemsMock.mockReturnValue(idleJewelryItems());
  useInventoryBalancesMock.mockReset();
  useInventoryBalancesMock.mockReturnValue({ data: [], isLoading: false, isError: false });
  useRecentJewelryItemsStore.setState({ recent: [] });
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
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
