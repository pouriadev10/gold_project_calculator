#!/usr/bin/env node
/**
 * ممیزی INP — FE-089.
 *
 * هدف CLAUDE.md §6: «INP زیر ۲۰۰ms». INP سنجه‌ی میدانی است؛ این اسکریپت نزدیک‌ترین
 * تقریب آزمایشگاهی را بدون وابستگی تازه می‌سازد:
 *
 * ۱. بیلد production در `.inp-audit/dist` — بدون minify تا نام کامپوننت‌ها و توابع در
 *    پروفایل خوانا بماند (React همچنان در حالت production است)؛
 * ۲. همان سرور LCP (FE-088): `dist` با gzip و `/api/*` با handlerهای MSW در Node. با
 *    `--large` هر پاسخ صفحه‌بندی‌شده تا `limit` پر و `total` بزرگ می‌شود — یعنی صفحه‌ی
 *    کامل یک فروشگاه پرکار، نه فهرستی که سرور واقعی هرگز نمی‌فرستد؛
 * ۳. Chrome headless از راه DevTools Protocol، نمای ۳۶۰px لمسی، **CPU ×۴** (تقریب
 *    اندروید میان‌رده)، ضربه‌ی لمسی و کلید واقعی (رویداد trusted، همان که Event Timing
 *    می‌شمارد)؛
 * ۴. برای هر تعامل: مدت Event Timing (تأخیر ورودی + پردازش + تا رنگ بعدی)، تعداد
 *    کامپوننت‌های رندرشده (هوک commit همان رابطی که React DevTools به کار می‌برد) و
 *    برای هر سناریو پروفایل CPU (پرهزینه‌ترین توابع بر اساس زمان خود).
 *
 * INP هر سناریو = بدترین تعامل آن (با کمتر از ۵۰ تعامل، صدک ۹۸ همان بیشینه است).
 * تعامل بالای ۲۰۰ms کد خروج ۱ می‌دهد.
 *
 * اجرا: `pnpm --filter @gold/web audit:inp`
 * گزینه‌ها: `--no-build`، `--only=<نام سناریو>`، `--large` (پیش‌فرض روشن؛ `--no-large`)،
 *   `--cpu=N` (پیش‌فرض ۴).
 * مرورگر: Chrome/Edge نصب‌شده، یا `CHROME_PATH` (و `CHROME_FLAGS` برای پرچم‌های اضافه،
 * مثلاً `--no-sandbox` در کانتینر).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import {
  Cdp,
  findControl,
  launchBrowser,
  loadMockHandlers,
  openTarget,
  pressKey,
  seedSessionScript,
  sleep,
  startProdServer,
  tapFinder,
  waitFor,
} from './lib/audit-kit.mjs';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(WEB_ROOT, '.inp-audit');
const DIST = join(OUT_DIR, 'dist');
const INP_BUDGET_MS = 200;
const DEBUG_PORT = 9335;
const VIEWPORT = { width: 360, height: 800 };
const PARTY_ID = 'a1000000-0000-4000-8000-000000000001';
const ONLY = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);
const LARGE = !process.argv.includes('--no-large');
const CPU_RATE = Number.parseInt(process.argv.find((arg) => arg.startsWith('--cpu='))?.slice(6) ?? '4', 10);
/** صفحه‌ی کامل در حالت `--large`: total = limit × این عدد. */
const LARGE_PAGES = 25;


// فقط برای چاپ زمان‌ها؛ هیچ مقدار مالی یا وزنی اینجا نیست.
const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, useGrouping: false });
const ms = (value) => `${WHOLE.format(value)}ms`;

/**
 * `--large`: هر صفحه‌ی پاسخ صفحه‌بندی‌شده (`items` + `total` + `limit`) کامل است — `limit`
 * ردیف با `offset` درخواستی و `total` بزرگ. ردیف‌ها رونوشت صفحه‌ی اول داده‌ی ساختگی‌اند
 * (صفحه‌های بعدی داده‌ی ساختگی خالی‌اند) با `id` تازه تا کلید React یکتا بماند؛ شکل‌شان
 * همان قرارداد zod است.
 */
