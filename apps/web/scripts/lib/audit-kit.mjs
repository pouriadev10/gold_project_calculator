/**
 * ابزار مشترک ممیزی‌های مرورگری روی بیلد production — FE-089 (INP) و FE-090 (PWA).
 *
 * بدون وابستگی تازه: سرور Node که `dist` را مثل سرور واقعی سرو می‌کند (gzip، کش immutable
 * برای فایل‌های hashدار، بازگشت SPA به index.html) و `/api/*` را با همان handlerهای MSW
 * توسعه پاسخ می‌دهد (همان الگوی `lcp-audit.mjs`)، به‌علاوه‌ی کلاینت حداقلی DevTools
 * Protocol و راندن لمسی کنترل‌ها.
 *
 * مرورگر: Chrome/Edge نصب‌شده، یا `CHROME_PATH` (و `CHROME_FLAGS` برای پرچم‌های اضافه،
 * مثلاً `--no-sandbox` در کانتینر).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createServer as createViteServer } from 'vite';

export const SESSION_STORAGE_KEY = 'gold-ui-session';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function findBrowser() {
  const path = BROWSERS.find((candidate) => existsSync(candidate));
  if (!path) throw new Error('Chrome یا Edge پیدا نشد (یا CHROME_PATH را بده)');
  return path;
}

/** Chrome headless با پروفایل تازه روی `port`؛ `close()` هم مرورگر و هم پروفایل را پاک می‌کند. */
export function launchBrowser(port, profilePrefix) {
  const profileDir = mkdtempSync(join(tmpdir(), profilePrefix));
  const extraFlags = (process.env.CHROME_FLAGS ?? '').split(/\s+/u).filter(Boolean);
  const browser = spawn(
    findBrowser(),
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      ...extraFlags,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  return {
    async close() {
      browser.kill();
      await sleep(500);
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

/** handlerهای MSW توسعه در Node (از راه `ssrLoadModule` خودِ Vite). */
export async function loadMockHandlers(webRoot) {
  const vite = await createViteServer({
    root: webRoot,
    configFile: join(webRoot, 'vite.config.ts'),
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  const { handlers } = await vite.ssrLoadModule('/src/mocks/handlers/index.ts');
  const { getResponse } = await import('msw');
  return { handlers, getResponse, close: () => vite.close() };
}

/* ── سرور production + API ساختگی ───────────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg']);

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function send(req, res, status, headers, body) {
  const accepts = /\bgzip\b/u.test(req.headers['accept-encoding'] ?? '');
  if (accepts && body.length > 1024 && headers.compressible) {
    body = gzipSync(body);
    headers['content-encoding'] = 'gzip';
  }
  delete headers.compressible;
  res.writeHead(status, { ...headers, 'content-length': body.length });
  res.end(body);
}

/**
 * @param {object} options
 * @param {string} options.dist پوشه‌ی بیلد
 * @param {{ handlers: unknown[], getResponse: Function }} options.mocks
 * @param {(ctx: { url: URL, method: string, ok: boolean, body: Buffer, callApi: Function, headers: Record<string,string> }) => Promise<Buffer>} [options.transformApi]
 *   تغییر پاسخ API پیش از ارسال (مثلاً صفحه‌های کامل در ممیزی INP).
 *
 * خروجی، جز `origin` و `session` (نشست واقعی از handler ورود): `requests` (هر درخواست
 * رسیده، حتی در قطعی: روش، مسیر و `outage`؛ برای API همچنین `query`، `status` و برای نوشتن‌ها
 * `idempotencyKey`، بدنه‌ی درخواست و پاسخ — FE-098 تکرار درخواست مالی را با آن‌ها می‌سنجد)، `setOutage(true)` (قطع کامل: هر اتصال بی‌پاسخ بسته می‌شود — مثل
 * سرور یا شبکه‌ی در دسترس نیست) و `bumpServiceWorker()` (بایت‌های `sw.js` عوض می‌شود؛
 * مرورگر آن را نسخه‌ی تازه می‌بیند).
 */
export async function startProdServer({ dist, mocks, transformApi }) {
  const requests = [];
  let outage = false;
  let swRevision = 0;

  async function callApi(method, url, headers, body) {
    const request = new Request(url, { method, headers, body: body?.length ? body : undefined });
    return mocks.getResponse(mocks.handlers, request, { baseUrl: new URL(url).origin });
  }

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    // حتی در قطعی ثبت می‌شود — تا ممیزی ببیند برنامه آفلاین اصلاً تلاشی کرده یا نه
    const record = { method: req.method, path: url.pathname, at: Date.now(), outage };
    requests.push(record);
    if (outage) {
      req.socket.destroy();
      return;
    }
    try {
      if (url.pathname.startsWith('/api/')) {
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
        const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string'));
        const response = await callApi(req.method, url.href, headers, body);
        record.query = url.search;
        record.status = response?.status ?? 404;
        if (!response) {
          send(req, res, 404, { 'content-type': MIME['.json'], compressible: true }, Buffer.from('{"code":"NOT_FOUND"}'));
          return;
        }
        let out = Buffer.from(await response.arrayBuffer());
        const outHeaders = Object.fromEntries(response.headers.entries());
        delete outHeaders['content-length'];
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          record.idempotencyKey = headers['idempotency-key'] ?? null;
          record.body = body?.toString('utf8') ?? '';
          record.response = out.toString('utf8');
        }
        if (transformApi) {
          out = await transformApi({ url, method: req.method, ok: response.ok, body: out, callApi, headers });
        }
        send(req, res, response.status, { ...outHeaders, 'cache-control': 'no-store', compressible: true }, out);
        return;
      }

      let file = normalize(join(dist, decodeURIComponent(url.pathname)));
      if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
        file = join(dist, 'index.html');
      }
      const ext = extname(file);
      let body = readFileSync(file);
      if (url.pathname === '/sw.js' && swRevision > 0) {
        body = Buffer.concat([body, Buffer.from(`\n// audit revision ${swRevision}\n`)]);
      }
      send(
        req,
        res,
        200,
        {
          'content-type': MIME[ext] ?? 'application/octet-stream',
          'cache-control': file.includes(join(dist, 'assets')) ? 'public, max-age=31536000, immutable' : 'no-cache',
          compressible: COMPRESSIBLE.has(ext),
        },
        body,
      );
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  // نشست واقعی از همان handler ورود — شکلش همیشه با قرارداد فعلی می‌خواند.
  const login = await callApi(
    'POST',
    `${origin}/api/auth/login`,
    { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    Buffer.from(JSON.stringify({ email: 'owner@example.com', password: 'password123', tenantSlug: 'demo' })),
  );
  if (!login?.ok) throw new Error(`ورود ساختگی شکست خورد (${login?.status})`);
  const session = await login.json();

  return {
    origin,
    session,
    requests,
    setOutage: (value) => {
      outage = value;
    },
    bumpServiceWorker: () => {
      swRevision += 1;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

/** اسکریپتی که نشست را پیش از هر بارگذاری در localStorage می‌گذارد (اگر نبود). */
export function seedSessionScript(session) {
  const value = JSON.stringify(JSON.stringify({ state: { session }, version: 0 }));
  const key = JSON.stringify(SESSION_STORAGE_KEY);
  return `if (!localStorage.getItem(${key})) localStorage.setItem(${key}, ${value});`;
}

/* ── DevTools Protocol ───────────────────────────────────────────── */

export class Cdp {
  #id = 0;
  #pending = new Map();
  #listeners = new Map();
  #socket;

  static async connect(url) {
    const cdp = new Cdp();
    cdp.#socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      cdp.#socket.addEventListener('open', resolve, { once: true });
      cdp.#socket.addEventListener('error', reject, { once: true });
    });
    cdp.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method) {
        for (const listener of cdp.#listeners.get(message.method) ?? []) listener(message.params);
        return;
      }
      const waiter = message.id === undefined ? undefined : cdp.#pending.get(message.id);
      if (!waiter) return;
      cdp.#pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
      else waiter.resolve(message.result);
    });
    return cdp;
  }

  on(method, listener) {
    this.#listeners.set(method, [...(this.#listeners.get(method) ?? []), listener]);
  }

  send(method, params = {}) {
    this.#id += 1;
    const id = this.#id;
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method}: بدون پاسخ پس از ۳۰ ثانیه`));
      }, 30_000);
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        method,
      });
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    return result.result.value;
  }

  close() {
    this.#socket.close();
  }
}

export async function openTarget(port) {
  for (let attempt = 0; attempt < 75; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      // مرورگر هنوز بالا نیامده
    }
    await sleep(200);
  }
  throw new Error('اتصال DevTools برقرار نشد');
}

/* ── یافتن و راندن کنترل‌ها ───────────────────────────────────────── */

export async function waitFor(cdp, expression, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.eval(`Boolean(${expression})`)) return;
    await sleep(150);
  }
  throw new Error(`منتظر «${label}» ماند و نرسید`);
}

/** کنترل دیده‌شده با نام دسترس‌پذیر (aria-label، `<label>` یا متن). `prefix` = ابتدای نام. */
export const findControl = (name, { prefix = false } = {}) => `(() => {
  const name = ${JSON.stringify(name)};
  const match = (value) => ${prefix ? 'value.startsWith(name)' : 'value === name'};
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const candidates = [...document.querySelectorAll('button, a, [role="button"], [role="radio"], [role="option"], input, select')];
  return candidates.find((el) => {
    const names = [el.getAttribute('aria-label'), el.labels?.[0]?.textContent, el.textContent].map((v) => (v ?? '').trim());
    return names.some(match) && visible(el);
  }) ?? null;
})()`;

export const centerOf = (finder) => `(() => {
  const el = ${finder};
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;

/** ضربه‌ی لمسی واقعی (touchStart/touchEnd) — همان رویدادهای pointer که انگشت می‌سازد. */
export async function tapPoint(cdp, point) {
  const touchPoints = [{ x: point.x, y: point.y, radiusX: 4, radiusY: 4, force: 1, id: 0 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** کنترل ممکن است پس از رسیدن داده‌ی صفحه‌ی بعد پیدا شود — تا ۱۰ ثانیه صبر می‌کند. */
export async function tapFinder(cdp, finder, label) {
  const deadline = Date.now() + 10_000;
  let point = null;
  while (!point && Date.now() < deadline) {
    point = await cdp.eval(centerOf(finder));
    if (!point) await sleep(150);
  }
  if (!point) throw new Error(`کنترل «${label}» پیدا نشد`);
  await sleep(120);
  await tapPoint(cdp, point);
}

/** کلید واقعی: keyDown (با متن) + keyUp — Event Timing آن را یک تعامل می‌شمارد. */
export async function pressKey(cdp, key) {
  const special = { Backspace: 8, Enter: 13, Escape: 27 }[key];
  const params = special
    ? { key, code: key, windowsVirtualKeyCode: special }
    : { key, text: key, unmodifiedText: key };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}
