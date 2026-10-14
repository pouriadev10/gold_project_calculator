import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bubble,
  bullionPrice,
  coinPositionValue,
  formatRial,
  gramRate1000,
  grossMg,
  grossUg,
  intrinsicValue,
  karat,
  rial,
  toPureMg,
  valueOfPure,
  type CentralBankMintedCoinType,
} from '@gold/core-calc';
import { createMixedSettlementSchema, mixedSettlementSchema } from '@gold/contracts';
import { partyBalancesSchema, type SessionResponse } from '@/api/contracts';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { contractGate } from '@/mocks/handlers/contract-gate';
import { mockError } from '@/mocks/handlers/errors';
import { COIN_TYPE_VERSIONS, MAZNEH_RIAL, partyRecords } from '@/mocks/handlers/fixtures';
import { useSessionStore } from '@/stores/session-store';
import { useUnitStore } from '@/stores/unit-store';
import { createIntegrationServer, IdempotencyLedger, renderRoute, UUID } from '@/test/integration';

/**
 * تست Integration تسویه‌ی ترکیبی — FE-096.
 *
 * صفحه‌ی واقعی `/parties/:partyId/settlements/new` روی درخت مسیر، هوک‌ها و کلاینت واقعی؛
 * `msw/node` تنها مرز (`@/test/integration`). «سرور» مانده‌ی شخص را نگه می‌دارد و تسویه را
 * اتمیک روی آن اعمال می‌کند، با همان فرمول‌های `core-calc` و قاعده‌ی Idempotency ِ سرور واقعی.
 *
 * مسیر: مانده‌ی شخص → ردیف ریال → ردیف طلا → ردیف سکه → پیش‌نمایش → ثبت → مانده‌ی جدید.
 */

const api = createIntegrationServer();

