# معماری فرانت — `apps/web`

**FE-107** · وضعیت کد پس از FE-106 (همه‌ی مسیرهایی که فرانت صدا می‌زند در سرور وجود دارند).

این سند توضیح می‌دهد کد فرانت **همین امروز** چطور کار می‌کند و چرا؛ برنامه‌ی آینده نیست. هر بخش به فایل‌هایی
ارجاع می‌دهد که منبع حقیقت‌اند — اگر این سند با کد اختلاف داشت، کد درست است و این سند باید اصلاح شود.
قواعد غیرقابل‌مذاکره‌ی محصول در [`CLAUDE.md`](../CLAUDE.md) است؛ اینجا فقط می‌گوییم فرانت آن‌ها را **کجا و چگونه**
اجرا می‌کند. راهنمای اجرا و env در `apps/web/README.md` (FE-108) می‌آید.

| لایه | انتخاب |
|---|---|
| رندر | React 18 + Vite، TypeScript سخت‌گیر (`exactOptionalPropertyTypes`) |
| مسیر | TanStack Router (درخت کدی، نه فایل‌محور) |
| داده‌ی سرور | TanStack Query |
| state ِ کلاینت | zustand (با `persist` فقط جایی که لازم است) |
| قرارداد | zod — `packages/contracts` مشترک با بک‌اند |
| محاسبه و قالب‌بندی | `packages/core-calc` — همان کد سرور |
| UI | Tailwind + shadcn/ui، وزیرمتن با Tabular Numbers، RTL با خاصیت‌های منطقی |
| PWA | vite-plugin-pwa (Workbox) — فقط پوسته |
| تست | Vitest + jsdom + Testing Library + `msw/node`؛ E2E با Chrome بی‌سر روی CDP |

---

## ۱. ساختار Feature

```text
apps/web/src/
├── main.tsx             راه‌اندازی: فونت/CSS، MSW فقط در توسعه، پیش‌بار مسیر اول، ثبت سرویس‌ورکر
├── app/                 router.tsx، محافظ‌های مسیر، پیش‌بار مسیر اول + تست‌های Integration سراسری
├── api/                 تنها مرز شبکه: client، قراردادها، کلیدهای Query، هوک‌های خواندن، تابع‌های نوشتن هر دامنه
├── features/<دامنه>/    صفحه‌ها و اجزای هر دامنه: auth, home, pricing, parties, payments, inventory,
│                         sales, purchase, reporting, settings (+ dev فقط در توسعه)
├── components/
│   ├── ui/              اجزای پایه‌ی shadcn (بدون منطق دامنه)
│   ├── common/          اجزای مشترک دامنه‌آگاه: AmountDisplay، UnitToggle، ResponsiveDialog، PartySelector، …
│   └── keypad/          صفحه‌کلید عددی سفارشی و فیلدهای عددی
├── hooks/               هوک‌های بین‌دامنه‌ای (ثبت مالی، نشست، واحد، PDF، …)
├── stores/              zustand: نشست، واحد، تم، پیش‌نویس فروش/خرید، اشخاص و کالاهای اخیر، toast
├── lib/                 تابع‌های خالص بی‌React: تاریخ شمسی، bigint، نرخ سند، داده‌ی مستأجر، PDF، …
├── mocks/               MSW — فقط توسعه و تست (ESLint و `check-no-mocks` بیرون نگهش می‌دارند)
├── styles/              توکن‌های طراحی (`globals.css`) و تست کنتراست
└── test/                setup ِ Vitest و هارنس Integration
```

قواعد چیدمان:

- **یک دامنه، یک پوشه.** هر چیز فقط مال یک دامنه است در `features/<دامنه>/` می‌ماند (مثلاً `features/sales/`:
  `SaleWizardPage.tsx`، `sale-line-pricing.ts`، `useJewelrySaleSubmit.ts`). چیزی که دو دامنه لازم دارند به
  `components/common`، `hooks` یا `lib` می‌رود — نه import ِ متقاطع از `features/` دیگر.
- **منطق خالص کنار صفحه، در فایل `.ts` ِ جدا** (`sale-submit.ts`، `profit-report.ts`، `party-statement.ts`):
  بی‌React تست می‌شود و صفحه فقط ترکیبش می‌کند.
