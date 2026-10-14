import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  calculateJewelrySale,
  DEFAULT_ROUNDING_UNIT,
  dualFromRial,
  formatCount,
  formatGram,
  formatRial,
  gramRate1000,
  grossMg,
  karat,
  RATE_DIVISOR,
} from '@gold/core-calc';
import {
  createJewelryCashSaleSchema,
  createJewelryCreditSaleSchema,
  jewelryCashSaleSchema,
  jewelryCreditSaleSchema,
  salesInvoiceVersionHistorySchema,
  type SalesInvoiceVersionHistory,
  type SessionResponse,
} from '@/api/contracts';
import { createQueryClient } from '@/api/query-client';
import { formatJalaliDateTime } from '@/lib/date';
import { routeTree } from '@/app/router';
import { Toaster } from '@/components/common/Toaster';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { handlers } from '@/mocks/handlers';
import { contractGate } from '@/mocks/handlers/contract-gate';
import { mockError } from '@/mocks/handlers/errors';
import { jewelryItemVersionRecords, MAZNEH_RIAL, partyRecords } from '@/mocks/handlers/fixtures';
import { useSaleDraftStore } from '@/stores/sale-draft-store';
import { useSessionStore } from '@/stores/session-store';
import { useUnitStore } from '@/stores/unit-store';

/**
 * تست Integration فروش زیورآلات — FE-094.
 *
 * هیچ hook یا ماژولی mock نمی‌شود: درخت مسیر واقعی (`routeTree`)، store واقعی پیش‌نویس، هوک‌های
 * واقعی TanStack Query و کلاینت واقعی `src/api` تا لایه‌ی `fetch`؛ مرز تنها جایی است که MSW
 * (`msw/node`) جای سرور می‌نشیند. خواندنی‌ها (مظنه، اشخاص، کالا، موجودی) همان handlerهای
 * توسعه‌اند. ثبت فروش و نسخه‌های فاکتور را این فایل خودش جواب می‌دهد — یک «سرور» کوچک با همان
 * قاعده‌ی Idempotency ِ سرور واقعی (`apps/api/src/platform/idempotency/request-hash.ts`): همان
 * کلید با همان بدنه پاسخ ذخیره‌شده را تکرار می‌کند، همان کلید با بدنه‌ی دیگر ۴۰۹ می‌گیرد.
 * `contractGate` هم جلوی آن می‌نشیند تا بدنه پیش از رسیدن به «سرور» با schema ِ قرارداد سنجیده
 * شود، درست مثل `ZodValidationPipe`.
 *
 * مبلغ «سرور» عمداً با پیش‌نمایش کلاینت فرق دارد: اگر رسید عدد کلاینت را نشان دهد، تست می‌شکند.
 */

const server = setupServer(...handlers);
const originalFetch = globalThis.fetch;
// jsdom `scrollTo` را پیاده نمی‌کند؛ router هنگام ناوبری صدایش می‌زند.
window.scrollTo = () => undefined;

