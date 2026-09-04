import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Party } from '@/api/contracts';
import type * as Queries from '@/api/queries';
import { useRecentPartiesStore } from '@/stores/recent-parties-store';
import { PartySelector } from './PartySelector';

/**
 * FE-035 — انتخاب‌گر طرف حساب.
 *
 * `useParties` مستقیم mock می‌شود (الگوی `PartyList.test.tsx`) — بیشتر
 * تست‌ها فقط مکانیک خودِ selector را می‌سنجند (فهرست اخیر، جست‌وجو،
 * کیبورد، پاک‌کردن). دو تست آخر عمداً `CreatePartyDialog` واقعی را
 * (نه mock) رندر می‌کنند — فقط `createParty` mock می‌شود — چون «بعد از
 * ایجاد شخص جدید همان شخص انتخاب شود» دقیقاً «تمام است وقتی» این تسک
 * است و ارزش سنجیدن سرتاسری را دارد، نه فقط اینکه prop درست پاس داده شده.
 */
const usePartiesMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useParties: (...args: unknown[]) => usePartiesMock(...args),
}));

const createPartyMock = vi.fn();
vi.mock('@/api/parties', () => ({
  createParty: (...args: unknown[]) => createPartyMock(...args),
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

function party(overrides: Partial<Party> = {}): Party {
  return {
    id: 'p1',
    type: 'CONSUMER',
    displayName: 'حسین مرادی',
    mobile: '09121234567',
    nationalId: null,
    linkedTenantId: null,
    status: 'ACTIVE',
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function idleParties(items: Party[] = []) {
  return {
    data: { items, total: items.length, limit: 20, offset: 0 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

function renderSelector(props: Partial<Parameters<typeof PartySelector>[0]> = {}) {
  const {
    onChange = vi.fn(),
    value = null,
    label = 'طرف حساب',
    ...rest
  } = props;
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <PartySelector label={label} value={value} onChange={onChange} {...rest} />
    </QueryClientProvider>,
  );
  return onChange;
}

beforeEach(() => {
  mockViewport(true);
  usePartiesMock.mockReset();
  usePartiesMock.mockReturnValue(idleParties());
  createPartyMock.mockReset();
  useRecentPartiesStore.setState({ recent: [] });
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PartySelector — دکمه‌ی اصلی', () => {
  it('بدون انتخاب، placeholder نشان می‌دهد و دکمه‌ی پاک‌کردن نیست', () => {
    renderSelector();
    expect(screen.getByText('انتخاب شخص')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'پاک‌کردن انتخاب' })).not.toBeInTheDocument();
  });

  it('با انتخاب، نام و دکمه‌ی پاک‌کردن نشان داده می‌شوند', () => {
    renderSelector({ value: party({ displayName: 'زهرا کریمی' }) });
    expect(screen.getByText('زهرا کریمی')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'پاک‌کردن انتخاب' })).toBeInTheDocument();
  });

  it('شخص غیرفعالِ انتخاب‌شده برچسب غیرفعال می‌گیرد', () => {
    renderSelector({ value: party({ status: 'INACTIVE' }) });
    expect(screen.getByText('غیرفعال')).toBeInTheDocument();
  });

  it('کلیک روی «پاک‌کردن انتخاب» با null صدا می‌زند', async () => {
    const user = userEvent.setup();
    const onChange = renderSelector({ value: party() });

    await user.click(screen.getByRole('button', { name: 'پاک‌کردن انتخاب' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('PartySelector — باز شدن و فهرست اخیر', () => {
  it('کلیک روی دکمه، گفت‌وگو را با فیلد جست‌وجو باز می‌کند', async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(screen.getByRole('button', { name: 'طرف حساب' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'جست‌وجوی نام یا موبایل' })).toBeInTheDocument();
  });

  it('بدون جست‌وجو، فهرست اخیر نشان داده می‌شود؛ خالی که باشد راهنما می‌آید', async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(screen.getByRole('button', { name: 'طرف حساب' }));
    expect(await screen.findByText('برای جست‌وجو تایپ کنید — هنوز شخصی اخیراً انتخاب نشده.')).toBeInTheDocument();
  });

  it('با فهرست اخیر پرشده، ردیف‌ها را نشان می‌دهد', async () => {
    useRecentPartiesStore.setState({
      recent: [{ id: 'r1', displayName: 'رضا کاظمی', mobile: null, type: 'CONSUMER', status: 'ACTIVE' }],
    });
    const user = userEvent.setup();
    renderSelector();

    await user.click(screen.getByRole('button', { name: 'طرف حساب' }));
    expect(await screen.findByText('اخیر')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /رضا کاظمی/ })).toBeInTheDocument();
  });
});

describe('PartySelector — جست‌وجو (تمام است وقتی: با کیبورد کار کند)', () => {
  it('تایپ با تأخیر useParties را با search و status=ACTIVE صدا می‌زند', async () => {
    const user = userEvent.setup();
    renderSelector();
    await user.click(screen.getByRole('button', { name: 'طرف حساب' }));

    await user.type(screen.getByRole('combobox', { name: 'جست‌وجوی نام یا موبایل' }), 'رضا');

    await waitFor(() =>
      expect(usePartiesMock).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'رضا', status: 'ACTIVE' }),
        true,
      ),
    );
  });

  it('بدون جست‌وجو، useParties با enabled=false صدا زده می‌شود', async () => {
    const user = userEvent.setup();
    renderSelector();
    await user.click(screen.getByRole('button', { name: 'طرف حساب' }));

    expect(usePartiesMock).toHaveBeenLastCalledWith(expect.not.objectContaining({ search: expect.anything() }), false);
  });

  it('حین بارگذاری اسکلت، بعد از خطا پیام تلاش دوباره', async () => {
    const refetch = vi.fn();
    usePartiesMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    const user = userEvent.setup();
    renderSelector();
    await user.click(screen.getByRole('button', { name: 'طرف حساب' }));
    await user.type(screen.getByRole('combobox', { name: 'جست‌وجوی نام یا موبایل' }), 'x');

    expect(await screen.findByText('جست‌وجو ناموفق بود.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('بدون نتیجه، پیام «شخصی پیدا نشد»', async () => {
    usePartiesMock.mockReturnValue(idleParties([]));
    const user = userEvent.setup();
    renderSelector();
    await user.click(screen.getByRole('button', { name: 'طرف حساب' }));
    await user.type(screen.getByRole('combobox', { name: 'جست‌وجوی نام یا موبایل' }), 'ناموجود');

    expect(await screen.findByText('شخصی پیدا نشد')).toBeInTheDocument();
  });

  it('کلیک روی یک نتیجه، انتخاب می‌کند، در اخیر ثبت می‌کند و گفت‌وگو را می‌بندد', async () => {
    usePartiesMock.mockReturnValue(idleParties([party({ id: 'p9', displayName: 'مهدی صادقی' })]));
    const user = userEvent.setup();
    const onChange = renderSelector();
    await user.click(screen.getByRole('button', { name: 'طرف حساب' }));
    await user.type(screen.getByRole('combobox', { name: 'جست‌وجوی نام یا موبایل' }), 'مهدی');

    await user.click(await screen.findByRole('option', { name: /مهدی صادقی/ }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'p9', displayName: 'مهدی صادقی' }));
    expect(useRecentPartiesStore.getState().recent.map((p) => p.id)).toEqual(['p9']);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('اطلاعات اضافی پاسخ API را حذف و فقط کد ملی پوشانده‌شده را ذخیره می‌کند', async () => {
    const rawNationalId = '0012345678';
    usePartiesMock.mockReturnValue(idleParties([party({ id: 'p-secure', nationalId: rawNationalId })]));
    const user = userEvent.setup();
    const onChange = renderSelector();
    await user.click(screen.getByRole('button', { name: 'طرف حساب' }));
    await user.type(screen.getByRole('combobox', { name: 'جست‌وجوی نام یا موبایل' }), 'حسین');
    await user.click(await screen.findByRole('option', { name: /حسین مرادی/ }));

    expect(onChange).toHaveBeenCalledWith({
      id: 'p-secure',
      displayName: 'حسین مرادی',
      mobile: '09121234567',
      nationalIdMasked: '۰۰۱••••۶۷۸',
      type: 'CONSUMER',
      status: 'ACTIVE',
    });
    expect(localStorage.getItem('gold-ui-recent-parties')).not.toContain(rawNationalId);
  });

  it('ردیف غیرفعال با کلیک انتخاب نمی‌شود', async () => {
    usePartiesMock.mockReturnValue(idleParties([party({ id: 'p9', status: 'INACTIVE' })]));
    const user = userEvent.setup();
    const onChange = renderSelector();
    await user.click(screen.getByRole('button', { name: 'طرف حساب' }));
    await user.type(screen.getByRole('combobox', { name: 'جست‌وجوی نام یا موبایل' }), 'x');

    const option = await screen.findByRole('option', { name: /حسین مرادی/ });
    expect(option).toHaveAttribute('aria-disabled', 'true');

    await user.click(option);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('فلش پایین/بالا و Enter، ردیف highlight‌شده را انتخاب می‌کند', async () => {
    usePartiesMock.mockReturnValue(
      idleParties([party({ id: 'p1', displayName: 'اول' }), party({ id: 'p2', displayName: 'دوم' })]),
    );
    const user = userEvent.setup();
    const onChange = renderSelector();
    await user.click(screen.getByRole('button', { name: 'طرف حساب' }));
    const input = screen.getByRole('combobox', { name: 'جست‌وجوی نام یا موبایل' });
    await user.type(input, 'x');
    await screen.findByRole('option', { name: /دوم/ });

    await user.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2', displayName: 'دوم' }));
  });
});

describe('PartySelector — ایجاد شخص جدید (تمام است وقتی: بعد از ایجاد همان شخص انتخاب شود)', () => {
  it('کلیک روی «ایجاد شخص جدید» گفت‌وگوی جست‌وجو را می‌بندد و فرم ایجاد را باز می‌کند', async () => {
    const user = userEvent.setup();
    renderSelector();
    await user.click(screen.getByRole('button', { name: 'طرف حساب' }));

    await user.click(screen.getByRole('button', { name: 'ایجاد شخص جدید' }));

    expect(await screen.findByLabelText('نام')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'جست‌وجوی نام یا موبایل' })).not.toBeInTheDocument();
  });

  it('در زمینه‌ی فروشنده فرم inline کد ملی اختیاری و نوع ثابت مصرف‌کننده دارد', async () => {
    const user = userEvent.setup();
    renderSelector({ label: 'فروشنده', inlineCreateVariant: 'SELLER' });
    await user.click(screen.getByRole('button', { name: 'فروشنده' }));
    await user.click(screen.getByRole('button', { name: 'ایجاد شخص جدید' }));

    expect(await screen.findByRole('heading', { name: 'افزودن فروشنده' })).toBeInTheDocument();
    expect(screen.getByLabelText('کد ملی (اختیاری)')).toBeInTheDocument();
    expect(screen.queryByLabelText('نوع طرف حساب')).not.toBeInTheDocument();
  });

  it('بعد از ثبت موفق، همان شخص انتخاب و در فهرست اخیر ثبت می‌شود', async () => {
    const created = party({ id: 'p-new', displayName: 'سارا کریمی' });
    createPartyMock.mockResolvedValue(created);
    const user = userEvent.setup();
    const onChange = renderSelector();
    await user.click(screen.getByRole('button', { name: 'طرف حساب' }));
    await user.click(screen.getByRole('button', { name: 'ایجاد شخص جدید' }));

    await user.type(await screen.findByLabelText('نام'), 'سارا کریمی');
    await user.click(screen.getByRole('button', { name: 'ثبت شخص' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-new' })));
    expect(useRecentPartiesStore.getState().recent[0]?.id).toBe('p-new');
  });
});
