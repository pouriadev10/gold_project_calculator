import {
  amendSalesInvoiceSchema,
  createB2cBuybackSchema,
  createCoinSaleSchema,
  createCoinSettlementSchema,
  createCoinTypeSchema,
  createCoinTypeVersionSchema,
  createGoldSettlementSchema,
  createJewelryCashSaleSchema,
  createJewelryCreditSaleSchema,
  createJewelryItemSchema,
  createManualPriceQuoteSchema,
  createMixedSettlementSchema,
  createOpeningBalanceSchema,
  createPartySchema,
  createRialSettlementSchema,
  createSecondHandCoinPurchaseSchema,
  createSecondHandGoldPurchaseSchema,
  loginSchema,
  previewB2cBuybackSchema,
  refreshPriceFeedSchema,
  refreshSchema,
  updateGeneralSettingSchema,
  updateJewelryItemSchema,
  updatePartySchema,
} from '@gold/contracts';
import { HttpResponse, http, matchRequestUrl } from 'msw';
import { z } from 'zod';
import { mockError, mockMissingIdempotencyKey, mockValidationError } from './errors';

/**
 * دروازه‌ی قرارداد — FE-093. اولین handler ِ MSW؛ هر درخواست `/api/*` پیش از رسیدن
 * به پاسخ‌دهنده‌ی مسیر از همان لایه‌هایی عبور می‌کند که سرور واقعی دارد:
 *
 * 1. سناریوی فعال (`network` / `forbidden` / `conflict` / `validation`).
 * 2. `Idempotency-Key` روی هر نوشتن غیرعمومی — `TenantContextMiddleware`.
 * 3. بدنه با **همان** schema ِ `packages/contracts` که `ZodValidationPipe` کنترلر اجرا می‌کند.
 *
 * اگر هیچ‌کدام پاسخ ندهند `undefined` برمی‌گردد و MSW سراغ handler بعدی (مسیر واقعی) می‌رود.
 * نتیجه: handlerهای مسیر نمی‌توانند ورودی‌ای را بپذیرند که سرور رد می‌کند، و هر تغییر
 * schema ِ ورودی همین‌جا — و در `contract-conformance.test.ts` — دیده می‌شود.
 */

export interface WriteRoute {
  readonly method: 'POST' | 'PATCH';
  /** الگوی MSW، همان رشته‌ی handler مسیر. */
  readonly path: string;
  /** schema ِ بدنه در `ZodValidationPipe` کنترلر؛ `null` = کنترلر بدنه نمی‌خواند. */
  readonly body: z.ZodTypeAny | null;
}

/**
 * همه‌ی مسیرهای نوشتنی mock و schema ِ بدنه‌ی هرکدام. تست قرارداد بررسی می‌کند هر
 * handler نوشتنی اینجا ثبت شده باشد — مسیر تازه بدون schema سبز نمی‌شود.
 */
