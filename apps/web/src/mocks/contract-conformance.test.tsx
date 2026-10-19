import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { apiErrorSchema, partyBalanceReportQuerySchema, partyListQuerySchema, partyStatementQuerySchema, jewelryItemQuerySchema } from '@gold/contracts';
import { matchRequestUrl, type HttpHandler } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '@/api/api-error';
import { login, logout, refresh } from '@/api/auth';
import { createCoinType, createCoinTypeVersion } from '@/api/coin-types';
import { salesInvoiceListQuerySchema, type SessionResponse } from '@/api/contracts';
import { presentApiError } from '@/api/error-presentation';
import { createJewelryItem, updateJewelryItem } from '@/api/jewelry-items';
import { createOpeningBalance } from '@/api/opening-balances';
import { createParty, deactivateParty, getPartyStatementPdf, updateParty } from '@/api/parties';
import { createManualPriceQuote, refreshPriceFeed } from '@/api/pricing';
import {
  createB2cBuyback,
  createSecondHandCoinPurchase,
  createSecondHandGoldPurchase,
  getSecondHandPurchasePdf,
  previewB2cBuyback,
} from '@/api/purchase';
import * as queries from '@/api/queries';
import { amendSalesInvoice, createCoinSale, createJewelryCashSale, createJewelryCreditSale, getSalesInvoicePdf } from '@/api/sales';
import { updateGeneralSetting } from '@/api/settings';
import { createCoinSettlement, createGoldSettlement, createMixedSettlement, createRialSettlement } from '@/api/settlements';
import { useSessionStore } from '@/stores/session-store';
import { handlers } from './handlers';
import { contractGate, resetMockScenario, SCENARIO_MESSAGES, setMockScenario, WRITE_ROUTES } from './handlers/contract-gate';
import { MISSING_IDEMPOTENCY_KEY_MESSAGE, MOCK_ERROR_STATUS, mockError } from './handlers/errors';
import { COIN_TYPE_VERSIONS, jewelryItemVersionRecords, partyRecords, salesInvoiceDetailRecords } from './handlers/fixtures';

/**
 * قرارداد mock — FE-093.
 *
 * هر handler با **کلاینت واقعی** (`src/api/*` و هوک‌های `queries.ts`) صدا زده می‌شود، پس هر
 * پاسخ موفق از همان schema ِ `packages/contracts` می‌گذرد که production می‌گذرد؛ تغییر قرارداد
 * بی‌آنکه mock همراهش عوض شود `SCHEMA_MISMATCH` می‌دهد و این فایل قرمز می‌شود. هر پاسخ خطا هم
 * با `apiErrorSchema` بررسی می‌شود، و فهرست مسیرها و کدهای خطا با متن خود سرور مقایسه می‌شود
 * تا mock مسیر یا کدی نسازد که سرور ندارد.
 */

const server = setupServer(...handlers);
const originalFetch = globalThis.fetch;

/** هر پاسخ mock — برای پوشش handlerها و اعتبارسنجی بدنه‌ی خطاها. */
const mocked: Array<{ method: string; url: string; status: number; body: Promise<string> }> = [];

const OWNER_SESSION: SessionResponse = {
  accessToken: 'contract-access',
  refreshToken: 'contract-refresh',
  expiresInSeconds: 900,
  user: { id: 'c1000000-0000-4000-8000-000000000002', email: 'owner@example.com', displayName: 'مالک نمونه' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
  role: 'OWNER',
};

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('response:mocked', ({ request, response }) => {
    mocked.push({ method: request.method, url: request.url, status: response.status, body: response.clone().text() });
  });
  // fetch ِ Node آدرس نسبی را نمی‌پذیرد و `AbortSignal` ِ jsdom را نمی‌شناسد (همان الگوی a11y.test).
  const mswFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const { signal: _signal, ...rest } = init ?? {};
    return mswFetch(typeof input === 'string' && input.startsWith('/') ? new URL(input, window.location.origin) : input, rest);
  }) as typeof fetch;
  useSessionStore.setState({ session: OWNER_SESSION });
});