- **تست کنار فایل** (`X.tsx` ↔ `X.test.tsx`). تست‌های جریان چندصفحه‌ای `*.integration.test.tsx` هستند.
- **هر صفحه تنبل است** (`lazyRouteComponent` در `app/router.tsx`)؛ بسته‌ی اولیه فقط پوسته است.
- import با نام مستعار `@/` (= `src/`). وابستگی چرخشی ممنوع است و `pnpm --filter @gold/web check:circular`
  (madge) آن را می‌سنجد.

## ۲. API client

همه‌ی شبکه از [`src/api/client.ts`](../apps/web/src/api/client.ts) می‌گذرد. ESLint ِ `fetch` ِ مستقیم را بیرون از
`src/api/` خطا می‌دهد.

| تابع | کاربرد |
|---|---|
| `apiGet(path, schema)` | خواندن JSON |
| `apiGetFile(path)` | دریافت PDF (نام فایل از `X-File-Name`؛ سرور عمداً `Content-Disposition` نمی‌فرستد) |
| `apiPost` / `apiPatch(path, body, schema, idempotencyKey)` | نوشتن |
| `apiPostReadOnly` | POST ِ بی‌اثر (پیش‌نمایش مرجوعی B2C) — کلید تازه، بعد از تمدید نشست بی‌صدا تکرار می‌شود |
| `apiPostRaw` | فقط `/auth/login|refresh|logout` — بدون تمدید خودکار (وگرنه حلقه) |

کارهایی که client برای **هر** درخواست انجام می‌دهد:

1. **`BASE_URL`** = `VITE_API_BASE_URL` یا `/api`. API ِ NestJS پیشوند `/api` ندارد؛ در توسعه با
   `VITE_API_MODE=real` پراکسی Vite پیشوند را برمی‌دارد ([`lib/api-mode.ts`](../apps/web/src/lib/api-mode.ts)).
2. **`X-Request-Id`** تازه، تا لاگ کلاینت به لاگ سرور (و `requestId` ِ بدنه‌ی خطا) وصل شود.
3. **`Authorization: Bearer`** از `session-store`.
4. **سقف زمان** (پیش‌فرض ۱۵ ثانیه، PDF ۳۰ ثانیه) + ترکیب با `AbortSignal` ِ Query (دستی، چون
   `AbortSignal.any` روی WebView ِ قدیمی نیست).
5. **اعتبارسنجی پاسخ با zod** — ناسازگاری = `ApiError('SCHEMA_MISMATCH')`، نه داده‌ی خراب وسط رندر. در توسعه
   فقط مسیر و کد خطای zod لاگ می‌شود، هرگز مقدار.
6. **۴۰۱ ← یک تمدید مشترک** (`refreshInFlight`؛ چرخش توکن یعنی دو تمدید هم‌زمان یکی را باطل می‌کرد). پس از
   تمدید، GET بی‌صدا تکرار می‌شود ولی **نوشتن هرگز**: `ApiError(409, 'RETRY_AFTER_REFRESH')` و کاربر با همان
   کلید دوباره ثبت می‌کند. شکست تمدید ← `clearSession()`.
7. **نوشتن آفلاین فرستاده نمی‌شود** — `OfflineError` همان لحظه (بخش ۱۳).

**خواندن‌ها** هوک‌های TanStack Query در [`api/queries.ts`](../apps/web/src/api/queries.ts) هستند و کلیدشان فقط از
[`api/query-keys.ts`](../apps/web/src/api/query-keys.ts) می‌آید (هر خانواده `all()` برای invalidation ِ درشت دارد).
[`api/query-client.ts`](../apps/web/src/api/query-client.ts): Query فقط برای خطای موقت (شبکه، ۵xx) یک بار retry
می‌کند — نه ۴xx و نه `SCHEMA_MISMATCH`؛ `refetchOnWindowFocus` خاموش؛ mutation بدون retry و با
`networkMode: 'always'` (پیش‌فرض TanStack نوشتن آفلاین را در صف نگه می‌داشت و بعداً بی‌صدا می‌فرستاد).

**نوشتن‌ها** تابع‌های ساده در `api/<دامنه>.ts` هستند (`sales.ts`، `settlements.ts`، `purchase.ts`، …) که
`idempotencyKey` را **اجباری** می‌گیرند؛ صفحه با هوک‌های بخش ۷ صدایشان می‌زند، نه با `useMutation`.

