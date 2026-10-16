import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@/api/contracts';
import { latestPriceQuoteOptions } from '@/api/queries';
import { createQueryClient } from '@/api/query-client';
import { queryKeys } from '@/api/query-keys';
import { routeTree, routerDefaults } from '@/app/router';
import { Toaster } from '@/components/common/Toaster';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { salesInvoiceRecords } from '@/mocks/handlers/fixtures';
import { usePurchaseDraftStore } from '@/stores/purchase-draft-store';
import { useSaleDraftStore, type SaleDraftItemLine } from '@/stores/sale-draft-store';
import { useSessionStore } from '@/stores/session-store';
import { useToastStore } from '@/stores/toast-store';
import { useUnitStore } from '@/stores/unit-store';
import { createIntegrationServer } from '@/test/integration';

/**
 * FE-104 — «تغییر مظنه جاری هیچ سند تاریخی را تغییر ندهد».
 *
 * هر صفحه‌ی تاریخی و هر رسید پس از ثبت، با درخت مسیر واقعی، هوک‌های واقعی و handlerهای توسعه
 * (`msw/node`) رندر می‌شود. همه‌ی اعداد مالی (`data-raw` + `data-unit` از `AmountDisplay` و
 * `RateDisplay`) در **هر دو** واحد خوانده می‌شوند، سپس مظنه‌ی جاری واقعاً عوض می‌شود (پاسخ تازه‌ی
 * `GET /pricing/quotes/latest` و invalidate ِ همان کش)، و هر عدد باید بایت‌به‌بایت همان بماند.
 * چهره‌ی طلایی همان جایی است که نرخ اثر دارد؛ پس هر صفحه باید دست‌کم یک عدد طلایی داشته باشد.
 *
 * شاهد: «مانده فعلی» ِ صفحه‌ی تسویه عمداً با مظنه‌ی جاری ساخته می‌شود (مانده‌ی امروز است، نه سند)
 * و باید با همین تغییر عوض شود — یعنی تغییر مظنه واقعاً به برنامه رسیده است.
 */

vi.mock('@/features/reporting/profit-trend-echarts', () => ({
  renderTrendChart: () => ({
    update: () => undefined,
    resize: () => undefined,
    dispose: () => undefined,
  }),
}));

const api = createIntegrationServer();
const PARTY_ID = 'a1000000-0000-4000-8000-000000000001';
/** فاکتور زیورآلات مصرف‌کننده (حسین مرادی) با دو نسخه — هم فاکتور، هم نسخه‌ها، هم مرجع Buyback. */
const INVOICE_ID = salesInvoiceRecords[0]!.id;
const ORIGINAL_QUOTE_ID = 'c1000000-0000-4000-8000-000000000001';
/** هر تغییر یک مظنه‌ی تازه و متفاوت — دو تغییر پشت‌سرهم در یک تست هم واقعاً دو تغییرند. */
let quoteSerial = 0;
function nextTodayQuote() {
  quoteSerial += 1;
  return {
    id: `c1000000-0000-4000-8000-0000000009${String(quoteSerial).padStart(2, '0')}`,
    quoteType: 'MAZNEH' as const,
    amountRial: (900_000_000n + BigInt(quoteSerial) * 37_000_000n).toString(),
    source: 'MANUAL' as const,
    observedAt: new Date().toISOString(),
    createdBy: 'c1000000-0000-4000-8000-000000000002',
    createdAt: new Date().toISOString(),
  };
}

