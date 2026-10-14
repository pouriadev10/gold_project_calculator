import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  calculateSecondHandGoldPurchase,
  formatGram,
  gramRate,
  grossMg,
  karat,
  RATE_DIVISOR,
} from '@gold/core-calc';
import { createSecondHandGoldPurchaseSchema, secondHandGoldPurchaseSchema } from '@gold/contracts';
import { generalSettingsSchema, type SessionResponse } from '@/api/contracts';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { contractGate } from '@/mocks/handlers/contract-gate';
import { mockError } from '@/mocks/handlers/errors';
import { MAZNEH_RIAL, partyRecords } from '@/mocks/handlers/fixtures';
import { usePurchaseDraftStore } from '@/stores/purchase-draft-store';
import { useSessionStore } from '@/stores/session-store';
import { useUnitStore } from '@/stores/unit-store';
import { createIntegrationServer, IdempotencyLedger, rawAmount, renderRoute, UUID } from '@/test/integration';

/**
 * تست Integration خرید طلای دست‌دوم از مصرف‌کننده — FE-095.
 *
 * مثل FE-094: درخت مسیر، store پیش‌نویس، هوک‌ها و کلاینت واقعی؛ `msw/node` تنها مرز
 * (`@/test/integration`). «سرور» خرید و تنظیمات عمومی را این فایل جواب می‌دهد: خرید با همان
 * `calculateSecondHandGoldPurchase` ِ سرور واقعی و **تنظیمات نسخه‌دار همین مستأجر** قیمت می‌خورد
 * (عیار پیش‌فرض ۷۵۰، گرد کردن ۱۰٬۰۰۰ ریال — عمداً هیچ‌کدام همان عدد ثابت قدیمی کد نیست)، و
 * Idempotency همان قاعده‌ی سرور (`IdempotencyLedger`) است.
 *
 * مسیر: فروشنده → وزن → کسورات → عیار → مظنه → مبلغ → پرداخت → ثبت → رسید.
 */

const api = createIntegrationServer();

