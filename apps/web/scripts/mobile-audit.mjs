#!/usr/bin/env node
/**
 * ممیزی خودکار موبایل ۳۶۰px — FE-085.
 *
 * jsdom چیدمان ندارد، پس «بدون overflow افقی» فقط با موتور چیدمان واقعی قابل
 * اندازه‌گیری است. این اسکریپت بدون هیچ وابستگی تازه:
 *
 * ۱. سرور توسعه‌ی Vite را برنامه‌ای (روی پورت آزاد، با MSW) بالا می‌آورد؛
 * ۲. Chrome یا Edge نصب‌شده را headless اجرا می‌کند و از راه DevTools Protocol
 *    (WebSocket خودِ Node) آن را می‌راند — هیچ پنجره‌ای باز نمی‌شود؛
 * ۳. نما را روی ۳۶۰×۸۰۰ لمسی تنظیم می‌کند، با فرم ورود واقعی وارد می‌شود و
 *    صفحه‌های اجباری FE-085 را یکی‌یکی می‌سنجد:
 *    - overflow افقی (عرض سند + هر عنصر بیرون‌زده که داخل ظرف اسکرول‌دار نیست)
 *    - اقدام اصلی: دیده می‌شود و چیزی رویش نیست
 *    - کیپد: داخل نما، و فیلد فعال زیرش پنهان نمی‌شود
 *    - Bottom Sheet: تمام‌صفحه و واقعاً روی صفحه (نه گیر کرده بیرون نما)
 *    - جدول: هیچ <table> دیده‌شده‌ای زیر ۶۴۰px
 * ۴. از هر صفحه screenshot می‌گیرد (`apps/web/.mobile-audit/`، gitignore) و
 *    خلاصه را چاپ می‌کند. هر شکست کد خروج ۱ می‌دهد.
 *
 * اجرا: `pnpm --filter @gold/web audit:mobile`
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(WEB_ROOT, '.mobile-audit');
const VIEWPORT = { width: 360, height: 800 };
const DEBUG_PORT = 9333;
const PARTY_ID = 'a1000000-0000-4000-8000-000000000001';
const INVOICE_ID = 'd5000000-0000-4000-8000-000000000001';

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── کلاینت حداقلی DevTools Protocol ─────────────────────────────── */