const OWNER: SessionResponse = {
  accessToken: 'history-access',
  refreshToken: 'history-refresh',
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

type User = ReturnType<typeof userEvent.setup>;

function renderApp(path: string): QueryClient {
  const client = createQueryClient();
  const router = createRouter({
    routeTree,
    ...routerDefaults,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  );
  return client;
}

/** مظنه‌ی جاری را واقعاً عوض می‌کند و منتظر می‌ماند تا کش برنامه همان مظنه‌ی تازه را داشته باشد. */
async function changeTodayMazneh(client: QueryClient): Promise<void> {
  const today = nextTodayQuote();
  api.server.use(http.get('/api/pricing/quotes/latest', () => HttpResponse.json(today)));
  await act(async () => {
    // صفحه‌ای که مظنه را هنوز نخوانده هم مظنه‌ی تازه را در کش داشته باشد — هر مصرف‌کننده همین را می‌بیند
    await client.fetchQuery({ ...latestPriceQuoteOptions('MAZNEH'), staleTime: 0 });
    await client.invalidateQueries({ queryKey: queryKeys.pricing.all() });
    await client.invalidateQueries({ queryKey: queryKeys.dashboard.all() });
  });
  await waitFor(() =>
    expect(client.getQueryData(queryKeys.pricing.latestQuote('MAZNEH'))).toMatchObject({
      id: today.id,
    }),
  );
}

function amountsIn(scope: ParentNode): string[] {
  return [...scope.querySelectorAll('[data-raw]')].map(
    (el) => `${el.getAttribute('data-unit') ?? 'count'}:${el.getAttribute('data-raw')}`,
  );
}

/** همه‌ی اعداد مالی محدوده، یک‌بار در طلا و یک‌بار در ریال؛ پایان روی طلا (پیش‌فرض). */
function readBothUnits(scope: () => ParentNode): { gold: string[]; rial: string[] } {
  act(() => useUnitStore.setState({ unit: 'rial' }));
  const rial = amountsIn(scope());
  act(() => useUnitStore.setState({ unit: 'gold' }));
  const gold = amountsIn(scope());
  return { gold, rial };
}

/** معیار تسک برای یک محدوده: پس از تغییر مظنه‌ی جاری، هیچ عددی در هیچ واحدی عوض نشده. */
async function expectUnchangedByTodayMazneh(client: QueryClient, scope: () => ParentNode) {
  const before = readBothUnits(scope);
  expect(before.gold.some((value) => value.startsWith('gold:'))).toBe(true);

  await changeTodayMazneh(client);
  // فرصت رندر دوباره‌ی هر مصرف‌کننده‌ی مظنه
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

  expect(changedAmounts(before, readBothUnits(scope))).toEqual([]);
}

/** فقط عددهایی که عوض شده‌اند، با واحد نمایش — پیام شکست همان چیزی است که کاربر عوض‌شده می‌بیند. */
function changedAmounts(
  before: { gold: string[]; rial: string[] },
  after: { gold: string[]; rial: string[] },
): string[] {
  const changes: string[] = [];
  for (const shown of ['gold', 'rial'] as const) {
    const length = Math.max(before[shown].length, after[shown].length);
    for (let index = 0; index < length; index += 1) {
      if (before[shown][index] !== after[shown][index]) {
        changes.push(
          `[${shown} #${index}] ${before[shown][index] ?? '∅'} → ${after[shown][index] ?? '∅'}`,
        );
      }
    }
  }
  return changes;
}

function main(): HTMLElement {
  return document.querySelector('main')!;
}

async function settled(heading: string | RegExp) {
  await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 4000 });
  await waitFor(
    () => {
      expect(document.querySelector('[aria-label^="در حال دریافت"]')).toBeNull();
      expect(main().querySelector('[data-raw]')).not.toBeNull();
    },
    { timeout: 4000 },
  );
}

async function typeInto(user: User, field: HTMLElement, keys: string, value: string) {
  await user.click(field);
  await user.keyboard(keys);
  await waitFor(() => expect(field).toHaveAttribute('data-value', value));
}

/**
 * کارتی که این عنوان را دارد — داخل `main`، تا اعلان (toast) ِ هم‌عنوان «ثبت شد» با آن اشتباه نشود.
 * کارت بی‌عدد یعنی محدوده‌ی غلط؛ پس همین‌جا شکست می‌خورد، نه با مقایسه‌ی دو فهرست خالی.
 */
