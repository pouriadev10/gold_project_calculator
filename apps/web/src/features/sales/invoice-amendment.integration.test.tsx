import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dualFromRial, formatCount, formatGram, formatInvoiceNumber } from '@gold/core-calc';
import {
  amendedSalesInvoiceSchema,
  amendSalesInvoiceSchema,
  salesInvoiceAmendmentHistorySchema,
  type SalesInvoiceAmendmentHistory,
} from '@gold/contracts';
import {
  salesInvoiceDetailSchema,
  salesInvoiceVersionHistorySchema,
  type SalesInvoiceDetail,
  type SalesInvoiceVersionHistory,
  type SessionResponse,
} from '@/api/contracts';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { contractGate } from '@/mocks/handlers/contract-gate';
import { mockError } from '@/mocks/handlers/errors';
import {
  jewelryItemVersionRecords,
  MAZNEH_RIAL,
  priceJewelryFromVersion,
  salesInvoiceDetailRecords,
  salesInvoiceVersionRecords,
} from '@/mocks/handlers/fixtures';
import { useSessionStore } from '@/stores/session-store';
import { useUnitStore } from '@/stores/unit-store';
import { createIntegrationServer, IdempotencyLedger, renderRoute, UUID } from '@/test/integration';

/**
 * تست Integration اصلاح فاکتور — FE-097.
 *
 * از صفحه‌ی جزئیات فاکتور تا نسخه‌ی جدید، روی درخت مسیر، هوک‌ها و کلاینت واقعی؛ `msw/node` تنها
 * مرز (`@/test/integration`). «سرور» یک فاکتور واقعیِ fixture را نگه می‌دارد (جزئیات، policy،
 * نسخه‌ها، اصلاحیه‌ها)، اصلاح را با **مظنه‌ی قفل‌شده‌ی همان فاکتور** و مشخصات تاریخی قلم قیمت
 * می‌زند، نسخه‌ی تازه را append می‌کند (نسخه‌ی قبلی دست‌نخورده) و Idempotency ِ سرور را دارد.
 *
 * قرارداد BE-054 ویرایش مستقیم وزن را نمی‌پذیرد: «تغییر وزن» یعنی انتخاب قلمی که وزن درست را
 * دارد؛ وزن آن قلم از نسخه‌ی مؤثر در تاریخ صدور فاکتور خوانده می‌شود.
 */

const api = createIntegrationServer();

