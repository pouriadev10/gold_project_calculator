#!/usr/bin/env node
/**
 * ممیزی LCP روی 3G شبیه‌سازی‌شده — FE-088.
 *
 * هدف CLAUDE.md §6: «LCP روی 3G شبیه‌سازی‌شده زیر ۲٫۵ ثانیه». این اسکریپت بدون
 * وابستگی تازه همان را روی **بیلد production** می‌سنجد:
 *
 * ۱. `vite build` (بدون دروازه‌ی اندازه؛ آن کار `pnpm build` است)؛
 * ۲. یک سرور Node که `dist/` را مثل سرور واقعی سرو می‌کند (gzip، کش immutable برای
 *    فایل‌های hashدار، بازگشت SPA به index.html) و `/api/*` را با همان handlerهای MSW
 *    توسعه پاسخ می‌دهد — handlerها از راه `ssrLoadModule` خودِ Vite در Node اجرا
 *    می‌شوند، پس داده‌ی ممیزی همان داده‌ی توسعه است؛
 * ۳. Lighthouse (همان نسخه‌ای که `@lhci/cli` در CI به کار می‌برد) با throttling
 *    شبیه‌سازی‌شده‌ی پیش‌فرض موبایل: RTT ۵۶۲٫۵ms، ۱٫۴۷Mbps، CPU ×۴ — یعنی پروفایل
 *    «Fast 3G»ی DevTools — روی نمای ۳۶۰px؛
 * ۴. هر سناریو چند بار با پروفایل مرورگر تازه (کش سرد، بدون سرویس‌ورکر) اجرا و میانه
 *    گزارش می‌شود. میانه‌ی LCP یک سناریوی دروازه بالای بودجه کد خروج ۱ می‌دهد؛
 * ۵. پس از هر اجرا، همان صفحه یک بار هم با throttling «اعمال‌شده» روی Chrome واقعی باز
 *    می‌شود: عددی مستقل از مدل Lantern، و نام عنصر LCP.
 *
 * سناریوی «واردشده» نشست را پیش از اجرا در localStorage می‌گذارد — از صفحه‌ای جدا
 * (`/__lcp-seed`) که هیچ asset یا سرویس‌ورکری بار نمی‌کند تا کش سرد بماند.
 *
 * اجرا: `pnpm --filter @gold/web audit:lcp`
 * گزینه‌ها: `--runs=N` (پیش‌فرض ۳)، `--only=<ابتدای نام سناریو>`، `--no-build`، `--profile=real3g`؛
 * `LCP_AUDIT_DEBUG=1` گزارش کامل Lighthouse هر سناریو را در `.lcp-audit/` می‌نویسد.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, createServer as createViteServer } from 'vite';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB_ROOT, 'dist');
const OUT_DIR = join(WEB_ROOT, '.lcp-audit');
const LCP_BUDGET_MS = 2500;
const DEBUG_PORT = 9334;
const SESSION_STORAGE_KEY = 'gold-ui-session';
const RUNS = Number.parseInt(process.argv.find((arg) => arg.startsWith('--runs='))?.slice(7) ?? '3', 10);
const ONLY = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/**
 * سناریوها: باز کردن سرد برنامه. دو نقطه‌ی ورود واقعی (`start_url` = `/` برای کاربرِ
 * واردشده که به داشبورد می‌رود، و همان آدرس برای کاربرِ خارج‌شده که به ورود می‌رود)
 * دروازه‌اند. لینک عمیق به یک جادوگر سنگین فقط گزارش می‌شود — مسیر عادی رسیدن به آن
 * ناوبری درون‌برنامه است، نه باز کردن سرد.
 */
const SCENARIOS = [
  { name: 'dashboard (واردشده)', path: '/', session: true, gate: true },
  { name: 'login (خارج‌شده)', path: '/', session: false, gate: true },
  { name: 'sales/new (لینک عمیق، گزارشی)', path: '/sales/new', session: true, gate: false },
];

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lighthouse وابستگی مستقیم وب نیست؛ همان نسخه‌ی داخل `@lhci/cli` (pnpm سخت‌گیر است). */
async function loadLighthouse() {
  const require = createRequire(import.meta.url);
  const lhciDir = realpathSync(join(require.resolve('@lhci/cli/package.json'), '..'));
  const lighthousePath = createRequire(join(lhciDir, 'package.json')).resolve('lighthouse');
  return (await import(pathToFileURL(lighthousePath).href)).default;
}