function inflatePage(json, template) {
  if (!json || !Array.isArray(template?.items) || typeof json.limit !== 'number' || template.items.length === 0) return json;
  const items = [];
  for (let i = 0; items.length < json.limit; i += 1) {
    const copy = structuredClone(template.items[i % template.items.length]);
    if (typeof copy.id === 'string') copy.id = crypto.randomUUID();
    items.push(copy);
  }
  return { ...json, items, total: Math.max(json.total ?? 0, json.limit * LARGE_PAGES) };
}

/** `--large`: هر GET صفحه‌بندی‌شده از صفحه‌ی اول داده‌ی ساختگی کامل می‌شود. */
async function inflateTransform({ url, method, ok, body, callApi, headers }) {
  if (method !== 'GET' || !ok || !url.searchParams.has('limit')) return body;
  const firstPageUrl = new URL(url);
  firstPageUrl.searchParams.set('offset', '0');
  const firstPage = await callApi('GET', firstPageUrl.href, headers);
  const template = firstPage?.ok ? await firstPage.json() : null;
  return Buffer.from(JSON.stringify(inflatePage(JSON.parse(body.toString('utf8')), template)));
}

/* ── ابزار درون صفحه: Event Timing + هوک commit ری‌اکت ─────────────── */

/**
 * پیش از هر اسکریپت صفحه اجرا می‌شود. هوک `__REACT_DEVTOOLS_GLOBAL_HOOK__` همان رابطی
 * است که React DevTools استفاده می‌کند؛ React حتی در production هر commit را به آن خبر
 * می‌دهد. کامپوننتی «رندر شده» است که تازه mount شده یا در این commit پرچم
 * PerformedWork دارد — و زیردرختی که `child`ش با نسخه‌ی قبلی یکی است اصلاً دیده نمی‌شود
 * (همان منطق DevTools، تا پرچم کهنه‌ی fiberهای bail-out شمرده نشود).
 */
const INSTRUMENT = `(() => {
  const state = { events: [], commits: [] };
  window.__inpAudit = state;
  const describe = (node) => {
    if (!node || node.nodeType !== 1) return '';
    const label = node.getAttribute('aria-label') || node.getAttribute('id') || (node.textContent || '').trim().slice(0, 30);
    return node.tagName.toLowerCase() + (label ? ' «' + label + '»' : '');
  };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (!e.interactionId) continue;
      state.events.push({
        name: e.name, id: e.interactionId, start: e.startTime, duration: e.duration,
        delay: e.processingStart - e.startTime,
        processing: e.processingEnd - e.processingStart,
        presentation: e.startTime + e.duration - e.processingEnd,
        target: describe(e.target),
      });
    }
  }).observe({ type: 'event', durationThreshold: 16, buffered: true });

  const COMPONENT_TAGS = new Set([0, 1, 11, 15]); // Function، Class، ForwardRef، SimpleMemo
  const nameOf = (fiber) => {
    const type = fiber.type;
    if (!type) return 'Anonymous';
    return type.displayName || type.name || type.render?.displayName || type.render?.name || 'Anonymous';
  };
  const walk = (next, prev, counts) => {
    if (COMPONENT_TAGS.has(next.tag) && (prev === null || (next.flags & 1) === 1)) {
      const name = nameOf(next);
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    if (prev !== null && next.child === prev.child) return;
    for (let child = next.child; child; child = child.sibling) {
      walk(child, prev === null ? null : child.alternate, counts);
    }
  };
  let rendererId = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(renderer) { rendererId += 1; this.renderers.set(rendererId, renderer); return rendererId; },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      try {
        const counts = new Map();
        walk(root.current, root.current.alternate, counts);
        let total = 0;
        for (const value of counts.values()) total += value;
        state.commits.push({ t: performance.now(), total, counts: [...counts.entries()] });
      } catch {
        // ممیزی هرگز نباید برنامه را بشکند
      }
    },
  };
})()`;

