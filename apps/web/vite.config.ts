import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { bundleReport } from './vite-plugins/bundle-report';
import { nonBlockingCss } from './vite-plugins/non-blocking-css';
import { routePreload } from './vite-plugins/route-preload';
import { DEFAULT_API_PROXY_TARGET, resolveApiMode } from './src/lib/api-mode';

const SRC = fileURLToPath(new URL('./src', import.meta.url));

/**
 * `mockServiceWorker.js` را از خروجی production حذف می‌کند.
 *
 * این فایل باید در `public/` بماند چون msw در توسعه آن را از ریشه
 * سرو می‌کند — ولی Vite کل `public/` را کورکورانه در `dist` کپی می‌کند.
 * نتیجه: ۹ کیلوبایت کد ساختگی روی سرور production.
 *
 * `globIgnores` جلوی کش‌شدنش را می‌گیرد؛ این افزونه خود فایل را هم برمی‌دارد.
 */
function stripMockWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'strip-mock-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const target = join(outDir, 'mockServiceWorker.js');
      if (existsSync(target)) {
        rmSync(target);
        this.warn('mockServiceWorker.js از خروجی production حذف شد');
      }
    },
  };
}

/**
 * FE-106a: توسعه با API واقعی (`VITE_API_MODE=real`). API ِ NestJS پیشوند سراسری ندارد
 * (`/sales/invoices`، نه `/api/sales/invoices`)، پس proxy پیشوند `/api` ِ کلاینت را برمی‌دارد.
 * در حالت پیش‌فرض (mock) proxy نیست و MSW در مرورگر پاسخ می‌دهد.
 */
function apiProxy(mode: string): Record<string, ProxyOptions> {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (resolveApiMode(env.VITE_API_MODE) !== 'real') return {};
  return {
    '/api': {
      target: env.VITE_API_PROXY_TARGET?.trim() || DEFAULT_API_PROXY_TARGET,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api(?=\/|$)/u, '') || '/',
    },
  };
}