## ۳. Contracts

- **منبع واحد:** [`packages/contracts`](../packages/contracts/src) — همان schemaهایی که `ZodValidationPipe` ِ
  کنترلرها اجرا می‌کند. بدنه‌ی هر نوشتن پیش از ارسال با همان schema ِ ورودی سرور ساخته می‌شود.
- **لایه‌ی مصرف:** [`apps/web/src/api/contracts.ts`](../apps/web/src/api/contracts.ts) دو کار دارد و بس:
  re-export ِ schema ِ مشترک، و `.extend` ِ همان schema برای تبدیل مبلغ رشته‌ای به `bigint`
  (`priceQuoteSchema`، `transactionSchema`، …). **schema ِ سیمی را اینجا دوباره تعریف نکن**؛ شکل عوض شود؟ تغییر در
  `packages/contracts` است.
- از FE-106 هیچ View model ِ بی‌endpoint نمانده. آزمون
  [`mocks/contract-conformance.test.tsx`](../apps/web/src/mocks/contract-conformance.test.tsx) مسیرهای
  کنترلرهای NestJS را از دکوراتورها می‌خواند و می‌سنجد: هر مسیر سرور mock دارد، هر mock در سرور هست
  (`PENDING_BACKEND_ROUTES` خالی است)، هر پاسخ موفق mock از schema ِ واقعی کلاینت می‌گذرد، و کدهای خطای mock
  زیرمجموعه‌ی کدهای فیلتر خطای سرورند.
- `@gold/contracts` سمت API از `dist` (CJS) خوانده می‌شود: پس از تغییر قرارداد
  `pnpm --filter @gold/contracts build` را پیش از آزمون‌های API اجرا کن. وب از `src` می‌خواند.

## ۴. BigInt handling

قاعده‌ی ۲-۱: پول و وزن هیچ‌جا `number` نیستند.

| کجا | نوع |
|---|---|
| روی سیم (JSON) | رشته‌ی عدد صحیح لاتین (`"12500000"`) — `bigIntStringSchema` و خانواده |
| داخل برنامه | `bigint` — تبدیل فقط در schemaهای `api/contracts.ts` (`.transform(BigInt)`) یا `lib/bigint.ts` |
| state ِ فرم | `bigint` (فیلدهای کیپد) یا رشته‌ی لاتین |
| نمایش | `Intl` ِ `fa-IR` از طریق قالب‌بندهای `core-calc` (`formatRial`، `formatGram`، …) |

- **همه‌ی حساب و گرد کردن در `@gold/core-calc`** (`dualFromRial`، `gramRate1000`، `calculateJewelrySale`، …)؛
  همان کدی که سرور اجرا می‌کند، پس پیش‌نمایش کلاینت و سند سرور یکی‌اند. ESLint ِ `Math.round`، `parseFloat`،
  `toFixed` و `Number(...)` را برای مقادیر مالی خطا می‌دهد؛ تبدیل امن به `number` (فقط برای شمارنده/عیار) با
  `toSafeNumber` ِ core-calc.
- ورودی کاربر با ارقام فارسی/عربی: `toLatinDigits` و سپس `parseBigIntString` ([`lib/bigint.ts`](../apps/web/src/lib/bigint.ts)).
- **سکه شمارشی است** (قاعده‌ی ۲-۲): تعداد صحیح، هرگز به گرم تبدیل نمی‌شود و تعداد انواع مختلف سکه جمع زده
  نمی‌شود. مدل نوع سکه از یک جا می‌آید: [`lib/coin-type.ts`](../apps/web/src/lib/coin-type.ts)؛ `bubble()` ِ
  core-calc فقط نوع ضرب بانک مرکزی را می‌پذیرد (قاعده‌ی ۲-۳).
- `build.target` ≥ ES2020 چون `BigInt` لازم است.

## ۵. Unit display (کلید طلا ↔ ریال)

قاعده‌ی ۲-۴: هر عدد مالی با یک کلیک بین طلا و ریال جابه‌جا می‌شود؛ پیش‌فرض **طلا**.

- **state:** [`stores/unit-store.ts`](../apps/web/src/stores/unit-store.ts) (`'gold' | 'rial'`، `localStorage` ِ
  `gold-ui-unit` — فقط تنظیم UI)؛ [`hooks/useUnit.ts`](../apps/web/src/hooks/useUnit.ts) تب‌ها را همگام می‌کند.