export const WRITE_ROUTES: readonly WriteRoute[] = [
  { method: 'POST', path: '/api/auth/login', body: loginSchema },
  { method: 'POST', path: '/api/auth/refresh', body: refreshSchema },
  { method: 'POST', path: '/api/auth/logout', body: refreshSchema },
  { method: 'POST', path: '/api/pricing/quotes/manual', body: createManualPriceQuoteSchema },
  { method: 'POST', path: '/api/pricing/feed/refresh', body: refreshPriceFeedSchema },
  { method: 'POST', path: '/api/parties', body: createPartySchema },
  { method: 'PATCH', path: '/api/parties/:id', body: updatePartySchema },
  { method: 'POST', path: '/api/parties/:id/deactivate', body: null },
  { method: 'POST', path: '/api/parties/:partyId/settlements/rial', body: createRialSettlementSchema },
  { method: 'POST', path: '/api/parties/:partyId/settlements/gold', body: createGoldSettlementSchema },
  { method: 'POST', path: '/api/parties/:partyId/settlements/coins', body: createCoinSettlementSchema },
  { method: 'POST', path: '/api/parties/:partyId/settlements/mixed', body: createMixedSettlementSchema },
  { method: 'POST', path: '/api/inventory/jewelry-items', body: createJewelryItemSchema },
  { method: 'PATCH', path: '/api/inventory/jewelry-items/:id', body: updateJewelryItemSchema },
  { method: 'POST', path: '/api/inventory/coin-types', body: createCoinTypeSchema },
  { method: 'POST', path: '/api/inventory/coin-types/:coinTypeId/versions', body: createCoinTypeVersionSchema },
  { method: 'POST', path: '/api/inventory/opening-balances', body: createOpeningBalanceSchema },
  { method: 'POST', path: '/api/settings/general', body: updateGeneralSettingSchema },
  { method: 'POST', path: '/api/sales/invoices/jewelry', body: createJewelryCashSaleSchema },
  { method: 'POST', path: '/api/sales/invoices/jewelry/credit', body: createJewelryCreditSaleSchema },
  { method: 'POST', path: '/api/sales/invoices/coins', body: createCoinSaleSchema },
  { method: 'POST', path: '/api/sales/invoices/:invoiceId/amend', body: amendSalesInvoiceSchema },
  { method: 'POST', path: '/api/sales/invoices/:invoiceId/b2c-buyback/preview', body: previewB2cBuybackSchema },
  { method: 'POST', path: '/api/sales/invoices/:invoiceId/b2c-buyback', body: createB2cBuybackSchema },
  { method: 'POST', path: '/api/purchase/second-hand/gold', body: createSecondHandGoldPurchaseSchema },
  { method: 'POST', path: '/api/purchase/second-hand/coins', body: createSecondHandCoinPurchaseSchema },
];

/** `PUBLIC_PATH_PREFIXES` سرور (`request-path.ts`): بی‌مستأجر، بی‌کلید، بی‌نقش. */
const PUBLIC_PREFIX = '/api/auth';

function isPublicPath(pathname: string): boolean {
  return pathname === PUBLIC_PREFIX || pathname.startsWith(`${PUBLIC_PREFIX}/`);
}

function findWriteRoute(method: string, url: string): WriteRoute | undefined {
  return WRITE_ROUTES.find((route) => route.method === method && matchRequestUrl(new URL(url), route.path).matches);
}

/* ── سناریوها ─────────────────────────────────────────────────── */

/**
 * - `success`: رفتار عادی هر مسیر (پیش‌فرض).
 * - `validation`: نوشتن‌ها `400 VALIDATION_ERROR` می‌گیرند — `fields` از اجرای واقعی schema ِ
 *   همان مسیر روی بدنه‌ی خالی، نه پیام دست‌ساز.
 * - `conflict`: نوشتن‌ها `409 CONFLICT` ِ تعارض کلید (`IdempotencyKeyConflictError` در کنترلرها).
 * - `forbidden`: هر مسیر غیرعمومی `403 FORBIDDEN` ِ `RolesGuard`.
 * - `network`: هر درخواست `/api` خطای شبکه (`TypeError` ِ fetch) می‌گیرد.
 *
 * خواندن‌ها از `validation`/`conflict` عبور می‌کنند: سرور برای GET هیچ‌کدام را تولید نمی‌کند
 * و ساختن‌شان یعنی mock رفتاری را نشان دهد که production ندارد.
 */
export const MOCK_SCENARIOS = ['success', 'validation', 'conflict', 'forbidden', 'network'] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export function isMockScenario(value: unknown): value is MockScenario {
  return typeof value === 'string' && (MOCK_SCENARIOS as readonly string[]).includes(value);
}

interface ActiveScenario {
  readonly scenario: MockScenario;
  /** فقط درخواست‌هایی که با این الگوی MSW می‌خوانند (مثلاً `/api/parties/:partyId/settlements/*`). */
  readonly path?: string;
}

let active: ActiveScenario = { scenario: 'success' };

/** تست‌ها و سوییچ توسعه (`browser.ts`) از همین تابع استفاده می‌کنند. */
export function setMockScenario(scenario: MockScenario, options: { readonly path?: string } = {}): void {
  active = options.path === undefined ? { scenario } : { scenario, path: options.path };
}

export function resetMockScenario(): void {
  active = { scenario: 'success' };
}