export default defineConfig(({ command, mode }) => ({
  server: { proxy: apiProxy(mode) },
  /*
   * FE-101: «DevTools logging production» — بیلد production هر `console.*` و `debugger` را حذف
   * می‌کند (کد برنامه و کتابخانه‌ها). ESLint (`no-console`) جلوی نوشتنش را می‌گیرد؛ این تضمین
   * خروجی است، و `scripts/check-no-mocks.mjs` روی همان خروجی وارسی می‌کند. توسعه و تست دست‌نخورده.
   */
  esbuild: command === 'build' ? { drop: ['console', 'debugger'] } : {},

  plugins: [
    react(),
    stripMockWorker(),
    // FE-087: ترکیب بسته (اولیه/تنبل، سهم هر بسته، نسخه‌ی تکراری) → build/bundle-report.json
    bundleReport(),
    // FE-088: CSS اصلی رنگ‌آمیزی پوسته را نگه نمی‌دارد؛ main.tsx پیش از رندر منتظرش می‌ماند
    nonBlockingCss(),
    // FE-088: چانک مسیرِ آدرس بازشده هم‌زمان با بسته‌ی اصلی دانلود می‌شود، نه پس از اجرای آن
    routePreload({
      routerFile: join(SRC, 'app/router.tsx'),
      // همان SESSION_STORAGE_KEY در stores/session-store.ts (تست route-preload برابری را می‌پاید)
      sessionStorageKey: 'gold-ui-session',
      resolveSpecifier: (specifier) => specifier.replace(/^@\//u, `${SRC}/`),
    }),
    VitePWA({
      // FE-090: نسخه‌ی تازه منتظر اجازه‌ی کاربر می‌ماند (SKIP_WAITING از `lib/pwa-update.ts`)؛
      // `autoUpdate` می‌توانست وسط ثبت یک فروش کنترل را عوض کند.
      registerType: 'prompt',
      // FE-088: بدون `registerSW.js` همگام در <head>؛ main.tsx پس از داده‌ی صفحه‌ی اول ثبت می‌کند
      injectRegister: false,
      includeAssets: ['fonts/vazirmatn-fa.woff2', 'icons/*.png', 'icons/*.svg'],
      manifest: {
        // شناسه‌ی پایدار برنامه‌ی نصب‌شده — مستقل از start_url، تا تغییر آن نصب تازه نسازد
        id: '/',
        name: 'حساب طلا',
        short_name: 'حساب طلا',
        description: 'حسابداری طلا و سکه — واحد پایه طلاست، نه ریال',
        lang: 'fa',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#faf9f7',
        theme_color: '#1c1917',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        // سرویس‌ورکر ساختگی هرگز نباید در production کش شود
        globIgnores: ['**/mockServiceWorker.js'],
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        /*
         * FE-090 — آفلاین فقط پوسته: ناوبری آفلاین همان index.html پیش‌کش‌شده را می‌گیرد،
         * ولی `/api` هرگز (نه fallback، نه runtimeCaching): داده‌ی مالی کهنه از کش نشان داده
         * نمی‌شود و نوشتن آفلاین در صف نمی‌رود.
         */
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: {
        // در توسعه سرویس‌ورکر خاموش است تا رفتار HMR گیج‌کننده نشود
        enabled: false,
      },
    }),
  ],

  resolve: {
    alias: {
      '@': SRC,
    },
  },

  build: {
    // BigInt به ES2020 به بالا نیاز دارد
    target: 'es2022',
    cssCodeSplit: true,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        /*
         * FE-088: چانک‌های ریز مشترک (یک آیکون، یک هوک ۵۰۰ بایتی) با چانکی که همیشه همراهشان
         * بار می‌شود ادغام می‌شوند. باز کردن سرد `/sales/new` ۴۱ درخواست جدا می‌خواست؛ روی
         * HTTP/1.1 (۶ اتصال) و RTT بالای 3G هر موج درخواست یک رفت‌وبرگشت است. حالا ۲۲ تا،
         * بسته‌ی اولیه عملاً بی‌تغییر (+۰٫۳KB) و مجموع چانک‌های تنبل کوچک‌تر (سربار کمتر).
         * Rollup فقط چانک‌های بی‌اثر جانبی را ادغام می‌کند، پس ترتیب اجرا عوض نمی‌شود.
         */
        experimentalMinChunkSize: 10_000,
      },
    },
    /*
     * عمداً بدون `manualChunks`.
     *
     * قبلاً یک چانک دستی به نام `echarts` تعریف شده بود، ولی ECharts در
     * بیلد production اصلاً وارد درخت وابستگی نمی‌شود (فقط صفحه‌ی دودِ
     * توسعه از آن استفاده می‌کند). نتیجه یک چانک بود که نامش echarts بود
     * ولی محتوایش React — و چون modulepreload می‌شد، در بسته‌ی اولیه
     * حساب می‌آمد.
     *
     * وقتی گزارش‌ها ساخته شدند، ECharts را با `import()` پویا صدا بزن؛
     * Rollup خودش چانک درست را می‌سازد و نامش هم راست می‌گوید.
     */
  },

  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // تست‌های تعاملی کیپد به‌تنهایی ۱٫۵ تا ۲ ثانیه‌اند؛ از FE-084 ممیزی axe کل برنامه را
    // موازی با آن‌ها رندر می‌کند و زیر بار CPU سقف پیش‌فرض ۵ ثانیه بی‌دلیل می‌شکست.
    testTimeout: 15_000,
    // Vitest به‌طور پیش‌فرض محتوای CSS را خالی برمی‌گرداند؛ تست کنتراست توکن‌ها
    // (FE-084، `styles/contrast.test.ts`) متن خام `globals.css` را با `?raw` می‌خواند.
    css: { include: [/globals\.css/] },
  },
}));