- **کلید:** `components/common/UnitToggle.tsx` در هدر **هر** صفحه‌ای که عدد مالی دارد (FE-103 همه را ممیزی کرد؛
  `app/unit-toggle.integration.test.tsx` نگهش می‌دارد).
- **تنها مسیر رندر عدد مالی:** [`components/common/AmountDisplay.tsx`](../apps/web/src/components/common/AmountDisplay.tsx).
  سه شکل ورودی:
  - `DualAmount` (`rial`، `pureMg`، `rate1000`) — مبلغ با نرخ قفل‌شده‌ی خود سند؛
  - `kind: 'faces'` — هر دو چهره از سرور بدون یک نرخ مشترک (گزارش سود: هر رویداد با مظنه‌ی خودش جمع شده)؛
  - `kind: 'raw'` — تک‌واحدی، وقتی نرخ مرجع نداریم. **معادل ساختگی نمی‌سازیم.**
  `RateDisplay` برای مظنه و نرخ گرم است و از کلید پیروی نمی‌کند (نرخ طلا برحسب طلا بی‌معناست).
  هر دو `data-raw`/`data-unit` می‌گذارند تا تست‌ها مستقل از قالب فارسی بسنجند.
- **نرخ همیشه نرخ سند است** (قاعده‌ی ۲-۸): گزارش‌ها و صورت‌حساب‌ها معادل را از نرخ قفل‌شده‌ی هر سند می‌گیرند
  (سرور یا `documentRateSnapshots`)، نه مظنه‌ی امروز. برای رسیدهای پس از ثبت،
  [`lib/document-rate.ts`](../apps/web/src/lib/document-rate.ts) نرخ را فقط وقتی می‌دهد که مظنه‌ی در دست دقیقاً همان
  `quoteId` ِ سند باشد؛ وگرنه `null` و نمایش ریالی خام. `app/historical-rates.integration.test.tsx` این را می‌پاید.

## ۶. Forms

دو نوع فرم داریم و عمداً یکی نیستند:

- **فرم‌های غیرمالی** (ورود، شخص، کالا): `react-hook-form` + `zodResolver` با schema ِ مشترک.
- **فرم‌های مالی** (فروش، خرید، تسویه، موجودی افتتاحیه، اصلاح فاکتور): state ِ صریح (`useState` یا
  پیش‌نویس zustand) + فیلدهای کیپد + بدنه‌ای که مستقیم با schema ِ ورودی قرارداد ساخته می‌شود.

قطعات مشترک:

- **کیپد سفارشی** ([`components/keypad/`](../apps/web/src/components/keypad)): `NumericField` با `readOnly` و
  `inputMode="none"` تا کیبورد سیستم‌عامل باز نشود؛ پوسته‌های `WeightInput`، `KaratInput`، `MoneyInput`،
  `PercentInput`، `CountInput`؛ میان‌برهای دامنه‌ای در `shortcuts.ts` (۷۵۰، ۹۹۵، ۷۴۰، ۹۲۵، گرم↔مثقال — فقط
  میان‌بر تایپ، نه عدد صنفی). صفحه `<NumericKeypad/>` را خودش mount می‌کند.
  ⚠️ مقدار اولیه‌ی فیلد عددی را با `useState` ِ همگام بده، نه با effect ِ پس از mount (فیلد در mount مقدار
  صفر را به والد اعلام می‌کند و seed ِ دیرهنگام بازنویسی می‌شود).
- **پیش‌نویس جریان‌های چندمرحله‌ای** در `sessionStorage` (`sale-draft-store.ts`، `purchase-draft-store.ts`):
  بستن تب یعنی پاک‌شدن؛ پیش‌نویس رسمی آفلاین ساخته نمی‌شود. مظنه‌ی پیش‌نمایش با رسیدن به مرحله‌ی بازبینی قفل
  می‌شود (`lockMazneh`، یک‌بار).
- **بدون عدد صنفی هاردکد** (قاعده‌ی ۲-۶): عیار پیش‌فرض خرید، واحد گرد کردن، نرخ سود/مالیات از
  `useGeneralSettings` (تنظیمات نسخه‌دار مستأجر) می‌آیند.