/* ── یافتن و راندن کنترل‌ها ───────────────────────────────────────── */

/** پایان بارگذاری‌های پس از یک تعامل (اسکلت‌ها `aria-label="در حال دریافت…"` دارند). */
const settle = (cdp) =>
  waitFor(cdp, `!document.querySelector('[aria-label^="در حال دریافت"]')`, 'پایان بارگذاری', 15_000).catch(() => undefined);

/* ── سناریوها ───────────────────────────────────────────────────── */

const tap = (name, opts) => ({ label: `ضربه: ${name}`, run: (cdp) => tapFinder(cdp, findControl(name, opts), name) });
const tapCss = (label, selector) => ({
  label,
  run: (cdp) => tapFinder(cdp, `document.querySelector(${JSON.stringify(selector)})`, label),
});
const keypad = (digit) => tap(`رقم ${digit}`);
const typeKey = (key) => ({ label: `کلید: ${key}`, run: (cdp) => pressKey(cdp, key) });
const typeText = (text) => [...text].map((ch) => typeKey(ch));

/**
 * تمرکزهای FE-089: کیپد، فرم فروش، فهرست‌های بزرگ، جست‌وجو، mutationها، نمودار — و
 * کلید سراسری طلا/ریال که همه‌ی اعداد صفحه را دوباره قالب می‌زند.
 */
const SCENARIOS = [
  {
    name: 'keypad',
    focus: 'کیپد',
    path: '/sales/coins/new',
    ready: 'نوع سکه',
    steps: [tap('تعداد'), keypad('۲'), keypad('۵'), keypad('۰'), tap('حذف یک رقم', { prefix: true }), tap('تمام')],
  },
  {
    name: 'coin-sale-form',
    focus: 'فرم فروش + mutation',
    path: '/sales/coins/new',
    ready: 'نوع سکه',
    steps: [
      tap('انتخاب شخص', { prefix: true }),
      tapCss('فوکوس جست‌وجوی شخص', 'input[aria-label="جست‌وجوی نام یا موبایل"]'),
      ...typeText('حسین'),
      tapCss('انتخاب اولین شخص', '[role="option"]'),
      tap('تعداد'),
      keypad('۱'),
      tap('قیمت واحد بازار'),
      ...['۵', '۰', '۰', '۰', '۰', '۰', '۰', '۰', '۰'].map(keypad),
      tap('مبلغ پرداختی'),
      keypad('۰'),
      tap('تمام'),
      tap('ثبت فروش'),
    ],
  },
  {
    name: 'jewelry-sale-wizard',
    focus: 'فرم فروش',
    path: '/sales/new',
    ready: 'منبع: ',
    steps: [tap('بعدی')],
  },
  {
    name: 'party-search',
    focus: 'جست‌وجو + فهرست',
    path: '/parties',
    ready: 'حسین مرادی',
    steps: [tapCss('فوکوس جست‌وجو', 'input[type="search"]'), ...typeText('مرادی'), typeKey('Backspace'), typeKey('Backspace')],
  },
  {
    name: 'invoice-list',
    focus: 'فهرست بزرگ',
    path: '/sales/invoices',
    ready: 'صفحه',
    steps: [tap('بعدی'), tap('بعدی'), tap('قبلی'), tap('ریال'), tap('طلا')],
  },
  {
    name: 'party-statement',
    focus: 'فهرست بزرگ',
    path: `/parties/${PARTY_ID}/statement`,
    ready: 'صفحه',
    steps: [tap('بعدی'), tap('بعدی'), tap('ریال'), tap('طلا')],
  },
  {
    name: 'debtors-report',
    focus: 'فهرست بزرگ + کلید واحد',
    path: '/reporting/debtors',
    ready: 'حسین مرادی',
    steps: [tap('ریال'), tap('طلا')],
  },
  {
    name: 'dashboard-unit',
    focus: 'کلید واحد',
    path: '/dashboard',
    ready: 'آخرین معامله‌ها',
    // هر سناریو با «طلا» (پیش‌فرض) تمام می‌شود؛ واحد تنظیم سراسری ماندگار است.
    steps: [tap('ریال'), tap('طلا')],
  },
  {
    name: 'manual-quote',
    focus: 'mutation',
    path: '/pricing',
    ready: 'ثبت مظنه',
    steps: [
      tap('مظنه مثقال'),
      ...['۴', '۹', '۰', '۰', '۰', '۰', '۰', '۰', '۰'].map(keypad),
      tap('تمام'),
      tap('ثبت مظنه'),
      tap('تأیید و ثبت'),
    ],
  },
  {
    name: 'profit-chart',
    focus: 'نمودار',
    path: '/reporting/profit',
    ready: 'گزارش سود',
    // بازه‌ی پیش‌فرض «این ماه» در داده‌ی ساختگی سودی ندارد؛ «کل دوره» روند شش‌ماهه را می‌کشد.
    setup: [tap('پاک کردن تاریخ')],
    steps: [tapCss('ضربه روی نمودار', 'canvas'), tap('ریال'), tap('طلا')],
  },
];

