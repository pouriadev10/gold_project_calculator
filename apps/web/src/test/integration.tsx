import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { render, within } from '@testing-library/react';
import { HttpResponse, type JsonBodyType } from 'msw';
import { setupServer, type SetupServer } from 'msw/node';
import { createQueryClient } from '@/api/query-client';
import { routeTree, routerDefaults } from '@/app/router';
import { Toaster } from '@/components/common/Toaster';
import { handlers } from '@/mocks/handlers';
import { mockError } from '@/mocks/handlers/errors';

/**
 * زیرساخت تست‌های Integration جریان‌های مالی — FE-094 به بعد.
 *
 * برنامه با درخت مسیر واقعی، هوک‌های واقعی Query و کلاینت واقعی `src/api` رندر می‌شود؛ تنها
 * مرز `msw/node` است. خواندنی‌ها همان handlerهای توسعه‌اند و هر تست نوشتن‌های جریان خودش را
 * با `server.use(...)` جواب می‌دهد.
 */

export interface CapturedRequest {
  readonly method: string;
  readonly path: string;
  /** رشته‌ی query ِ آدرس، با `?` (یا خالی). */
  readonly query: string;
  readonly headers: Headers;
  readonly body: Promise<string>;
}

export interface IntegrationServer {
  readonly server: SetupServer;
  /** هر درخواستی که از برنامه بیرون رفت، به ترتیب؛ با `reset()` خالی می‌شود. */
  readonly requests: () => readonly CapturedRequest[];
  /** فقط نوشتن‌ها (هر متدی جز GET). */
  readonly writes: () => readonly CapturedRequest[];
  /** پاک‌کردن فهرست درخواست‌ها — در `beforeEach`. */
  readonly reset: () => void;
  /** شروع شنود و پل fetch — در `beforeAll`. */
  readonly start: () => void;
  /** برگرداندن fetch و بستن سرور — در `afterAll`. */
  readonly stop: () => void;
}

export function createIntegrationServer(): IntegrationServer {
  const server = setupServer(...handlers);
  const originalFetch = globalThis.fetch;
  let requests: CapturedRequest[] = [];

  return {
    server,
    requests: () => requests,
    writes: () => requests.filter((request) => request.method !== 'GET'),
    reset: () => {
      requests = [];
    },
    start: () => {
      // jsdom `scrollTo` را پیاده نمی‌کند؛ router هنگام ناوبری صدایش می‌زند.
      window.scrollTo = () => undefined;
      server.listen({ onUnhandledRequest: 'error' });
      server.events.on('request:start', ({ request }) => {
        requests.push({
          method: request.method,
          path: new URL(request.url).pathname,
          query: new URL(request.url).search,
          headers: new Headers(request.headers),
          body: request.clone().text(),
        });
      });
      // همان پل `a11y.test.tsx`: fetch ِ Node آدرس نسبی و `AbortSignal` ِ jsdom را نمی‌پذیرد.
      const mswFetch = globalThis.fetch;
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const { signal: _signal, ...rest } = init ?? {};
        return mswFetch(
          typeof input === 'string' && input.startsWith('/') ? new URL(input, window.location.origin) : input,
          rest,
        );
      }) as typeof fetch;
    },
    stop: () => {
      globalThis.fetch = originalFetch;
      server.close();
    },
  };
}

/**
 * آینه‌ی جدول `idempotency_records` ِ سرور (`apps/api/src/platform/idempotency/request-hash.ts`):
 * hash روی متد + مسیر + بدنه‌ی canonical است. همان کلید و همان بدنه ← پاسخ ذخیره‌شده تکرار
 * می‌شود؛ همان کلید با بدنه‌ی دیگر ← ۴۰۹. mock توسعه فقط کلید را می‌سنجد و این تفاوت را پنهان
 * می‌کرد (FE-094).
 */
export class IdempotencyLedger {
  readonly #records = new Map<string, { fingerprint: string; status: number; body: JsonBodyType }>();

  get size(): number {
    return this.#records.size;
  }

  /** پاسخ‌های ذخیره‌شده، به ترتیب ثبت. */
  responses(): JsonBodyType[] {
    return [...this.#records.values()].map((record) => record.body);
  }

  /**
   * `execute` فقط برای کلید تازه اجرا می‌شود؛ `null` یعنی رد پیش از ثبت (چیزی ذخیره نمی‌شود،
   * مثل rollback تراکنش سرور). `loseResponse`: ثبت می‌شود ولی مرورگر خطای شبکه می‌بیند.
   */
  async handle(
    request: Request,
    execute: (body: Record<string, unknown>) => { status: number; body: JsonBodyType } | Response,
    options: { readonly loseResponse?: boolean } = {},
  ): Promise<Response> {
    const path = new URL(request.url).pathname;
    const rawBody = await request.text();
    const key = request.headers.get('Idempotency-Key') ?? '';
    const fingerprint = `${request.method} ${path} ${canonicalJson(JSON.parse(rawBody))}`;

    const existing = this.#records.get(key);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        return mockError('CONFLICT', 'این Idempotency-Key قبلاً برای درخواست دیگری استفاده شده است');
      }
      return HttpResponse.json(existing.body, { status: existing.status });
    }

    const outcome = execute(JSON.parse(rawBody) as Record<string, unknown>);
    if (outcome instanceof Response) return outcome;
    this.#records.set(key, { fingerprint, ...outcome });
    return options.loseResponse ? HttpResponse.error() : HttpResponse.json(outcome.body, { status: outcome.status });
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** رندر کل برنامه روی یک مسیر — همان چیدمان `main.tsx`. */
export function renderRoute(path: string): void {
  const router = createRouter({ routeTree, ...routerDefaults, history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  );
}

/**
 * مقدار خام (`data-raw`، لاتین و صحیح) و واحد عدد مالی کنار برچسب `label`. `AmountDisplay` و
 * `RateDisplay` این دو ویژگی را می‌گذارند؛ سنجش روی آن‌ها از قالب‌بندی فارسی مستقل است.
 */
export function rawAmount(
  label: string,
  scope: HTMLElement = document.body,
  selector = 'span',
): { raw: string; unit: string } {
  const row = within(scope).getByText(label, { selector }).parentElement!;
  const amount = row.querySelector('[data-raw]');
  if (amount === null) throw new Error(`کنار «${label}» عدد مالی‌ای نیست`);
  return { raw: amount.getAttribute('data-raw')!, unit: amount.getAttribute('data-unit')! };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