afterEach(() => {
  resetMockScenario();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  server.close();
  useSessionStore.setState({ session: null });
});

const ROUTE_HANDLERS = handlers.filter((handler): handler is HttpHandler => handler !== contractGate) as HttpHandler[];

/** همان قاعده‌ی MSW: اولین handler (پس از دروازه) که متد و مسیرش بخواند پاسخ‌دهنده است. */
function ownerOf(method: string, url: string): HttpHandler | undefined {
  return ROUTE_HANDLERS.find(
    (handler) => handler.info.method === method && matchRequestUrl(new URL(url), String(handler.info.path)).matches,
  );
}

function routeKey(handler: HttpHandler): string {
  return `${String(handler.info.method)} ${String(handler.info.path)}`;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const consumer = partyRecords.find((party) => party.type === 'CONSUMER' && party.status === 'ACTIVE')!;
const activeJewelry = jewelryItemVersionRecords.filter((item) => item.active);
const coinType = COIN_TYPE_VERSIONS[0]!;
const finalizedInvoice = salesInvoiceDetailRecords.find((detail) => detail.status === 'FINALIZED')!;
const NOW = () => new Date().toISOString();

describe('پاسخ‌های موفق از schema ِ واقعی کلاینت می‌گذرند و همه‌ی handlerها پوشش دارند', () => {
  it('هر handler مسیر دست‌کم یک بار با کلاینت واقعی و ورودی معتبر قرارداد صدا زده می‌شود', { timeout: 60_000 }, async () => {
    // ── احراز هویت (`/auth` عمومی است و کلید نمی‌خواهد) ──
    const session = await login({ email: 'owner@example.com', password: 'password123', tenantSlug: 'demo' }, crypto.randomUUID());
    const rotated = await refresh(session.refreshToken);
    await logout(rotated.refreshToken);

    // ── همه‌ی هوک‌های خواندن ──
    const latest = renderHook(() => queries.useLatestPriceQuote(), { wrapper });
    await waitFor(() => expect(latest.result.current.data).toBeTruthy());
    const quote = latest.result.current.data!;
    const at = NOW();

    const reads = renderHook(
      () => ({
        history: queries.usePriceQuoteHistory(),
        feed: queries.usePriceFeedStatus(),
        ledgerProfit: queries.useLedgerProfitReport({}),
        trend: queries.useLedgerProfitTrend([{}]),
        settings: queries.useGeneralSettings(),
        recent: queries.useRecentTransactions(),
        partySearch: queries.usePartySearch('علی'),
        parties: queries.useParties(partyListQuerySchema.parse({})),
        party: queries.useParty(consumer.id),
        balances: queries.usePartyBalances(consumer.id, { at, referenceQuoteId: quote.id }),
        statement: queries.usePartyStatement(consumer.id, partyStatementQuerySchema.parse({ referenceQuoteId: quote.id })),
        debtors: queries.usePartyBalanceReport('DEBTOR', partyBalanceReportQuerySchema.parse({ referenceQuoteId: quote.id })),
        creditors: queries.usePartyBalanceReport('CREDITOR', partyBalanceReportQuerySchema.parse({ referenceQuoteId: quote.id })),
        coinTypes: queries.useCoinTypes(),
        catalog: queries.useCoinTypeCatalog(),
        coinBalances: queries.useInventoryBalances('COIN'),
        jewelryItems: queries.useJewelryItems(jewelryItemQuerySchema.parse({})),
        jewelryItem: queries.useJewelryItem(activeJewelry[0]!.jewelryItemId),
        jewelryItemAt: queries.useJewelryItemAt(activeJewelry[0]!.jewelryItemId, at),
        dashboard: queries.useDashboard(),
        versions: queries.useInvoiceVersions(finalizedInvoice.id),
        amendments: queries.useInvoiceAmendments(finalizedInvoice.id),
        detail: queries.useSalesInvoiceDetail(finalizedInvoice.id),
        policy: queries.useInvoiceAmendmentPolicy(finalizedInvoice.id),
        invoices: queries.useSalesInvoices(salesInvoiceListQuerySchema.parse({})),
        movements: queries.useRecentInventoryMovements(),
      }),
      { wrapper },
    );
    await waitFor(
      () => {
        for (const [name, result] of Object.entries(reads.result.current)) {
          if (result.isError) throw new Error(`${name}: ${String('error' in result ? result.error : '')}`);
          expect(result.data, name).toBeDefined();
        }
      },
      { timeout: 15_000 },
    );

    // ── مظنه ──
    const manual = await createManualPriceQuote(quote.amountRial + 1_000_000n, crypto.randomUUID());
    await refreshPriceFeed(crypto.randomUUID());

    // ── اشخاص ──
    const created = await createParty({ type: 'CONSUMER', displayName: 'مشتری قرارداد' }, crypto.randomUUID());
    await updateParty(created.id, { notes: 'به‌روزرسانی قرارداد' }, crypto.randomUUID());

    // ── تسویه‌ها ──
    await createRialSettlement(consumer.id, { amountRial: '1000000', effectiveAt: NOW() }, crypto.randomUUID());
    await createGoldSettlement(consumer.id, { grossWeightMg: '1000', karat: 750, quoteId: manual.id, effectiveAt: NOW() }, crypto.randomUUID());
    await createCoinSettlement(
      consumer.id,
      { coinTypeId: coinType.coinTypeId, count: 1, marketUnitPriceRial: '900000000', quoteId: manual.id, effectiveAt: NOW() },
      crypto.randomUUID(),
    );
    await createMixedSettlement(
      consumer.id,
      {
        lines: [
          { type: 'RIAL', amountRial: '500000' },
          { type: 'GOLD', grossWeightMg: '500', karat: 750, quoteId: manual.id },
          { type: 'COIN', coinTypeId: coinType.coinTypeId, count: 1, marketUnitPriceRial: '900000000', quoteId: manual.id },
        ],
        effectiveAt: NOW(),
      },
      crypto.randomUUID(),
    );

    // ── موجودی و تنظیمات ──
    const jewelry = await createJewelryItem(
      { code: 'CT-750-01', title: 'انگشتر قرارداد', grossWeightMg: '3500', karat: 750, stoneWeightMg: '0', otherDeductionWeightMg: '0', wageType: 'PER_GRAM', wageValue: '1500000' },
      crypto.randomUUID(),
    );
    await updateJewelryItem(jewelry.jewelryItemId, { title: 'انگشتر قرارداد ۲' }, crypto.randomUUID());
    const coin = await createCoinType(
      { code: 'CT-COIN', title: 'سکه‌ی قرارداد', mintType: 'PRIVATE_MINT', grossWeightUg: '1000000', karat: 900, active: true },
      crypto.randomUUID(),
    );
    await createCoinTypeVersion(
      coin.coinTypeId,
      { title: 'سکه‌ی قرارداد', mintType: 'PRIVATE_MINT', grossWeightUg: '1000000', karat: 900, active: false },
      crypto.randomUUID(),
    );
    await createOpeningBalance(
      { effectiveAt: NOW(), description: 'موجودی اول دوره‌ی قرارداد', lines: [{ itemType: 'MELTED_GOLD', quantity: '1000' }] },
      crypto.randomUUID(),
    );
    await updateGeneralSetting({ key: 'purchase.second_hand_default_karat', value: '740' }, crypto.randomUUID());

    // ── فروش، اصلاح و خرید مجدد ──
    const cash = await createJewelryCashSale(
      { partyId: consumer.id, jewelryItemId: activeJewelry[0]!.jewelryItemId, quoteId: manual.id, effectiveAt: NOW() },
      crypto.randomUUID(),
    );
    await createJewelryCreditSale(
      { partyId: consumer.id, jewelryItemId: activeJewelry[1]!.jewelryItemId, quoteId: manual.id, effectiveAt: NOW(), paidRial: '0' },
      crypto.randomUUID(),
    );
    await createCoinSale(
      { partyId: consumer.id, coinTypeId: coinType.coinTypeId, count: 1, marketUnitPriceRial: '900000000', quoteId: manual.id, effectiveAt: NOW(), paidRial: '900000000' },
      crypto.randomUUID(),
    );
    const amended = await amendSalesInvoice(
      cash.invoiceId,
      { reason: 'PAYMENT_ERROR', partyId: consumer.id, item: { itemType: 'JEWELRY', jewelryItemId: activeJewelry[0]!.jewelryItemId, paidRial: '0' } },
      crypto.randomUUID(),
    );
    expect(amended).toMatchObject({ invoiceId: cash.invoiceId, version: 2, receivableRial: amended.payableRial });

    const buybackInput = { grossWeightMg: '3000', stoneWeightMg: '0', otherDeductionWeightMg: '0', quoteId: manual.id, effectiveAt: NOW() };
    const preview = await previewB2cBuyback(cash.invoiceId, buybackInput);
    const buyback = await createB2cBuyback(cash.invoiceId, { ...buybackInput, paidRial: '0' }, crypto.randomUUID());
    // همان محاسبه‌ی سرور در هر دو؛ preview هیچ سندی نمی‌سازد.
    expect(buyback.breakdown).toEqual(preview.breakdown);

    // ── خرید از مصرف‌کننده ──
    const gold = await createSecondHandGoldPurchase(
      { partyId: consumer.id, grossWeightMg: '2000', stoneWeightMg: '0', otherDeductionWeightMg: '0', quoteId: manual.id, feeRial: '0', paidRial: '0', effectiveAt: NOW() },
      crypto.randomUUID(),
    );
    await createSecondHandCoinPurchase(
      { partyId: consumer.id, coinTypeId: coinType.coinTypeId, count: 2, purchaseUnitPriceRial: '850000000', quoteId: manual.id, paidRial: '0', effectiveAt: NOW() },
      crypto.randomUUID(),
    );

    // ── فایل‌ها و غیرفعال‌سازی ──
    await getSalesInvoicePdf(cash.invoiceId);
    await getSecondHandPurchasePdf(gold.secondHandPurchaseId);
    await getPartyStatementPdf(consumer.id);
    await deactivateParty(created.id, crypto.randomUUID());

    // ── هیچ handler مسیری بدون مصرف‌کننده نماند ──
    const exercised = new Set(
      mocked.flatMap(({ method, url }) => {
        const owner = ownerOf(method, url);
        return owner === undefined ? [] : [routeKey(owner)];
      }),
    );
    const unused = ROUTE_HANDLERS.map(routeKey).filter((key) => !exercised.has(key));
    expect(unused).toEqual([]);
    expect(mocked.filter(({ status }) => status >= 400)).toEqual([]);
  });

  it('هر handler نوشتنی schema ِ بدنه‌اش را در دروازه‌ی قرارداد ثبت کرده است', () => {
    const writeHandlers = ROUTE_HANDLERS.filter((handler) => handler.info.method !== 'GET').map(routeKey).sort();
    expect(WRITE_ROUTES.map((route) => `${route.method} ${route.path}`).sort()).toEqual(writeHandlers);
  });
});

/* ── سناریوها ─────────────────────────────────────────────────── */

describe('سناریوهای خطا — همان شکل و کدی که سرور می‌فرستد', () => {
  const newParty = () => createParty({ type: 'CONSUMER', displayName: 'سناریو' }, crypto.randomUUID());

  it('validation: ۴۰۰ VALIDATION_ERROR با fields ِ حاصل از اجرای schema ِ همان مسیر', async () => {
    setMockScenario('validation');
    const error = await newParty().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'ورودی نامعتبر است' });
    // `createPartySchema.safeParse({})` → نام و نوع الزامی؛ نه پیام دست‌ساز.
    expect(Object.keys((error as ApiError).fields).sort()).toEqual(['displayName', 'type']);
    expect(presentApiError(error).kind).toBe('validation');
    expect(typeof (error as ApiError).requestId).toBe('string');
  });

  it('conflict: ۴۰۹ CONFLICT ِ تعارض Idempotency-Key', async () => {
    setMockScenario('conflict');
    const error = await newParty().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 409, code: 'CONFLICT', message: SCENARIO_MESSAGES.conflict });
    expect(presentApiError(error).kind).toBe('conflict');
  });

  it('forbidden: ۴۰۳ FORBIDDEN ِ RolesGuard، هم روی خواندن هم نوشتن', async () => {
    setMockScenario('forbidden');
    const write = await newParty().catch((caught: unknown) => caught);
    expect(write).toMatchObject({ status: 403, code: 'FORBIDDEN', message: SCENARIO_MESSAGES.forbidden });
    expect(presentApiError(write).kind).toBe('forbidden');

    const read = renderHook(() => queries.useParties(partyListQuerySchema.parse({})), { wrapper });
    await waitFor(() => expect(read.result.current.isError).toBe(true));
    expect(read.result.current.error).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('forbidden مسیرهای عمومی `/auth` را نمی‌بندد — سرور هم آن‌جا نقش را نمی‌سنجد', async () => {
    setMockScenario('forbidden');
    await expect(
      login({ email: 'owner@example.com', password: 'password123', tenantSlug: 'demo' }, crypto.randomUUID()),
    ).resolves.toMatchObject({ role: 'OWNER' });
  });

  it('network: خطای fetch ← NetworkError، نه ApiError', async () => {
    setMockScenario('network');
    const error = await newParty().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    expect(presentApiError(error).kind).toBe('network');
  });

  it('validation و conflict خواندن را دست نمی‌زنند — سرور برای GET هیچ‌کدام را نمی‌سازد', async () => {
    for (const scenario of ['validation', 'conflict'] as const) {
      setMockScenario(scenario);
      const read = renderHook(() => queries.useParties(partyListQuerySchema.parse({})), { wrapper });
      await waitFor(() => expect(read.result.current.isSuccess).toBe(true));
    }
  });

  it('سناریو را می‌شود به یک مسیر محدود کرد', async () => {
    setMockScenario('conflict', { path: '/api/parties/:partyId/settlements/*' });
    await expect(newParty()).resolves.toMatchObject({ displayName: 'سناریو' });
    await expect(
      createRialSettlement(consumer.id, { amountRial: '1000', effectiveAt: NOW() }, crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('success دوباره رفتار عادی است', async () => {
    setMockScenario('network');
    resetMockScenario();
    await expect(newParty()).resolves.toMatchObject({ type: 'CONSUMER' });
  });
});

describe('دروازه‌ی قرارداد — middleware و pipe ِ سرور', () => {
  it('نوشتن بی‌کلید: ۴۰۰ BAD_REQUEST با پیام middleware', async () => {
    const response = await globalThis.fetch('/api/parties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'CONSUMER', displayName: 'بی‌کلید' }),
    });
    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error).toMatchObject({
      code: 'BAD_REQUEST',
      message: MISSING_IDEMPOTENCY_KEY_MESSAGE,
    });
  });

  it('بدنه‌ی خلاف قرارداد: ۴۰۰ VALIDATION_ERROR — handler مسیر هرگز ورودی نامعتبر نمی‌بیند', async () => {
    const response = await globalThis.fetch('/api/purchase/second-hand/gold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      // وزن عددی JSON به‌جای رشته — قاعده‌ی ۲-۱
      body: JSON.stringify({ partyId: consumer.id, grossWeightMg: 2000, quoteId: crypto.randomUUID(), effectiveAt: NOW() }),
    });
    expect(response.status).toBe(400);
    const body = apiErrorSchema.parse(await response.json());
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(body.error.fields)).toContain('grossWeightMg');
  });

  it('مسیر عمومی `/auth` کلید نمی‌خواهد، مثل `PUBLIC_PATH_PREFIXES` ِ سرور', async () => {
    const response = await globalThis.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'password123', tenantSlug: 'demo' }),
    });
    expect(response.status).toBe(200);
  });

  it('هر پاسخ خطایی که mock تا اینجا داده با apiErrorSchema می‌خواند', async () => {
    const errors = mocked.filter(({ status }) => status >= 400);
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) {
      const body = JSON.parse(await error.body) as unknown;
      expect(apiErrorSchema.safeParse(body).success, `${error.method} ${error.url}`).toBe(true);
    }
  });
});

