# `@gold/web` — راهنمای اجرای فرانت

فرانت PWA ِ موبایل‌فرست حسابداری طلا (React 18 + Vite). معماری و «چرا»ها در
[`docs/frontend-architecture.md`](../../docs/frontend-architecture.md) است؛ این فایل فقط می‌گوید **چطور اجرایش کنی**.
همه‌ی دستورها از **ریشه‌ی مخزن** اجرا می‌شوند، مگر خلافش گفته شود.

---

## پیش‌نیازها

| ابزار | نسخه | برای |
|---|---|---|
| Node.js | ۲۲ یا بالاتر (`engines` ِ ریشه) | همه‌چیز؛ اسکریپت‌های ممیزی از `WebSocket` ِ سراسری Node استفاده می‌کنند |
| pnpm | ۱۱ (`packageManager` ِ ریشه: `pnpm@11.18.0`) | مونوریپو؛ `corepack enable` همان نسخه را می‌آورد |
| Chrome یا Edge | نصب‌شده | فقط `test:e2e` و `audit:*` (یا مسیرش را در `CHROME_PATH` بده) |
| Docker | — | فقط برای اتصال به API ِ واقعی؛ توسعه‌ی فرانت بدون آن ممکن است |
| Android SDK Platform-Tools (`adb`) | — | فقط تست روی گوشی واقعی |

نصب وابستگی‌ها (یک بار، و پس از هر تغییر `pnpm-lock.yaml`):

```bash
pnpm install
```

## env

فرانت سه متغیر Vite دارد. [`apps/web/.env.example`](.env.example) را به `apps/web/.env.local` (در gitignore)
کپی کن و فقط آنچه لازم داری را پر کن — همه می‌توانند خالی بمانند.

| متغیر | پیش‌فرض | معنی |
|---|---|---|
| `VITE_API_MODE` | خالی = `mock` | فقط `real` (بدون حساسیت به حروف) MSW را خاموش و پراکسی را روشن می‌کند. هر مقدار دیگر — حتی غلط تایپی — mock می‌ماند. production این را نادیده می‌گیرد. |
| `VITE_API_PROXY_TARGET` | `http://localhost:3000` | مقصد پراکسی `/api` در حالت `real`. پیشوند `/api` حذف می‌شود چون API ِ NestJS پیشوند سراسری ندارد. |
| `VITE_API_BASE_URL` | `/api` | ریشه‌ی آدرس API در خود کد. خالی بگذار. مقدار فقط برای بک‌اندی روی origin ِ دیگر است، و آن‌وقت CORS ِ سرور لازم است که فعلاً فعال نیست. |

متغیرهای ابزار (نه Vite): `CHROME_PATH` و `CHROME_FLAGS` (مرورگر ممیزی/E2E)، `BUNDLE_BUDGET_KB` (فقط
سخت‌تر کردن بودجه‌ی بسته، هرگز شل‌تر از ۲۰۰)، `E2E_KEY_INTERVAL_MS` (فاصله‌ی کلیدها در E2E، پیش‌فرض ۵۰).

## dev

```bash
pnpm dev
```

همان `pnpm --filter @gold/web dev` است: Vite روی `http://localhost:5173` با HMR و **حالت mock** (بخش بعد).
سرویس‌ورکر PWA در توسعه خاموش است. مسیرهای کمکی فقط‌توسعه: `/_dev/smoke`، `/_dev/keypad`،
`/_dev/party-selector`.

## mock mode

پیش‌فرض توسعه. MSW در مرورگر به همه‌ی `/api/*` پاسخ می‌دهد — بدون Docker و PostgreSQL — با handlerهایی که
[`src/mocks/handlers`](src/mocks/handlers) دارد:

- **ورود:** مستأجر `demo`، رمز `password123`، کاربر `owner@example.com` (مالک) یا `cashier@example.com`
  (صندوق‌دار، برای دیدن محدودیت‌های نقش).