- **`UnsavedChangesGuard`** روی هر صفحه‌ی فرم (`when`، `submitting`، `draft: 'discard' | 'session'`) با
  `useBlocker({ shouldBlockFn, enableBeforeUnload, withResolver: true })`. شکل قدیمی
  `useBlocker(() => true, cond)` بی‌صدا مسدود می‌کند — استفاده نکن.
- **خطا کنار فرم می‌ماند** (`ApiErrorNotice`)، نه در toast؛ خطای هر فیلد از `fields` ِ پاسخ سرور.
- **دکمه‌ی اقدام اصلی در یک‌سوم پایین صفحه**؛ زیر ۶۴۰px مودال‌ها bottom sheet هستند (`ResponsiveDialog`).

## ۷. Idempotency

سرور روی هر POST/PATCH ِ غیرعمومی `Idempotency-Key` می‌خواهد و hash ِ متد + مسیر + بدنه را کنار کلید نگه
می‌دارد: **همان کلید + همان بدنه** ← پاسخ ذخیره‌شده؛ **همان کلید + بدنه‌ی دیگر** ← ۴۰۹.

| هوک | برای |
|---|---|
| [`useFinancialSubmit`](../apps/web/src/hooks/useFinancialSubmit.ts) | **هر سند مالی** — فروش زیورآلات و سکه، چهار تسویه، خرید سکه، موجودی افتتاحیه، اصلاح فاکتور |
| [`useIdempotentSubmit`](../apps/web/src/hooks/useIdempotentSubmit.ts) | نوشتن غیرسندی — تنظیمات، مظنه‌ی دستی، شخص، کالا |

`useFinancialSubmit` **تلاش** را سنجاق می‌کند، نه فقط کلید: اولین ضربه `{ key, payload }` را ثابت می‌کند
(از جمله `effectiveAt`) و هر ضربه‌ی بعدی دقیقاً همان را دوباره می‌فرستد. چرخه:

- `sending` — ضربه‌ی دیگر روی `ref` (همگام) نادیده گرفته می‌شود؛ دکمه‌ی غیرفعال فقط راحتی است.
- `uncertain` — شبکه، timeout، ۵xx، ۴۰۸/۴۲۹ یا `SCHEMA_MISMATCH` ِ پاسخ موفق: معلوم نیست سند ساخته شده.
  فرم قفل می‌ماند و تنها اقدام «بررسی نتیجه‌ی ثبت» است (همان درخواست). `PendingSubmitNotice` توضیحش می‌دهد.
- رد قطعی (`isDefinitiveRejection`: هر ۴xx از جمله ۴۰۹، و `OfflineError`) — چیزی ساخته نشده؛ کاربر اصلاح می‌کند.
- `done` — ضربه‌ی دیرهنگام هیچ نمی‌فرستد؛ عملیات بعدی فقط با `reset()` و کلید تازه.

با `persist: { scope, schema }` تلاش نامطمئن در `sessionStorage` (کلید
`gold-ui-submit-attempt:<tenant>:<user>:<scope>`) می‌ماند تا ترک صفحه، back/forward یا تازه‌سازی آن را گم نکند.
`app/double-submit.integration.test.tsx` و `test/integration.tsx` (`IdempotencyLedger`، آینه‌ی معنای سرور)
این را می‌سنجند.

## ۸. Auth

- **نشست:** [`stores/session-store.ts`](../apps/web/src/stores/session-store.ts) در `localStorage`
  (`gold-ui-session`) — تا تازه‌سازی صفحه کاربر را بیرون نیندازد و خروج بین تب‌ها همگام شود. مصالحه‌ی آگاهانه:
  توکن از JS خواندنی است (کوکی httpOnly نیازمند تغییر قرارداد بک‌اند است).
- **تمدید:** در client (بخش ۲)؛ واکنشی به ۴۰۱ واقعی، نه تایمر.
- **[`useSessionGuard`](../apps/web/src/hooks/useSessionGuard.ts)** به گذار «نشست ← null» واکنش می‌دهد: کش Query
  را پاک و به `/login?reason=expired` (یا پیام خروج عمدی) هدایت می‌کند.