function findBrowser() {
  const path = BROWSERS.find((candidate) => existsSync(candidate));
  if (!path) throw new Error('Chrome یا Edge پیدا نشد');
  return path;
}

/* ── سرور production + API ساختگی ───────────────────────────────── */

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

async function startServer(handlers, getResponse) {
  const gzCache = new Map();
  let seedSession = null;

  // handlerها مسیر نسبی دارند ('/api/...')؛ در Node باید مبدأ را صریح داد.
  async function callApi(method, url, headers, body) {
    const request = new Request(url, { method, headers, body: body?.length ? body : undefined });
    return getResponse(handlers, request, { baseUrl: new URL(url).origin });
  }

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
        const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string'));
        const response = await callApi(req.method, url.href, headers, body);
        if (!response) {
          send(req, res, 404, { 'content-type': MIME['.json'], compressible: true }, Buffer.from('{"code":"NOT_FOUND"}'));
          return;
        }
        const out = Buffer.from(await response.arrayBuffer());
        const outHeaders = Object.fromEntries(response.headers.entries());
        delete outHeaders['content-length'];
        send(req, res, response.status, { ...outHeaders, 'cache-control': 'no-store', compressible: true }, out);
        return;
      }

      if (url.pathname === '/__lcp-seed') {
        const value = JSON.stringify(JSON.stringify({ state: { session: seedSession }, version: 0 }));
        const html = `<!doctype html><script>localStorage.setItem(${JSON.stringify(SESSION_STORAGE_KEY)}, ${value});document.title='seeded'</script>`;
        send(req, res, 200, { 'content-type': MIME['.html'] }, Buffer.from(html));
        return;
      }

      let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
      if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
        file = join(DIST, 'index.html');
      }
      const ext = extname(file);
      const hashed = file.includes(`${join(DIST, 'assets')}`);
      let body = gzCache.get(file) ?? readFileSync(file);
      gzCache.set(file, body);
      send(
        req,
        res,
        200,
        {
          'content-type': MIME[ext] ?? 'application/octet-stream',
          'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
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
  seedSession = await login.json();

  return { origin, close: () => new Promise((resolve) => server.close(resolve)) };
}

/* ── Chrome و Lighthouse ─────────────────────────────────────────── */

async function waitForDevTools() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (response.ok) return;
    } catch {
      // مرورگر هنوز بالا نیامده
    }
    await sleep(200);
  }
  throw new Error('اتصال DevTools برقرار نشد');
}

async function seedSession(origin) {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${origin}/__lcp-seed`, { method: 'PUT' });
  const target = await response.json();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    if (targets.some((t) => t.id === target.id && t.title === 'seeded')) break;
    await sleep(100);
  }
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${target.id}`);
}

/** کلاینت تک‌منظوره‌ی DevTools Protocol روی WebSocket خودِ Node. */
async function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  return {
    send(method, params = {}) {
      id += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close: () => socket.close(),
  };
}

/**
 * سنجش دوم با throttling «اعمال‌شده» (نه شبیه‌سازی) — همان پروفایل شبکه و CPU، روی
 * Chrome واقعی. دو کار می‌کند: عنصر LCP را نام می‌برد (Lighthouse 12.1 با Chrome
 * تازه در TraceElements می‌شکند) و یک عدد مستقل از مدل Lantern می‌دهد.
 */
const LCP_PROBE = `new Promise((resolve) => {
  let last = null;
  new PerformanceObserver((list) => { last = list.getEntries().at(-1); })
    .observe({ type: 'largest-contentful-paint', buffered: true });
  setTimeout(() => {
    const el = last?.element;
    const label = el ? el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : '') : '(حذف‌شده از DOM)';
    resolve({ lcp: last?.startTime ?? null, size: last?.size ?? null, element: label + ' «' + (el?.textContent ?? '').trim().slice(0, 40) + '»' });
  }, 500);
})`;

