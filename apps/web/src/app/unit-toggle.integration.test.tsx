import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@/api/contracts';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { salesInvoiceRecords } from '@/mocks/handlers/fixtures';
import { usePurchaseDraftStore } from '@/stores/purchase-draft-store';
import { useSaleDraftStore, type SaleDraftItemLine } from '@/stores/sale-draft-store';
import { useSessionStore } from '@/stores/session-store';
import { UNIT_STORAGE_KEY, useUnitStore, type MoneyUnit } from '@/stores/unit-store';
import { createIntegrationServer, renderRoute } from '@/test/integration';

/**
 * FE-103 — «هیچ صفحه مالی بدون Unit Toggle باقی نماند» و «انتخاب سراسری در همه صفحات یکسان باشد».
 *
 * هر صفحه‌ی چک‌لیست تسک با درخت مسیر واقعی، هوک‌های واقعی و handlerهای توسعه (`msw/node`) رندر
 * می‌شود. معیار از DOM خوانده می‌شود، نه از فهرست دستی کامپوننت‌ها:
 *
 * - کلید سراسری (`radiogroup` «واحد نمایش اعداد») روی صفحه هست؛
 * - هر مبلغ دومقیاسه‌ای که از کلید پیروی می‌کند (`data-follows-unit`، از `AmountDisplay`) با
 *   زدن کلید هم‌زمان طلا ↔ ریال می‌شود، و صفحه دست‌کم یکی دارد؛
 * - هیچ مبلغ ریالی «لخت» (رقم + «ریال» بیرون از `AmountDisplay`/`RateDisplay`) نیست — همان
 *   شکلی که کلید را دور می‌زد (خلاصه‌ی تسویه‌ی ترکیبی پیش از این تسک). نرخ‌ها («ریال/گرم») و
 *   وزن‌های فیزیکی عدد مالی نیستند و این الگو را ندارند.
 */

// ECharts در jsdom canvas ندارد؛ نمودار روند جداگانه آزموده شده (`ProfitTrendChart.test.tsx`)
vi.mock('@/features/reporting/profit-trend-echarts', () => ({
  renderTrendChart: () => ({
    update: () => undefined,
    resize: () => undefined,
    dispose: () => undefined,
  }),
}));

const api = createIntegrationServer();
const PARTY_ID = 'a1000000-0000-4000-8000-000000000001';
const INVOICE_ID = salesInvoiceRecords[0]!.id;
const UNIT_GROUP = 'واحد نمایش اعداد';

const OWNER: SessionResponse = {
  accessToken: 'unit-access',
  refreshToken: 'unit-refresh',
  expiresInSeconds: 900,
  user: {
    id: 'c1000000-0000-4000-8000-000000000002',
    email: 'owner@example.com',
    displayName: 'مالک نمونه',
  },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
  role: 'OWNER',
};

const CUSTOMER = {
  id: PARTY_ID,
  displayName: 'حسین مرادی',
  mobile: '09121234567',
  type: 'CONSUMER',
  status: 'ACTIVE',
} as const;

const SALE_LINE: SaleDraftItemLine = {
  lineId: 'l1',
  kind: 'CATALOG',
  jewelryItemId: 'b1000000-0000-4000-8000-000000000001',
  code: 'RG-750-04',
  title: 'انگشتر ۱۸ عیار',
  pricing: {
    grossWeightMg: '10000',
    karat: 750,
    stoneWeightMg: '0',
    otherDeductionWeightMg: '0',
    wageType: 'FLAT',
    wageValue: '5000000',
    profitRateBps: '700',
    taxRateBps: '1000',
  },
};

function seedSale(step: 'ITEMS' | 'REVIEW') {
  const store = useSaleDraftStore.getState();
  store.setParty(CUSTOMER);
  store.setItems([SALE_LINE]);
  if (step === 'REVIEW') {
    store.lockMazneh({
      quoteId: 'c1000000-0000-4000-8000-000000000001',
      mazneh: '480000000',
      source: 'MANUAL',
      observedAt: '2026-08-22T09:00:00.000Z',
    });
  }
  store.goToStep(step);
}

function seedPurchase(step: 'AMOUNT' | 'PAYMENT') {
  const store = usePurchaseDraftStore.getState();
  store.setSeller(CUSTOMER);
  store.setGrossWeightMg('10000');
  store.setPurchaseKarat(750);
  store.goToStep(step);
}

function followingAmounts(): Element[] {
  return [...document.querySelectorAll('[data-follows-unit="true"]')];
}