- **داده‌ی مستأجر** ([`lib/tenant-data.ts`](../apps/web/src/lib/tenant-data.ts)): کنار داده‌ی مرورگر (کش، پیش‌نویس‌ها،
  تلاش‌های سنجاق‌شده، اشخاص و کالاهای اخیر) شناسه‌ی «مستأجر:کاربر» ِ صاحبش نگه داشته می‌شود. خروج عمدی همه را
  پاک می‌کند؛ ورود کاربر یا مستأجر دیگر (`claimTenantData`) داده‌ی قبلی را پاک می‌کند؛ توکن یک مستأجر را بسته
  است، پس تعویض مستأجر = ورود دوباره، و `useTenantScope` تبی را که نشستش در تب دیگری عوض شده، پیش از رندر
  داده‌ی قدیمی پاک و به داشبورد می‌برد.
- **نقش:** فهرست سفید، نه سلسله‌مراتب ([`lib/permissions.ts`](../apps/web/src/lib/permissions.ts))، آینه‌ی
  `@Roles` ِ سرور. `requireRole(...)` در `beforeLoad` ِ مسیر، `RequireRole`/`useHasRole` برای پنهان‌کردن اقدام.
  **همه‌ی این‌ها فقط راحتی UI است؛ مرز امنیتی `JwtAuthGuard`/`RolesGuard` ِ سرور است.**
- **نمایش داده‌ی حساس:** کد ملی و موبایل پوشانده با دکمه‌ی نمایش (`lib/sensitive-identity.ts`)؛ بیلد production همه‌ی
  `console.*` را حذف می‌کند و `no-console` در ESLint فعال است.

## ۹. Error handling

| لایه | رفتار |
|---|---|
| client | `ApiError(status, code, message, fields, requestId)`، `NetworkError`، `OfflineError` ([`api/api-error.ts`](../apps/web/src/api/api-error.ts)) |
| نگاشت نمایشی | [`presentApiError`](../apps/web/src/api/error-presentation.ts) ← `kind` (`validation`, `conflict`, `retry-after-refresh`, `session-expired`, `forbidden`, `network`, `not-found`, `server`, `unknown`) + عنوان و پیام فارسی **از کد و وضعیت HTTP**، نه از متن خام سرور؛ پیام فیلدهای مشکوک (PostgreSQL، stack trace، SQL) دور ریخته می‌شود. `presentPdfError` برای سند. |
| صفحه | `ApiErrorNotice` — خطای ماندگار کنار state ِ صفحه، شناسه‌ی رهگیری داخل «جزئیات». خطای خواندن: `RetryPanel`/`ErrorState` با «تلاش دوباره». |
| مسیر | `RouteErrorFallback` (`routerDefaults.defaultErrorComponent`) — هرگز `error.message` یا stack را رندر نمی‌کند؛ فقط در توسعه پیام خام زیر «جزئیات توسعه». |
| سراسری | `AppStatusBanners` (آفلاین، نسخه‌ی تازه) در بالای صفحه؛ toast فقط برای تأیید موفقیت و پیام‌های گذرا. |

قاعده: **خطای ثبت مالی هرگز فقط در toast نمی‌آید** — باید تا اقدام بعدی کاربر روی صفحه بماند.

## ۱۰. Routing

- درخت کدی در [`app/router.tsx`](../apps/web/src/app/router.tsx): `rootRoute` ← `/login` (بی‌پوسته) و
  `appShellRoute` (پوسته‌ی ناوبری، `beforeLoad: requireAuth`) ← همه‌ی صفحه‌ها. `routeTree` و `routerDefaults` صادر
  می‌شوند تا تست‌ها همان درخت و همان رفتار pending/error را بسازند.
- مسیرهای دامنه‌ای همان مسیرهای `FrontTasks.md`اند (`/sales/invoices/$invoiceId/amend`،
  `/parties/$partyId/settlements/new`، `/reporting/profit`، …)؛ مسیرهای `/_dev/*` فقط در توسعه وجود دارند و از بیلد
  حذف می‌شوند.
- هر صفحه `lazyRouteComponent`؛ `defaultPreload: 'intent'`؛ pending = `PageSkeleton` (اسکلت، نه اسپینر).
- **باز کردن سرد** (FE-088): [`app/initial-route.ts`](../apps/web/src/app/initial-route.ts) مسیر اول را پیش از
  اولین رندر React کامل بار می‌کند و داده‌ی اولین رنگ را (`staticData.startupQueries`، مثلاً مظنه) هم‌زمان با چانک
  می‌خواهد؛ پلاگین `vite-plugins/route-preload.ts` چانک مسیر آدرس بازشده را در HTML پیش‌بار می‌کند.