- **قراردادمحور است، نه آزاد:** پیش از هر handler، دروازه‌ی قرارداد (`contract-gate.ts`) همان کارهای سرور را
  می‌کند — `Idempotency-Key` روی نوشتن، و بدنه با همان schema ِ `packages/contracts`. پس اگر در mock کار
  می‌کند، شکل درخواست درست است. آزمون `contract-conformance` می‌سنجد هر مسیر mock در سرور هم هست.
- **سناریوهای خطا** (`network`، `forbidden`، `conflict`، `validation`) برای دیدن حالت‌های خطای هر صفحه:
  - در آدرس: `http://localhost:5173/sales/new?mockScenario=network`
  - یا در کنسول مرورگر: `__goldMocks.setScenario('conflict', '/sales/invoices/jewelry')`، و برگشت با
    `__goldMocks.reset()`. سناریو در `sessionStorage` ِ همان تب می‌ماند.
- داده‌ی mock در حافظه است؛ تازه‌سازی صفحه آن را به fixtureها برمی‌گرداند.
- **production هرگز mock ندارد:** MSW فقط با `import()` ِ پویا پشت `import.meta.env.DEV` بار می‌شود و
  `scripts/check-no-mocks.mjs` پس از هر بیلد خروجی را می‌گردد.

## اتصال API

برای کار روی بک‌اند واقعی (NestJS + PostgreSQL، `apps/api`):

1. دیتابیس و API را بالا بیاور (اولین بار ایمیج ساخته می‌شود):

   ```bash
   docker compose up -d
   ```

2. مهاجرت را صریحاً اجرا کن (عمداً خودکار نیست):

   ```bash
   docker compose --profile tools run --rm migrate
   ```

   به‌جای Docker برای API می‌توانی آن را محلی اجرا کنی: `apps/api/.env.example` را به `apps/api/.env` کپی و
   دو کلید JWT را پر کن (`openssl rand -base64 48`)، سپس `pnpm --filter @gold/api dev`.

3. فرانت را در حالت real اجرا کن — `VITE_API_MODE=real` را در `apps/web/.env.local` بگذار و:

   ```bash
   pnpm dev
   ```

   درخواست `/api/sales/invoices?limit=5` به `http://localhost:3000/sales/invoices?limit=5` می‌رود، با همان
   هدر `Authorization`. سلامت API: `http://localhost:3000/health`.

**مستأجر و کاربر اول.** هنوز ثبت‌نام یا endpoint ِ ساخت کاربر وجود ندارد:

- مستأجر (فقط بیرون از production؛ تنظیمات اولیه، انواع سکه و حساب‌ها را هم seed می‌کند):

  ```bash
  curl -X POST http://localhost:3000/internal/dev/tenants -H "Content-Type: application/json" -d "{\"name\":\"Demo Shop\",\"slug\":\"demo\",\"timezone\":\"Asia/Tehran\"}"
  ```

- کاربر و عضویت فعلاً با SQL ساخته می‌شوند: ردیف `users` (ایمیل با حروف کوچک، `password_hash` = هش
  Argon2id، که با `PasswordService` ِ `apps/api` یا `@node-rs/argon2` ساخته می‌شود) و ردیف `tenant_memberships`
  با `role_code` یکی از `OWNER`، `MANAGER`، `CASHIER`. این مسیر در محیط بدون Docker ِ توسعه‌ی فرانت آزموده
  نشده است؛ اگر جایی گیر کرد، تست‌های `apps/api/test/*.e2e-spec.ts` نشان می‌دهند سرویس‌ها کاربر را چطور
  می‌سازند.

## build

```bash
pnpm --filter @gold/web build
```

به ترتیب: `tsc --noEmit` ← `vite build` (خروجی `apps/web/dist`) ← دروازه‌ی اندازه‌ی بسته ← نگهبان mock. هر
مرحله شکست بخورد، بیلد شکست می‌خورد. در production همه‌ی `console.*` و `debugger` حذف می‌شوند و
`mockServiceWorker.js` از خروجی بیرون می‌ماند.