class Cdp {
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
      // هیچ فراخوانی DevTools نباید اسکریپت را بی‌صدا معلق کند.
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method}: بدون پاسخ پس از ۱۵ ثانیه`));
      }, 15_000);
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

  /** یک عبارت را در صفحه اجرا و مقدار JSON آن را برمی‌گرداند. */
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    return result.result.value;
  }

  close() {
    this.#socket.close();
  }
}

async function waitFor(cdp, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.eval(`Boolean(${expression})`)) return;
    await sleep(150);
  }
  throw new Error(`منتظر «${label}» ماند و نرسید`);
}

/** دکمه یا لینک دیده‌شده با نام دسترس‌پذیر دقیق (aria-label، `<label>` یا متن). */
const findControl = (name) => `(() => {
  const name = ${JSON.stringify(name)};
  return [...document.querySelectorAll('button, a, [role="button"]')].find((el) => {
    const names = [el.getAttribute('aria-label'), el.labels?.[0]?.textContent, el.textContent].map((v) => (v ?? '').trim());
    return names.includes(name) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  }) ?? null;
})()`;

/** مرکز یک کنترل پس از آوردنش به وسط نما — برای ضربه‌ی لمسی واقعی. */
const centerOf = (finder) => `(() => {
  const el = ${finder};
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;

/* ── سنجه‌ها، اجراشده داخل صفحه ──────────────────────────────────── */

const MEASURE = `(() => {
  const vw = window.innerWidth;
  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.split(/\\s+/).slice(0, 4).join('.') : '';
    const text = (el.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 40);
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (text ? ' «' + text + '»' : '');
  };
  const clippedByAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        const r = p.getBoundingClientRect();
        if (r.right <= vw + 1 && r.left >= -1) return true;
      }
    }
    return false;
  };
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.right > vw + 1 || r.left < -1) && !clippedByAncestor(el)) {
      offenders.push(describe(el) + ' [' + Math.floor(r.left) + '…' + Math.ceil(r.right) + ']');
    }
  }
  const tables = [...document.querySelectorAll('table')].filter(
    (t) => t.getClientRects().length > 0 && getComputedStyle(t).visibility !== 'hidden',
  ).length;
  return {
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewport: vw,
    // فقط ریشه‌ها را گزارش کن، نه همه‌ی فرزندان یک عنصر بیرون‌زده.
    offenders: offenders.slice(0, 8),
    offenderCount: offenders.length,
    tables,
  };
})()`;

/** اقدام اصلی دیده می‌شود، داخل نماست و عنصر دیگری (نوار ناوبری، کیپد) رویش نیست. */
const ACTION_CHECK = (name) => `(() => {
  const el = ${findControl(name)};
  if (!el) return { found: false };
  const before = el.getBoundingClientRect();
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  // دکمه‌ی غیرفعال \`pointer-events: none\` دارد و hit-test از رویش رد می‌شود؛
  // اینجا فقط پوشیده‌بودن مهم است، نه فعال‌بودن.
  const previous = el.style.pointerEvents;
  el.style.pointerEvents = 'auto';
  const hit = document.elementFromPoint(x, y);
  el.style.pointerEvents = previous;
  return {
    found: true,
    inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
    unobstructed: Boolean(hit && (hit === el || el.contains(hit))),
    covering: hit && hit !== el && !el.contains(hit) ? (hit.closest('nav, [data-numeric-keypad-root]')?.tagName ?? hit.tagName) + ' ' + (typeof hit.className === 'string' ? hit.className.slice(0, 90) : '') : null,
    bottomThird: before.top >= window.innerHeight * (2 / 3) || getComputedStyle(el.closest('.fixed') ?? el).position === 'fixed',
    height: Math.round(r.height),
  };
})()`;

/** فیلدهای عددی قابل‌استفاده — داخل گفت‌وگوی باز اگر هست، نه صفحه‌ی پشتش. */
const NUMERIC_FIELDS = `[...([...document.querySelectorAll('[role="dialog"]')].find((d) => d.getClientRects().length > 0) ?? document).querySelectorAll('input[data-kind]')].filter((el) => el.getClientRects().length > 0 && !el.disabled)`;
const FIRST_NUMERIC_FIELD = `(${NUMERIC_FIELDS}[0] ?? null)`;
/** آخرین فیلد — پایین‌ترین جای فرم، سخت‌ترین حالت برای کیپد. */
const LAST_NUMERIC_FIELD = `(${NUMERIC_FIELDS}.at(-1) ?? null)`;

/**
 * کیپد پس از ضربه روی فیلد `finder`: داخل نما، فیلد لمس‌شده فوکوس DOM گرفته و
 * زیر کیپد پنهان نمی‌شود.
 */
const KEYPAD_CHECK = (finder) => `(async () => {
  const field = ${finder};
  if (!field) return { found: false };
  const keypad = document.querySelector('[data-numeric-keypad-root]');
  if (!keypad || getComputedStyle(keypad).visibility === 'hidden') {
    const active = document.activeElement;
    return { found: true, opened: false, focused: active ? active.tagName + ' ' + (active.getAttribute('aria-label') ?? active.id ?? '') : null, keypads: document.querySelectorAll('[data-numeric-keypad-root]').length };
  }
  const k = keypad.getBoundingClientRect();
  const f = field.getBoundingClientRect();
  const hit = document.elementFromPoint(f.left + f.width / 2, f.top + f.height / 2);
  const keys = [...keypad.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
  return {
    found: true,
    opened: true,
    focused: document.activeElement === field,
    activeElement: document.activeElement ? document.activeElement.tagName + ' ' + (document.activeElement.getAttribute('aria-label') ?? document.activeElement.id ?? '') + ' ' + (typeof document.activeElement.className === 'string' ? document.activeElement.className.slice(0, 50) : '') : null,
    fieldLabel: field.labels?.[0]?.textContent ?? field.id,
    keypadInViewport: k.top >= 0 && k.bottom <= window.innerHeight + 1 && k.left >= -1 && k.right <= window.innerWidth + 1,
    fieldVisible: Boolean(hit && field.closest('div')?.contains(hit)) && f.bottom <= k.top,
    fieldBottom: Math.round(f.bottom),
    keypadTop: Math.round(k.top),
    smallestKey: Math.round(Math.min(...keys.map((r) => Math.min(r.width, r.height)))),
  };
})()`;

/** Bottom Sheet باز: تمام‌صفحه و واقعاً روی نما (نه گیر کرده بیرون آن). */
const SHEET_CHECK = `(async () => {
  await new Promise((resolve) => setTimeout(resolve, 900));
  const dialog = [...document.querySelectorAll('[role="dialog"]')].find((el) => el.getClientRects().length > 0);
  if (!dialog) return { open: false };
  const r = dialog.getBoundingClientRect();
  return {
    open: true,
    isSheet: dialog.hasAttribute('data-vaul-drawer') || dialog.closest('[data-vaul-drawer]') !== null,
    fullWidth: r.left <= 1 && r.right >= window.innerWidth - 1,
    onScreen: r.top >= -1 && r.top < 2 && r.bottom <= window.innerHeight + 1,
    top: Math.round(r.top),
    height: Math.round(r.height),
  };
})()`;

/* ── سناریوها ───────────────────────────────────────────────────── */

/**
 * هر صفحه: مسیر، عنوانی که نشانه‌ی بارگذاری کامل است، اقدام اصلی (یا null اگر
 * صفحه‌ی خواندنی است)، و اینکه کیپد/Bottom Sheet روی آن سنجیده شود.
 */
const PAGES = [
  { name: 'dashboard', path: '/dashboard', ready: 'آخرین معامله‌ها', action: 'فروش' },
  { name: 'parties', path: '/parties', ready: 'حسین مرادی', action: 'افزودن شخص', sheet: 'افزودن شخص' },
  { name: 'inventory', path: '/inventory', ready: 'موجودی', action: null },
  { name: 'inventory-coins', path: '/inventory/coins', ready: 'نیم سکه', action: null, keypad: true },
  // فیلد عددی داخل Bottom Sheet: بدنه‌ی sheet باید فیلد را بالای کیپد بیاورد.
  {
    name: 'inventory-jewelry',
    path: '/inventory/jewelry',
    ready: 'انگشتر',
    action: 'کالای جدید',
    sheet: 'کالای جدید',
    sheetKeypad: true,
  },
  { name: 'new-sale', path: '/sales/new', ready: 'منبع: ', action: 'بعدی', steps: ['بعدی'], sheet: 'مشتری' },
  { name: 'new-coin-sale', path: '/sales/coins/new', ready: 'نوع سکه', action: 'ثبت فروش', keypad: true, sheet: 'مشتری' },
  { name: 'new-coin-purchase', path: '/purchase/second-hand/coins', ready: 'نوع سکه', action: 'ثبت خرید سکه', keypad: true },
  { name: 'new-purchase', path: '/purchase/second-hand', ready: 'فروشنده', action: 'بعدی', sheet: 'فروشنده' },
  {
    name: 'settlement',
    path: `/parties/${PARTY_ID}/settlements/new`,
    ready: 'حسین مرادی',
    steps: ['سکه'],
    action: 'ثبت پرداخت',
    keypad: true,
  },
  { name: 'invoice-list', path: '/sales/invoices', ready: 'صفحه', action: null },
  { name: 'invoice', path: `/sales/invoices/${INVOICE_ID}`, ready: 'اقلام', action: 'دریافت PDF' },
  { name: 'report-debtors', path: '/reporting/debtors', ready: 'حسین مرادی', action: null },
  { name: 'report-profit', path: '/reporting/profit', ready: 'سود', action: null },
];

function findBrowser() {
  const path = BROWSERS.find((candidate) => existsSync(candidate));
  if (!path) throw new Error('Chrome یا Edge پیدا نشد');
  return path;
}

async function openPage() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      // مرورگر هنوز بالا نیامده
    }
    await sleep(200);
  }
  throw new Error('اتصال DevTools برقرار نشد');
}