const ACCESS_TOKEN = 'fe095-access';
const CASHIER: SessionResponse = {
  accessToken: ACCESS_TOKEN,
  refreshToken: 'fe095-refresh',
  expiresInSeconds: 900,
  user: { id: 'c1000000-0000-4000-8000-000000000002', email: 'cashier@example.com', displayName: 'صندوق‌دار نمونه' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
  role: 'CASHIER',
};

/** مظنه‌ی جاری handlerهای توسعه (`maznehQuoteHistory[0]` در `mocks/handlers/index.ts`). */
const QUOTE_ID = 'c1000000-0000-4000-8000-000000000001';
const SELLER = partyRecords.find((party) => party.displayName === 'حسین مرادی')!;

/** تنظیمات نسخه‌دار مستأجر — `GET /settings/general`. */
const TENANT_KARAT = 750;
const TENANT_ROUNDING_RIAL = 10_000n;

/** ورودی کاربر: ۱۲٫۵۰۰ گرم، نگین ۰٫۸۰۰، سایر ۰٫۲۰۰، کارمزد ۵۰۰٬۰۰۰ ریال. */
const GROSS_MG = 12_500n;
const STONE_MG = 800n;
const OTHER_MG = 200n;
const FEE_RIAL = 500_000n;

/**
 * پیش‌نمایش مستقل از کد صفحه: همان ورودی‌ها مستقیم به `core-calc`. اگر صفحه عیار هاردکد، واحد
 * گرد کردن ثابت یا کسوراتی جاافتاده به موتور بدهد، با این نمی‌خواند.
 */
function expected(purchaseKarat: number, roundingUnitRial = TENANT_ROUNDING_RIAL) {
  return calculateSecondHandGoldPurchase({
    grossWeightMg: GROSS_MG,
    deductions: { stone: grossMg(STONE_MG), other: grossMg(OTHER_MG) },
    purchaseKarat: karat(purchaseKarat),
    maznehRial: MAZNEH_RIAL,
    feeRial: FEE_RIAL,
    roundingUnitRial,
    rateDivisor: RATE_DIVISOR,
  });
}

/* ── «سرور» ───────────────────────────────────────────────────── */

let ledger = new IdempotencyLedger();
/** واحد گرد کردنی که «سرور» لحظه‌ی ثبت با آن قیمت می‌زند — نسخه‌ی مؤثر همان لحظه. */
let serverRoundingRial = TENANT_ROUNDING_RIAL;
let loseNextResponse = false;
let rejectNext: (() => Response) | null = null;

function createPurchase(raw: Record<string, unknown>) {
  if (rejectNext !== null) {
    const reject = rejectNext;
    rejectNext = null;
    return reject();
  }
  const body = createSecondHandGoldPurchaseSchema.parse(raw);
  if (body.quoteId !== QUOTE_ID) return mockError('BAD_REQUEST', 'مظنه‌ی انتخاب‌شده پیدا نشد');
  const calc = calculateSecondHandGoldPurchase({
    grossWeightMg: BigInt(body.grossWeightMg),
    deductions: { stone: grossMg(BigInt(body.stoneWeightMg)), other: grossMg(BigInt(body.otherDeductionWeightMg)) },
    // عیار نیامده = تنظیم نسخه‌دار مستأجر، همان کاری که `second-hand-gold-purchases.service.ts` می‌کند
    purchaseKarat: karat(body.purchaseKarat ?? TENANT_KARAT),
    maznehRial: MAZNEH_RIAL,
    feeRial: BigInt(body.feeRial),
    roundingUnitRial: serverRoundingRial,
    rateDivisor: RATE_DIVISOR,
  });
  const paid = BigInt(body.paidRial);
  if (paid > calc.finalAmountRial) return mockError('BAD_REQUEST', 'پرداخت بیشتر از مبلغ خرید است');
  const sequence = String(ledger.size + 1).padStart(12, '0');
  return {
    status: 201,
    body: {
      secondHandPurchaseId: `d9500000-0000-4000-8000-${sequence}`,
      ledgerTransactionId: `e9500000-0000-4000-8000-${sequence}`,
      inventoryMovementId: `f9500000-0000-4000-8000-${sequence}`,
      pureWeightMg: calc.pureWeightMg.toString(),
      goldRatePerGramRial: calc.goldRatePerGramRial.toString(),
      grossPurchaseAmountRial: calc.grossPurchaseAmountRial.toString(),
      feeRial: body.feeRial,
      finalAmountRial: calc.finalAmountRial.toString(),
      paidRial: body.paidRial,
      payableRial: (calc.finalAmountRial - paid).toString(),
    },
  };
}

const purchaseServer = [
  contractGate,
  http.post('/api/purchase/second-hand/gold', ({ request }) => {
    const loseResponse = loseNextResponse;
    loseNextResponse = false;
    return ledger.handle(request, createPurchase, { loseResponse });
  }),
  http.get('/api/settings/general', () =>
    HttpResponse.json(
      generalSettingsSchema.parse({
        settings: [
          {
            key: 'purchase.second_hand_default_karat',
            value: String(TENANT_KARAT),
            version: 3,
            validFrom: '2026-09-01T00:00:00.000Z',
            createdBy: null,
          },
          {
            key: 'pricing.rial_rounding_unit',
            value: TENANT_ROUNDING_RIAL.toString(),
            version: 2,
            validFrom: '2026-09-01T00:00:00.000Z',
            createdBy: null,
          },
        ],
      }),
    ),
  ),
];

/* ── چرخه‌ی تست ───────────────────────────────────────────────── */

beforeAll(api.start);
afterAll(api.stop);

beforeEach(() => {
  api.reset();
  ledger = new IdempotencyLedger();
  serverRoundingRial = TENANT_ROUNDING_RIAL;
  loseNextResponse = false;
  rejectNext = null;
  api.server.use(...purchaseServer);
  sessionStorage.clear();
  usePurchaseDraftStore.getState().reset();
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
  useUnitStore.setState({ unit: 'rial' });
  useSessionStore.setState({ session: CASHIER });
});

afterEach(() => {
  cleanup();
  api.server.resetHandlers();
  useSessionStore.setState({ session: null });
});

/* ── کمک‌ها ───────────────────────────────────────────────────── */

type User = ReturnType<typeof userEvent.setup>;

async function next(user: User) {
  const button = screen.getByRole('button', { name: 'بعدی' });
  await waitFor(() => expect(button).not.toBeDisabled());
  await user.click(button);
}

/** رقم‌ها را با کیبورد فیزیکی در فیلد کیپدی می‌زند و منتظر مقدار ذخیره‌ی لاتین می‌ماند. */
async function typeInto(user: User, label: string, keys: string, value: string) {
  const field = screen.getByLabelText(label);
  await user.click(field);
  await user.keyboard(keys);
  await waitFor(() => expect(field).toHaveAttribute('data-value', value));
}

async function renderPurchasePage() {
  renderRoute('/purchase/second-hand');
  await screen.findByRole('heading', { level: 1, name: 'خرید طلای دست‌دوم' }, { timeout: 4000 });
}

/**
 * مسیر کاربر از صفحه‌ی خالی تا «پرداخت»؛ در هر مرحله همان چیزی را می‌سنجد که آن مرحله باید از
 * سرور، تنظیمات مستأجر یا موتور محاسبه آورده باشد. `karat`: عیاری که کاربر به‌جای پیش‌فرض می‌زند.
 */
async function walkToPayment(user: User, options: { readonly karat?: number } = {}) {
  await renderPurchasePage();
  const purchaseKarat = options.karat ?? TENANT_KARAT;
  const calc = expected(purchaseKarat);

  // ۱. شخص — فروشنده‌ی مصرف‌کننده از `GET /parties`.
  await user.click(screen.getByLabelText('فروشنده'));
  await user.type(screen.getByLabelText('جست‌وجوی نام یا موبایل'), 'حسین');
  await user.click(await screen.findByRole('option', { name: /حسین مرادی/ }, { timeout: 4000 }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByLabelText('خلاصه امن مشخصات فروشنده')).toHaveTextContent('مصرف‌کننده');
  await next(user);

  // ۲. وزن
  expect(screen.getByText('مرحله ۲ از ۸ — وزن‌کشی')).toBeInTheDocument();
  await typeInto(user, 'وزن کل (ناخالص)', '12.500', GROSS_MG.toString());
  await next(user);

  // ۳. کسورات — وزن خالص پیش از عیار با دست: ۱۲٫۵۰۰ − ۰٫۸۰۰ − ۰٫۲۰۰ = ۱۱٫۵۰۰
  await typeInto(user, 'وزن نگین', '0.800', STONE_MG.toString());
  await typeInto(user, 'سایر متعلقات (چرم، نخ، موم)', '0.200', OTHER_MG.toString());
  expect(screen.getByTestId('net-weight-display')).toHaveTextContent(`${formatGram(11_500n)} گرم`);
  await next(user);

  // ۴. عیار — پیش‌فرض نسخه‌دار همین مستأجر، نه ۷۴۰ ِ کد
  const karatField = await screen.findByLabelText('عیار خرید', {}, { timeout: 4000 });
  expect(karatField).toHaveAttribute('data-value', String(TENANT_KARAT));
  expect(screen.getByText(/عیار پیش‌فرض خرید این فروشگاه: ۷۵۰/)).toBeInTheDocument();
  if (options.karat !== undefined) {
    await typeInto(user, 'عیار خرید', `{Backspace>3/}${options.karat}`, String(options.karat));
  }
  expect(rawAmount(`نرخ هر گرم عیار ${purchaseKarat}:`).raw).toBe(
    gramRate(MAZNEH_RIAL, karat(purchaseKarat), RATE_DIVISOR).toString(),
  );
  await next(user);

  // ۵. مظنه — از `GET /pricing/quotes/latest`
  const maznehCell = (await screen.findByText('مظنه مثقال', {}, { timeout: 4000 })).parentElement!;
  expect(maznehCell.querySelector('[data-raw]')).toHaveAttribute('data-raw', MAZNEH_RIAL.toString());
  await next(user);

  // ۶. مبلغ — کارمزد، طلای خالص و مبلغ نهایی با گرد کردن خودِ مستأجر
  await typeInto(user, 'کارمزد خرید (اختیاری)', '500000', FEE_RIAL.toString());
  expect(screen.getByTestId('pure-weight-display')).toHaveTextContent(`${formatGram(calc.pureWeightMg)} گرم`);
  expect(rawAmount('مبلغ قبل از کارمزد:')).toEqual({ raw: calc.grossPurchaseAmountRial.toString(), unit: 'rial' });
  expect(rawAmount('کارمزد کسرشده:').raw).toBe(FEE_RIAL.toString());
  expect(rawAmount('مبلغ نهایی قابل پرداخت:')).toEqual({ raw: calc.finalAmountRial.toString(), unit: 'rial' });
  expect(calc.finalAmountRial % TENANT_ROUNDING_RIAL).toBe(0n);
  await next(user);

  // ۷. پرداخت
  expect(screen.getByText('مرحله ۷ از ۸ — پرداخت')).toBeInTheDocument();
  return calc;
}

/** مانده‌ی تخمینی مرحله‌ی پرداخت — برچسب و عدد در یک `<p>` اند. */
function estimatedBalance(): string {
  const line = screen.getByText(/^مانده بستانکاری:/u, { selector: 'p' });
  return line.querySelector('[data-raw]')!.getAttribute('data-raw')!;
}

function receiptCard(): Promise<HTMLElement> {
  return screen.findByLabelText('رسید خرید', {}, { timeout: 4000 });
}

function receiptAmount(card: HTMLElement, label: string): string {
  return rawAmount(label, card, 'dt').raw;
}

/* ── سناریوها ─────────────────────────────────────────────────── */

describe('FE-095 — خرید طلای دست‌دوم از فروشنده تا رسید، روی کلاینت و store واقعی', () => {
  it('پرداخت کامل با تنظیمات مستأجر: payload دقیق، Idempotency-Key، رسید از پاسخ سرور', async () => {
    const user = userEvent.setup();
    const calc = await walkToPayment(user);

    await user.click(screen.getByRole('button', { name: 'پرداخت کامل' }));
    await waitFor(() =>
      expect(screen.getByLabelText('پرداخت اکنون (ریال)')).toHaveAttribute('data-value', calc.finalAmountRial.toString()),
    );
    expect(estimatedBalance()).toBe('0');

    const before = Date.now();
    await user.click(screen.getByRole('button', { name: 'ثبت خرید' }));
    const card = await receiptCard();
    const after = Date.now();

    // ── درخواست
    expect(api.writes().map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /api/purchase/second-hand/gold',
    ]);
    const [write] = api.writes();
    const rawBody = await write!.body;
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    expect(body).toEqual({
      partyId: SELLER.id,
      grossWeightMg: '12500',
      stoneWeightMg: '800',
      otherDeductionWeightMg: '200',
      purchaseKarat: TENANT_KARAT,
      quoteId: QUOTE_ID,
      feeRial: '500000',
      paidRial: calc.finalAmountRial.toString(),
      effectiveAt: expect.any(String),
    });
    expect(createSecondHandGoldPurchaseSchema.safeParse(body).success).toBe(true);
    // وزن و پول رشته‌اند؛ تنها number مجاز عیار است (عدد صحیح ۱ تا ۱۰۰۰، قاعده‌ی ۲-۱).
    for (const [key, value] of Object.entries(body)) {
      expect(typeof value, key).toBe(key === 'purchaseKarat' ? 'number' : 'string');
    }
    const effectiveAt = Date.parse(String(body.effectiveAt));
    expect(effectiveAt).toBeGreaterThanOrEqual(before);
    expect(effectiveAt).toBeLessThanOrEqual(after);
    expect(write!.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(write!.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(write!.headers.get('Content-Type')).toBe('application/json');

    // ── رسید = پاسخ سرور
    const server = secondHandGoldPurchaseSchema.parse(ledger.responses()[0]);
    expect(within(card).getByText('شناسه خرید').nextElementSibling).toHaveTextContent(server.secondHandPurchaseId);
    expect(within(card).getByText('وزن خالص ثبت‌شده').nextElementSibling).toHaveTextContent(
      `${formatGram(BigInt(server.pureWeightMg))} گرم`,
    );
    expect(receiptAmount(card, 'مبلغ خرید')).toBe(server.grossPurchaseAmountRial);
    expect(receiptAmount(card, 'کارمزد')).toBe(server.feeRial);
    expect(receiptAmount(card, 'مبلغ نهایی')).toBe(server.finalAmountRial);
    expect(receiptAmount(card, 'پرداخت‌شده')).toBe(server.paidRial);
    expect(receiptAmount(card, 'مانده بستانکاری فروشنده')).toBe('0');
    expect(screen.getByText('مرحله ۸ از ۸ — رسید')).toBeInTheDocument();

    // پیش‌نویس پاک شد؛ «خرید جدید» از اول شروع می‌کند.
    expect(usePurchaseDraftStore.getState().seller).toBeNull();
    expect(usePurchaseDraftStore.getState().attempt).toBeNull();
    await user.click(screen.getByRole('button', { name: 'خرید جدید' }));
    expect(screen.getByText('مرحله ۱ از ۸ — فروشنده')).toBeInTheDocument();
    expect(ledger.size).toBe(1);
  }, 45_000);

  it('عیار دستی و پرداخت ناقص؛ اگر سرور با نسخه‌ی تازه‌تر تنظیم قیمت بزند، رسید عدد سرور را نشان می‌دهد', async () => {
    const user = userEvent.setup();
    const calc = await walkToPayment(user, { karat: 740 });

    await typeInto(user, 'پرداخت اکنون (ریال)', '100000000', '100000000');
    expect(estimatedBalance()).toBe((calc.finalAmountRial - 100_000_000n).toString());

    // تنظیم گرد کردن وسط جریان نسخه‌ی تازه گرفته؛ سرور با نسخه‌ی مؤثر لحظه‌ی ثبت قیمت می‌زند.
    serverRoundingRial = 1_000_000n;
    await user.click(screen.getByRole('button', { name: 'ثبت خرید' }));
    const card = await receiptCard();

    const body = JSON.parse(await api.writes()[0]!.body) as Record<string, unknown>;
    expect(body).toMatchObject({ purchaseKarat: 740, paidRial: '100000000', feeRial: '500000' });
    expect(await api.writes()[0]!.body).toContain('"paidRial":"100000000"');

    const server = secondHandGoldPurchaseSchema.parse(ledger.responses()[0]);
    expect(BigInt(server.finalAmountRial)).not.toBe(calc.finalAmountRial);
    expect(receiptAmount(card, 'مبلغ نهایی')).toBe(server.finalAmountRial);
    expect(receiptAmount(card, 'مانده بستانکاری فروشنده')).toBe(server.payableRial);
    expect(BigInt(server.payableRial)).toBe(BigInt(server.finalAmountRial) - 100_000_000n);
    expect(card.querySelector(`[data-raw="${calc.finalAmountRial.toString()}"]`)).toBeNull();

    // کلید تعویض واحد روی رسید: رو‌ی طلا از عدد سرور و نرخ گرم ثبت‌شده‌ی سرور.
    await user.click(screen.getByRole('radio', { name: 'طلا' }));
    const finalRow = within(card).getByText('مبلغ نهایی', { selector: 'dt' }).parentElement!;
    expect(finalRow.querySelector('[data-raw]')).toHaveAttribute('data-unit', 'gold');
  }, 45_000);

  it('پاسخ گم‌شده و بارگذاری دوباره‌ی صفحه: همان کلید و همان بدنه، یک خرید', async () => {
    const user = userEvent.setup();
    await walkToPayment(user);
    await typeInto(user, 'پرداخت اکنون (ریال)', '100000000', '100000000');

    loseNextResponse = true;
    await user.click(screen.getByRole('button', { name: 'ثبت خرید' }));
    expect(await screen.findByText('ارتباط با سرور برقرار نشد', {}, { timeout: 4000 })).toBeInTheDocument();
    // نتیجه نامعلوم است: فرم قفل می‌ماند تا همان درخواست دوباره بررسی شود، نه خرید تازه.
    expect(screen.getByText(/نتیجه درخواست قبلی هنوز مشخص نیست/)).toBeInTheDocument();
    expect(screen.getByLabelText('پرداخت اکنون (ریال)')).toBeDisabled();
    expect(ledger.size).toBe(1);

    // «تازه‌سازی»: صفحه از نو mount می‌شود؛ تلاش در sessionStorage ِ پیش‌نویس مانده است.
    cleanup();
    await renderPurchasePage();
    await user.click(await screen.findByRole('button', { name: 'بررسی نتیجه خرید' }));
    const card = await receiptCard();

    const [first, second] = api.writes();
    expect(api.writes()).toHaveLength(2);
    expect(second!.headers.get('Idempotency-Key')).toBe(first!.headers.get('Idempotency-Key'));
    expect(await second!.body).toBe(await first!.body);
    expect(ledger.size).toBe(1);
    const server = secondHandGoldPurchaseSchema.parse(ledger.responses()[0]);
    expect(within(card).getByText('شناسه خرید').nextElementSibling).toHaveTextContent(server.secondHandPurchaseId);
  }, 45_000);

  it('رد قطعی سرور: پیام در صفحه، پیش‌نویس قابل اصلاح، و ثبت بعدی عملیات تازه با کلید تازه است', async () => {
    const user = userEvent.setup();
    await walkToPayment(user);

    rejectNext = () => mockError('BAD_REQUEST', 'خرید دست‌دوم فقط از مصرف‌کننده‌ی فعال ممکن است');
    await user.click(screen.getByRole('button', { name: 'ثبت خرید' }));

    expect(await screen.findByText('اطلاعات واردشده را بررسی کنید', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByLabelText('رسید خرید')).not.toBeInTheDocument();
    expect(ledger.size).toBe(0);
    expect(usePurchaseDraftStore.getState().attempt).toBeNull();
    expect(usePurchaseDraftStore.getState().seller?.id).toBe(SELLER.id);
    expect(screen.getByLabelText('پرداخت اکنون (ریال)')).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'ثبت خرید' }));
    await receiptCard();
    const [first, second] = api.writes();
    expect(second!.headers.get('Idempotency-Key')).not.toBe(first!.headers.get('Idempotency-Key'));
    expect(ledger.size).toBe(1);
  }, 45_000);
});
