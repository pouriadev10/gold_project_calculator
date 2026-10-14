#!/usr/bin/env node
/**
 * تست E2E مسیر پایلوت — FE-098.
 *
 * کل مسیر روزانه‌ی پایلوت، از ورود تا PDF، در Chrome واقعی (headless) روی **بیلد production**:
 *
 * ۱. `vite build` (مگر با `--no-build`)؛
 * ۲. سرور production با API ساختگی قراردادمحور (`audit-kit.mjs`: همان handlerهای MSW ِ FE-093 در
 *    Node، با `contractGate` که هر بدنه را با schema ِ `packages/contracts` می‌سنجد)؛
 * ۳. هر نما (۳۶۰px لمسی، و دسکتاپ ۱۴۴۰px با ماوس) با **وضعیت mock تازه** و پروفایل مرورگر تازه از
 *    اول تا آخر اجرا می‌شود — مرحله‌ها به هم وابسته‌اند (شخص ساخته‌شده، فاکتورها و ...).
 *
 * سنجش‌ها:
 * - هر مرحله باید با پیام موفقیت یا داده‌ی سرور تمام شود؛ اولین شکست اجرای آن نما را متوقف می‌کند.
 * - **هیچ درخواست مالی تکراری**: هر نوشتن `Idempotency-Key` دارد، هیچ کلیدی دو بار نیامده، هیچ دو
 *   نوشتنی یک مسیر و بدنه‌ی یکسان ندارند، هر نوشتن ۲xx است و تعداد نوشتن هر endpoint دقیقاً همان
 *   تعداد عملیات منطقی مسیر است.
 * - **screenshotهای حساس**: هر screenshot با متن صفحه و localStorage/sessionStorage همان لحظه
 *   سنجیده می‌شود: رمز و کد ملی کامل فروشنده نه روی صفحه نه در storage (فقط نسخه‌ی پوشانده)، و توکن‌های
 *   نشست هرگز روی صفحه. screenshotها در `apps/web/.e2e/<نما>/` (gitignore) برای مرور دستی می‌مانند.
 * - هر ضربه پیش از اجرا hit-test می‌شود؛ اگر toast روی هدف است مثل کاربر بسته و در گزارش شمرده می‌شود.
 * - کلیدهای فیزیکی با فاصله‌ی `E2E_KEY_INTERVAL_MS` (پیش‌فرض ۵۰ms، تندتر از تایپیست سریع) زده می‌شوند.
 *
 * اجرا: `pnpm --filter @gold/web test:e2e`
 * گزینه‌ها: `--no-build`، `--viewport=mobile|desktop`
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import {
  Cdp,
  launchBrowser,
  loadMockHandlers,
  openTarget,
  pressKey,
  sleep,
  startProdServer,
} from './lib/audit-kit.mjs';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(WEB_ROOT, '.e2e');
const DIST = join(OUT_DIR, 'dist');

/** فاصله‌ی دو کلید فیزیکی (ms) — تایپیست سریع حدود ۸۰ تا ۱۲۰ms؛ پیش‌فرض عمداً تندتر از آن. */
const KEY_INTERVAL_MS = Number.parseInt(process.env.E2E_KEY_INTERVAL_MS ?? '50', 10);

const VIEWPORTS = [
  { name: 'mobile', width: 360, height: 800, mobile: true, port: 9341 },
  { name: 'desktop', width: 1440, height: 900, mobile: false, port: 9342 },
];

/** داده‌ی مسیر — شخص، کالا و فروشنده‌ی تازه، نه fixture. */
const PILOT = {
  email: 'owner@example.com',
  password: 'password123',
  tenant: 'demo',
  mazneh: '485000000',
  partyName: 'سارا پایلوت',
  partyMobile: '09120000098',
  jewelryCode: 'PL-750-01',
  jewelryTitle: 'دستبند پایلوت',
  sellerName: 'رضا فروشنده',
  sellerNationalId: '0084575948',
  coinTypeId: 'd1000000-0000-4000-8000-000000000001',
  coinTitle: 'تمام بهار آزادی',
};

/* ── کمک‌های داخل صفحه ──────────────────────────────────────────── */