async function screenshot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
}

async function navigate(cdp, origin, path, ready) {
  await cdp.send('Page.navigate', { url: `${origin}${path}` });
  await waitFor(cdp, `document.body && document.body.innerText.includes(${JSON.stringify(ready)})`, ready, 15_000);
  // تا skeletonها و انیمیشن ورود تمام شوند
  await waitFor(cdp, `!document.querySelector('[aria-label^="در حال دریافت"]')`, 'پایان بارگذاری', 15_000);
  await sleep(400);
}

/**
 * فیلد را پایین صفحه (۷۰٪ ارتفاع نما، زیر جایی که کیپد باز می‌شود) می‌گذارد و
 * مرکزش را می‌دهد؛ اگر برنامه پس از ضربه فیلد را بالای کیپد نیاورد، سنجه می‌شکند.
 */
const lowPointOf = (finder) => `(() => {
  const el = ${finder};
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const before = el.getBoundingClientRect();
  const delta = before.top + before.height / 2 - window.innerHeight * 0.7;
  // داخل Bottom Sheet، بدنه‌ی خودِ sheet اسکرول می‌خورد نه صفحه.
  let scroller = null;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) { scroller = p; break; }
  }
  (scroller ?? window).scrollBy(0, delta);
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, hit: hit ? hit.tagName + ' ' + (hit.id || (typeof hit.className === 'string' ? hit.className.slice(0, 60) : '')) : null, label: el.labels?.[0]?.textContent ?? el.id };
})()`;