/* ── آینه‌ی خود سرور، نه فرض ما از آن ───────────────────────── */

/** vitest از ریشه‌ی `apps/web` اجرا می‌شود (`pnpm test` و `pnpm -r test`). */
const API_SRC = resolve(process.cwd(), '../api/src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** مسیرهای واقعی کنترلرهای NestJS — از دکوراتورها، همان‌طور که Nest می‌خواند. */
function serverRoutes(): string[] {
  return walk(API_SRC)
    .filter((path) => path.endsWith('.controller.ts') && !path.includes('dev-'))
    .flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      const prefix = /@Controller\(\s*['`]?([^'`)]*)['`]?\s*\)/u.exec(source)?.[1] ?? '';
      return [...source.matchAll(/@(Get|Post|Patch|Put|Delete)\(\s*(?:['`]([^'`]*)['`])?\s*\)/gu)].map(
        ([, method, sub]) => `${method!.toUpperCase()} /api/${[prefix, sub ?? ''].filter(Boolean).join('/')}`,
      );
    });
}

/**
 * مسیرهایی که mock دارد ولی سرور هنوز ندارد. از FE-106b خالی است: چهار مسیر خواندنی ِ آخر
 * (فهرست/جزئیات فاکتور، معاملات اخیر، حرکات اخیر موجودی) در سرور پیاده شدند. افزودن به این
 * فهرست یعنی تصمیم صریح، نه mock بی‌صدا.
 */
