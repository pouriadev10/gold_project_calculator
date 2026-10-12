#!/usr/bin/env node
/**
 * ممیزی PWA پایه فاز ۱ — FE-090.
 *
 * معیارهای «تمام است وقتی» را تا جایی که بدون دستگاه واقعی ممکن است، روی بیلد production
 * و Chrome headless می‌سنجد (بدون وابستگی تازه؛ سرور و DevTools از `lib/audit-kit.mjs`):
 *
 * ۱. **installable** — همان بررسی خودِ Chrome برای نصب (`Page.getInstallabilityErrors`)،
 *    manifest بدون خطا، و آیکون‌های ۱۹۲/۵۱۲/maskable که واقعاً PNG با همان اندازه‌اند؛
 * ۲. **پوسته‌ی آفلاین** — سرویس‌ورکر صفحه را کنترل می‌کند؛ سرور کاملاً قطع (هر اتصال
 *    بی‌پاسخ بسته می‌شود) و مرورگر آفلاین؛ ناوبری مستقیم به یک صفحه همان پوسته‌ی پیش‌کش‌شده
 *    را می‌آورد و **پیام واضح** آفلاین دیده می‌شود؛
 * ۳. **عملیات مالی آفلاین غیرفعال** — دکمه‌ی «ثبت مظنه» غیرفعال با دلیل؛ و یک نوشتن
 *    غیرمالی (ثبت شخص) که دکمه‌اش فعال مانده، پیام آفلاین می‌گیرد و **هیچ درخواستی** حتی
 *    تلاش هم نمی‌شود؛
 * ۴. **بدون صف آفلاین** — پس از وصل شدن دوباره، هیچ نوشتنی خودکار فرستاده نمی‌شود؛
 * ۵. **اعلان به‌روزرسانی** — نسخه‌ی تازه‌ی سرویس‌ورکر نصب و منتظر می‌ماند، صفحه خودکار
 *    بارگذاری نمی‌شود، اعلان دیده می‌شود و فقط «به‌روزرسانی» آن را فعال و صفحه را بارگذاری می‌کند.
 *
 * نصب واقعی روی گوشی اندروید همچنان آزمون دستی FE-086 است؛ این ممیزی همان شرط‌هایی را
 * می‌سنجد که Chrome برای نشان دادن «نصب برنامه» بررسی می‌کند.
 *
 * اجرا: `pnpm --filter @gold/web audit:pwa` (`--no-build` برای بیلد قبلی)
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
  seedSessionScript,
  sleep,
  startProdServer,
  tapFinder,
  waitFor,
} from './lib/audit-kit.mjs';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(WEB_ROOT, '.pwa-audit');
const DIST = join(OUT_DIR, 'dist');
const DEBUG_PORT = 9336;
const OFFLINE_TEXT = 'اتصال اینترنت قطع است.';
const UPDATE_TEXT = 'نسخه‌ی تازه‌ی برنامه آماده است';

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const pageHasText = (text) => `document.body && document.body.innerText.includes(${JSON.stringify(text)})`;

async function navigate(cdp, url, ready) {
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, pageHasText(ready), ready, 30_000);
}

async function setOffline(cdp, server, offline) {
  server.setOutage(offline);
  await cdp.send('Network.emulateNetworkConditions', {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
}

/** هر آیکون manifest: پاسخ ۲۰۰، PNG، و اندازه‌ی واقعی تصویر همان `sizes`. */
const ICON_CHECK = (icons) => `Promise.all(${JSON.stringify(icons)}.map(async (icon) => {
  const response = await fetch(icon.src, { cache: 'no-store' });
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  return { src: icon.src, purpose: icon.purpose ?? 'any', ok: response.ok, type: blob.type, size: bitmap.width + 'x' + bitmap.height, declared: icon.sizes };
}))`;