export function currentMockScenario(): MockScenario {
  return active.scenario;
}

/** پیام‌های واقعی سرور — هرکدام با منبعش. */
export const SCENARIO_MESSAGES = {
  /** `RolesGuard` (`platform/auth/roles.guard.ts`). */
  forbidden: 'نقش شما اجازه‌ی این عملیات را ندارد',
  /** `IdempotencyKeyConflictError` ← `ConflictException` در هر کنترلر نوشتنی. */
  conflict: 'این Idempotency-Key قبلاً برای درخواست دیگری استفاده شده است',
} as const;

function scenarioResponse(request: Request, route: WriteRoute | undefined): Response | undefined {
  const { scenario, path } = active;
  if (scenario === 'success') return undefined;
  if (path !== undefined && !matchRequestUrl(new URL(request.url), path).matches) return undefined;

  const pathname = new URL(request.url).pathname;
  switch (scenario) {
    case 'network':
      return HttpResponse.error();
    case 'forbidden':
      return isPublicPath(pathname) ? undefined : mockError('FORBIDDEN', SCENARIO_MESSAGES.forbidden);
    case 'conflict':
      return route === undefined || isPublicPath(pathname)
        ? undefined
        : mockError('CONFLICT', SCENARIO_MESSAGES.conflict);
    case 'validation': {
      if (route === undefined) return undefined;
      const parsed = (route.body ?? z.never()).safeParse({});
      return parsed.success ? mockError('VALIDATION_ERROR', 'ورودی نامعتبر است') : mockValidationError(parsed.error);
    }
  }
}

/* ── Idempotency-Key: همان بدنه یا ۴۰۹ (M-22، #33) ──────────────── */

/**
 * اثر انگشت درخواستی که با هر کلید در حال پردازش است، و اثر انگشتی که پاسخش ذخیره شده.
 * سرور (`IdempotencyService`) کلید را با «متد + مسیر + بدنه» ذخیره می‌کند. همان کلید با همان
 * درخواست replay می‌شود و با درخواست دیگر `409` می‌گیرد. ولی اگر تلاش اول شکست بخورد، claim
 * rollback می‌شود و همان کلید با بدنه‌ی اصلاح‌شده آزاد است، که فرانت دقیقاً همین کار را می‌کند
 * (`useIdempotencyKey`). پس اثر انگشت فقط وقتی «قطعی» می‌شود که handler پاسخ موفق را
 * cache کند: `commitIdempotentRequest`.
 */
const inFlightFingerprints = new Map<string, string>();
const committedFingerprints = new Map<string, string>();

/** handlerهای مسیر هنگام cache کردن پاسخ موفق صدا می‌زنند (`idempotencyCache` در `index.ts`). */
export function commitIdempotentRequest(key: string): void {
  const fingerprint = inFlightFingerprints.get(key);
  if (fingerprint !== undefined) committedFingerprints.set(key, fingerprint);
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.clone().text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return Symbol('invalid-json');
  }
}

export const contractGate = http.all('/api/*', async ({ request }) => {
  const route = findWriteRoute(request.method, request.url);

  const scenario = scenarioResponse(request, route);
  if (scenario !== undefined) return scenario;

  if (route === undefined) return undefined;
  const pathname = new URL(request.url).pathname;
  const key = request.headers.get('Idempotency-Key')?.trim();
  if (!isPublicPath(pathname) && !key) {
    return mockMissingIdempotencyKey();
  }

  const body = route.body === null ? undefined : await readJson(request);
  if (route.body !== null) {
    if (typeof body === 'symbol') return mockError('BAD_REQUEST', 'درخواست نامعتبر است');
    const parsed = route.body.safeParse(body);
    if (!parsed.success) return mockValidationError(parsed.error);
  }

  if (key && !isPublicPath(pathname)) {
    const fingerprint = `${request.method} ${pathname} ${JSON.stringify(body ?? null)}`;
    const committed = committedFingerprints.get(key);
    if (committed !== undefined && committed !== fingerprint) {
      return mockError('CONFLICT', SCENARIO_MESSAGES.conflict);
    }
    inFlightFingerprints.set(key, fingerprint);
  }
  return undefined;
});