function cardTitled(title: string): HTMLElement {
  const card = within(main()).getByText(title).closest('[class*="rounded"]') as HTMLElement | null;
  if (card === null || card.querySelector('[data-raw]') === null)
    throw new Error(`کارت «${title}» عدد مالی ندارد`);
  return card;
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
  useToastStore.setState({ toasts: [] });
  useSessionStore.setState({ session: OWNER });
});
afterEach(() => {
  cleanup();
  api.server.resetHandlers();
  useSessionStore.setState({ session: null });
});

describe('FE-104 — صفحات تاریخی با تغییر مظنه‌ی جاری عوض نمی‌شوند', () => {
  it('فاکتور و نسخه‌های فاکتور', async () => {
    const client = renderApp(`/sales/invoices/${INVOICE_ID}`);
    await settled('جزئیات فاکتور');
    await screen.findByText(/نسخهٔ ۲|نسخه ۲/u, {}, { timeout: 4000 });
    await expectUnchangedByTodayMazneh(client, main);
  });

  it('فهرست فاکتورها', async () => {
    const client = renderApp('/sales/invoices');
    await settled('فاکتورهای فروش');
    await expectUnchangedByTodayMazneh(client, main);
  });

  it('صورت‌حساب', async () => {
    const client = renderApp(`/parties/${PARTY_ID}/statement`);
    await settled('صورت‌حساب حسین مرادی');
    await expectUnchangedByTodayMazneh(client, main);
  });

  it('«آخرین معاملات» صفحه‌ی شخص (همان سلول‌های صورت‌حساب)', async () => {
    const client = renderApp(`/parties/${PARTY_ID}`);
    await settled('حسین مرادی');
    const recent = () => cardTitled('آخرین معاملات');
    await waitFor(() => expect(recent().querySelector('[data-raw]')).not.toBeNull(), {
      timeout: 4000,
    });
    await expectUnchangedByTodayMazneh(client, recent);
  });

  it('سود', async () => {
    const user = userEvent.setup();
    const client = renderApp('/reporting/profit');
    await screen.findByRole('heading', { level: 1, name: 'گزارش سود' }, { timeout: 4000 });
    await user.click(await screen.findByRole('button', { name: 'پاک کردن تاریخ' }));
    await settled('گزارش سود');
    await expectUnchangedByTodayMazneh(client, main);
  });
});