const PAGE_HELPERS = `window.__e2e = (() => {
  const visible = (el) => Boolean(el) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const norm = (value) => (value ?? '').replace(/\\s+/g, ' ').trim();
  const dialog = () => [...document.querySelectorAll('[role="dialog"]')].filter(visible).at(-1) ?? null;
  const root = (inDialog) => (inDialog ? dialog() : null) ?? document;
  const names = (el) => [el.getAttribute('aria-label'), el.labels?.[0]?.textContent, el.textContent].map(norm);
  const CONTROLS = 'button, a, [role="button"], [role="radio"], [role="option"], [role="combobox"], [role="tab"], summary';
  function control(name, { prefix = false, inDialog = true } = {}) {
    const match = (value) => (prefix ? value.startsWith(name) : value === name);
    return [...root(inDialog).querySelectorAll(CONTROLS)].find((el) => visible(el) && names(el).some(match)) ?? null;
  }
  function field(label, { inDialog = true, group } = {}) {
    let scope = root(inDialog);
    if (group) scope = [...scope.querySelectorAll('[aria-label]')].find((el) => norm(el.getAttribute('aria-label')) === group) ?? scope;
    return [...scope.querySelectorAll('input, select, textarea')].find(
      (el) => visible(el) && (norm(el.labels?.[0]?.textContent) === label || norm(el.getAttribute('aria-label')) === label),
    ) ?? null;
  }
  function inGroup(group, name) {
    const scope = [...document.querySelectorAll('[role="radiogroup"], [role="group"]')].find(
      (el) => visible(el) && norm(el.getAttribute('aria-label')) === group,
    );
    return scope ? [...scope.querySelectorAll(CONTROLS)].find((el) => visible(el) && names(el).includes(name)) ?? null : null;
  }
  /** مقدار خام (لاتین) اولین عدد مالی داخل کارتی که عنوانش \`title\` است. */
  function amountUnder(title) {
    const heading = [...document.querySelectorAll('h1, h2, h3, [class*="font-semibold"], [class*="CardTitle"]')].find(
      (el) => visible(el) && norm(el.textContent) === title,
    );
    let card = heading;
    while (card && !card.querySelector('[data-raw]')) card = card.parentElement;
    const amount = card?.querySelector('[data-raw]');
    return amount ? { raw: amount.getAttribute('data-raw'), unit: amount.getAttribute('data-unit') } : null;
  }
  const text = () => norm(document.body?.innerText);
  return { visible, dialog, control, field, inGroup, amountUnder, text, norm };
})();`;

const control = (name, options = {}) => `window.__e2e.control(${JSON.stringify(name)}, ${JSON.stringify(options)})`;
const field = (label, options = {}) => `window.__e2e.field(${JSON.stringify(label)}, ${JSON.stringify(options)})`;
const bySelector = (selector) => `document.querySelector(${JSON.stringify(selector)})`;
const inGroup = (group, name) => `window.__e2e.inGroup(${JSON.stringify(group)}, ${JSON.stringify(name)})`;

/** مانده‌ی ریالی کارت «مانده فعلی»/«مانده» به bigint — واحد نمایش باید ریال باشد. */
async function balanceRial(d, title) {
  const amount = await d.eval(`window.__e2e.amountUnder(${JSON.stringify(title)})`);
  if (!amount || amount.unit !== 'rial') throw new Error(`مانده‌ی ریالی «${title}» دیده نشد (${JSON.stringify(amount)})`);
  return BigInt(amount.raw);
}

async function expectBalance(d, title, expected) {
  const deadline = Date.now() + 10_000;
  let actual;
  while (Date.now() < deadline) {
    actual = await balanceRial(d, title).catch(() => undefined);
    if (actual === expected) return;
    await sleep(200);
  }
  throw new Error(`«${title}»: ${actual} — انتظار ${expected}`);
}

/* ── راننده‌ی یک نما ───────────────────────────────────────────── */

class Driver {
  constructor(cdp, viewport, outDir, server) {
    this.cdp = cdp;
    this.viewport = viewport;
    this.outDir = outDir;
    this.server = server;
    this.shots = [];
    /** هر بار که toast روی هدف ضربه افتاد و کاربر باید اول آن را می‌بست. */
    this.toastCovered = [];
  }

  eval(expression) {
    return this.cdp.eval(expression);
  }