/* ── اجرای یک سناریو ──────────────────────────────────────────────── */

/** خلاصه‌ی Event Timing و commitهای بعد از `since` — یک تعامل = یک interactionId. */
const COLLECT = (since) => `(() => {
  const s = window.__inpAudit;
  const events = s.events.filter((e) => e.start >= ${since});
  const byId = new Map();
  for (const e of events) {
    const prev = byId.get(e.id);
    if (!prev || e.duration > prev.duration) byId.set(e.id, e);
  }
  const commits = s.commits.filter((c) => c.t >= ${since});
  const counts = new Map();
  for (const c of commits) for (const [name, n] of c.counts) counts.set(name, (counts.get(name) || 0) + n);
  return {
    interactions: [...byId.values()],
    commits: commits.length,
    rendered: commits.reduce((sum, c) => sum + c.total, 0),
    topComponents: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
  };
})()`;

/** پرهزینه‌ترین توابع بر اساس زمان خود (self time) در پروفایل CPU. */
function hotFunctions(profile, limit = 10) {
  const byNode = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map();
  const deltas = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i += 1) {
    const node = byNode.get(profile.samples[i]);
    const dt = (deltas[i + 1] ?? 0) / 1000;
    const frame = node.callFrame;
    if (['(idle)', '(program)', '(root)'].includes(frame.functionName)) continue;
    const file = frame.url ? frame.url.split('/').pop().replace(/\?.*$/u, '') : '';
    const key = `${frame.functionName || '(anonymous)'} ${file}${file ? `:${frame.lineNumber + 1}` : ''}`;
    self.set(key, (self.get(key) ?? 0) + dt);
  }
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

async function runScenario(cdp, origin, scenario) {
  await cdp.send('Page.navigate', { url: `${origin}${scenario.path}` });
  await waitFor(cdp, `document.body && document.body.innerText.includes(${JSON.stringify(scenario.ready)})`, scenario.ready, 30_000);
  await waitFor(cdp, `!document.querySelector('[aria-label^="در حال دریافت"]')`, 'پایان بارگذاری', 30_000);
  await sleep(800);
  for (const step of scenario.setup ?? []) {
    await step.run(cdp);
    await sleep(1500);
  }

  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  const steps = [];
  let error = null;
  for (const step of scenario.steps) {
    const since = await cdp.eval('performance.now()');
    try {
      await step.run(cdp);
    } catch (caught) {
      error = `${step.label}: ${caught instanceof Error ? caught.message : String(caught)}`;
      break;
    }
    // تا رنگ بعدی، پاسخ شبکه‌ی mutation و commitهای پس از آن برسند
    await sleep(step.label.startsWith('کلید') ? 250 : 700);
    await settle(cdp);
    const collected = await cdp.eval(COLLECT(since));
    const worst = collected.interactions.reduce((a, b) => (b.duration > (a?.duration ?? -1) ? b : a), null);
    steps.push({ label: step.label, worst, interactions: collected.interactions.length, ...collected });
  }
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.send('Profiler.disable');
  return { steps, error, hot: hotFunctions(profile) };
}