/** ضربه‌ی لمسی واقعی (touchStart/touchEnd) — همان رویدادهای pointer که انگشت می‌سازد. */
async function tap(cdp, point) {
  const touchPoints = [{ x: point.x, y: point.y, radiusX: 4, radiusY: 4, force: 1, id: 0 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function tapControl(cdp, finder, label) {
  const point = await cdp.eval(centerOf(finder));
  if (!point) throw new Error(`کنترل «${label}» پیدا نشد`);
  await sleep(150);
  await tap(cdp, point);
}

async function typeInto(cdp, selector, text) {
  await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await cdp.send('Input.insertText', { text });
}

async function run() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const server = await createServer({
    root: WEB_ROOT,
    configFile: join(WEB_ROOT, 'vite.config.ts'),
    logLevel: 'error',
    server: { port: 5199, strictPort: false, open: false },
  });
  await server.listen();
  console.log(`… dev server ${server.resolvedUrls.local[0]}`);
  const origin = server.resolvedUrls.local[0].replace(/\/$/u, '');

  const profile = mkdtempSync(join(tmpdir(), 'gold-mobile-audit-'));
  const browser = spawn(
    findBrowser(),
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const results = [];
  let cdp;
  try {
    cdp = await Cdp.connect(await openPage());
    await cdp.send('Page.enable');
    // جادوگرهای فروش و خرید با پیش‌نویس نیمه‌کاره ترک صفحه را با beforeunload
    // می‌پرسند (رفتار درست برنامه)؛ اینجا مثل کاربری که «ترک» را تأیید می‌کند.
    cdp.on('Page.javascriptDialogOpening', () => {
      void cdp.send('Page.handleJavaScriptDialog', { accept: true });
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      ...VIEWPORT,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    // بدون این، صفحه‌ی headless «فوکوس پنجره» ندارد و رویداد focus فیلدها شلیک نمی‌شود.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });

    console.log('… login');
    // ── ورود: هم صفحه‌ی اجباری است، هم نشست بقیه را می‌سازد.
    await navigate(cdp, origin, '/login', 'ورود');
    results.push({ name: 'login', ...(await cdp.eval(MEASURE)), action: await cdp.eval(ACTION_CHECK('ورود')) });
    await screenshot(cdp, 'login');
    await typeInto(cdp, '#login-email', 'owner@example.com');
    await typeInto(cdp, '#login-password', 'password123');
    await typeInto(cdp, '#login-tenant', 'demo');
    await tapControl(cdp, findControl('ورود'), 'ورود');
    await waitFor(cdp, `location.pathname === '/dashboard'`, 'داشبورد پس از ورود', 15_000);

    for (const page of PAGES) {
      console.log(`… ${page.name}`);
      const entry = { name: page.name };
      try {
        await navigate(cdp, origin, page.path, page.ready);
        for (const step of page.steps ?? []) {
          await tapControl(cdp, findControl(step), step);
          await sleep(500);
        }
        Object.assign(entry, await cdp.eval(MEASURE));
        await screenshot(cdp, page.name);
        if (page.action) entry.action = await cdp.eval(ACTION_CHECK(page.action));
        if (page.keypad) {
          const field = await cdp.eval(lowPointOf(FIRST_NUMERIC_FIELD));
          if (field) {
            await sleep(150);
            await tap(cdp, field);
            await sleep(600);
          }
          entry.keypad = await cdp.eval(KEYPAD_CHECK(FIRST_NUMERIC_FIELD));
          await screenshot(cdp, `${page.name}-keypad`);
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
          await sleep(300);
        }
        if (page.sheet) {
          await tapControl(cdp, findControl(page.sheet), page.sheet);
          entry.sheet = await cdp.eval(SHEET_CHECK);
          await screenshot(cdp, `${page.name}-sheet`);
          if (page.sheetKeypad) {
            const field = await cdp.eval(lowPointOf(LAST_NUMERIC_FIELD));
            entry.sheetTap = field;
            if (field) {
              await sleep(150);
              await tap(cdp, field);
              await sleep(600);
            }
            entry.keypad = await cdp.eval(KEYPAD_CHECK(LAST_NUMERIC_FIELD));
            await screenshot(cdp, `${page.name}-sheet-keypad`);
            await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await sleep(300);
          }
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
          await sleep(400);
        }
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
        await screenshot(cdp, `${page.name}-error`).catch(() => undefined);
      }
      results.push(entry);
    }
  } finally {
    cdp?.close();
    browser.kill();
    await server.close();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  /* ── گزارش ── */
  const failures = [];
  for (const entry of results) {
    const problems = [];
    if (entry.error) problems.push(`خطا: ${entry.error}`);
    if (entry.scrollWidth > entry.viewport) problems.push(`overflow افقی: عرض سند ${entry.scrollWidth}px`);
    if (entry.offenderCount > 0) problems.push(`عناصر بیرون‌زده (${entry.offenderCount}): ${entry.offenders.join(' | ')}`);
    if (entry.tables > 0) problems.push(`${entry.tables} جدول دیده‌شده زیر ۶۴۰px`);
    if (entry.action && !entry.action.found) problems.push('اقدام اصلی پیدا نشد');
    if (entry.action?.found && !(entry.action.inViewport && entry.action.unobstructed)) {
      problems.push(`اقدام اصلی در دسترس نیست (پوشیده با ${entry.action.covering ?? '?'})`);
    }
    if (entry.action?.found && entry.action.height < 44) problems.push(`ارتفاع اقدام اصلی ${entry.action.height}px`);
    if (entry.keypad?.found && !entry.keypad.opened) problems.push('کیپد با فوکوس فیلد باز نشد');
    if (entry.keypad?.opened && !entry.keypad.keypadInViewport) problems.push('کیپد بیرون از نما');
    if (entry.keypad?.opened && !entry.keypad.focused) problems.push('فیلد لمس‌شده فوکوس DOM نگرفت');
    if (entry.keypad?.opened && !entry.keypad.fieldVisible) {
      problems.push(`فیلد فعال زیر کیپد پنهان است (پایین فیلد ${entry.keypad.fieldBottom}، بالای کیپد ${entry.keypad.keypadTop})`);
    }
    if (entry.keypad?.opened && entry.keypad.smallestKey < 44) problems.push(`کوچک‌ترین کلید کیپد ${entry.keypad.smallestKey}px`);
    if (entry.sheet && !entry.sheet.open) problems.push('Bottom Sheet باز نشد');
    if (entry.sheet?.open && !(entry.sheet.isSheet && entry.sheet.fullWidth && entry.sheet.onScreen)) {
      problems.push(`Bottom Sheet نادرست (sheet=${entry.sheet.isSheet}، تمام‌عرض=${entry.sheet.fullWidth}، بالا=${entry.sheet.top}px)`);
    }
    const status = problems.length === 0 ? '✔' : '✖';
    console.log(`${status} ${entry.name}`);
    for (const problem of problems) console.log(`    ${problem}`);
    if (problems.length > 0) failures.push(entry.name);
  }
  writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\nscreenshotها و results.json در ${OUT_DIR}`);
  if (failures.length > 0) {
    console.error(`\n✖ ${failures.length} صفحه در ۳۶۰px مشکل دارد.`);
    process.exitCode = 1;
  } else {
    console.log('\n✔ همه‌ی صفحه‌های اجباری در ۳۶۰px سالم‌اند.');
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