  async waitFor(expression, label, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.eval(`Boolean(${expression})`).catch(() => false)) return;
      await sleep(150);
    }
    throw new Error(`منتظر «${label}» ماند و نرسید`);
  }

  waitText(text, timeoutMs = 15_000) {
    return this.waitFor(`window.__e2e && window.__e2e.text().includes(${JSON.stringify(text)})`, text, timeoutMs);
  }

  async idle() {
    await this.waitFor(`!document.querySelector('[aria-label^="در حال دریافت"]')`, 'پایان بارگذاری', 15_000);
    await sleep(300);
  }

  async goto(path, ready) {
    await this.cdp.send('Page.navigate', { url: `${this.server.origin}${path}` });
    await this.waitText(ready, 20_000);
    await this.idle();
  }

  /**
   * مرکز کنترل پس از آوردنش به نما؛ تا ۱۰ ثانیه منتظر پیدا شدن، فعال شدن و **ایستادنش** می‌ماند —
   * Bottom Sheet هنگام باز شدن می‌لغزد و ضربه روی مختصات وسط انیمیشن به جای دیگری می‌خورد.
   */
  async point(finder, label) {
    const deadline = Date.now() + 10_000;
    let previous = null;
    while (Date.now() < deadline) {
      const point = await this.eval(`(() => {
        const el = ${finder};
        if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return null;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      if (point && previous && point.x === previous.x && point.y === previous.y) return point;
      previous = point;
      await sleep(point ? 120 : 150);
    }
    throw new Error(`کنترل «${label}» پیدا یا فعال نشد`);
  }

  /**
   * ضربه‌ی لمسی واقعی روی ۳۶۰px، کلیک ماوس واقعی روی دسکتاپ. پیش از ضربه hit-test می‌شود: اگر toast
   * روی هدف است، مثل کاربر اول بسته می‌شود (و ثبت می‌شود)؛ هر پوشش دیگری خطاست، نه ضربه‌ی کور.
   */
  async click(finder, label) {
    let { x, y } = await this.point(finder, label);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const cover = await this.eval(`(() => {
        const el = ${finder};
        const hit = document.elementFromPoint(${x}, ${y});
        // فیلدهای عددی متن نمایشی را در همان قاب کنار input می‌کشند؛ ضربه روی قاب همان فیلد است
        if (!el || !hit || el === hit || el.contains(hit) || hit.contains(el) || el.parentElement?.contains(hit)) return null;
        const toast = hit.closest('[data-radix-toast-viewport] > li, ol > li[data-state]');
        if (toast) {
          toast.querySelector('[toast-close]')?.click();
          return { toast: true, text: window.__e2e.norm(toast.textContent).slice(0, 60) };
        }
        return { toast: false, text: hit.tagName + ' ' + window.__e2e.norm(hit.textContent).slice(0, 60) };
      })()`);
      if (cover === null) break;
      if (!cover.toast) throw new Error(`«${label}» زیر عنصر دیگری است: ${cover.text}`);
      this.toastCovered.push({ target: label, toast: cover.text });
      await sleep(500);
      ({ x, y } = await this.point(finder, label));
    }
    await sleep(120);
    if (this.viewport.mobile) {
      const touchPoints = [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 0 }];
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints });
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }
    await sleep(250);
  }

  /** ضربه تا فوکوس واقعی؛ اولین فیلد یک sheet در حال باز شدن گاهی ضربه‌ی اول را از دست می‌دهد. */
  async focus(finder, label) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.click(finder, label);
      try {
        await this.waitFor(`document.activeElement === (${finder})`, `فوکوس روی ${label}`, 2_500);
        return;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  }

  /** متن آزاد: فوکوس واقعی با ضربه، سپس ورود متن (مثل کیبورد سیستم). */
  async typeText(finder, label, text) {
    await this.focus(finder, label);
    await this.cdp.send('Input.insertText', { text });
    await sleep(150);
  }

  /** فیلد عددی کیپدی: ضربه، پاک کردن، سپس رقم‌ها با کلید فیزیکی؛ مقدار لاتین ذخیره‌شده سنجیده می‌شود. */
  async typeNumber(finder, label, keys, expected = keys.replace('.', '').replace(/^0+(?=\d)/u, '')) {
    await this.focus(finder, label);
    for (let i = 0; i < 24; i += 1) await pressKey(this.cdp, 'Backspace');
    // فاصله‌ی کلیدها مثل تایپ انسانی سریع؛ کلیدهای پشت‌سرهم میکروثانیه‌ای تایپ واقعی نیستند
    for (const key of keys) {
      await pressKey(this.cdp, key);
      await sleep(KEY_INTERVAL_MS);
    }
    await this.waitFor(`(${finder})?.getAttribute('data-value') === ${JSON.stringify(expected)}`, `${label} = ${expected}`, 5_000);
    // Enter کیپد را می‌بندد (کیپد آن را می‌بلعد)؛ Escape گفت‌وگوی بازِ پشت فیلد را هم می‌بست
    await pressKey(this.cdp, 'Enter');
    await this.waitFor(`document.querySelector('[data-numeric-keypad-root]')?.getAttribute('aria-hidden') === 'true'`, 'بسته شدن کیپد', 5_000);
    await sleep(200);
  }

  /** `<select>` بومی: مقدار با setter بومی و رویداد change — همان چیزی که انتخاب مرورگر می‌کند. */
  async select(finder, label, value) {
    await this.point(finder, label);
    const ok = await this.eval(`(() => {
      const el = ${finder};
      if (!el || ![...el.options].some((o) => o.value === ${JSON.stringify(value)})) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`گزینه‌ی «${value}» در «${label}» نیست`);
    await sleep(200);
  }

  async pickParty(trigger, search, name) {
    await this.click(control(trigger, { inDialog: false }), trigger);
    await this.typeText(field('جست‌وجوی نام یا موبایل'), 'جست‌وجوی شخص', search);
    // جست‌وجو debounce دارد و فهرست «اخیر» را با نتایج جایگزین می‌کند؛ ضربه روی ردیفی که همان لحظه
    // عوض می‌شود گم می‌شود. انتخاب شخص نوشتن نیست، پس یک تلاش دوباره بی‌خطر است.
    await sleep(700);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.click(control(name, { prefix: true }), name);
      try {
        await this.waitFor(`!window.__e2e.dialog()`, 'بسته شدن انتخاب شخص', 3_000);
        return;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
  }

  /**
   * screenshot و سنجش داده‌ی حساس همان لحظه: رمز و کد ملی کامل نه روی صفحه و نه در storage؛ توکن‌های
   * نشست در storage ِ خودِ نشست مجازند ولی هرگز نباید روی صفحه (و در نتیجه در screenshot) بیایند.
   */
  async shot(name) {
    const file = `${String(this.shots.length + 1).padStart(2, '0')}-${name}.png`;
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(this.outDir, file), Buffer.from(data, 'base64'));
    const everywhere = [
      ['رمز عبور', PILOT.password],
      ['کد ملی کامل فروشنده', PILOT.sellerNationalId],
      ['کد ملی کامل فروشنده (ارقام فارسی)', toPersian(PILOT.sellerNationalId)],
    ];
    const exposed = await this.eval(`(() => {
      const page = document.body.innerText;
      const storage = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
      // توکن‌های نشست جاری همان مرورگر (از ورود واقعی مرحله‌ی ۱)
      let live = null;
      try { live = JSON.parse(localStorage.getItem('gold-ui-session'))?.state?.session ?? null; } catch {}
      const onScreen = live ? [['توکن دسترسی', live.accessToken], ['توکن تازه‌سازی', live.refreshToken]].filter(([, t]) => t) : [];
      return [
        ...${JSON.stringify(everywhere)}.filter(([, secret]) => page.includes(secret) || storage.includes(secret)),
        ...onScreen.filter(([, secret]) => page.includes(secret)),
      ].map(([kind]) => kind);
    })()`);
    this.shots.push({ file, exposed });
    if (exposed.length > 0) throw new Error(`داده‌ی حساس در screenshot «${file}»: ${exposed.join('، ')}`);
  }

  /** پاسخ آخرین نوشتن موفق روی `path` (regex) — شناسه‌ی سندی که سرور ساخت. */
  created(pathPattern) {
    const write = [...this.server.requests]
      .reverse()
      .find((r) => r.method !== 'GET' && pathPattern.test(r.path) && r.status >= 200 && r.status < 300);
    if (!write) throw new Error(`نوشتن موفقی روی ${pathPattern} نیست`);
    return JSON.parse(write.response);
  }
}

function toPersian(text) {
  return text.replace(/\d/gu, (d) => '۰۱۲۳۴۵۶۷۸۹'['0123456789'.indexOf(d)]);
}

/* ── مسیر پایلوت ─────────────────────────────────────────────────── */

/** تعداد نوشتن مورد انتظار هر endpoint — هر عملیات منطقی دقیقاً یک بار. */
const EXPECTED_WRITES = {
  'POST /api/auth/login': 1,
  'POST /api/pricing/quotes/manual': 1,
  'POST /api/parties': 2, // مشتری مسیر + فروشنده‌ی خرید دست‌دوم
  'POST /api/inventory/jewelry-items': 1,
  'POST /api/inventory/opening-balances': 1,
  'POST /api/sales/invoices/jewelry': 1,
  'POST /api/sales/invoices/coins': 1,
  'POST /api/parties/:id/settlements/rial': 1,
  'POST /api/parties/:id/settlements/gold': 1,
  'POST /api/purchase/second-hand/gold': 1,
  'POST /api/sales/invoices/:id/b2c-buyback/preview': 1,
  'POST /api/sales/invoices/:id/b2c-buyback': 1,
  'POST /api/sales/invoices/:id/amend': 1,
};

const normalizePath = (path) => path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu, ':id');

const STEPS = [
  {
    name: '۱. ورود',
    async run(d) {
      await d.goto('/login', 'ورود');
      await d.typeText(bySelector('#login-email'), 'ایمیل', PILOT.email);
      await d.typeText(bySelector('#login-password'), 'رمز', PILOT.password);
      await d.typeText(bySelector('#login-tenant'), 'فروشگاه', PILOT.tenant);
      await d.click(control('ورود', { inDialog: false }), 'ورود');
      await d.waitFor(`location.pathname === '/dashboard'`, 'داشبورد پس از ورود', 20_000);
      await d.waitText('آخرین معامله‌ها');
      await d.idle();
      await d.shot('dashboard');
    },
  },
  {
    name: '۲. ثبت مظنه',
    async run(d) {
      await d.goto('/pricing', 'منبع فعال');
      await d.typeNumber(field('مظنه مثقال'), 'مظنه مثقال', PILOT.mazneh);
      await d.click(control('ثبت مظنه'), 'ثبت مظنه');
      await d.click(control('تأیید و ثبت'), 'تأیید و ثبت');
      await d.waitText('مظنه با موفقیت ثبت شد.');
      await d.shot('mazneh');
    },
  },
  {
    name: '۳. ایجاد شخص',
    async run(d, ctx) {
      await d.goto('/parties', 'حسین مرادی');
      await d.click(control('افزودن شخص'), 'افزودن شخص');
      await d.typeText(bySelector('#party-name'), 'نام', PILOT.partyName);
      await d.typeText(bySelector('#party-mobile'), 'موبایل', PILOT.partyMobile);
      await d.click(control('ثبت شخص'), 'ثبت شخص');
      await d.waitFor(`!window.__e2e.dialog()`, 'بسته شدن فرم شخص');
      ctx.party = d.created(/^\/api\/parties$/u);
      await d.waitText(PILOT.partyName);
      await d.shot('party-created');
    },
  },
  {
    name: '۴. ایجاد کالای زیورآلات',
    async run(d, ctx) {
      await d.goto('/inventory/jewelry', 'انگشتر');
      await d.click(control('کالای جدید'), 'کالای جدید');
      await d.typeText(bySelector('#jewelry-code'), 'کد', PILOT.jewelryCode);
      await d.typeText(bySelector('#jewelry-title'), 'عنوان', PILOT.jewelryTitle);
      await d.typeNumber(field('وزن ناخالص'), 'وزن ناخالص', '10.000', '10000');
      await d.typeNumber(field('عیار'), 'عیار', '750');
      await d.select(bySelector('#jewelry-wage-type'), 'نوع اجرت', 'PER_GRAM');
      await d.typeNumber(field('مقدار اجرت'), 'مقدار اجرت', '2000000');
      await d.click(control('ثبت کالا'), 'ثبت کالا');
      await d.waitFor(`!window.__e2e.dialog()`, 'بسته شدن فرم کالا');
      ctx.jewelry = d.created(/^\/api\/inventory\/jewelry-items$/u);
      await d.waitText(PILOT.jewelryTitle);
      await d.shot('jewelry-item');
    },
  },
  {
    name: '۵. ثبت موجودی افتتاحیه',
    async run(d) {
      await d.goto('/inventory/opening-balance', 'وزن آبشده');
      await d.click(control('افزودن کالای زیورآلات', { inDialog: false }), 'افزودن کالای زیورآلات');
      await d.typeText(field('جست‌وجوی کد یا عنوان'), 'جست‌وجوی کالا', PILOT.jewelryCode);
      await d.click(control(PILOT.jewelryTitle, { prefix: true }), PILOT.jewelryTitle);
      await d.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await d.waitFor(`!window.__e2e.dialog()`, 'بسته شدن انتخاب کالا');
      await d.typeNumber(field('وزن آبشده (طلای خالص ۱۰۰۰)'), 'وزن آبشده', '100.000', '100000');
      await d.typeNumber(field(PILOT.coinTitle), PILOT.coinTitle, '5');
      await d.typeText(bySelector('#opening-balance-description'), 'توضیحات', 'موجودی آغاز پایلوت');
      await d.click(control('مرور و ثبت موجودی افتتاحیه'), 'مرور و ثبت');
      await d.click(control('تأیید و ثبت'), 'تأیید و ثبت');
      await d.waitText('موجودی افتتاحیه با موفقیت ثبت شد.');
      await d.shot('opening-balance');
    },
  },
  {
    name: '۶. فروش نقدی زیورآلات',
    async run(d, ctx) {
      await d.goto('/sales/new', 'منبع: ');
      await d.click(control('بعدی'), 'بعدی');
      await d.pickParty('مشتری', 'سارا', PILOT.partyName);
      await d.click(control('بعدی'), 'بعدی');
      await d.click(control('افزودن کالا'), 'افزودن کالا');
      await d.typeText(field('جست‌وجوی کد یا عنوان'), 'جست‌وجوی کالا', PILOT.jewelryCode);
      await d.click(control(PILOT.jewelryTitle, { prefix: true }), PILOT.jewelryTitle);
      await d.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await d.waitFor(`!window.__e2e.dialog()`, 'بسته شدن انتخاب کالا');
      await d.click(control(`ویرایش قیمت ${PILOT.jewelryTitle}`), 'ویرایش قیمت');
      await d.click(control('ذخیره'), 'ذخیره');
      await d.waitFor(`!window.__e2e.dialog()`, 'بسته شدن قیمت‌گذاری');
      await d.click(control('بعدی'), 'بعدی');
      await d.click(control('بعدی'), 'بعدی');
      await d.click(control('پرداخت کامل'), 'پرداخت کامل');
      await d.click(control('ثبت فروش'), 'ثبت فروش');
      await d.waitText('رسید فروش', 20_000);
      ctx.jewelrySale = d.created(/^\/api\/sales\/invoices\/jewelry$/u);
      await d.idle();
      await d.shot('jewelry-sale-receipt');
    },
  },
  {
    name: '۷. فروش نسیه سکه',
    async run(d, ctx) {
      await d.goto('/sales/coins/new', 'نوع سکه');
      await d.pickParty('مشتری', 'سارا', PILOT.partyName);
      await d.select(bySelector('#coin-sale-type'), 'نوع سکه', PILOT.coinTypeId);
      await d.typeNumber(field('تعداد'), 'تعداد', '2');
      await d.typeNumber(field('قیمت واحد بازار'), 'قیمت واحد بازار', '400000000');
      await d.typeNumber(field('مبلغ پرداختی'), 'مبلغ پرداختی', '300000000');
      await d.click(control('ثبت فروش'), 'ثبت فروش');
      await d.waitFor(`/فاکتور شماره .* ثبت شد/.test(window.__e2e.text())`, 'رسید فروش سکه', 20_000);
      ctx.coinSale = d.created(/^\/api\/sales\/invoices\/coins$/u);
      await d.shot('coin-credit-sale');
    },
  },
  {
    name: '۸. تسویه بخشی با ریال',
    async run(d, ctx) {
      await d.goto(`/parties/${ctx.party.id}/settlements/new`, 'مانده فعلی');
      // کلید سراسری واحد: از اینجا اعداد ریالی دیده و سنجیده می‌شوند (انتخاب کاربر، ماندگار)
      await d.click(inGroup('واحد نمایش اعداد', 'ریال'), 'واحد ریال');
      // طلب از فروش نسیه‌ی سکه: ۲ × ۴۰۰٬۰۰۰٬۰۰۰ − ۳۰۰٬۰۰۰٬۰۰۰ (فروش زیورآلات نقدی بود)
      ctx.balance = 500_000_000n;
      await expectBalance(d, 'مانده فعلی', ctx.balance);
      await d.click(inGroup('روش پرداخت', 'ریال'), 'روش ریال');
      await d.typeNumber(field('مبلغ'), 'مبلغ', '100000000');
      await d.click(control('ثبت پرداخت'), 'ثبت پرداخت');
      await d.waitFor(`window.__e2e.control('پرداخت ریالی جدید')`, 'ثبت پرداخت ریالی', 20_000);
      ctx.balance -= 100_000_000n;
      await expectBalance(d, 'مانده فعلی', ctx.balance);
      await d.shot('rial-settlement');
    },
  },
  {
    name: '۹. تسویه بخشی با طلا',
    async run(d, ctx) {
      await d.goto(`/parties/${ctx.party.id}/settlements/new`, 'مانده فعلی');
      await expectBalance(d, 'مانده فعلی', ctx.balance);
      await d.click(inGroup('روش پرداخت', 'طلا'), 'روش طلا');
      await d.typeNumber(field('وزن'), 'وزن', '2.000', '2000');
      await d.typeNumber(field('عیار'), 'عیار', '750');
      await d.click(control('ثبت پرداخت'), 'ثبت پرداخت');
      await d.waitFor(`window.__e2e.control('پرداخت طلای جدید')`, 'ثبت پرداخت طلا', 20_000);
      // ارزش ریالی طلای دریافتی را سرور با نرخ قفل‌شده حساب کرده — از پاسخ خودش
      ctx.balance -= BigInt(d.created(/^\/api\/parties\/[^/]+\/settlements\/gold$/u).settledRial);
      await expectBalance(d, 'مانده فعلی', ctx.balance);
      await d.shot('gold-settlement');
    },
  },
  {
    name: '۱۰. خرید طلای دست‌دوم',
    async run(d, ctx) {
      await d.goto('/purchase/second-hand', 'فروشنده');
      // فروشنده‌ی تازه با کد ملی — هویت فقط پوشانده نمایش داده می‌شود
      await d.click(control('فروشنده', { inDialog: false }), 'فروشنده');
      await d.click(control('ایجاد شخص جدید'), 'ایجاد شخص جدید');
      await d.typeText(bySelector('#party-name'), 'نام فروشنده', PILOT.sellerName);
      await d.typeText(bySelector('#party-national-id'), 'کد ملی', PILOT.sellerNationalId);
      await d.click(control('ثبت شخص'), 'ثبت شخص');
      await d.waitFor(`!window.__e2e.dialog()`, 'بسته شدن فرم فروشنده');
      await d.waitText(PILOT.sellerName);
      await d.shot('seller-identity');
      await d.click(control('بعدی'), 'بعدی');
      await d.typeNumber(field('وزن کل (ناخالص)'), 'وزن کل', '5.000', '5000');
      await d.click(control('بعدی'), 'بعدی');
      await d.typeNumber(field('وزن نگین'), 'وزن نگین', '0.200', '200');
      await d.click(control('بعدی'), 'بعدی');
      await d.waitFor(field('عیار خرید'), 'عیار خرید');
      await d.click(control('بعدی'), 'بعدی');
      await d.click(control('بعدی'), 'بعدی');
      await d.click(control('بعدی'), 'بعدی');
      await d.click(control('پرداخت کامل'), 'پرداخت کامل');
      await d.click(control('ثبت خرید'), 'ثبت خرید');
      await d.waitText('خرید ثبت شد', 20_000);
      ctx.purchase = d.created(/^\/api\/purchase\/second-hand\/gold$/u);
      await d.shot('purchase-receipt');
    },
  },
  {
    name: '۱۱. Buyback B2C',
    async run(d, ctx) {
      await d.goto(`/sales/invoices/${ctx.jewelrySale.invoiceId}/b2c-buyback`, 'اندازه‌گیری امروز');
      await d.typeNumber(field('وزن ناخالص'), 'وزن ناخالص', '10.000', '10000');
      await d.click(control('نمایش مقایسه'), 'نمایش مقایسه');
      await d.waitText('مقایسه‌ی خرید اولیه و خرید امروز', 20_000);
      await d.shot('buyback-comparison');
      await d.click(control('پرداخت کامل'), 'پرداخت کامل');
      await d.click(control('ثبت سند خرید جدید'), 'ثبت سند خرید جدید');
      await d.waitText('خرید طلای دست‌دوم ثبت شد', 20_000);
      await d.waitText('فاکتور فروش مرجع بدون تغییر باقی مانده است');
      await d.shot('buyback-receipt');
    },
  },
  {
    name: '۱۲. اصلاح فاکتور',
    async run(d, ctx) {
      await d.goto(`/sales/invoices/${ctx.coinSale.invoiceId}`, 'جزئیات فاکتور');
      await d.click(control('اصلاح فاکتور', { prefix: true }), 'اصلاح فاکتور');
      await d.waitText('شمارهٔ فاکتور تغییر نمی‌کند');
      await d.typeNumber(field('قیمت واحد بازار'), 'قیمت واحد بازار', '400000000');
      await d.typeNumber(field('مبلغ پرداختی اصلاح‌شده'), 'پرداخت اصلاح‌شده', '350000000');
      await d.select(bySelector('#amend-reason'), 'دلیل اصلاح', 'PAYMENT_ERROR');
      await d.click(control('ثبت اصلاح فاکتور'), 'ثبت اصلاح فاکتور');
      await d.waitText('نسخهٔ جدید ثبت شد', 20_000);
      await d.idle();
      await d.shot('amendment');
    },
  },
  {
    name: '۱۳. مشاهده مانده',
    async run(d, ctx) {
      await d.goto(`/parties/${ctx.party.id}`, PILOT.partyName);
      // اصلاح فاکتور سکه پرداخت را ۳۰۰ → ۳۵۰ میلیون کرد؛ خرید مجدد کامل پرداخت شد (اثری ندارد)
      ctx.balance -= 50_000_000n;
      await d.waitText('مانده');
      // مقدار لاتین `data-raw` کنار «مانده اصلی» ریال — مستقل از قالب‌بندی فارسی
      await d.waitFor(
        `document.querySelector('[data-unit="rial"][data-raw="${ctx.balance}"]')`,
        `مانده‌ی ${ctx.balance} ریال روی صفحه‌ی شخص`,
      );
      await d.shot('party-balance');
    },
  },
  {
    name: '۱۴. مشاهده صورت‌حساب',
    async run(d, ctx) {
      await d.goto(`/parties/${ctx.party.id}/statement`, `صورت‌حساب ${PILOT.partyName}`);
      await d.shot('statement');
    },
  },
  {
    name: '۱۵. مشاهده بدهکاران',
    async run(d) {
      await d.goto('/reporting/debtors', 'بدهکاران');
      await d.waitText(PILOT.partyName);
      await d.shot('debtors');
    },
  },
  {
    name: '۱۶. مشاهده سود',
    async run(d) {
      await d.goto('/reporting/profit', 'گزارش سود');
      await d.shot('profit');
    },
  },
  {
    name: '۱۷. دریافت PDF',
    async run(d, ctx) {
      await d.goto(`/sales/invoices/${ctx.jewelrySale.invoiceId}`, 'جزئیات فاکتور');
      const before = d.server.requests.length;
      await d.click(control('دریافت PDF'), 'دریافت PDF');
      const deadline = Date.now() + 15_000;
      let pdfRequest;
      while (!pdfRequest && Date.now() < deadline) {
        pdfRequest = d.server.requests.slice(before).find((r) => r.path.endsWith('/pdf'));
        if (!pdfRequest) await sleep(150);
      }
      if (!pdfRequest || pdfRequest.status !== 200) throw new Error(`PDF دریافت نشد (${pdfRequest?.status})`);
      const file = await waitForDownload(join(d.outDir, 'downloads')).catch(async (error) => {
        const notice = await d.eval(`window.__e2e.text().slice(window.__e2e.text().indexOf('دریافت PDF') - 200, window.__e2e.text().indexOf('دریافت PDF') + 300)`);
        throw new Error(`${error.message} — رویدادها: ${JSON.stringify(d.downloads)} — صفحه: ${notice}`);
      });
      const head = readFileSync(file).subarray(0, 5).toString('latin1');
      if (head !== '%PDF-') throw new Error(`فایل دریافتی PDF نیست (${head})`);
      await d.shot('pdf');
    },
  },
];

async function waitForDownload(dir) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const files = readdirSync(dir).filter((name) => !name.endsWith('.crdownload'));
    if (files.length > 0) return join(dir, files[0]);
    await sleep(200);
  }
  throw new Error('فایل PDF دانلود نشد');
}