/** متن مستقیم هر عنصر که با رقم و «ریال» تمام می‌شود ولی از مسیر واحد عبور نکرده. */
function nakedRialAmounts(): string[] {
  const found: string[] = [];
  for (const element of document.body.querySelectorAll('*')) {
    if (element.closest('[data-raw]')) continue;
    const own = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join('')
      .trim();
    if (/[0-9۰-۹]\s*ریال$/u.test(own)) found.push(own);
  }
  return found;
}

function unitToggles(): HTMLElement[] {
  return screen.getAllByRole('radiogroup', { name: UNIT_GROUP });
}

async function chooseUnit(user: ReturnType<typeof userEvent.setup>, unit: MoneyUnit) {
  await user.click(
    within(unitToggles()[0]!).getByRole('radio', { name: unit === 'gold' ? 'طلا' : 'ریال' }),
  );
}

function expectEveryToggleOn(unit: MoneyUnit) {
  for (const group of unitToggles()) {
    expect(
      within(group).getByRole('radio', { name: unit === 'gold' ? 'طلا' : 'ریال' }),
    ).toHaveAttribute('aria-checked', 'true');
  }
}

/**
 * صفحه آماده است وقتی اسکلت‌ها رفته‌اند و دست‌کم یک عدد مالی (`data-raw`) رسیده. شمار مبلغ‌های
 * پیرو را این‌جا نمی‌سنجیم: صورت‌حساب در واحد خامِ هر ردیف فقط مقدار خام دارد و معادل پیرو را
 * فقط در واحد دیگر نشان می‌دهد.
 */
async function waitForPage(heading: string | RegExp) {
  await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 4000 });
  await waitFor(
    () => {
      expect(document.querySelector('[aria-label^="در حال دریافت"]')).toBeNull();
      expect(document.querySelector('[data-raw]')).not.toBeNull();
    },
    { timeout: 4000 },
  );
}

/** همه‌ی مبلغ‌های پیرو در همین واحدند؛ شمارشان را برمی‌گرداند. */
function expectAllFollowing(unit: MoneyUnit): number {
  const shown = followingAmounts().map((el) => el.getAttribute('data-unit'));
  expect(shown.filter((value) => value !== unit)).toEqual([]);
  return shown.length;
}

/** معیار مشترک هر صفحه: کلید هست، همه‌ی مبلغ‌ها با آن می‌چرخند، هیچ مبلغ لختی نیست. */
async function expectPageFollowsToggle(user: ReturnType<typeof userEvent.setup>) {
  expect(unitToggles().length).toBeGreaterThan(0);
  expect(nakedRialAmounts()).toEqual([]);
  let following = expectAllFollowing('gold');

  await chooseUnit(user, 'rial');
  following += expectAllFollowing('rial');
  expectEveryToggleOn('rial');
  expect(nakedRialAmounts()).toEqual([]);

  await chooseUnit(user, 'gold');
  expectAllFollowing('gold');
  expectEveryToggleOn('gold');
  // کلید باید روی دست‌کم یک مبلغ همین صفحه اثر داشته باشد، نه فقط نمایشی باشد
  expect(following).toBeGreaterThan(0);
}

beforeAll(api.start);
afterAll(api.stop);
beforeEach(() => {
  api.reset();
  sessionStorage.clear();
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
  useSaleDraftStore.getState().reset();
  usePurchaseDraftStore.getState().reset();
  useUnitStore.setState({ unit: 'gold' });
  useSessionStore.setState({ session: OWNER });
});
afterEach(() => {
  cleanup();
  api.server.resetHandlers();
  useSessionStore.setState({ session: null });
});