const ACCESS_TOKEN = 'fe094-access';
const CASHIER: SessionResponse = {
  accessToken: ACCESS_TOKEN,
  refreshToken: 'fe094-refresh',
  expiresInSeconds: 900,
  user: { id: 'c1000000-0000-4000-8000-000000000002', email: 'cashier@example.com', displayName: 'صندوق‌دار نمونه' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
  role: 'CASHIER',
};

/** مظنه‌ی جاری handlerهای توسعه (`maznehQuoteHistory[0]` در `mocks/handlers/index.ts`). */
const QUOTE_ID = 'c1000000-0000-4000-8000-000000000001';
const PARTY = partyRecords.find((party) => party.displayName === 'حسین مرادی')!;
const ITEM = jewelryItemVersionRecords.find((item) => item.code === 'RG-750-04')!;

/**
 * پیش‌نمایش مستقل از کد صفحه: همان ورودی‌هایی که کاتالوگ برای این کالا دارد، مستقیم به
 * `core-calc` (موتوری که golden testهای خودش را دارد). اگر صفحه عدد دیگری به موتور بدهد —
 * وزن نگین جاافتاده، عیار اشتباه، مظنه‌ی دیگر — پیش‌نمایش با این نمی‌خواند.
 */
const EXPECTED_PREVIEW = calculateJewelrySale({
  grossWeightMg: 4_180n,
  karat: karat(750),
  deductions: { stone: grossMg(320n), other: grossMg(0n) },
  wageType: 'PERCENT_X100',
  wageValue: 1_500n,
  maznehRial: MAZNEH_RIAL,
  profitRateBps: 700n,
  taxRateBps: 1_000n,
  roundingUnitRial: DEFAULT_ROUNDING_UNIT,
  rateDivisor: RATE_DIVISOR,
});

/** مبلغ ثبت‌شده‌ی «سرور» — عمداً غیر از پیش‌نمایش. */
const SERVER_PAYABLE_RIAL = 555_555_000n;
/** زمان ثبت سند روی «سرور» — رسید باید همین را نشان دهد، نه ساعت مرورگر. */
const SERVER_CREATED_AT = '2026-10-14T08:30:00.000Z';

/* ── «سرور» فروش ──────────────────────────────────────────────── */

interface Captured {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly body: Promise<string>;
}

/** هر درخواستی که از برنامه بیرون رفت، به ترتیب. */
let requests: Captured[] = [];
/** کلید Idempotency → اثر انگشت درخواست و پاسخ ذخیره‌شده؛ آینه‌ی جدول `idempotency_records`. */
let idempotency = new Map<string, { fingerprint: string; status: number; body: JsonBodyType }>();
let invoices = new Map<string, SalesInvoiceVersionHistory>();
/** پاسخ بعدی در راه گم می‌شود — فروش روی «سرور» ثبت شده ولی مرورگر خطای شبکه می‌بیند. */
let loseNextResponse = false;
/** رد بعدی پیش از ثبت (مثلاً قاعده‌ی کسب‌وکار سرور). */
let rejectNext: (() => Response) | null = null;

function fingerprint(method: string, path: string, rawBody: string): string {
  const body = JSON.parse(rawBody) as Record<string, unknown>;
  const sorted = Object.fromEntries(Object.entries(body).sort(([a], [b]) => a.localeCompare(b)));
  return `${method} ${path} ${JSON.stringify(sorted)}`;
}

function registerSale(mode: 'CASH' | 'CREDIT') {
  return async ({ request }: { request: Request }) => {
    const path = new URL(request.url).pathname;
    const rawBody = await request.text();
    // `contractGate` نبود کلید را پیش‌تر با ۴۰۰ رد کرده است.
    const key = request.headers.get('Idempotency-Key')!;
    const print = fingerprint(request.method, path, rawBody);

    const existing = idempotency.get(key);
    if (existing !== undefined) {
      if (existing.fingerprint !== print) {
        return mockError('CONFLICT', 'این Idempotency-Key قبلاً برای درخواست دیگری استفاده شده است');
      }
      return HttpResponse.json(existing.body, { status: existing.status });
    }

    if (rejectNext !== null) {
      const reject = rejectNext;
      rejectNext = null;
      return reject();
    }

    const body = JSON.parse(rawBody) as { partyId: string; jewelryItemId: string; paidRial?: string };
    const sequence = invoices.size + 1;
    const invoiceId = `d9400000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
    const invoiceNumber = 4_720 + sequence;
    const paid = mode === 'CASH' ? SERVER_PAYABLE_RIAL : BigInt(body.paidRial ?? '0');
    const response = {
      invoiceId,
      invoiceNumber,
      payableRial: SERVER_PAYABLE_RIAL.toString(),
      ...(mode === 'CREDIT' ? { receivableRial: (SERVER_PAYABLE_RIAL - paid).toString() } : {}),
      ledgerTransactionId: `e9400000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
      inventoryMovementId: `f9400000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    };
    invoices.set(
      invoiceId,
      salesInvoiceVersionHistorySchema.parse({
        invoiceId,
        invoiceNumber,
        versions: [
          {
            version: 1,
            reason: null,
            reasonDetail: null,
            partyId: body.partyId,
            actor: null,
            createdAt: SERVER_CREATED_AT,
            payableRial: SERVER_PAYABLE_RIAL.toString(),
            pureWeightMg: '2895',
            karat: 750,
            items: [{ itemType: 'JEWELRY', itemId: body.jewelryItemId, quantity: '1', pureWeightMg: '2895', karat: 750 }],
            totalsSnapshot: {},
            settingsSnapshot: {},
            ledgerEffects: [],
            inventoryEffects: [],
          },
        ],
      }),
    );
    idempotency.set(key, { fingerprint: print, status: 201, body: response });

    if (loseNextResponse) {
      loseNextResponse = false;
      return HttpResponse.error();
    }
    return HttpResponse.json(response, { status: 201 });
  };
}

const salesServer = [
  contractGate,
  http.post('/api/sales/invoices/jewelry', registerSale('CASH')),
  http.post('/api/sales/invoices/jewelry/credit', registerSale('CREDIT')),
  http.get('/api/sales/invoices/:invoiceId/versions', ({ params }) => {
    const found = invoices.get(String(params.invoiceId));
    return found ? HttpResponse.json(found) : mockError('NOT_FOUND', 'فاکتور مورد نظر پیدا نشد');
  }),
];

function writes(): Captured[] {
  return requests.filter((request) => request.method !== 'GET');
}

/* ── چرخه‌ی تست ───────────────────────────────────────────────── */

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    requests.push({
      method: request.method,
      path: new URL(request.url).pathname,
      headers: new Headers(request.headers),
      body: request.clone().text(),
    });
  });
  // همان پل `a11y.test.tsx`: fetch ِ Node آدرس نسبی و `AbortSignal` ِ jsdom را نمی‌پذیرد.
  const mswFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const { signal: _signal, ...rest } = init ?? {};
    return mswFetch(typeof input === 'string' && input.startsWith('/') ? new URL(input, window.location.origin) : input, rest);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  server.close();
});

beforeEach(() => {
  requests = [];
  idempotency = new Map();
  invoices = new Map();
  loseNextResponse = false;
  rejectNext = null;
  server.use(...salesServer);
  sessionStorage.clear();
  useSaleDraftStore.getState().reset();
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
  useUnitStore.setState({ unit: 'rial' });
  useSessionStore.setState({ session: CASHIER });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  useSessionStore.setState({ session: null });
});

/* ── کمک‌ها ───────────────────────────────────────────────────── */

type User = ReturnType<typeof userEvent.setup>;

function renderSalePage() {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/sales/new'] }) });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  );
}

/** مقدار خام (`data-raw`) عدد مالیِ ردیفی که برچسبش `label` است. */
function rawAmount(label: string, scope: HTMLElement = document.body): { raw: string; unit: string } {
  const row = within(scope).getByText(label, { selector: 'span' }).parentElement!;
  const amount = row.querySelector('[data-raw]')!;
  return { raw: amount.getAttribute('data-raw')!, unit: amount.getAttribute('data-unit')! };
}

async function next(user: User) {
  const button = screen.getByRole('button', { name: 'بعدی' });
  await waitFor(() => expect(button).not.toBeDisabled());
  await user.click(button);
}

/**
 * مسیر کاربر از صفحه‌ی خالی تا «مرور و ثبت»: مظنه → مشتری → کالا (+ قیمت‌گذاری) → پرداخت → مرور.
 * در هر مرحله همان چیزی را می‌سنجد که آن مرحله باید از سرور یا موتور محاسبه آورده باشد.
 */
async function walkToReview(user: User) {
  renderSalePage();
  await screen.findByRole('heading', { level: 1, name: 'فروش جدید' }, { timeout: 4000 });

  // ۱. مظنه — از `GET /pricing/quotes/latest`، نه عدد ثابت صفحه.
  await screen.findAllByText(/منبع: /, {}, { timeout: 4000 });
  const maznehCell = screen.getByText('مظنه مثقال').parentElement!;
  expect(maznehCell.querySelector('[data-raw]')).toHaveAttribute('data-raw', MAZNEH_RIAL.toString());
  await next(user);

  // ۲. شخص — جست‌وجو از `GET /parties`.
  await user.click(await screen.findByLabelText('مشتری'));
  await user.type(screen.getByLabelText('جست‌وجوی نام یا موبایل'), 'حسین');
  await user.click(await screen.findByRole('option', { name: /حسین مرادی/ }, { timeout: 4000 }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByLabelText('مشتری')).toHaveTextContent('حسین مرادی');
  await next(user);

  // ۳. کالا — جست‌وجوی کد از `GET /inventory/jewelry-items`.
  await user.click(await screen.findByRole('button', { name: 'افزودن کالا' }));
  await user.type(screen.getByLabelText('جست‌وجوی کد یا عنوان'), ITEM.code);
  await user.click(await screen.findByRole('option', { name: new RegExp(ITEM.title) }, { timeout: 4000 }));
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  // ۴. محاسبه — مشخصات از نسخه‌ی کاتالوگ پر می‌شوند و پیش‌نمایش همان خروجی core-calc است.
  await user.click(screen.getByRole('button', { name: `ویرایش قیمت ${ITEM.title}` }));
  const pricing = await screen.findByRole('dialog');
  await waitFor(() => expect(within(pricing).getByLabelText('وزن ناخالص')).toHaveAttribute('data-value', '4180'), {
    timeout: 4000,
  });
  expect(within(pricing).getByLabelText('عیار')).toHaveAttribute('data-value', '750');
  expect(within(pricing).getByLabelText('وزن نگین')).toHaveAttribute('data-value', '320');
  // وزن خالص با دست: (۴٫۱۸۰ − ۰٫۳۲۰) × ۷۵۰ ÷ ۱۰۰۰ = ۲٫۸۹۵ گرم
  expect(within(within(pricing).getByText('وزن خالص').parentElement!).getByText(formatGram(2_895n))).toBeInTheDocument();
  expect(EXPECTED_PREVIEW.pureWeightMg).toBe(2_895n);
  expect(rawAmount('مبلغ کل', pricing)).toEqual({ raw: EXPECTED_PREVIEW.payableRial.toString(), unit: 'rial' });
  await user.click(within(pricing).getByRole('button', { name: 'ذخیره' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await next(user);

  // ۵. پرداخت — مرحله‌ی روش پرداخت هنوز جانگه‌دار است؛ مبلغ پرداخت روی «مرور» پرسیده می‌شود.
  expect(screen.getByText('مرحله ۴ از ۵ — پرداخت')).toBeInTheDocument();
  await next(user);

  expect(screen.getByText('مرحله ۵ از ۵ — مرور و ثبت')).toBeInTheDocument();
  // مظنه‌ی قفل‌شده‌ی همین فاکتور و پیش‌نمایش جمع کل
  expect(rawAmount('مظنه‌ی ثبت‌شده برای این فاکتور').raw).toBe(MAZNEH_RIAL.toString());
  expect(rawAmount('مبلغ نهایی')).toEqual({ raw: EXPECTED_PREVIEW.payableRial.toString(), unit: 'rial' });
  // پیش‌شرط تست: اگر «سرور» و پیش‌نمایش یکی باشند، سنجش «عدد سرور برنده است» بی‌معنا می‌شود.
  expect(SERVER_PAYABLE_RIAL).not.toBe(EXPECTED_PREVIEW.payableRial);
}

async function submitButton(): Promise<HTMLElement> {
  const button = screen.getByRole('button', { name: 'ثبت فروش' });
  await waitFor(() => expect(button).not.toBeDisabled());
  return button;
}

async function receipt(): Promise<HTMLElement> {
  await screen.findByRole('heading', { level: 1, name: 'فروش ثبت شد' }, { timeout: 4000 });
  return (await screen.findByText('رسید فروش', {}, { timeout: 4000 })).closest('div.space-y-4') as HTMLElement;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/* ── سناریوها ─────────────────────────────────────────────────── */

describe('FE-094 — فروش زیورآلات از مظنه تا رسید، روی کلاینت و store واقعی', () => {
  it('پرداخت کامل: payload دقیق، Idempotency-Key، و رسیدی که فقط اعداد سرور را نشان می‌دهد', async () => {
    const user = userEvent.setup();
    await walkToReview(user);
    expect(screen.getByRole('button', { name: 'پرداخت کامل' })).toHaveAttribute('aria-pressed', 'true');

    const before = Date.now();
    await user.click(await submitButton());
    const page = await receipt();
    const after = Date.now();

    // ── درخواست: دقیقاً یک نوشتن، به endpoint نقدی
    expect(writes().map((request) => `${request.method} ${request.path}`)).toEqual(['POST /api/sales/invoices/jewelry']);
    const [write] = writes();
    const rawBody = await write!.body;
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    expect(body).toEqual({
      partyId: PARTY.id,
      jewelryItemId: ITEM.jewelryItemId,
      quoteId: QUOTE_ID,
      effectiveAt: expect.any(String),
    });
    // قرارداد `.strict()` است — کلید اضافه (مثلاً قیمت محاسبه‌شده‌ی کلاینت) رد می‌شد.
    expect(createJewelryCashSaleSchema.safeParse(body).success).toBe(true);
    const effectiveAt = Date.parse(String(body.effectiveAt));
    expect(effectiveAt).toBeGreaterThanOrEqual(before);
    expect(effectiveAt).toBeLessThanOrEqual(after);
    // هیچ عدد مالی به‌صورت number در JSON نیست — بدنه فقط ارجاع است، قیمت را سرور می‌زند.
    expect(Object.values(body).every((value) => typeof value === 'string')).toBe(true);
    expect(rawBody).not.toContain(EXPECTED_PREVIEW.payableRial.toString());

    // ── هدرها
    expect(write!.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(write!.headers.get('Content-Type')).toBe('application/json');
    expect(write!.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);

    // ── پاسخ server-authoritative: رسید از `GET /versions` ِ همان فاکتور خوانده شد
    const serverSale = jewelryCashSaleSchema.parse(
      [...idempotency.values()][0]!.body,
    );
    expect(requests.some((request) => request.method === 'GET' && request.path === `/api/sales/invoices/${serverSale.invoiceId}/versions`)).toBe(true);
    expect(within(within(page).getByText('شماره فاکتور').parentElement!).getByText(formatCount(serverSale.invoiceNumber))).toBeInTheDocument();
    expect(within(page).getByText('زمان ثبت').parentElement).toHaveTextContent(formatJalaliDateTime(new Date(SERVER_CREATED_AT)));
    expect(rawAmount('جمع فاکتور', page)).toEqual({ raw: SERVER_PAYABLE_RIAL.toString(), unit: 'rial' });
    expect(rawAmount('پرداخت‌شده (نقدی)', page).raw).toBe(SERVER_PAYABLE_RIAL.toString());
    expect(rawAmount('مانده', page).raw).toBe('0');
    expect(within(page).getByText('تسویه')).toBeInTheDocument();
    expect(within(page).getByText('مشتری').parentElement).toHaveTextContent('حسین مرادی');
    expect(rawAmount('نرخ قفل‌شده‌ی این فروش', page).raw).toBe(MAZNEH_RIAL.toString());
    // پیش‌نمایش کلاینت هیچ‌جای رسید نیست؛ اختلاف صریح گفته می‌شود.
    expect(page.querySelector(`[data-raw="${EXPECTED_PREVIEW.payableRial.toString()}"]`)).toBeNull();
    expect(within(page).getByText(/مبلغ ثبت‌شده با پیش‌نمایش مرحله‌ی مرور یکی نیست/)).toBeInTheDocument();
    expect(screen.getByText(`${formatRial(SERVER_PAYABLE_RIAL)} ریال`)).toBeInTheDocument(); // toast

    // کلید تعویض واحد روی رسید: معادل طلا از عدد سرور و مظنه‌ی قفل‌شده ساخته می‌شود.
    await user.click(screen.getByRole('radio', { name: 'طلا' }));
    const goldFace = dualFromRial(SERVER_PAYABLE_RIAL, gramRate1000(MAZNEH_RIAL));
    expect(rawAmount('جمع فاکتور', page)).toEqual({ raw: goldFace.pureMg.toString(), unit: 'gold' });

    // پیش‌نویس پاک شد؛ «سرور» دقیقاً یک فاکتور ساخت.
    expect(useSaleDraftStore.getState().items).toEqual([]);
    expect(invoices.size).toBe(1);
  }, 30_000);

  it('پرداخت ناقص: paidRial رشته‌ای به endpoint نسیه، و مانده‌ی رسید از پاسخ سرور', async () => {
    const user = userEvent.setup();
    await walkToReview(user);

    await user.click(screen.getByRole('button', { name: 'پرداخت ناقص (نسیه)' }));
    const paidField = screen.getByLabelText('مبلغ دریافتی');
    await user.click(paidField);
    await user.keyboard('200000000');
    await waitFor(() => expect(paidField).toHaveAttribute('data-value', '200000000'));
    // مانده‌ی مرحله‌ی مرور فقط تخمین کلاینت است: پیش‌نمایش − پرداخت.
    const estimated = EXPECTED_PREVIEW.payableRial - 200_000_000n;
    expect(rawAmount('مانده‌ی تخمینی').raw).toBe(estimated.toString());

    await user.click(await submitButton());
    const page = await receipt();

    expect(writes().map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /api/sales/invoices/jewelry/credit',
    ]);
    const rawBody = await writes()[0]!.body;
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    expect(body).toEqual({
      partyId: PARTY.id,
      jewelryItemId: ITEM.jewelryItemId,
      quoteId: QUOTE_ID,
      effectiveAt: expect.any(String),
      paidRial: '200000000',
    });
    expect(createJewelryCreditSaleSchema.safeParse(body).success).toBe(true);
    // مبلغ به‌صورت رشته، نه number — قاعده‌ی ۲-۱
    expect(rawBody).toContain('"paidRial":"200000000"');
    expect(Object.values(body).every((value) => typeof value === 'string')).toBe(true);
    expect(writes()[0]!.headers.get('Idempotency-Key')).toMatch(UUID);

    const serverSale = jewelryCreditSaleSchema.parse([...idempotency.values()][0]!.body);
    const serverReceivable = BigInt(serverSale.receivableRial);
    expect(serverReceivable).not.toBe(estimated);
    expect(rawAmount('جمع فاکتور', page).raw).toBe(SERVER_PAYABLE_RIAL.toString());
    expect(rawAmount('مانده', page).raw).toBe(serverReceivable.toString());
    expect(rawAmount('پرداخت‌شده', page).raw).toBe((SERVER_PAYABLE_RIAL - serverReceivable).toString());
    expect(within(page).getByText('بدهکار')).toBeInTheDocument();
    expect(within(page).getByText(/این فروش نسیه ثبت شد/)).toBeInTheDocument();
  }, 30_000);

  it('پاسخ گم‌شده: تلاش دوباره همان کلید و همان بدنه را می‌فرستد و همان فاکتور را برمی‌گرداند', async () => {
    const user = userEvent.setup();
    await walkToReview(user);

    loseNextResponse = true;
    await user.click(await submitButton());
    expect(await screen.findByText('ارتباط با سرور برقرار نشد', {}, { timeout: 4000 })).toBeInTheDocument();
    // «سرور» فروش را ثبت کرده ولی مرورگر خبر ندارد: رسیدی نیست و پیش‌نویس سر جایش است.
    expect(invoices.size).toBe(1);
    expect(screen.queryByText('رسید فروش')).not.toBeInTheDocument();
    expect(useSaleDraftStore.getState().items).toHaveLength(1);

    await user.click(await submitButton());
    const page = await receipt();

    const [first, second] = writes();
    expect(writes()).toHaveLength(2);
    expect(second!.headers.get('Idempotency-Key')).toBe(first!.headers.get('Idempotency-Key'));
    // بدنه‌ی بایت‌به‌بایت یکسان — سرور با بدنه‌ی دیگر (حتی فقط `effectiveAt` تازه) ۴۰۹ می‌دهد.
    expect(await second!.body).toBe(await first!.body);
    expect(invoices.size).toBe(1);
    const [invoice] = invoices.values();
    expect(within(within(page).getByText('شماره فاکتور').parentElement!).getByText(formatCount(invoice!.invoiceNumber))).toBeInTheDocument();
  }, 30_000);

  it('ضربه‌ی دوباره روی «ثبت فروش» حین ارسال، درخواست دوم نمی‌فرستد', async () => {
    const user = userEvent.setup();
    await walkToReview(user);

    const button = await submitButton();
    // `fireEvent` تا ضربه‌ی دوم پیش از رندر «در حال ثبت» برسد — قفل واقعی سنکرون است، نه `disabled`.
    fireEvent.click(button);
    fireEvent.click(button);
    await receipt();

    expect(writes()).toHaveLength(1);
    expect(invoices.size).toBe(1);
  }, 30_000);

  it('فروش بعدی کلید Idempotency تازه می‌گیرد — دو فروش واقعی، دو فاکتور', async () => {
    const user = userEvent.setup();
    await walkToReview(user);
    await user.click(await submitButton());
    await receipt();

    await user.click(screen.getByRole('button', { name: 'فروش جدید' }));
    cleanup();
    await walkToReview(user);
    await user.click(await submitButton());
    await receipt();

    const [first, second] = writes();
    expect(writes()).toHaveLength(2);
    expect(second!.headers.get('Idempotency-Key')).not.toBe(first!.headers.get('Idempotency-Key'));
    expect(invoices.size).toBe(2);
  }, 45_000);

  it('رد سرور: پیام خطا در صفحه می‌ماند، رسیدی ساخته نمی‌شود و پیش‌نویس قابل اصلاح است', async () => {
    const user = userEvent.setup();
    await walkToReview(user);

    rejectNext = () => mockError('VALIDATION_ERROR', 'ورودی نامعتبر است', { jewelryItemId: ['این کالا موجود نیست'] });
    await user.click(await submitButton());

    expect(await screen.findByText('اطلاعات واردشده را بررسی کنید', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'فروش ثبت شد' })).not.toBeInTheDocument();
    expect(invoices.size).toBe(0);
    const draft = useSaleDraftStore.getState();
    expect(draft.party?.id).toBe(PARTY.id);
    expect(draft.items).toHaveLength(1);
    expect(draft.step).toBe('REVIEW');
    expect(screen.getByRole('button', { name: 'قبلی' })).not.toBeDisabled();
    expect(await submitButton()).not.toBeDisabled();
  }, 30_000);
});