/* ── تکرار درخواست مالی ─────────────────────────────────────────── */

function duplicateProblems(requests) {
  const writes = requests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD' && r.path.startsWith('/api/'));
  const problems = [];
  const keys = new Map();
  const bodies = new Map();
  const counts = {};
  for (const write of writes) {
    const route = `${write.method} ${normalizePath(write.path)}`;
    counts[route] = (counts[route] ?? 0) + 1;
    if (write.status < 200 || write.status >= 300) problems.push(`${route} ← ${write.status}`);
    if (!write.idempotencyKey && route !== 'POST /api/auth/login') problems.push(`${route} بدون Idempotency-Key`);
    if (write.idempotencyKey) {
      if (keys.has(write.idempotencyKey)) problems.push(`کلید تکراری روی ${route} و ${keys.get(write.idempotencyKey)}`);
      keys.set(write.idempotencyKey, route);
    }
    const signature = `${write.method} ${write.path} ${write.body}`;
    if (bodies.has(signature)) problems.push(`بدنه‌ی تکراری روی ${route}`);
    bodies.set(signature, true);
  }
  for (const route of new Set([...Object.keys(counts), ...Object.keys(EXPECTED_WRITES)])) {
    if ((counts[route] ?? 0) !== (EXPECTED_WRITES[route] ?? 0)) {
      problems.push(`${route}: ${counts[route] ?? 0} نوشتن، انتظار ${EXPECTED_WRITES[route] ?? 0}`);
    }
  }
  return { problems, counts, writes: writes.length };
}