async function probeAppliedThrottling(origin, scenario) {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
  const target = await response.json();
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  try {
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      // همان اعداد throttling «devtools» که Lighthouse برای هر پروفایل به کار می‌برد
      latency: REAL_3G ? 1125 : 562.5,
      downloadThroughput: ((REAL_3G ? 630 : 1474.56) * 1024) / 8,
      uploadThroughput: ((REAL_3G ? 630 : 675) * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
    // اجرای Lighthouse پرچم «فونت در کش است» را گذاشته؛ این سنجش هم باید بار اول باشد.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.removeItem('gold-font-cached')" });
    await cdp.send('Page.navigate', { url: `${origin}${scenario.path}` });
    await sleep(9000);
    const { result } = await cdp.send('Runtime.evaluate', { expression: LCP_PROBE, awaitPromise: true, returnByValue: true });
    return result.value;
  } finally {
    cdp.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${target.id}`);
  }
}

/**
 * `--profile=real3g`: همان ردیف «3G واقعی» در PERFORMANCE.md (۷۰۰kbps، RTT ۳۰۰ms، CPU ×۴) —
 * فقط گزارشی، چون آستانه‌ی ۲٫۵ ثانیه‌ی LCP با پروفایل پیش‌فرض تعریف شده است.
 */
const REAL_3G = process.argv.includes('--profile=real3g');

const LH_CONFIG = {
  extends: 'lighthouse:default',
  settings: {
    onlyCategories: ['performance'],
    formFactor: 'mobile',
    screenEmulation: { mobile: true, width: 360, height: 780, deviceScaleFactor: 2, disabled: false },
    // پیش‌فرض موبایل Lighthouse = DevTools «Fast 3G» (RTT ۵۶۲٫۵ms، ۱۴۷۴kbps) + CPU ×۴
    throttlingMethod: 'simulate',
    ...(REAL_3G && {
      throttling: {
        rttMs: 300,
        throughputKbps: 700,
        requestLatencyMs: 300 * 3.75,
        downloadThroughputKbps: 700 * 0.9,
        uploadThroughputKbps: 700 * 0.9,
        cpuSlowdownMultiplier: 4,
      },
    }),
  },
};

async function runOnce(lighthouse, origin, scenario) {
  const profile = mkdtempSync(join(tmpdir(), 'gold-lcp-audit-'));
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
  try {
    await waitForDevTools();
    if (scenario.session) await seedSession(origin);
    const result = await lighthouse(
      `${origin}${scenario.path}`,
      { port: DEBUG_PORT, logLevel: 'error', output: 'json', disableStorageReset: true },
      LH_CONFIG,
    );
    const { audits } = result.lhr;
    if (process.env.LCP_AUDIT_DEBUG) writeFileSync(join(OUT_DIR, `${scenario.name.split(' ')[0].replace(/\W/gu, '_')}-lhr.json`), JSON.stringify(result.lhr, null, 1));
    const requests = audits['network-requests']?.details?.items ?? [];
    const applied = await probeAppliedThrottling(origin, scenario);
    return {
      lcp: audits['largest-contentful-paint'].numericValue,
      fcp: audits['first-contentful-paint'].numericValue,
      tbt: audits['total-blocking-time'].numericValue,
      cls: audits['cumulative-layout-shift'].numericValue,
      score: result.lhr.categories.performance.score,
      appliedLcp: applied.lcp,
      lcpElement: applied.element,
      finalUrl: result.lhr.finalDisplayedUrl,
      requests: requests.map((r) => `${r.resourceType ?? '?'} ${new URL(r.url).pathname} ${r.transferSize ?? 0}B`),
      runtimeError: result.lhr.runtimeError?.message,
    };
  } finally {
    browser.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

// اندیس میانی با شیفت بیتی (عدد صحیح)، نه گرد کردن — تعداد زوج میانه‌ی بالایی را می‌دهد
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];
// فقط برای چاپ گزارش زمان‌ها؛ هیچ مقدار مالی یا وزنی اینجا نیست.
const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, useGrouping: false });
const THREE = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const ms = (value) => `${WHOLE.format(value)}ms`;

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });

  if (!process.argv.includes('--no-build')) {
    console.log('… vite build');
    await build({ root: WEB_ROOT, configFile: join(WEB_ROOT, 'vite.config.ts'), logLevel: 'error' });
  }

  const vite = await createViteServer({
    root: WEB_ROOT,
    configFile: join(WEB_ROOT, 'vite.config.ts'),
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  const { handlers } = await vite.ssrLoadModule('/src/mocks/handlers/index.ts');
  const { getResponse } = await import('msw');
  const server = await startServer(handlers, getResponse);
  const lighthouse = await loadLighthouse();
  console.log(`… سرور production ${server.origin} — ${RUNS} اجرا برای هر سناریو\n`);

  const report = [];
  try {
    for (const scenario of SCENARIOS.filter((s) => !ONLY || s.name.startsWith(ONLY))) {
      const runs = [];
      for (let i = 0; i < RUNS; i += 1) {
        const outcome = await runOnce(lighthouse, server.origin, scenario);
        if (outcome.runtimeError) throw new Error(`${scenario.name}: ${outcome.runtimeError}`);
        runs.push(outcome);
        console.log(`  ${scenario.name} #${i + 1}: LCP ${ms(outcome.lcp)}  FCP ${ms(outcome.fcp)}  اعمال‌شده ${ms(outcome.appliedLcp ?? 0)}  → ${outcome.finalUrl}`);
      }
      const typical = runs.find((r) => r.lcp === median(runs.map((x) => x.lcp)));
      report.push({
        scenario: scenario.name,
        gate: scenario.gate,
        lcp: median(runs.map((r) => r.lcp)),
        fcp: median(runs.map((r) => r.fcp)),
        tbt: median(runs.map((r) => r.tbt)),
        cls: median(runs.map((r) => r.cls)),
        score: median(runs.map((r) => r.score)),
        appliedLcp: median(runs.map((r) => r.appliedLcp ?? Infinity)),
        lcpElement: typical.lcpElement,
        requests: typical.requests,
      });
    }
  } finally {
    await server.close();
    await vite.close();
  }

  console.log(`\nمیانه‌ها (Lighthouse، ${REAL_3G ? '3G واقعی ۷۰۰kbps/RTT ۳۰۰ms' : '3G شبیه‌سازی‌شده'}، ۳۶۰px، CPU ×۴):\n`);
  const failures = [];
  for (const entry of report) {
    const ok = entry.lcp <= LCP_BUDGET_MS;
    if (!ok && entry.gate) failures.push(entry.scenario);
    console.log(`${ok ? '✔' : entry.gate ? '✖' : '⚠'} ${entry.scenario}`);
    console.log(`    LCP ${ms(entry.lcp)}  FCP ${ms(entry.fcp)}  TBT ${ms(entry.tbt)}  CLS ${THREE.format(entry.cls)}  امتیاز ${entry.score}`);
    console.log(`    LCP با throttling اعمال‌شده (Chrome واقعی): ${ms(entry.appliedLcp)}`);
    console.log(`    عنصر LCP: ${entry.lcpElement}`);
    console.log(`    درخواست‌ها (${entry.requests.length}): ${entry.requests.join(' | ')}`);
  }
  writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(report, null, 2));
  console.log(`\nresults.json در ${OUT_DIR}`);
  if (REAL_3G) {
    console.log('\nپروفایل real3g فقط گزارشی است؛ دروازه با پروفایل پیش‌فرض سنجیده می‌شود.');
  } else if (failures.length > 0) {
    console.error(`\n✖ LCP بالای ${LCP_BUDGET_MS}ms: ${failures.join('، ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\n✔ LCP نقطه‌های ورود زیر ${LCP_BUDGET_MS}ms است.`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