const ACCESS_TOKEN = 'fe096-access';
const CASHIER: SessionResponse = {
  accessToken: ACCESS_TOKEN,
  refreshToken: 'fe096-refresh',
  expiresInSeconds: 900,
  user: { id: 'c1000000-0000-4000-8000-000000000002', email: 'cashier@example.com', displayName: 'صندوق‌دار نمونه' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
  role: 'CASHIER',
};

/** مظنه‌ی جاری handlerهای توسعه (`maznehQuoteHistory[0]` در `mocks/handlers/index.ts`). */
const QUOTE_ID = 'c1000000-0000-4000-8000-000000000001';
const PARTY = partyRecords.find((party) => party.displayName === 'حسین مرادی')!;
const BAHAR = COIN_TYPE_VERSIONS.find((coin) => coin.title === 'تمام بهار آزادی')!;
const RATE_1000 = gramRate1000(MAZNEH_RIAL);

/** بدهی شخص پیش از تسویه — `rawBalances.rial` مثبت = طلب فروشگاه. */
const OPENING_DEBT_RIAL = 900_000_000n;

/** ورودی کاربر: ۱۰۰٬۰۰۰٬۰۰۰ ریال + ۱٫۰۰۰ گرم طلای ۷۵۰ + یک تمام بهار به نرخ بازار ۳۰۰٬۰۰۰٬۰۰۰. */
const RIAL_LINE = 100_000_000n;
const GOLD_GROSS_MG = 1_000n;
const GOLD_KARAT = 750;
const COIN_PRICE_RIAL = 300_000_000n;

/** پیش‌نمایش مستقل از کد فرم — همان توابع core-calc با ورودی‌های لفظی. */
const EXPECTED_GOLD = bullionPrice(grossMg(GOLD_GROSS_MG), karat(GOLD_KARAT), rial(RATE_1000));
const EXPECTED_COIN = coinPositionValue(1, rial(COIN_PRICE_RIAL));
const EXPECTED_TOTAL = RIAL_LINE + EXPECTED_GOLD + EXPECTED_COIN;

/* ── «سرور» ───────────────────────────────────────────────────── */

let ledger = new IdempotencyLedger();
/** مانده‌ی ریالی شخص روی «سرور». */
let partyRialBalance = OPENING_DEBT_RIAL;
/** سند هم‌زمان دیگری (مثلاً فروش صندوق دیگر) که هم‌زمان با این تسویه روی همین شخص نشست. */
let concurrentRial = 0n;
let loseNextResponse = false;
let rejectNext: (() => Response) | null = null;

function coinType(fixture: (typeof COIN_TYPE_VERSIONS)[number]): CentralBankMintedCoinType {
  return {
    kind: 'coin',
    id: fixture.coinTypeId,
    label: fixture.title,
    grossWeightUg: grossUg(BigInt(fixture.grossWeightUg)),
    karat: karat(fixture.karat),
    isCentralBankMinted: true,
  };
}

function createSettlement(raw: Record<string, unknown>) {
  if (rejectNext !== null) {
    const reject = rejectNext;
    rejectNext = null;
    return reject();
  }
  const body = createMixedSettlementSchema.parse(raw);
  let total = 0n;
  const lines = body.lines.map((line, index) => {
    const id = `9${String(index).padStart(11, '0')}`;
    switch (line.type) {
      case 'RIAL':
      case 'CREDIT':
        total += BigInt(line.amountRial);
        return { type: line.type, settledRial: line.amountRial };
      case 'GOLD': {
        const pure = toPureMg(grossMg(BigInt(line.grossWeightMg)), karat(line.karat));
        const settled = valueOfPure(pure, RATE_1000);
        total += settled;
        return {
          type: 'GOLD' as const,
          inventoryMovementId: `f9600000-0000-4000-8000-${id}`,
          pureWeightMg: pure.toString(),
          settledRial: settled.toString(),
          goldRatePerGramRial: RATE_1000.toString(),
        };
      }
      case 'COIN': {
        const coin = coinType(COIN_TYPE_VERSIONS.find((c) => c.coinTypeId === line.coinTypeId)!);
        const settled = coinPositionValue(line.count, rial(BigInt(line.marketUnitPriceRial)));
        total += settled;
        return {
          type: 'COIN' as const,
          inventoryMovementId: `f9600000-0000-4000-8000-${id}`,
          coinTypeId: line.coinTypeId,
          count: line.count,
          settledRial: settled.toString(),
          intrinsicValueRial: intrinsicValue(coin, RATE_1000).toString(),
          bubbleRial: bubble(coin, rial(BigInt(line.marketUnitPriceRial)), RATE_1000).toString(),
        };
      }
    }
  });
  if (body.lines.some((line) => 'quoteId' in line && line.quoteId !== QUOTE_ID)) {
    return mockError('NOT_FOUND', 'مظنه‌ی انتخاب‌شده پیدا نشد');
  }
  // یک تراکنش: کل سبد با هم روی مانده می‌نشیند (به‌همراه هر سند هم‌زمان دیگر).
  partyRialBalance = partyRialBalance - total + concurrentRial;
  const sequence = String(ledger.size + 1).padStart(12, '0');
  return {
    status: 201,
    body: {
      settlementId: `d9600000-0000-4000-8000-${sequence}`,
      ledgerTransactionId: `e9600000-0000-4000-8000-${sequence}`,
      totalSettledRial: total.toString(),
      lines,
    },
  };
}

const settlementServer = [
  contractGate,
  http.post('/api/parties/:partyId/settlements/mixed', ({ request, params }) => {
    if (params['partyId'] !== PARTY.id) return mockError('NOT_FOUND', 'شخص پیدا نشد');
    const loseResponse = loseNextResponse;
    loseNextResponse = false;
    return ledger.handle(request, createSettlement, { loseResponse });
  }),
  http.get('/api/parties/:id/balances', ({ params }) =>
    HttpResponse.json(
      partyBalancesSchema.parse({
        partyId: params['id'],
        calculatedAt: new Date().toISOString(),
        defaultDisplayUnit: 'GOLD',
        rawBalances: { rial: partyRialBalance.toString(), pureGoldMg: '0', coins: [] },
        convertedView: null,
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
  partyRialBalance = OPENING_DEBT_RIAL;
  concurrentRial = 0n;
  loseNextResponse = false;
  rejectNext = null;
  api.server.use(...settlementServer);
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

/** عدد خام کارت «مانده فعلی» بالای صفحه — از `GET /parties/:id/balances`. */
function currentBalanceRaw(): string | null {
  const card = screen.getByText('مانده فعلی').parentElement!.parentElement!;
  return card.querySelector('[data-raw]')?.getAttribute('data-raw') ?? null;
}

function row(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

async function typeInto(user: User, field: HTMLElement, keys: string, value: string) {
  await user.click(field);
  await user.keyboard(keys);
  await waitFor(() => expect(field).toHaveAttribute('data-value', value));
}

/** مبلغ‌های ردیف خلاصه (مقدار خام و واحد) — از FE-103 این بخش هم از `AmountDisplay` عبور می‌کند. */
function summaryAmounts(label: string): Array<{ raw: string | null; unit: string | null }> {
  return [...screen.getByText(label).parentElement!.querySelectorAll('[data-raw]')].map((el) => ({
    raw: el.getAttribute('data-raw'),
    unit: el.getAttribute('data-unit'),
  }));
}

/**
 * از صفحه‌ی خالی تا سبد سه‌ردیفی آماده‌ی ثبت؛ در هر قدم همان چیزی را می‌سنجد که از سرور یا
 * موتور محاسبه آمده.
 */
async function buildBasket(user: User) {
  renderRoute(`/parties/${PARTY.id}/settlements/new`);
  await screen.findByRole('heading', { level: 1, name: `ثبت تسویه — ${PARTY.displayName}` }, { timeout: 4000 });

  // ۱. مانده‌ی شخص — از سرور
  await waitFor(() => expect(currentBalanceRaw()).toBe(OPENING_DEBT_RIAL.toString()), { timeout: 4000 });

  await user.click(screen.getByRole('radio', { name: /ترکیبی/ }));
  await screen.findByText('هنوز ردیفی اضافه نشده.');

  // ۲. ریال
  await user.click(screen.getByRole('button', { name: '+ ریال' }));
  await typeInto(user, within(row('ردیف ۱: ریال')).getByLabelText('مبلغ'), '100000000', RIAL_LINE.toString());

  // ۳. طلا — مظنه همین‌جا برای کل سبد قفل می‌شود
  await user.click(screen.getByRole('button', { name: '+ طلا' }));
  const gold = row('ردیف ۲: طلا');
  await typeInto(user, within(gold).getByLabelText('وزن'), '1.000', GOLD_GROSS_MG.toString());
  await typeInto(user, within(gold).getByLabelText('عیار'), '750', String(GOLD_KARAT));

  // ۴. سکه — نوع از `GET /inventory/coin-types`
  await user.click(screen.getByRole('button', { name: '+ سکه' }));
  const coin = row('ردیف ۳: سکه');
  await screen.findAllByRole('option', { name: BAHAR.title }, { timeout: 4000 });
  await user.selectOptions(within(coin).getByLabelText('نوع سکه'), BAHAR.coinTypeId);
  await typeInto(user, within(coin).getByLabelText('تعداد'), '1', '1');
  await typeInto(user, within(coin).getByLabelText('نرخ بازار'), '300000000', COIN_PRICE_RIAL.toString());

  // ۵. پیش‌نمایش — معادل هر ردیف، نرخ ردیف‌های طلا/سکه، پوشش و باقی‌مانده
  const equivalent = (group: HTMLElement) =>
    within(group).getByText('معادل نمایشی').parentElement!.querySelector('[data-raw]')!.getAttribute('data-raw');
  expect(equivalent(row('ردیف ۱: ریال'))).toBe(RIAL_LINE.toString());
  expect(equivalent(gold)).toBe(EXPECTED_GOLD.toString());
  expect(equivalent(coin)).toBe(EXPECTED_COIN.toString());
  for (const group of [gold, coin]) {
    expect(within(group).getByText('نرخ ردیف').parentElement).toHaveTextContent(`${formatRial(RATE_1000)} ریال/گرم`);
  }
  // FE-103: خلاصه از `AmountDisplay` عبور می‌کند (کلید واحد روی ریال است) — مقدار خام سنجیده می‌شود
  expect(summaryAmounts('خلاصه پوشش بدهی')).toEqual([
    { raw: EXPECTED_TOTAL.toString(), unit: 'rial' },
    { raw: OPENING_DEBT_RIAL.toString(), unit: 'rial' },
  ]);
  expect(summaryAmounts('باقی‌مانده')).toEqual([{ raw: (OPENING_DEBT_RIAL - EXPECTED_TOTAL).toString(), unit: 'rial' }]);
}

function submitButton(): HTMLElement {
  return screen.getByRole('button', { name: 'ثبت تسویه‌ی ترکیبی' });
}

/** کارت نتیجه — همان کارتی که «مجموع تسویه‌شده» در آن است (عنوانش با toast هم‌متن است). */
async function resultCard(): Promise<HTMLElement> {
  const total = await screen.findByText('مجموع تسویه‌شده', {}, { timeout: 4000 });
  return total.closest('div.space-y-3')!.parentElement!;
}

/* ── سناریوها ─────────────────────────────────────────────────── */

describe('FE-096 — تسویه‌ی ترکیبی ریال + طلا + سکه، روی کلاینت و store واقعی', () => {
  it('یک درخواست اتمیک با payload دقیق؛ نتیجه و مانده‌ی جدید از سرور', async () => {
    const user = userEvent.setup();
    await buildBasket(user);

    // سند دیگری هم‌زمان روی همین شخص می‌نشیند: مانده‌ی جدید عدد سرور است، نه «باقی‌مانده» ِ فرم.
    concurrentRial = 7_000_000n;
    const before = Date.now();
    await user.click(submitButton());
    const card = await resultCard();
    const after = Date.now();

    // ── درخواست: یک نوشتن، کل سبد در یک بدنه
    expect(api.writes().map((request) => `${request.method} ${request.path}`)).toEqual([
      `POST /api/parties/${PARTY.id}/settlements/mixed`,
    ]);
    const [write] = api.writes();
    const body = JSON.parse(await write!.body) as { lines: Record<string, unknown>[]; effectiveAt: string };
    expect(body).toEqual({
      lines: [
        { type: 'RIAL', amountRial: '100000000' },
        { type: 'GOLD', grossWeightMg: '1000', karat: GOLD_KARAT, quoteId: QUOTE_ID },
        { type: 'COIN', coinTypeId: BAHAR.coinTypeId, count: 1, marketUnitPriceRial: '300000000', quoteId: QUOTE_ID },
      ],
      effectiveAt: expect.any(String),
    });
    expect(createMixedSettlementSchema.safeParse(body).success).toBe(true);
    // پول و وزن رشته‌اند؛ فقط عیار و تعداد سکه عدد صحیح (قاعده‌ی ۲-۱ و ۲-۲: سکه شمرده می‌شود، وزن نمی‌شود).
    for (const line of body.lines) {
      for (const [key, value] of Object.entries(line)) {
        expect(typeof value, key).toBe(key === 'karat' || key === 'count' ? 'number' : 'string');
      }
    }
    expect(Date.parse(body.effectiveAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(body.effectiveAt)).toBeLessThanOrEqual(after);
    expect(write!.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(write!.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);

    // ── نتیجه = پاسخ سرور
    const server = mixedSettlementSchema.parse(ledger.responses()[0]);
    expect(BigInt(server.totalSettledRial)).toBe(EXPECTED_TOTAL);
    expect(within(card).getByText('مجموع تسویه‌شده').parentElement!.querySelector('[data-raw]')).toHaveAttribute(
      'data-raw',
      server.totalSettledRial,
    );
    const lineLabel = { RIAL: 'ریال', GOLD: 'طلا', COIN: 'سکه', CREDIT: 'مانده اعتباری' } as const;
    // FE-103: ریز نتیجه هم از `AmountDisplay` عبور می‌کند — برچسب و مقدار خام هر ردیف از پاسخ سرور
    expect(
      within(card)
        .getAllByRole('listitem')
        .map((item) => [item.firstElementChild?.textContent, item.querySelector('[data-raw]')?.getAttribute('data-raw')]),
    ).toEqual(server.lines.map((line) => [lineLabel[line.type], line.settledRial]));

    // ── مانده‌ی جدید: پس از invalidation دوباره از سرور خوانده می‌شود
    const serverBalance = OPENING_DEBT_RIAL - EXPECTED_TOTAL + 7_000_000n;
    await waitFor(() => expect(currentBalanceRaw()).toBe(serverBalance.toString()), { timeout: 4000 });
    expect(currentBalanceRaw()).not.toBe((OPENING_DEBT_RIAL - EXPECTED_TOTAL).toString());
    expect(
      api.requests().filter((request) => request.method === 'GET' && request.path === `/api/parties/${PARTY.id}/balances`).length,
    ).toBeGreaterThanOrEqual(2);
    expect(ledger.size).toBe(1);
  }, 45_000);

  it('پاسخ گم‌شده: تلاش دوباره همان کلید و همان بدنه را می‌فرستد و مانده یک بار کم می‌شود', async () => {
    const user = userEvent.setup();
    await buildBasket(user);

    loseNextResponse = true;
    await user.click(submitButton());
    expect(await screen.findByText('ارتباط با سرور برقرار نشد', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(ledger.size).toBe(1);
    expect(partyRialBalance).toBe(OPENING_DEBT_RIAL - EXPECTED_TOTAL);

    // FE-100: پاسخ نامشخص ردیف‌ها را قفل می‌کند (رفع #37) — تنها اقدام تکرار همان درخواست است
    expect(within(row('ردیف ۱: ریال')).getByLabelText('مبلغ')).toBeDisabled();
    expect(screen.getByRole('button', { name: '+ ریال' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'بررسی نتیجه‌ی ثبت' }));
    await resultCard();

    const [first, second] = api.writes();
    expect(api.writes()).toHaveLength(2);
    expect(second!.headers.get('Idempotency-Key')).toBe(first!.headers.get('Idempotency-Key'));
    // بدنه‌ی بایت‌به‌بایت یکسان — با `effectiveAt` تازه، سرور ۴۰۹ می‌داد.
    expect(await second!.body).toBe(await first!.body);
    expect(ledger.size).toBe(1);
    await waitFor(() => expect(currentBalanceRaw()).toBe((OPENING_DEBT_RIAL - EXPECTED_TOTAL).toString()), {
      timeout: 4000,
    });
  }, 45_000);

  it('رد سرور: هیچ ردیفی ثبت نمی‌شود، سبد دست‌نخورده می‌ماند و مانده عوض نمی‌شود', async () => {
    const user = userEvent.setup();
    await buildBasket(user);

    rejectNext = () => mockError('BAD_REQUEST', 'مانده‌ی اعتباری شخص برای این ردیف کافی نیست');
    await user.click(submitButton());

    expect(await screen.findByText('اطلاعات واردشده را بررسی کنید', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText('مجموع تسویه‌شده')).not.toBeInTheDocument();
    expect(ledger.size).toBe(0);
    expect(partyRialBalance).toBe(OPENING_DEBT_RIAL);
    expect(currentBalanceRaw()).toBe(OPENING_DEBT_RIAL.toString());
    // سه ردیف با همان مقدارها سر جایشان — کاربر می‌تواند اصلاح کند و دوباره بزند.
    expect(within(row('ردیف ۱: ریال')).getByLabelText('مبلغ')).toHaveAttribute('data-value', RIAL_LINE.toString());
    expect(within(row('ردیف ۲: طلا')).getByLabelText('وزن')).toHaveAttribute('data-value', GOLD_GROSS_MG.toString());
    expect(within(row('ردیف ۳: سکه')).getByLabelText('تعداد')).toHaveAttribute('data-value', '1');
    expect(submitButton()).not.toBeDisabled();
  }, 45_000);
});