- محافظ نقش روی مسیر فقط جایی است که سرور هم نقش می‌خواهد (کامنت هر مسیر دلیلش را می‌گوید)؛ بدون نقش ←
  `/forbidden`.

## ۱۱. Testing

| لایه | ابزار و محل |
|---|---|
| تابع خالص و قرارداد | Vitest — `lib/*.test.ts`، `api/*-contract.test.ts`؛ `packages/core-calc` با پوشش ۱۰۰٪ خطوط و golden tests |
| جزء و صفحه | Testing Library + jsdom، کنار فایل؛ هوک‌های `api/queries` معمولاً `vi.mock` می‌شوند |
| Integration | [`test/integration.tsx`](../apps/web/src/test/integration.tsx): `routeTree` ِ واقعی + client ِ واقعی + `msw/node`؛ هر تست نوشتن‌های جریانش را با `server.use` جواب می‌دهد و `IdempotencyLedger` معنای سرور را تقلید می‌کند؛ عدد را با `rawAmount` (`data-raw`) بسنج. نمونه‌ها: `sale-flow`، `mixed-settlement`، `invoice-amendment`، `double-submit`، `historical-rates`، `unit-toggle`، `tenant-data` |
| قرارداد mock | `mocks/contract-conformance.test.tsx` (بخش ۳) + دروازه‌ی قرارداد [`mocks/handlers/contract-gate.ts`](../apps/web/src/mocks/handlers/contract-gate.ts): کلید Idempotency و بدنه با schema ِ سرور پیش از هر handler |
| دسترس‌پذیری | `app/a11y.test.tsx` (axe روی صفحه‌های اصلی با `routeTree` ِ واقعی) و دو جریان فروش فقط با کیبورد، `styles/contrast.test.ts` |
| E2E | `pnpm --filter @gold/web test:e2e` ← `scripts/e2e-pilot.mjs`: بیلد production + handlerهای MSW در Node، Chrome بی‌سر روی CDP، ۱۷ مرحله‌ی مسیر پایلوت روی ۳۶۰px لمسی و ۱۴۴۰px ماوس؛ ثبت تکراری و داده‌ی حساس در screenshot را هم می‌سنجد |
| ممیزی‌ها | `audit:mobile`، `audit:lcp`، `audit:inp`، `audit:pwa` (گزارش‌ها در `docs/` و `PERFORMANCE.md`) |

نکته‌ها: `setup.ts` سقف انتظار async را ۱۰ ثانیه گذاشته (suite ِ موازی بزرگ است)؛ `testTimeout` ۱۵ ثانیه. تست
صفحه `<NumericKeypad/>` اضافه نکند — صفحه خودش mount می‌کند. پیش‌نمایش مرورگر برای «تیک زدن» تسک‌ها جایگزین
آزمون خودکار نیست. آزمون روی دستگاه اندروید واقعی پروتکل جدا دارد: [`docs/android-device-test.md`](android-device-test.md).

## ۱۲. Performance

بودجه‌ها از بخش ۶ `CLAUDE.md`: JS ِ اولیه < ۲۰۰KB gzip، LCP < ۲٫۵s روی 3G ِ شبیه‌سازی‌شده، INP < ۲۰۰ms.

- **دروازه‌ی بیلد:** `pnpm --filter @gold/web build` = typecheck ← `vite build` ←
  [`scripts/check-bundle-size.mjs`](../scripts/check-bundle-size.mjs) (شکست بالای ۲۰۰KB یا هر بسته‌ی دونسخه‌ای؛
  `BUNDLE_BUDGET_KB` فقط سخت‌ترش می‌کند) ← `scripts/check-no-mocks.mjs`. `analyze` جزئیات را چاپ می‌کند و
  `vite-plugins/bundle-report.ts` گزارش را در `build/bundle-report.json` می‌نویسد. هنگام نوشتن این سند: ۱۳۸KB از
  ۲۰۰KB؛ ۶۴ چانک تنبل.
- **تنبل‌سازی:** همه‌ی صفحه‌ها؛ ECharts فقط در `features/reporting/profit-trend-echarts.ts` و فقط با `import()`
  (ESLint اجبار می‌کند)؛ ورود هر آیکون lucide نام‌دار؛ `lodash`/`moment`/`echarts-for-react` ممنوع.