const PENDING_BACKEND_ROUTES: readonly string[] = [];

/** مسیرهای سرور که فرانت فاز ۱ هیچ‌جا صدا نمی‌زند، پس mock هم لازم ندارند. */
const UNUSED_SERVER_ROUTES = [
  'GET /api/health',
  'GET /api/auth/me',
  'POST /api/inventory/jewelry-items/:id/deactivate',
  // BE-069: خروجی کامل مستأجر — هنوز هیچ صفحه‌ای در فرانت ندارد.
  'POST /api/platform/exports/full',
  'GET /api/platform/exports/:id',
  // BE-070: Swagger UI و مستند OpenAPI — برای توسعه‌دهنده، نه برنامه‌ی فرانت.
  'GET /api/docs',
  'GET /api/docs/openapi.json',
  'GET /api/docs/assets/:file',
];

describe('mock مسیر یا کدی نمی‌سازد که سرور ندارد', () => {
  it('هر مسیر سرور mock دارد و هر مسیر mock یا در سرور هست یا صریحاً «در انتظار بک‌اند» است', () => {
    const server = new Set(serverRoutes());
    const mock = new Set(ROUTE_HANDLERS.map(routeKey));
    expect([...server].filter((route) => !mock.has(route) && !UNUSED_SERVER_ROUTES.includes(route))).toEqual([]);
    expect([...mock].filter((route) => !server.has(route)).sort()).toEqual([...PENDING_BACKEND_ROUTES].sort());
  });

  it('کدهای خطای mock زیرمجموعه‌ی کدهای `api-exception.filter.ts` سرورند', () => {
    const filter = readFileSync(join(API_SRC, 'platform/error-contract/api-exception.filter.ts'), 'utf8');
    const serverCodes = new Set([...filter.matchAll(/'([A-Z][A-Z0-9_]+)'/gu)].map(([, code]) => code));
    expect(Object.keys(MOCK_ERROR_STATUS).filter((code) => !serverCodes.has(code))).toEqual([]);
  });

  it('mockError بدنه‌ی خلاف قرارداد نمی‌سازد', () => {
    expect(() => mockError('NOT_FOUND', '')).toThrow();
    expect(() => mockError('not_a_code' as never, 'پیام')).toThrow();
  });
});