describe('FE-104 — رسیدها پس از ثبت با تغییر مظنه‌ی جاری عوض نمی‌شوند', () => {
  it('رسید فروش زیورآلات', async () => {
    const line: SaleDraftItemLine = {
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
    const store = useSaleDraftStore.getState();
    store.setParty(CUSTOMER);
    store.setItems([line]);
    store.lockMazneh({
      quoteId: ORIGINAL_QUOTE_ID,
      mazneh: '480000000',
      source: 'MANUAL',
      observedAt: '2026-08-22T09:00:00.000Z',
    });
    store.goToStep('REVIEW');

    const user = userEvent.setup();
    const client = renderApp('/sales/new');
    await screen.findByRole('heading', { level: 1, name: 'فروش جدید' }, { timeout: 4000 });
    await user.click(await screen.findByRole('button', { name: 'ثبت فروش' }));
    await settled('فروش ثبت شد');
    await expectUnchangedByTodayMazneh(client, main);
  });

  it('رسید فروش سکه (پاسخ نرخ ندارد ← نرخ همان مظنه‌ی ثبت)', async () => {
    const user = userEvent.setup();
    const client = renderApp('/sales/coins/new');
    await screen.findByRole('heading', { level: 1, name: 'فروش سکه' }, { timeout: 4000 });
    await user.click(await screen.findByLabelText('مشتری'));
    await user.type(screen.getByLabelText('جست‌وجوی نام یا موبایل'), 'حسین');
    await user.click(await screen.findByRole('option', { name: /حسین مرادی/ }, { timeout: 4000 }));
    const coinType = await screen.findByLabelText('نوع سکه', {}, { timeout: 4000 });
    await user.selectOptions(coinType, within(coinType).getAllByRole('option')[1]!);
    await typeInto(user, screen.getByLabelText('تعداد'), '1', '1');
    await typeInto(user, screen.getByLabelText('قیمت واحد بازار'), '300000000', '300000000');
    await user.click(screen.getByRole('button', { name: 'ثبت فروش' }));
    await screen.findByText(/فاکتور شماره .* ثبت شد/u, {}, { timeout: 4000 });
    await expectUnchangedByTodayMazneh(client, main);
  });

  it('رسید خرید طلای دست‌دوم', async () => {
    const draft = usePurchaseDraftStore.getState();
    draft.setSeller(CUSTOMER);
    draft.setGrossWeightMg('10000');
    draft.setPurchaseKarat(750);
    draft.goToStep('PAYMENT');

    const user = userEvent.setup();
    const client = renderApp('/purchase/second-hand');
    await screen.findByRole('heading', { level: 1, name: 'خرید طلای دست‌دوم' }, { timeout: 4000 });
    await user.click(await screen.findByRole('button', { name: 'پرداخت کامل' }, { timeout: 4000 }));
    await user.click(screen.getByRole('button', { name: 'ثبت خرید' }));
    await waitFor(() => expect(main().querySelector('dl [data-raw]')).not.toBeNull(), {
      timeout: 4000,
    });
    await expectUnchangedByTodayMazneh(client, main);
  });

  it('مقایسه و رسید Buyback', async () => {
    const user = userEvent.setup();
    const client = renderApp(`/sales/invoices/${INVOICE_ID}/b2c-buyback`);
    await screen.findByRole(
      'heading',
      { level: 1, name: 'مقایسه خرید مجدد مشتری' },
      { timeout: 4000 },
    );
    await typeInto(
      user,
      await screen.findByLabelText('وزن ناخالص', {}, { timeout: 4000 }),
      '5.000',
      '5000',
    );
    const preview = screen.getByRole('button', { name: 'نمایش مقایسه' });
    await waitFor(() => expect(preview).toBeEnabled(), { timeout: 4000 });
    await user.click(preview);
    await screen.findByRole('button', { name: 'پرداخت کامل' }, { timeout: 4000 });

    // مقایسه پیش‌نمایش ثبت‌شده‌ی سرور است (خرید اولیه با نرخ قفل‌شده‌ی فاکتور، امروز با مظنه‌ی
    // لحظه‌ی مقایسه): مظنه‌ای که پس از آن ثبت شود عددی از آن را عوض نمی‌کند
    const comparison = () => cardTitled('مقایسه‌ی خرید اولیه و خرید امروز');
    await expectUnchangedByTodayMazneh(client, comparison);

    await user.click(screen.getByRole('button', { name: 'پرداخت کامل' }));
    await user.click(screen.getByRole('button', { name: 'ثبت سند خرید جدید' }));
    await within(main()).findByText('خرید طلای دست‌دوم ثبت شد', {}, { timeout: 4000 });
    await expectUnchangedByTodayMazneh(client, main);
  });

  describe('رسید تسویه', () => {
    async function openSettlement(
      user: User,
      method: 'ریال' | 'سکه' | 'ترکیبی',
    ): Promise<QueryClient> {
      const client = renderApp(`/parties/${PARTY_ID}/settlements/new`);
      await settled(/^ثبت تسویه/u);
      const methods = screen.getByRole('radiogroup', { name: 'روش پرداخت' });
      await user.click(within(methods).getByRole('radio', { name: method }));
      return client;
    }

    function currentBalance(): string[] {
      return amountsIn(cardTitled('مانده فعلی'));
    }

    it('ریالی: سند نرخ طلا ندارد ← فقط ریال خام، هیچ معادل ساختگی با مظنه‌ی جاری', async () => {
      const user = userEvent.setup();
      const client = await openSettlement(user, 'ریال');
      await typeInto(user, screen.getByLabelText('مبلغ'), '100000000', '100000000');
      await user.click(screen.getByRole('button', { name: 'ثبت پرداخت' }));
      const receipt = () => cardTitled('پرداخت ریالی ثبت شد');
      await within(main()).findByText('پرداخت ریالی ثبت شد', {}, { timeout: 4000 });

      const before = readBothUnits(receipt);
      expect(before).toEqual({ gold: ['rial:100000000'], rial: ['rial:100000000'] });
      const balanceBefore = currentBalance();

      await changeTodayMazneh(client);
      // شاهد: مانده‌ی امروز (نه سند) با مظنه‌ی تازه عوض می‌شود — تغییر واقعاً رسیده است
      await waitFor(() => expect(currentBalance()).not.toEqual(balanceBefore), { timeout: 4000 });
      expect(readBothUnits(receipt)).toEqual(before);
    });

    it('با سکه: نرخ همان مظنه‌ی ثبت، نه مظنه‌ی جاری', async () => {
      const user = userEvent.setup();
      const client = await openSettlement(user, 'سکه');
      const coinType = await screen.findByLabelText('نوع سکه', {}, { timeout: 4000 });
      await user.selectOptions(coinType, within(coinType).getAllByRole('option')[1]!);
      await typeInto(user, screen.getByLabelText('تعداد'), '1', '1');
      await typeInto(user, screen.getByLabelText('نرخ بازار'), '300000000', '300000000');
      await user.click(screen.getByRole('button', { name: 'ثبت پرداخت' }));
      await within(main()).findByText('پرداخت با سکه ثبت شد', {}, { timeout: 4000 });
      await expectUnchangedByTodayMazneh(client, () => cardTitled('پرداخت با سکه ثبت شد'));
    });

    it('ترکیبی با ردیف طلا: نرخ مظنه‌ی قفل‌شده‌ی خود سند', async () => {
      const user = userEvent.setup();
      const client = await openSettlement(user, 'ترکیبی');
      await user.click(screen.getByRole('button', { name: '+ طلا' }));
      const gold = screen.getByRole('group', { name: /طلا/u });
      await typeInto(user, within(gold).getByLabelText('وزن'), '1.000', '1000');
      await typeInto(user, within(gold).getByLabelText('عیار'), '750', '750');
      await user.click(screen.getByRole('button', { name: 'ثبت تسویه‌ی ترکیبی' }));
      await within(main()).findByText('تسویه‌ی ترکیبی ثبت شد', {}, { timeout: 4000 });
      await expectUnchangedByTodayMazneh(client, () => cardTitled('تسویه‌ی ترکیبی ثبت شد'));
    });

    it('ترکیبی فقط ریالی: سند نرخ ندارد ← فقط ریال خام', async () => {
      const user = userEvent.setup();
      const client = await openSettlement(user, 'ترکیبی');
      await user.click(screen.getByRole('button', { name: '+ ریال' }));
      const row = screen.getByRole('group', { name: /ریال/u });
      await typeInto(user, within(row).getByLabelText('مبلغ'), '100000000', '100000000');
      await user.click(screen.getByRole('button', { name: 'ثبت تسویه‌ی ترکیبی' }));
      const receipt = () => cardTitled('تسویه‌ی ترکیبی ثبت شد');
      await within(main()).findByText('تسویه‌ی ترکیبی ثبت شد', {}, { timeout: 4000 });

      const before = readBothUnits(receipt);
      expect(before.gold.length).toBeGreaterThan(0);
      expect(before.gold.every((value) => value.startsWith('rial:'))).toBe(true);
      await changeTodayMazneh(client);
      expect(readBothUnits(receipt)).toEqual(before);
    });
  });
});