async function run() {
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

  const mocks = await loadMockHandlers(WEB_ROOT);
  const server = await startProdServer({ dist: DIST, mocks });
  const browser = launchBrowser(DEBUG_PORT, 'gold-pwa-audit-');
  console.log(`… سرور production ${server.origin}\n`);

  let cdp;
  try {
    cdp = await Cdp.connect(await openTarget(DEBUG_PORT));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    cdp.on('Page.javascriptDialogOpening', () => {
      void cdp.send('Page.handleJavaScriptDialog', { accept: true });
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: seedSessionScript(server.session) });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });

    /* ── ۱. installable ── */
    await navigate(cdp, `${server.origin}/dashboard`, 'آخرین معامله‌ها');
    // ثبت سرویس‌ورکر عمداً پس از بالا آمدن است (FE-088)
    // `activated`، نه فقط وجود `active` — ناوبری در حالت activating کنترل نمی‌شد
    await waitFor(
      cdp,
      `navigator.serviceWorker.getRegistration().then((r) => r?.active?.state === 'activated')`,
      'فعال شدن سرویس‌ورکر',
      45_000,
    );

    const manifest = await cdp.send('Page.getAppManifest');
    check('manifest بدون خطا', manifest.errors.length === 0, manifest.errors.map((e) => e.message).join('؛ '));
    const data = JSON.parse(manifest.data ?? '{}');
    check(
      'manifest: نام، standalone، start_url، id، rtl/fa',
      data.name === 'حساب طلا' && data.display === 'standalone' && data.start_url === '/' && data.id === '/' && data.dir === 'rtl' && data.lang === 'fa',
      `${data.name} · ${data.display} · start_url=${data.start_url} · id=${data.id}`,
    );

    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    check(
      'installable (بررسی خودِ Chrome برای «نصب برنامه»)',
      installabilityErrors.length === 0,
      installabilityErrors.map((e) => e.errorId).join('، ') || 'بدون خطا',
    );

    const icons = await cdp.eval(ICON_CHECK(data.icons ?? []));
    const iconsOk =
      icons.length > 0 &&
      icons.every((icon) => icon.ok && icon.type === 'image/png' && icon.size === icon.declared) &&
      ['192x192', '512x512'].every((size) => icons.some((icon) => icon.size === size && icon.purpose === 'any')) &&
      icons.some((icon) => icon.purpose === 'maskable');
    check('آیکون‌ها: ۱۹۲ و ۵۱۲ و maskable، PNG با اندازه‌ی اعلام‌شده', iconsOk, icons.map((i) => `${i.size} ${i.purpose}`).join('، '));

    /* ── ۲. پوسته‌ی آفلاین ── */
    /*
     * ناوبری به آدرسی دیگر، نه `Page.reload` یا همان آدرس (در Chrome headless بارگذاری دوباره
     * سرویس‌ورکر را دور می‌زند). اولین ناوبری درست پس از فعال شدن هم گاهی هنوز کنترل نمی‌شود؛
     * برای کاربر یعنی فقط اولین صفحه پس از نصب از شبکه می‌آید. تا پنج ناوبری صبر می‌شود.
     */
    let controlled = false;
    for (let attempt = 0; attempt < 5 && !controlled; attempt += 1) {
      await navigate(cdp, `${server.origin}/${attempt % 2 === 0 ? 'parties' : 'inventory'}`, attempt % 2 === 0 ? 'افزودن شخص' : 'موجودی');
      controlled = await cdp.eval('navigator.serviceWorker.controller !== null');
      if (!controlled) await sleep(1500);
    }
    check('سرویس‌ورکر صفحه را کنترل می‌کند', controlled);
    if (!controlled) throw new Error('صفحه پس از پنج ناوبری هم کنترل نشد');

    const requestsBeforeOffline = server.requests.length;
    await setOffline(cdp, server, true);
    await navigate(cdp, `${server.origin}/pricing`, OFFLINE_TEXT);
    const offlineShell = await cdp.eval(`({ title: document.title, banner: document.querySelector('[role="status"]')?.innerText ?? '' })`);
    check('بدون اینترنت پوسته از کش می‌آید (ناوبری مستقیم به /pricing)', offlineShell.title === 'حساب طلا', offlineShell.title);
    check('قطع اینترنت پیام واضح می‌دهد', offlineShell.banner.includes('ثبت معامله و هر عملیات مالی تا وصل شدن غیرفعال است'), offlineShell.banner.split('\n')[0]);

    /* ── ۳. عملیات مالی آفلاین غیرفعال ── */
    await waitFor(cdp, findControl('ثبت مظنه'), 'دکمه‌ی ثبت مظنه', 20_000);
    const quoteButton = await cdp.eval(`(${findControl('ثبت مظنه')})?.disabled ?? null`);
    check('«ثبت مظنه» آفلاین غیرفعال است و دلیلش نوشته شده', quoteButton === true && (await cdp.eval(pageHasText('ثبت تا وصل شدن غیرفعال است'))));

    await navigate(cdp, `${server.origin}/parties`, 'افزودن شخص');
    await tapFinder(cdp, findControl('افزودن شخص'), 'افزودن شخص');
    await waitFor(cdp, `document.querySelector('#party-name')`, 'فرم ثبت شخص', 15_000);
    // Bottom Sheet با انیمیشن بالا می‌آید؛ ضربه با مختصات پیش از پایانش جای دیگری می‌خورد
    await sleep(900);
    await cdp.eval(`document.querySelector('#party-name').focus()`);
    await cdp.send('Input.insertText', { text: 'آزمون آفلاین' });
    await waitFor(cdp, `document.querySelector('#party-name').value === 'آزمون آفلاین'`, 'تایپ نام', 5_000);
    await tapFinder(cdp, findControl('ثبت شخص'), 'ثبت شخص');
    await waitFor(cdp, pageHasText('چیزی برای ارسال بعدی نگه داشته نمی‌شود'), 'پیام خطای آفلاین فرم', 15_000);
    const writeAttempts = server.requests.slice(requestsBeforeOffline).filter((r) => r.method !== 'GET' && r.path.startsWith('/api/'));
    check('نوشتن آفلاین پیام صریح می‌گیرد و هیچ درخواستی حتی تلاش نمی‌شود', writeAttempts.length === 0, `${writeAttempts.length} تلاش نوشتن`);

    /* ── ۴. بدون صف آفلاین ── */
    await setOffline(cdp, server, false);
    await waitFor(cdp, `!(${pageHasText(OFFLINE_TEXT)})`, 'رفتن پیام آفلاین', 15_000);
    await sleep(4000);
    const replayed = server.requests.slice(requestsBeforeOffline).filter((r) => r.method !== 'GET' && r.path.startsWith('/api/'));
    check('پس از وصل شدن هیچ نوشتنی خودکار فرستاده نمی‌شود (صف آفلاین وجود ندارد)', replayed.length === 0, replayed.map((r) => `${r.method} ${r.path}`).join('، ') || 'صفر');

    /* ── ۵. اعلان به‌روزرسانی ── */
    await navigate(cdp, `${server.origin}/dashboard`, 'آخرین معامله‌ها');
    await cdp.eval('window.__pwaAuditMark = 1');
    server.bumpServiceWorker();
    await cdp.eval('navigator.serviceWorker.getRegistration().then((r) => r.update())');
    await waitFor(cdp, pageHasText(UPDATE_TEXT), 'اعلان نسخه‌ی تازه', 45_000);
    await sleep(2000);
    check('نسخه‌ی تازه منتظر می‌ماند و صفحه خودکار بارگذاری نمی‌شود', (await cdp.eval('window.__pwaAuditMark')) === 1);
    await tapFinder(cdp, findControl('به‌روزرسانی'), 'به‌روزرسانی');
    await waitFor(cdp, 'window.__pwaAuditMark === undefined && document.readyState === "complete"', 'بارگذاری دوباره پس از به‌روزرسانی', 30_000);
    await waitFor(cdp, pageHasText('آخرین معامله‌ها'), 'داشبورد پس از به‌روزرسانی', 30_000);
    const afterUpdate = await cdp.eval(
      `navigator.serviceWorker.getRegistration().then((r) => ({ waiting: Boolean(r && r.waiting), banner: document.body.innerText.includes(${JSON.stringify(UPDATE_TEXT)}) }))`,
    );
    check('«به‌روزرسانی» نسخه‌ی تازه را فعال و صفحه را یک بار بارگذاری می‌کند', !afterUpdate.waiting && !afterUpdate.banner);
  } catch (error) {
    // متن دیده‌شده‌ی گفت‌وگو (یا صفحه) هنگام شکست — بدون آن علت را فقط حدس می‌زدیم
    const seen = await cdp
      ?.eval(`(([...document.querySelectorAll('[role="dialog"]')].find((d) => d.getClientRects().length > 0) ?? document.body).innerText ?? '').replace(/\\s+/g, ' ').slice(0, 400)`)
      .catch(() => '');
    check('اجرای ممیزی', false, `${error instanceof Error ? error.message : String(error)}${seen ? ` — دیده‌شده: ${seen}` : ''}`);
  } finally {
    cdp?.close();
    await browser.close();
    await server.close();
    await mocks.close();
  }

  writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(checks, null, 2));
  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    console.error(`\n✖ ${failed.length} از ${checks.length} بررسی PWA شکست خورد.`);
    process.exitCode = 1;
  } else {
    console.log(`\n✔ همه‌ی ${checks.length} بررسی PWA سبز است.`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
