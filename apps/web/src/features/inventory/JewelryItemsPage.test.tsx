import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Queries from '@/api/queries';
import type { JewelryItemVersion } from '@/api/contracts';
import JewelryItemsPage from './JewelryItemsPage';

/**
 * FE-036 — سطح صفحه: سیم‌کشی فیلترها/جست‌وجو به `useJewelryItems`، و
 * راهکار فیلتر عیار (که قرارداد واقعی پشتیبانی نمی‌کند). رفتار خودِ
 * فهرست در `JewelryItemList.test.tsx` پوشش دارد.
 */
const useJewelryItemsMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useJewelryItems: (...args: unknown[]) => useJewelryItemsMock(...args),
}));

function item(overrides: Partial<JewelryItemVersion> = {}): JewelryItemVersion {
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

function itemsPage(items: JewelryItemVersion[], total = items.length, limit = 10, offset = 0) {
  return { items, total, limit, offset };
}

function lastQuery() {
  const call = useJewelryItemsMock.mock.calls.at(-1) as [Record<string, unknown>] | undefined;
  return call?.[0];
}

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

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <JewelryItemsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockDesktopViewport();
  useJewelryItemsMock.mockReset();
  useJewelryItemsMock.mockReturnValue({
    data: itemsPage([item()]),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe('JewelryItemsPage — عنوان و query اولیه', () => {
  it('عنوان «کالای زیورآلات» را نشان می‌دهد و بدون فیلتر با اندازه‌ی صفحه‌ی عادی فراخوانی می‌شود', () => {
    renderPage();
    expect(screen.getByText('کالای زیورآلات')).toBeInTheDocument();
    expect(lastQuery()).toEqual({ limit: 10, offset: 0 });
  });
});

describe('JewelryItemsPage — جست‌وجو', () => {
  it('بعد از سررسید تأخیر، جست‌وجو با مقدار واردشده فراخوانی می‌شود', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('جست‌وجوی کالا'), 'دستبند');
    await waitFor(() => expect(lastQuery()).toEqual({ search: 'دستبند', limit: 10, offset: 0 }));
  });
});

describe('JewelryItemsPage — فیلتر وضعیت', () => {
  it('انتخاب وضعیت در query اثر می‌گذارد', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('فیلتر وضعیت'), 'false');
    expect(lastQuery()).toEqual({ active: false, limit: 10, offset: 0 });
  });
});

describe('JewelryItemsPage — فیلتر عیار (راهکار نبودِ پشتیبانی سرور)', () => {
  it('فعال‌شدن فیلتر عیار، limit را به سقف واقعی سرور می‌برد و offset را صفر می‌کند', async () => {
    useJewelryItemsMock.mockReturnValue({
      data: itemsPage([item({ karat: 750 }), item({ jewelryItemId: 'i2', karat: 585 })], 2, 200, 0),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    renderPage();

    // یک بار به صفحه‌ی دوم می‌رویم تا مطمئن شویم فیلتر عیار واقعاً offset را صفر می‌کند
    await user.click(screen.getByLabelText('فیلتر عیار'));
    await user.click(screen.getByRole('button', { name: 'رقم ۷' }));
    await user.click(screen.getByRole('button', { name: 'رقم ۵' }));
    await user.click(screen.getByRole('button', { name: 'رقم ۰' }));

    await waitFor(() => expect(lastQuery()).toEqual({ limit: 200, offset: 0 }));
  });

  it('فقط کالای هم‌عیار نشان داده می‌شود — فیلتر سمت کلاینت روی دسته‌ی بزرگ', async () => {
    useJewelryItemsMock.mockReturnValue({
      data: itemsPage(
        [
          item({ jewelryItemId: 'i1', title: 'دستبند ۱۸', karat: 750 }),
          item({ jewelryItemId: 'i2', title: 'النگو ۱۴', karat: 585 }),
        ],
        2,
        200,
        0,
      ),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText('دستبند ۱۸')).toBeInTheDocument();
    expect(screen.getByText('النگو ۱۴')).toBeInTheDocument();

    await user.click(screen.getByLabelText('فیلتر عیار'));
    await user.click(screen.getByRole('button', { name: 'رقم ۷' }));
    await user.click(screen.getByRole('button', { name: 'رقم ۵' }));
    await user.click(screen.getByRole('button', { name: 'رقم ۰' }));

    expect(screen.getByText('دستبند ۱۸')).toBeInTheDocument();
    expect(screen.queryByText('النگو ۱۴')).not.toBeInTheDocument();
  });
});

describe('JewelryItemsPage — افزودن کالا', () => {
  it('کلیک روی «کالای جدید» گفت‌وگوی ثبت را باز می‌کند', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'کالای جدید' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('کد کالا')).toBeInTheDocument();
  });
});