/* ── اجرا ──────────────────────────────────────────────────────────── */

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  if (!process.argv.includes('--no-build')) {
    console.log('… vite build (production، بدون minify برای نام‌های خوانا)');
    await build({
      root: WEB_ROOT,
      configFile: join(WEB_ROOT, 'vite.config.ts'),
      logLevel: 'error',
      build: { outDir: DIST, emptyOutDir: true, minify: false },
    });
  }

  const mocks = await loadMockHandlers(WEB_ROOT);
  const server = await startProdServer({ dist: DIST, mocks, transformApi: LARGE ? inflateTransform : undefined });
  console.log(`… سرور production ${server.origin} — CPU ×${CPU_RATE}، ۳۶۰px لمسی${LARGE ? '، صفحه‌های کامل (--large)' : ''}\n`);
  const browser = launchBrowser(DEBUG_PORT, 'gold-inp-audit-');

  const report = [];
  let cdp;
  try {
    cdp = await Cdp.connect(await openTarget(DEBUG_PORT));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: seedSessionScript(server.session) });
    // جادوگرها با پیش‌نویس نیمه‌کاره ترک صفحه را می‌پرسند؛ مثل کاربری که «ترک» را تأیید می‌کند.
    cdp.on('Page.javascriptDialogOpening', () => {
      void cdp.send('Page.handleJavaScriptDialog', { accept: true });
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });

    for (const scenario of SCENARIOS.filter((s) => !ONLY || s.name === ONLY)) {
      console.log(`… ${scenario.name} (${scenario.focus})`);
      try {
        report.push({ scenario: scenario.name, focus: scenario.focus, ...(await runScenario(cdp, server.origin, scenario)) });
      } catch (error) {
        report.push({ scenario: scenario.name, focus: scenario.focus, steps: [], hot: [], error: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    cdp?.close();
    await browser.close();
    await server.close();
    await mocks.close();
  }

  /* ── گزارش ── */
  const failures = [];
  let overall = 0;
  console.log(`\nنتیجه (CPU ×${CPU_RATE}، بودجه‌ی هر تعامل ${INP_BUDGET_MS}ms):\n`);
  for (const entry of report) {
    const measured = entry.steps.filter((s) => s.worst);
    const inp = measured.reduce((max, s) => Math.max(max, s.worst.duration), 0);
    overall = Math.max(overall, inp);
    const over = inp > INP_BUDGET_MS;
    if (over || entry.error) failures.push(entry.scenario);
    console.log(`${over || entry.error ? '✖' : '✔'} ${entry.scenario} — INP ${ms(inp)} (${measured.length}/${entry.steps.length} تعامل سنجیده)`);
    if (entry.error) console.log(`    خطا: ${entry.error}`);
    for (const step of entry.steps) {
      const w = step.worst;
      const timing = w
        ? `${ms(w.duration)} = تأخیر ${ms(w.delay)} + پردازش ${ms(w.processing)} + رنگ ${ms(w.presentation)}`
        : '(زیر ۱۶ms)';
      const top = step.topComponents.slice(0, 4).map(([name, n]) => `${name}×${n}`).join(' ');
      console.log(`    ${step.label.padEnd(26)} ${timing.padEnd(48)} commit ${step.commits}، رندر ${step.rendered}${top ? ` — ${top}` : ''}`);
    }
    if (entry.hot.length > 0) {
      console.log(`    داغ‌ترین توابع: ${entry.hot.slice(0, 5).map(([name, t]) => `${name} ${ms(t)}`).join(' | ')}`);
    }
  }
  writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(report, null, 2));
  console.log(`\nبدترین تعامل کل: ${ms(overall)} — results.json در ${OUT_DIR}`);
  if (failures.length > 0) {
    console.error(`\n✖ سناریوهای بالای ${INP_BUDGET_MS}ms یا ناتمام: ${failures.join('، ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\n✔ همه‌ی تعامل‌ها زیر ${INP_BUDGET_MS}ms.`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