/* ── اجرا ─────────────────────────────────────────────────────── */

async function runViewport(viewport) {
  const outDir = join(OUT_DIR, viewport.name);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'downloads'), { recursive: true });

  // وضعیت mock تازه برای هر نما — مسیر روی داده‌ی تمیز از اول اجرا می‌شود.
  const mocks = await loadMockHandlers(WEB_ROOT);
  const server = await startProdServer({ dist: DIST, mocks });
  const browser = launchBrowser(viewport.port, `gold-e2e-${viewport.name}-`);
  const results = [];
  let driver;
  let cdp;
  let browserCdp;
  try {
    cdp = await Cdp.connect(await openTarget(viewport.port));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    cdp.on('Page.javascriptDialogOpening', () => {
      void cdp.send('Page.handleJavaScriptDialog', { accept: true });
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPERS });
    // دانلود در headless فقط با سیاست هدفِ خودِ مرورگر (نه صفحه) مجاز می‌شود
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${viewport.port}/json/version`)).json();
    browserCdp = await Cdp.connect(webSocketDebuggerUrl);
    await browserCdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: join(outDir, 'downloads'),
      eventsEnabled: true,
    });
    const downloads = [];
    browserCdp.on('Browser.downloadWillBegin', (event) => downloads.push({ begin: event.suggestedFilename }));
    browserCdp.on('Browser.downloadProgress', (event) => downloads.push({ state: event.state }));
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.mobile ? 2 : 1,
      mobile: viewport.mobile,
    });
    if (viewport.mobile) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });

    driver = new Driver(cdp, viewport, outDir, server);
    driver.downloads = downloads;
    const ctx = {};
    for (const step of STEPS) {
      const started = Date.now();
      try {
        await step.run(driver, ctx);
        results.push({ step: step.name, ok: true, ms: Date.now() - started });
        console.log(`  ✔ ${step.name} (${Date.now() - started}ms)`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ step: step.name, ok: false, error: message });
        console.log(`  ✖ ${step.name} — ${message}`);
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }).catch(() => ({ data: '' }));
        if (data) writeFileSync(join(outDir, 'error.png'), Buffer.from(data, 'base64'));
        const text = await cdp.eval('document.body ? document.body.innerText : ""').catch(() => '');
        const url = await cdp.eval('location.href').catch(() => '');
        writeFileSync(join(outDir, 'error.txt'), `${step.name}\n${message}\n${url}\n\n${text}`);
        break;
      }
    }
  } finally {
    cdp?.close();
    browserCdp?.close();
    // Chrome گاهی پوشه‌ی پروفایل را چند لحظه پس از بسته شدن نگه می‌دارد؛ نتیجه‌ی تست به آن وابسته نیست.
    await browser.close().catch(() => undefined);
    await server.close();
    await mocks.close();
  }

  const duplicates = duplicateProblems(server.requests);
  const completed = results.length === STEPS.length && results.every((r) => r.ok);
  writeFileSync(
    join(outDir, 'results.json'),
    JSON.stringify({ viewport, results, shots: driver?.shots ?? [], toastCovered: driver?.toastCovered ?? [], duplicates }, null, 2),
  );
  return { viewport, results, completed, duplicates, shots: driver?.shots ?? [], toastCovered: driver?.toastCovered ?? [] };
}

async function run() {
  const only = process.argv.find((arg) => arg.startsWith('--viewport='))?.split('=')[1];
  const viewports = VIEWPORTS.filter((v) => !only || v.name === only);
  mkdirSync(OUT_DIR, { recursive: true });
  if (!process.argv.includes('--no-build')) {
    console.log('… vite build (production)');
    await build({
      root: WEB_ROOT,
      configFile: join(WEB_ROOT, 'vite.config.ts'),
      logLevel: 'error',
      build: { outDir: DIST, emptyOutDir: true },
    });
  }

  let failed = false;
  for (const viewport of viewports) {
    console.log(`\n▶ ${viewport.name} (${viewport.width}×${viewport.height}${viewport.mobile ? '، لمسی' : '، ماوس'})`);
    const outcome = await runViewport(viewport);
    console.log(`  نوشتن‌ها: ${outcome.duplicates.writes}`);
    for (const problem of outcome.duplicates.problems) console.log(`  ✖ تکرار/ناهمخوانی: ${problem}`);
    console.log(`  screenshotها: ${outcome.shots.length} — داده‌ی حساس دیده‌نشده`);
    for (const cover of outcome.toastCovered) console.log(`  ⚠ toast روی «${cover.target}» بود و بسته شد: ${cover.toast}`);
    if (!outcome.completed || outcome.duplicates.problems.length > 0) failed = true;
  }

  if (failed) {
    console.error('\n✖ مسیر پایلوت سبز نیست.');
    process.exitCode = 1;
  } else {
    console.log(`\n✔ مسیر پایلوت (۱۷ مرحله) روی ${viewports.map((v) => v.name).join(' و ')} سبز است. screenshotها در ${OUT_DIR}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