پیش‌نمایش خروجی production (سرویس‌ورکر واقعی، **بدون mock**). داده فقط از API ِ واقعی می‌آید: با `VITE_API_MODE=real` در `.env.local` همان پراکسی حالت dev اینجا هم فعال است (`preview.proxy` از `server.proxy` ارث می‌برد):

```bash
pnpm --filter @gold/web preview
```

## tests

| دستور | چه می‌کند |
|---|---|
| `pnpm --filter @gold/web test` | همه‌ی آزمون‌های Vitest (واحد، صفحه، Integration، قرارداد mock، a11y) |
| `pnpm --filter @gold/web test:watch` | حالت watch |
| `pnpm --filter @gold/web typecheck` | TypeScript |
| `pnpm --filter @gold/web check:circular` | وابستگی چرخشی (madge) |
| `pnpm --filter @gold/web test:e2e` | مسیر پایلوت ۱۷ مرحله‌ای روی بیلد production در Chrome ِ بی‌سر، ۳۶۰px لمسی و ۱۴۴۰px؛ حدود ۶ دقیقه؛ screenshotها در `apps/web/.e2e/` |
| `pnpm typecheck` / `pnpm test` | همه‌ی پکیج‌ها (core-calc، contracts، api، web) |
| `pnpm gate:frontend` | دروازه‌ی کامل فرانت: typecheck، lint ِ web/core-calc/contracts، چرخشی، آزمون‌ها، build، analyze |

یک فایل یا یک نام:

```bash
pnpm --filter @gold/web exec vitest run src/features/sales/SaleWizardPage.test.tsx
```

ممیزی‌ها (مرورگر واقعی، گزارش در `docs/` و `PERFORMANCE.md`): `audit:mobile`، `audit:lcp`، `audit:inp`،
`audit:pwa` — هر کدام با `pnpm --filter @gold/web <نام>`.

## Android test

تست روی گوشی میان‌رده‌ی واقعی الزامی است (شبیه‌ساز کافی نیست). پروتکل کامل، سناریوها و جدول نتیجه در
[`docs/android-device-test.md`](../../docs/android-device-test.md). خلاصه‌ی راه‌اندازی:

1. روی گوشی USB debugging را روشن و با کابل وصل کن.
2. سرور توسعه را روی پورت ثابت بالا بیاور:

   ```bash
   pnpm --filter @gold/web dev --port 5173 --strictPort
   ```

3. پورت را به گوشی بده:

   ```bash
   adb reverse tcp:5173 tcp:5173
   ```

4. روی گوشی در Chrome `http://localhost:5173` را باز کن؛ برای INP و DevTools روی کامپیوتر
   `chrome://inspect/#devices`.

**از IP ِ شبکه‌ی محلی (`http://192.168.x.x:5173`) استفاده نکن:** context ِ امن نیست، پس سرویس‌ورکر MSW ثبت
نمی‌شود (همه‌ی درخواست‌ها شکست می‌خورند) و Web Share ِ فایل PDF هم غیرفعال است.

## bundle analysis

بودجه: بسته‌ی اولیه زیر ۲۰۰KB gzip (بخش ۶ `CLAUDE.md`). `build` آن را خودکار می‌سنجد؛ برای جزئیات:

```bash
pnpm --filter @gold/web analyze
```

سهم هر چانک اولیه/تنبل، بزرگ‌ترین بسته‌ها و هر بسته‌ی دونسخه‌ای را چاپ می‌کند؛ گزارش ماشینی در
`apps/web/build/bundle-report.json`. اگر بودجه شکست: import ِ ایستای چیزی سنگین در مسیر اولیه را پیدا کن.
ECharts فقط با `import()` در `features/reporting/profit-trend-echarts.ts`، آیکون‌های lucide نام‌دار، و
`lodash`/`moment` ممنوع‌اند — ESLint بیشترشان را پیش از بیلد می‌گیرد.