const OWNER: SessionResponse = {
  accessToken: 'fe097-access',
  refreshToken: 'fe097-refresh',
  expiresInSeconds: 900,
  user: { id: 'c1000000-0000-4000-8000-000000000002', email: 'owner@example.com', displayName: 'مالک نمونه' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
  role: 'OWNER',
};

/** فاکتور ۱۲۱: «سرویس کامل ۱۸ عیار» (۴۱٫۲۰۰ گرم) — در واقع «ست کامل عروس» (۶۵ گرم) فروخته شده بود. */
const ORIGINAL_DETAIL = salesInvoiceDetailRecords[1]!;
const ORIGINAL_HISTORY = salesInvoiceVersionRecords.find((record) => record.invoiceId === ORIGINAL_DETAIL.id)!;
const INVOICE_ID = ORIGINAL_DETAIL.id;
const BEFORE = ORIGINAL_DETAIL.versions[0]!;
const ISSUED_AT = BEFORE.createdAt;
const CORRECT_ITEM = jewelryItemVersionRecords.find((item) => item.code === 'ST-750-20')!;
/** مظنه‌ی قفل‌شده‌ی فاکتور و نرخ گرم ۱۰۰۰ همان snapshot. */
const LOCKED_RATE_1000 = BigInt(ORIGINAL_DETAIL.quoteSnapshot!.goldRatePerGramRial);
/** مظنه‌ی امروز عوض شده — هیچ عددی از اصلاح نباید از آن بیاید (قاعده‌ی ۲-۸). */
const TODAY_MAZNEH = MAZNEH_RIAL + 55_000_000n;

/** قیمت مستقل «سرور» برای قلم درست با مظنه‌ی قفل‌شده. */
const EXPECTED = priceJewelryFromVersion(CORRECT_ITEM, MAZNEH_RIAL);

/* ── «سرور» ───────────────────────────────────────────────────── */

let ledger = new IdempotencyLedger();
let detail: SalesInvoiceDetail = structuredClone(ORIGINAL_DETAIL);
let history: SalesInvoiceVersionHistory = structuredClone(ORIGINAL_HISTORY);
/** `at` ِ هر درخواست مشخصات قلم — باید لحظه‌ی صدور فاکتور باشد، نه امروز. */
let itemSpecAt: string[] = [];
let loseNextResponse = false;
let rejectNext: (() => Response) | null = null;

function amendInvoice(raw: Record<string, unknown>) {
  if (rejectNext !== null) {
    const reject = rejectNext;
    rejectNext = null;
    return reject();
  }
  const body = amendSalesInvoiceSchema.parse(raw);
  if (body.item.itemType !== 'JEWELRY') return mockError('BAD_REQUEST', 'این فاکتور فقط با قلم زیورآلات اصلاح می‌شود');
  const jewelryItemId = body.item.jewelryItemId;
  const item = jewelryItemVersionRecords.find((candidate) => candidate.jewelryItemId === jewelryItemId);
  if (!item) return mockError('NOT_FOUND', 'کالای انتخاب‌شده پیدا نشد');
  // مظنه‌ی قفل‌شده‌ی خودِ فاکتور، نه مظنه‌ی امروز
  const calc = priceJewelryFromVersion(item, BigInt(detail.quoteSnapshot!.amountRial));
  const paid = BigInt(body.item.paidRial);
  if (paid > calc.payableRial) return mockError('BAD_REQUEST', 'مبلغ پرداختی نمی‌تواند از مبلغ قابل‌پرداخت بیشتر باشد');

  const version = detail.currentVersion + 1;
  const createdAt = '2026-10-14T09:15:00.000Z';
  const actor = { id: OWNER.user.id, displayName: OWNER.user.displayName };
  const receivable = calc.payableRial - paid;
  const line = {
    itemType: 'JEWELRY' as const,
    itemId: item.jewelryItemId,
    quantity: '1',
    pureWeightMg: calc.pureWeightMg.toString(),
    karat: item.karat,
  };
  // append-only: نسخه‌ی قبلی همان‌طور که بود می‌ماند
  detail = salesInvoiceDetailSchema.parse({
    ...detail,
    currentVersion: version,
    versions: [
      ...detail.versions,
      {
        version,
        reason: body.reason,
        reasonDetail: body.reasonDetail ?? null,
        actor,
        createdAt,
        payableRial: calc.payableRial.toString(),
        paidRial: paid.toString(),
        receivableRial: receivable.toString(),
        pureWeightMg: calc.pureWeightMg.toString(),
        items: [{ ...line, title: item.title, payableRial: calc.payableRial.toString() }],
        settingsSnapshot: detail.versions[0]!.settingsSnapshot,
        ledgerSummary: { transactionCount: 1, entryCount: 6, balanced: true },
      },
    ],
  });
  history = salesInvoiceVersionHistorySchema.parse({
    ...history,
    versions: [
      ...history.versions,
      {
        version,
        reason: body.reason,
        reasonDetail: body.reasonDetail ?? null,
        partyId: body.partyId,
        actor,
        createdAt,
        payableRial: calc.payableRial.toString(),
        pureWeightMg: calc.pureWeightMg.toString(),
        karat: item.karat,
        items: [line],
        totalsSnapshot: {},
        settingsSnapshot: history.versions[0]!.settingsSnapshot,
        ledgerEffects: [],
        inventoryEffects: [],
      },
    ],
  });
  return {
    status: 201,
    body: {
      invoiceId: detail.id,
      invoiceNumber: detail.invoiceNumber!,
      invoicePeriod: detail.invoicePeriod!,
      version,
      payableRial: calc.payableRial.toString(),
      receivableRial: receivable.toString(),
      ledgerTransactionId: 'e9700000-0000-4000-8000-000000000001',
      inventoryMovementIds: ['f9700000-0000-4000-8000-000000000001', 'f9700000-0000-4000-8000-000000000002'],
    },
  };
}

function difference(before: string | null, after: string | null): string | null {
  return before === null || after === null ? null : (BigInt(after) - BigInt(before)).toString();
}

function amendments(): SalesInvoiceAmendmentHistory {
  return salesInvoiceAmendmentHistorySchema.parse({
    invoiceId: history.invoiceId,
    invoiceNumber: history.invoiceNumber,
    invoicePeriod: history.invoicePeriod,
    amendments: history.versions.flatMap((version, index) => {
      const before = history.versions[index - 1];
      if (!before || version.reason === null) return [];
      return [
        {
          version: version.version,
          reason: version.reason,
          reasonDetail: version.reasonDetail,
          actor: version.actor,
          createdAt: version.createdAt,
          changes: {
            pureWeightMg: {
              before: before.pureWeightMg,
              after: version.pureWeightMg,
              delta: difference(before.pureWeightMg, version.pureWeightMg),
            },
            payableRial: {
              before: before.payableRial,
              after: version.payableRial,
              delta: difference(before.payableRial, version.payableRial),
            },
            karat: { before: before.karat, after: version.karat },
          },
          ledgerEffects: version.ledgerEffects,
          inventoryEffects: version.inventoryEffects,
        },
      ];
    }),
  });
}

const invoiceServer = [
  contractGate,
  http.get('/api/sales/invoices/:invoiceId/detail', () => HttpResponse.json(detail)),
  http.get('/api/sales/invoices/:invoiceId/amendment-policy', () =>
    HttpResponse.json({
      invoiceId: detail.id,
      invoiceVersion: detail.currentVersion,
      evaluatedAt: new Date().toISOString(),
      allowed: true,
      requiresManagerAuthorization: false,
      restrictions: [],
    }),
  ),
  http.get('/api/sales/invoices/:invoiceId/versions', () => HttpResponse.json(history)),
  http.get('/api/sales/invoices/:invoiceId/amendments', () => HttpResponse.json(amendments())),
  http.post('/api/sales/invoices/:invoiceId/amend', ({ request, params }) => {
    if (params['invoiceId'] !== INVOICE_ID) return mockError('NOT_FOUND', 'فاکتور مورد نظر پیدا نشد');
    const loseResponse = loseNextResponse;
    loseNextResponse = false;
    return ledger.handle(request, amendInvoice, { loseResponse });
  }),
  // مشخصات مؤثر قلم «در تاریخ» — سرور واقعی نسخه‌ی معتبر همان لحظه را برمی‌گرداند.
  http.get('/api/inventory/jewelry-items/:id', ({ params, request }) => {
    const at = new URL(request.url).searchParams.get('at');
    if (at === null) return mockError('BAD_REQUEST', 'تاریخ مؤثر الزامی است');
    itemSpecAt.push(at);
    const found = jewelryItemVersionRecords.find((item) => item.jewelryItemId === params['id']);
    return found ? HttpResponse.json(found) : mockError('NOT_FOUND', 'کالا پیدا نشد');
  }),
  http.get('/api/pricing/quotes/latest', () =>
    HttpResponse.json({
      id: 'c1000000-0000-4000-8000-000000000099',
      quoteType: 'MAZNEH',
      amountRial: TODAY_MAZNEH.toString(),
      source: 'MANUAL',
      observedAt: new Date().toISOString(),
      createdBy: null,
      createdAt: new Date().toISOString(),
    }),
  ),
];

/* ── چرخه‌ی تست ───────────────────────────────────────────────── */

beforeAll(api.start);
afterAll(api.stop);

beforeEach(() => {
  api.reset();
  ledger = new IdempotencyLedger();
  detail = structuredClone(ORIGINAL_DETAIL);
  history = structuredClone(ORIGINAL_HISTORY);
  itemSpecAt = [];
  loseNextResponse = false;
  rejectNext = null;
  api.server.use(...invoiceServer);
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
  useUnitStore.setState({ unit: 'rial' });
  useSessionStore.setState({ session: OWNER });
});

afterEach(() => {
  cleanup();
  api.server.resetHandlers();
  useSessionStore.setState({ session: null });
});

/* ── کمک‌ها ───────────────────────────────────────────────────── */

type User = ReturnType<typeof userEvent.setup>;

/** مقدار خام `AmountDisplay` در ردیفی از کارت که برچسبش `label` است. */
function amountIn(card: HTMLElement, label: string): string {
  const row = within(card).getByText(label, { selector: 'span' }).parentElement!;
  return row.querySelector('[data-raw]')!.getAttribute('data-raw')!;
}

function requestsTo(path: string): number {
  return api.requests().filter((request) => request.method === 'GET' && request.path === path).length;
}

/**
 * از صفحه‌ی فاکتور تا فرم اصلاح آماده‌ی ثبت: باز کردن فاکتور ← policy سرور ← انتخاب قلمِ وزن
 * درست (مشخصات تاریخی) ← دلیل «اشتباه وزن».
 */
async function prepareAmendment(user: User) {
  // ۱. باز کردن فاکتور
  renderRoute(`/sales/invoices/${INVOICE_ID}`);
  await screen.findByRole('heading', { level: 1, name: 'جزئیات فاکتور' }, { timeout: 10_000 });

  // ۲. policy — اقدام فقط وقتی سرور اجازه داده فعال است
  const amendLink = await screen.findByRole('link', { name: /اصلاح فاکتور/ }, { timeout: 10_000 });
  expect(requestsTo(`/api/sales/invoices/${INVOICE_ID}/amendment-policy`)).toBeGreaterThanOrEqual(1);
  await user.click(amendLink);
  await screen.findByText(`اصلاح فاکتور ${formatInvoiceNumber(detail.invoicePeriod!, detail.invoiceNumber!)}`, {}, { timeout: 10_000 });
  expect(screen.getByText(`نسخهٔ جاری: ${formatCount(1)}. شمارهٔ فاکتور تغییر نمی‌کند.`)).toBeInTheDocument();

  // مشخصات قلم فعلی از نسخه‌ی مؤثر در تاریخ صدور
  const select = screen.getByLabelText('قلم زیورآلات');
  expect(select).toHaveValue(BEFORE.items[0]!.itemId);
  await waitFor(() => expect(itemSpecAt).toContain(ISSUED_AT), { timeout: 10_000 });

  // ۳. تغییر وزن = قلمی که وزن درست را دارد
  await user.type(screen.getByLabelText('جست‌وجوی قلم جایگزین'), CORRECT_ITEM.code);
  await screen.findByRole('option', { name: new RegExp(CORRECT_ITEM.title) }, { timeout: 10_000 });
  await user.selectOptions(select, CORRECT_ITEM.jewelryItemId);
  const grossWeight = await screen.findByText(`${formatGram(BigInt(CORRECT_ITEM.grossWeightMg))} گرم`, {}, { timeout: 10_000 });
  expect(grossWeight.previousElementSibling).toHaveTextContent('وزن ناخالص');
  // مشخصات قلم تازه هم «در تاریخ صدور» خوانده شد، نه امروز
  expect(itemSpecAt.every((at) => at === ISSUED_AT)).toBe(true);
  expect(itemSpecAt.length).toBeGreaterThanOrEqual(2);

  // ۴. دلیل
  await user.selectOptions(screen.getByLabelText('دلیل اصلاح'), 'WEIGHT_ERROR');
  expect(screen.queryByLabelText('توضیح دلیل')).not.toBeInTheDocument();
  // پرداخت همان پرداخت نسخه‌ی جاری می‌ماند
  expect(screen.getByLabelText('مبلغ پرداختی اصلاح‌شده')).toHaveAttribute('data-value', BEFORE.paidRial);
}

function submitButton(): HTMLElement {
  return screen.getByRole('button', { name: 'ثبت اصلاح فاکتور' });
}

/* ── سناریوها ─────────────────────────────────────────────────── */

describe('FE-097 — اصلاح فاکتور از صفحه‌ی فاکتور تا نسخه‌ی جدید، روی کلاینت واقعی', () => {
  it('payload دقیق، مرور اختلاف از پاسخ سرور، و نسخه‌ی ۲ جاری با شماره‌ی ثابت فاکتور', async () => {
    const user = userEvent.setup();
    await prepareAmendment(user);
    await user.click(submitButton());

    // ── درخواست: فقط واقعیت‌های منبع؛ هیچ مبلغ یا وزن محاسبه‌شده‌ای از کلاینت نمی‌رود
    const result = await screen.findByLabelText('نتیجه اصلاح فاکتور', {}, { timeout: 10_000 });
    expect(api.writes().map((request) => `${request.method} ${request.path}`)).toEqual([
      `POST /api/sales/invoices/${INVOICE_ID}/amend`,
    ]);
    const [write] = api.writes();
    const body = JSON.parse(await write!.body) as Record<string, unknown>;
    expect(body).toEqual({
      reason: 'WEIGHT_ERROR',
      partyId: ORIGINAL_DETAIL.party.id,
      item: { itemType: 'JEWELRY', jewelryItemId: CORRECT_ITEM.jewelryItemId, paidRial: BEFORE.paidRial },
    });
    expect(amendSalesInvoiceSchema.safeParse(body).success).toBe(true);
    expect(write!.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(write!.headers.get('Authorization')).toBe(`Bearer ${OWNER.accessToken}`);

    // ── مرور اختلاف — همه از پاسخ و تاریخچه‌ی سرور
    const server = amendedSalesInvoiceSchema.parse(ledger.responses()[0]);
    expect(server.payableRial).toBe(EXPECTED.payableRial.toString());
    expect(within(result).getByText(`فاکتور ${formatInvoiceNumber(ORIGINAL_DETAIL.invoicePeriod!, ORIGINAL_DETAIL.invoiceNumber!)} · نسخهٔ ${formatCount(2)}`)).toBeInTheDocument();
    expect(within(result).getByText(/نسخهٔ قبلی و سندهای آن تغییر نکرده‌اند/)).toBeInTheDocument();

    const beforeCard = screen.getByText(`قبل · نسخهٔ ${formatCount(1)}`).parentElement!.parentElement!;
    const afterCard = screen.getByText(`بعد · نسخهٔ ${formatCount(2)}`).parentElement!.parentElement!;
    const effectCard = screen.getByText('اثر اصلاح').parentElement!.parentElement!;
    expect(amountIn(beforeCard, 'مبلغ')).toBe(BEFORE.payableRial);
    expect(amountIn(beforeCard, 'مانده')).toBe(BEFORE.receivableRial);
    expect(amountIn(afterCard, 'مبلغ')).toBe(server.payableRial);
    expect(amountIn(afterCard, 'مانده')).toBe(server.receivableRial);
    // وزن بعد از `GET /versions` ِ تازه‌شده می‌آید
    await within(afterCard).findByText(`وزن خالص: ${formatGram(EXPECTED.pureWeightMg)} گرم`, {}, { timeout: 10_000 });
    expect(within(beforeCard).getByText(`وزن خالص: ${formatGram(BigInt(BEFORE.pureWeightMg!))} گرم`)).toBeInTheDocument();
    expect(amountIn(effectCard, 'اختلاف مبلغ')).toBe((BigInt(server.payableRial) - BigInt(BEFORE.payableRial)).toString());
    expect(amountIn(effectCard, 'تغییر ماندهٔ مشتری')).toBe(
      (BigInt(server.receivableRial) - BigInt(BEFORE.receivableRial)).toString(),
    );
    expect(
      within(effectCard).getByText(`اختلاف وزن خالص: ${formatGram(EXPECTED.pureWeightMg - BigInt(BEFORE.pureWeightMg!))} گرم`),
    ).toBeInTheDocument();

    // رو‌ی طلا با نرخ قفل‌شده‌ی فاکتور، نه مظنه‌ی امروز (قاعده‌ی ۲-۸)
    await user.click(screen.getAllByRole('radio', { name: 'طلا' })[0]!);
    const goldRaw = within(afterCard).getByText('مبلغ', { selector: 'span' }).parentElement!.querySelector('[data-raw]')!;
    expect(goldRaw).toHaveAttribute('data-unit', 'gold');
    expect(goldRaw).toHaveAttribute('data-raw', dualFromRial(BigInt(server.payableRial), LOCKED_RATE_1000).pureMg.toString());
    await user.click(screen.getAllByRole('radio', { name: 'ریال' })[0]!);

    // ── مشاهده‌ی نسخه‌ی جدید روی صفحه‌ی فاکتور
    await user.click(screen.getByRole('link', { name: 'دیدن فاکتور' }));
    await screen.findByRole('heading', { level: 1, name: 'جزئیات فاکتور' }, { timeout: 10_000 });
    const v2 = (await screen.findByText(`نسخه ${formatCount(2)}`, {}, { timeout: 10_000 })).closest('li')!;
    const v1 = screen.getByText(`نسخه ${formatCount(1)}`).closest('li')!;
    expect(within(v2).getByText('جاری')).toBeInTheDocument();
    expect(within(v1).getByText('قبلی')).toBeInTheDocument();
    expect(within(v2).getByText('اصلاح وزن')).toBeInTheDocument();
    expect(within(v1).getByText('صدور اولیه')).toBeInTheDocument();
    await within(v2).findByText(`${formatGram(EXPECTED.pureWeightMg - BigInt(BEFORE.pureWeightMg!))} گرم`, {}, { timeout: 10_000 });
    expect(screen.getByText('اصلاح‌شده')).toBeInTheDocument();
    // نسخه‌ی ۱ روی سرور دست‌نخورده ماند
    expect(history.versions[0]).toEqual(ORIGINAL_HISTORY.versions[0]);
    expect(ledger.size).toBe(1);
  }, 60_000);

  it('پاسخ گم‌شده: تلاش دوباره همان کلید و همان بدنه، فقط یک نسخه‌ی تازه', async () => {
    const user = userEvent.setup();
    await prepareAmendment(user);

    loseNextResponse = true;
    await user.click(submitButton());
    expect(await screen.findByText('ارتباط با سرور برقرار نشد', {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(detail.currentVersion).toBe(2);

    // FE-100: پاسخ نامشخص فرم را قفل می‌کند؛ ویرایش ممکن نیست، فقط تکرار همان درخواست
    expect(screen.getByLabelText('مبلغ پرداختی اصلاح‌شده')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'بررسی نتیجه‌ی ثبت' }));
    const result = await screen.findByLabelText('نتیجه اصلاح فاکتور', {}, { timeout: 10_000 });

    const [first, second] = api.writes();
    expect(api.writes()).toHaveLength(2);
    expect(second!.headers.get('Idempotency-Key')).toBe(first!.headers.get('Idempotency-Key'));
    expect(await second!.body).toBe(await first!.body);
    expect(detail.versions).toHaveLength(2);
    expect(within(result).getByText(new RegExp(`نسخهٔ ${formatCount(2)}$`))).toBeInTheDocument();
  }, 60_000);

  it('FE-099: اصلاح ثبت‌نشده با ترک صفحه پرسیده می‌شود و ترک هیچ نسخه‌ای نمی‌سازد', async () => {
    const user = userEvent.setup();
    await prepareAmendment(user);

    await user.click(await screen.findByRole('link', { name: /بازگشت به فاکتور/ }));
    const dialog = await screen.findByRole('dialog', {}, { timeout: 10_000 });
    expect(dialog).toHaveTextContent('تغییرات ثبت نشده‌اند');
    await user.click(within(dialog).getByRole('button', { name: 'ماندن در صفحه' }));
    expect(screen.getByLabelText('قلم زیورآلات')).toHaveValue(CORRECT_ITEM.jewelryItemId);

    await user.click(await screen.findByRole('link', { name: /بازگشت به فاکتور/ }));
    await user.click(await screen.findByRole('button', { name: 'ترک صفحه' }));
    await screen.findByRole('heading', { level: 1, name: 'جزئیات فاکتور' }, { timeout: 10_000 });
    expect(api.writes()).toHaveLength(0);
    expect(detail.currentVersion).toBe(1);
  }, 60_000);

  it('رد سرور در تراکنش نوشتن: پیام در صفحه، هیچ نسخه‌ی تازه‌ای نیست و فرم قابل اصلاح می‌ماند', async () => {
    const user = userEvent.setup();
    await prepareAmendment(user);

    rejectNext = () => mockError('BAD_REQUEST', 'اختلاف مبلغ از حد مجاز اصلاح عادی بیشتر است');
    await user.click(submitButton());

    expect(await screen.findByText('اطلاعات واردشده را بررسی کنید', {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByLabelText('نتیجه اصلاح فاکتور')).not.toBeInTheDocument();
    expect(detail.currentVersion).toBe(1);
    expect(history.versions).toHaveLength(1);
    expect(screen.getByLabelText('قلم زیورآلات')).toHaveValue(CORRECT_ITEM.jewelryItemId);
    expect(screen.getByLabelText('دلیل اصلاح')).toHaveValue('WEIGHT_ERROR');
    expect(submitButton()).not.toBeDisabled();
  }, 60_000);
});