- **اولین رنگ:** پوسته‌ی inline در `index.html`، CSS ِ غیرمسدودکننده (`vite-plugins/non-blocking-css.ts`)، پیش‌بار
  چانک و داده‌ی مسیر اول (بخش ۱۰)، ثبت سرویس‌ورکر پس از داده‌ی صفحه‌ی اول، `Toaster` تأخیری.
- **تعامل:** انیمیشن حداقلی، بدون glassmorphism/گرادیان؛ جست‌وجوها debounce (`useDebouncedValue`)؛
  `keepPreviousData` برای ورق‌زدن؛ اعداد Tabular تا ستون‌ها نلرزند.
- سنجه‌های اندازه‌گیری‌شده و روش‌شان: [`PERFORMANCE.md`](../PERFORMANCE.md).

## ۱۳. PWA limitations

فاز ۱ **آفلاین ندارد** (بخش ۵ `CLAUDE.md`). PWA فقط برای نصب، بازشدن سریع پوسته و اعلام نسخه‌ی تازه است:

- **فقط پوسته precache می‌شود** (HTML، JS، CSS، فونت، آیکون). `/api` نه fallback دارد نه runtime cache
  (`navigateFallbackDenylist: [/^\/api\//]`): داده‌ی مالی کهنه هرگز از کش نشان داده نمی‌شود.
- **نوشتن آفلاین وجود ندارد:** client آن را با `OfflineError` همان لحظه رد می‌کند، mutation `networkMode: 'always'`
  است و هیچ صف، Background Sync یا شماره‌ی فاکتور سمت کلاینت وجود ندارد. آفلاین فقط پوسته و پیام «اتصال قطع
  است» (`AppStatusBanners`، `OfflineSubmitHint`) دیده می‌شود.
- **به‌روزرسانی با اجازه‌ی کاربر** (`registerType: 'prompt'`، [`lib/pwa-update.ts`](../apps/web/src/lib/pwa-update.ts)):
  نسخه‌ی تازه منتظر می‌ماند تا وسط ثبت فروش کنترل عوض نشود.
- **سرویس‌ورکر فقط در context ِ امن** (https یا localhost). روی http ِ شبکه‌ی داخلی مغازه نه سرویس‌ورکر ثبت
  می‌شود، نه MSW ِ توسعه، نه Web Share ِ فایل؛ برای آزمون گوشی از `adb reverse` استفاده کن.
- **اشتراک PDF** با Web Share ِ فایل فقط جایی که مرورگر پشتیبانی کند؛ وگرنه دانلود/پیش‌نمایش
  (`PdfDocumentActions`، `usePdfFile`). رفتار روی اندروید واقعی هنوز تأیید نشده (FE-079/FE-086 باز).
- **IndexedDB برای داده استفاده نمی‌شود** (Dexie فقط در صفحه‌ی دود توسعه)؛ ذخیره‌ی محلی فقط تنظیمات UI
  (`localStorage`) و پیش‌نویس/تلاش همان تب (`sessionStorage`) است، همه با مالک «مستأجر:کاربر» (بخش ۸).
- در توسعه سرویس‌ورکر خاموش است (`devOptions.enabled: false`) و `mockServiceWorker.js` از خروجی production حذف
  می‌شود.

---

## پیوست — حالت mock در توسعه

- پیش‌فرض `pnpm dev`: MSW با handlerهای قراردادمحور ([`mocks/handlers`](../apps/web/src/mocks/handlers)) — بدون
  Docker و PostgreSQL. `VITE_API_MODE=real` آن را خاموش و `/api` را به `VITE_API_PROXY_TARGET` (پیش‌فرض
  `http://localhost:3000`) پراکسی می‌کند.
- سناریوهای خطا: `?mockScenario=network|forbidden|conflict|validation` در آدرس، یا در کنسول
  `__goldMocks.setScenario('conflict', '/sales/invoices/jewelry')` و `__goldMocks.reset()`؛ در `sessionStorage` می‌ماند.
- production هرگز MSW بار نمی‌کند: تنها مسیر، `import()` ِ پویا در `main.tsx` پشت `shouldStartMockWorker` است
  (`lib/api-mode.test.ts`)، ESLint import ِ mock در کد برنامه را ممنوع می‌کند و `check-no-mocks.mjs` خروجی بیلد را
  می‌گردد.