## مشکلات متداول

| نشانه | علت و راه‌حل |
|---|---|
| ورود در حالت mock «ایمیل یا رمز عبور نادرست است» | مستأجر باید `demo` و رمز `password123` باشد (بخش mock mode). |
| همه‌ی درخواست‌ها در حالت mock خطای شبکه می‌دهند | سرویس‌ورکر MSW ثبت نشده: آدرس `localhost` نیست (IP ِ شبکه → context ِ ناامن)، یا سناریوی `network` فعال مانده — `__goldMocks.reset()`. |
| حالت real: ۴۰۴ یا `ECONNREFUSED` روی `/api/...` | API بالا نیست یا `VITE_API_PROXY_TARGET` غلط است؛ `http://localhost:3000/health` را باز کن. پس از تغییر `.env.local` سرور Vite را دوباره بالا بیاور. |
| حالت real: خطای CORS | `VITE_API_BASE_URL` را مقدار داده‌ای؛ خالی‌اش کن و از پراکسی (`VITE_API_MODE=real`) استفاده کن. مقدار `http://localhost:3000/api` هم غلط است — API پیشوند `/api` ندارد. |
| `SCHEMA_MISMATCH` («پاسخ سرور با قرارداد نمی‌خواند») | فرانت و API از دو نسخه‌ی متفاوت `packages/contracts` استفاده می‌کنند. API آن را از `dist` می‌خواند: `pnpm --filter @gold/contracts build` و API را دوباره بالا بیاور. جزئیات (فقط مسیر فیلد، بدون مقدار) در کنسول توسعه. |
| آزمون‌ها روی سیستم پربار گاهی timeout می‌شوند | سقف انتظار ۱۰ ثانیه و `testTimeout` ۱۵ ثانیه است؛ همان فایل را تنها اجرا کن تا مطمئن شوی باگ نیست. |
| `test:e2e`: «Chrome یا Edge پیدا نشد» | مرورگر نصب کن یا `CHROME_PATH` را به فایل اجرایی‌اش بده. |
| `test:e2e` روی بیلد تازه در مرحله‌ی اول گیر می‌کند | اسکن on-access ِ ضدویروس روی فایل‌های تازه‌ساخته؛ اسکریپت خروجی را پیش‌خوانی می‌کند (`warmBuildOutput`). یک بار دیگر اجرا کن؛ خطای صفحه در `error.txt` ِ همان مرحله در `.e2e/` است. |
| دانلود PDF خالی برمی‌گردد (۲۰۴) | بعضی ضدویروس‌ها (ESET) پاسخ‌های دارای `Content-Disposition` را خالی می‌کنند؛ سرور عمداً نام فایل را در `X-File-Name` می‌فرستد. اگر سرویس جدیدی PDF برمی‌گرداند، از `pdfResponse` ِ `apps/api` استفاده کند. |
| پس از deploy نسخه‌ی قدیمی دیده می‌شود | به‌روزرسانی PWA منتظر اجازه‌ی کاربر است (نوار «نسخه‌ی تازه»)؛ در DevTools ← Application ← Service workers می‌توانی دستی unregister کنی. |
| پیش‌نویس فروش یا تلاش ثبت ناپدید شد | عمدی است: پیش‌نویس‌ها در `sessionStorage` ِ همان تب‌اند و با خروج، یا ورود کاربر/مستأجر دیگر پاک می‌شوند. |
| کیبورد گوشی روی فیلد عددی باز نمی‌شود | عمدی است — فیلدهای عددی با کیپد سفارشی برنامه پر می‌شوند (`inputMode="none"`). |
| `pnpm build` با «بسته‌ی اولیه بیش از بودجه» شکست می‌خورد | بخش bundle analysis. |