/** چک‌لیست FE-103 — هر صفحه با مسیر واقعی و آماده‌سازی لازمِ همان مسیر. */
const PAGES: ReadonlyArray<{
  readonly item: string;
  readonly path: string;
  readonly heading: string | RegExp;
  readonly seed?: () => void;
  /** پس از رسیدن عنوان و پیش از سنجش — مثلاً بازه‌ای که داده‌ی mock را دربرگیرد. */
  readonly prepare?: (user: ReturnType<typeof userEvent.setup>) => Promise<void>;
}> = [
  { item: 'داشبورد و کارت‌های درآمد و پرداخت', path: '/dashboard', heading: 'مظنه بازار' },
  { item: 'مانده شخص', path: `/parties/${PARTY_ID}`, heading: 'حسین مرادی' },
  { item: 'صورت‌حساب', path: `/parties/${PARTY_ID}/statement`, heading: 'صورت‌حساب حسین مرادی' },
  { item: 'بدهکاران', path: '/reporting/debtors', heading: 'بدهکاران' },
  { item: 'بستانکاران', path: '/reporting/creditors', heading: 'بستانکاران' },
  {
    item: 'سود',
    path: '/reporting/profit',
    heading: 'گزارش سود',
    // پیش‌فرض «این ماه» است و رویدادهای mock در ماه‌های پیش‌اند؛ «کل دوره» همه را می‌آورد
    prepare: async (user) =>
      user.click(await screen.findByRole('button', { name: 'پاک کردن تاریخ' })),
  },
  {
    item: 'خلاصه فروش — اقلام',
    path: '/sales/new',
    heading: 'فروش جدید',
    seed: () => seedSale('ITEMS'),
  },
  {
    item: 'خلاصه فروش — مرور',
    path: '/sales/new',
    heading: 'فروش جدید',
    seed: () => seedSale('REVIEW'),
  },
  { item: 'خلاصه فروش — فاکتورها', path: '/sales/invoices', heading: 'فاکتورهای فروش' },
  {
    item: 'خلاصه فروش — جزئیات فاکتور',
    path: `/sales/invoices/${INVOICE_ID}`,
    heading: 'جزئیات فاکتور',
  },
  {
    item: 'خلاصه خرید — مبلغ',
    path: '/purchase/second-hand',
    heading: 'خرید طلای دست‌دوم',
    seed: () => seedPurchase('AMOUNT'),
  },
  {
    item: 'خلاصه خرید — پرداخت',
    path: '/purchase/second-hand',
    heading: 'خرید طلای دست‌دوم',
    seed: () => seedPurchase('PAYMENT'),
  },
  { item: 'تسویه', path: `/parties/${PARTY_ID}/settlements/new`, heading: /^ثبت تسویه/ },
];

describe('FE-103 — هر صفحه‌ی مالی کلید واحد دارد و همه‌ی مبلغ‌هایش با آن عوض می‌شوند', () => {
  it.each(PAGES)('$item ($path)', async ({ path, heading, seed, prepare }) => {
    seed?.();
    const user = userEvent.setup();
    renderRoute(path);
    await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 4000 });
    await prepare?.(user);
    await waitForPage(heading);
    await expectPageFollowsToggle(user);
  });

  it.each(['ریال', 'طلا', 'سکه', 'ترکیبی'] as const)('تسویه با روش «%s»', async (method) => {
    const user = userEvent.setup();
    renderRoute(`/parties/${PARTY_ID}/settlements/new`);
    await waitForPage(/^ثبت تسویه/);
    const methods = screen.getByRole('radiogroup', { name: 'روش پرداخت' });
    await user.click(within(methods).getByRole('radio', { name: method }));
    // یک ردیف ریالی تا پیش‌نمایش ردیف هم کنار خلاصه‌ی پوشش دیده شود
    if (method === 'ترکیبی') await user.click(screen.getByRole('button', { name: '+ ریال' }));
    await waitFor(
      () => expect(document.querySelector('[aria-label^="در حال دریافت"]')).toBeNull(),
      { timeout: 4000 },
    );
    await expectPageFollowsToggle(user);
  });
});

describe('FE-103 — انتخاب سراسری در همه‌ی صفحات یکسان است', () => {
  it('ریال در داشبورد ← بدهکاران (ناوبری) هم ریال است و پس از بارگذاری دوباره می‌ماند', async () => {
    const user = userEvent.setup();
    renderRoute('/dashboard');
    await waitForPage('مظنه بازار');
    await chooseUnit(user, 'rial');

    const debtors = screen.getByRole('region', { name: 'مانده اشخاص' });
    await user.click(within(debtors).getAllByRole('link', { name: /مشاهده فهرست/ })[0]!);
    await waitForPage('بدهکاران');
    expectEveryToggleOn('rial');
    expect(expectAllFollowing('rial')).toBeGreaterThan(0);

    // تنظیم سراسری کاربر است: در همان کلید ذخیره‌ی مشترک نوشته شده، نه state ِ صفحه
    expect(JSON.parse(localStorage.getItem(UNIT_STORAGE_KEY) ?? '{}')).toMatchObject({
      state: { unit: 'rial' },
    });
    cleanup();

    renderRoute(`/parties/${PARTY_ID}`);
    await waitForPage('حسین مرادی');
    expectEveryToggleOn('rial');
    expect(expectAllFollowing('rial')).toBeGreaterThan(0);
  });

  it('کلید صفحه‌ی «بیشتر» همان انتخاب سراسری است', async () => {
    useUnitStore.setState({ unit: 'rial' });
    renderRoute('/settings');
    await screen.findByRole('heading', { level: 1, name: 'بیشتر' }, { timeout: 4000 });
    expectEveryToggleOn('rial');
  });
});
