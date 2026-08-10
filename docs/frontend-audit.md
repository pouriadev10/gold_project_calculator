# ممیزی وضعیت فعلی فرانت — FE-001

**تاریخ:** ۱۴۰۵/۰۵/۲۰ (۲۰۲۶-۰۸-۱۱) · شاخه‌ی `dev_pouria`
**روش:** خواندن مستقیم کد و پیکربندی + اجرای واقعی `pnpm lint`، `pnpm typecheck`، تست‌های `@gold/web` / `@gold/core-calc` / `@gold/contracts`، و `pnpm --filter web typecheck`. **هیچ کد عملیاتی در این تسک تغییر نکرد** — فقط این فایل اضافه شد.

---

## خلاصه‌ی اجرایی

نکته‌ای که باید پیش از خواندن جدول‌های زیر روشن باشد:

> **`FrontTasks.md` تازه اضافه شده (untracked) و هر ۹۲ تسکش تیک‌نخورده است، ولی بخش قابل‌توجهی از دامنه‌ی Milestone 1 و 3، و بخش‌هایی از Milestone 4، 5 و 21، از قبل ساخته شده — با کیفیتی بالاتر از یک اسکلت اولیه.**

پیش از وجود `FrontTasks.md`، یک سند مستقل خودبسنده به نام [`BOOTSTRAP.md`](../BOOTSTRAP.md) در ریشه‌ی مخزن اجرا شده. تقریباً تمام گام‌های آن (۱ تا ۸) تیک خورده‌اند؛ تنها مورد باز «تست روی اندروید میان‌رده‌ی واقعی» است که در [`PERFORMANCE.md`](../PERFORMANCE.md) صریحاً به‌عنوان ناتمام ثبت شده. کامیت‌های `[bootstrap] ...` و `[keypad] ...` در `git log` این را تأیید می‌کنند:

```
ef0d908 [bootstrap] گام ۴ تا ۸ — سیستم طراحی، توکن‌ها، پوسته، صفحه‌ی اصلی، دروازه‌ی کارایی
a2a09c9 [bootstrap] گام ۳ — اسکلت Vite + React و صفحه‌ی دود
676a531 [bootstrap] گام ۱ و ۲ — مونوریپو، ابزار، و پکیج core-calc
fb8cc83 افزودن حالت تیره — روشن / تیره / سیستم
d19cd08 [keypad] گام ۱ — لایه‌ی API ساختگی با MSW
48a7f12 [keypad] گام ۲ تا ۴ — صفحه‌کلید عددی، NumericField، و هارنس اندازه‌گیری
```

**هیچ کامیت `[FE-xxx]` در تاریخچه نیست** — روال کامیت رسمی `FrontTasks.md` هنوز شروع نشده. جزئیات تطبیق هر تسک با کد موجود در بخش «تطبیق با تسک‌های بعدی» آمده تا تسک‌های بعدی چیزی را که از قبل درست ساخته شده، دوباره طراحی نکنند.

همچنین یک سند سوم به نام `FRONTEND-NEXT.md` در `PERFORMANCE.md` ارجاع داده می‌شود («معیار پذیرش گام ۲ و ۴ سند FRONTEND-NEXT.md») ولی این فایل در مخزن فعلی وجود ندارد — احتمالاً پیش‌نویس اولیه‌ی همین `FrontTasks.md` بوده و جای خود را به آن داده. ارزش تأیید دارد؛ در این تسک تغییری داده نشد.

### نتیجه‌ی اجرای واقعی دستورها

| دستور | نتیجه | جزئیات |
|---|---|---|
| `pnpm typecheck` (سراسر مخزن) | ✅ سبز | `apps/api`، `apps/web`، `core-calc`، `contracts` — هیچ خطای TS |
| `pnpm --filter @gold/web --filter @gold/core-calc --filter @gold/contracts test` | ✅ سبز | ۲۸ فایل تست، **۳۵۸ تست** پاس (core-calc: ۱۳ فایل/۱۵۵ تست + ۵ تست نوعی؛ contracts: ۹ فایل/۱۴۷ تست؛ web: ۶ فایل/۵۶ تست) |
| `pnpm --filter web typecheck` | ✅ سبز | نام کوتاه `web` درست روی پکیج `@gold/web` resolve می‌شود — معیار «تمام است وقتی» FE-002 از این جهت مشکلی نخواهد داشت |
| `pnpm lint` (سراسر مخزن) | ❌ قرمز | ۱۹ خطا — **صفر خطا در `apps/web`، `packages/core-calc`، `packages/contracts`** (تفصیل در ردیف «ESLint rules») |

---

## جدول اصلی — وضعیت هر مورد Foundation

| # | مورد | وضعیت | مسیر(های) اصلی | یادداشت |
|---|---|---|---|---|
| 1 | React و Vite | ✅ انجام‌شده | `apps/web/vite.config.ts`, `package.json` | React 18.3.1 + Vite 5.4.11. پلاگین سفارشی `stripMockWorker` نویز MSW را از build حذف می‌کند. `build.target: 'es2022'` (لازم برای BigInt). عمداً بدون `manualChunks` (کامنت مستند در همان فایل توضیح می‌دهد چرا). |
| 2 | TypeScript strict | ✅ انجام‌شده | `tsconfig.base.json`, `apps/web/tsconfig.json` | `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride` + `exactOptionalPropertyTypes` + `useUnknownInCatchVariables` + `verbatimModuleSyntax` — سخت‌گیرتر از `strict` تنها. |
| 3 | TanStack Router | 🟡 ناقص | `apps/web/src/app/router.tsx` | نصب و کار می‌کند (`createRouter`, `defaultPreload: 'intent'`, `lazyRouteComponent` برای مسیرهای dev). فقط ۴ مسیر واقعی + ۱ مسیر تنظیمات + ۲ مسیر dev وجود دارد؛ سه‌تای اول (`/sales`, `/purchase`, `/parties`) هنوز `PlaceholderPage` هستند. هیچ‌کدام از ۱۶ مسیر فاز ۱ در FE-013 (`/login`, `/dashboard`, `/inventory/*`, `/sales/new`, ...) نیست. بدون route param، بدون صفحه‌ی Not Found. |
| 4 | TanStack Query | 🟡 ناقص | `apps/web/src/main.tsx`, `api/queries.ts` | `QueryClientProvider` با `retry:1`, `refetchOnWindowFocus:false`, `staleTime:30s`. ۶ هوک GET با `queryKey` دستی (نه factory). بدون الگوی invalidation استاندارد. **هیچ `useMutation`ای در کد مصرف نمی‌شود** — با اینکه MSW یک handler نوشتنی (`POST /api/invoices`) دارد، فرانت هنوز چیزی آن را صدا نمی‌زند. |
| 5 | Tailwind | ✅ انجام‌شده | `apps/web/tailwind.config.ts`, `postcss.config.js` | `screens` **جایگزین**‌شده (نه گسترش‌یافته): `sm:640 lg:1024 xl:1440`, پایه ۳۶۰px. رنگ‌ها کانال HSL بدون `hsl()`. `darkMode:'class'`. |
| 6 | shadcn/ui | ✅ انجام‌شده (بخشی) | `components.json`, `src/components/ui/*` | ۹ primitve نصب: `button card badge input separator skeleton dialog drawer(vaul) sheet`. سفارشی‌سازی‌شده برای هدف لمسی (`min-h-touch`, سایز `action`) و RTL (`sheet.tsx` از `start/end` استفاده می‌کند نه `left/right`). **Dialog/Sheet/Drawer فقط در هارنس دود مصرف شده‌اند، نه در هیچ صفحه‌ی واقعی**؛ abstraction مشترک Bottom-Sheet↔Dialog (آینده‌ی FE-015) هنوز وجود ندارد. |
| 7 | React Hook Form | 🟡 انجام‌شده (فقط اثبات‌شده) | `features/dev/SmokePage.tsx` | نصب + `zodResolver` کار می‌کند (فرم آزمایشی با اعتبارسنجی). **در هیچ فرم واقعی محصول استفاده نشده** چون هنوز هیچ فرم واقعی ساخته نشده. |
| 8 | Zod | ✅ انجام‌شده | `api/contracts.ts`, `api/client.ts` | schema کامل برای هر پاسخ API + اعتبارسنجی در لایه‌ی client. برای فرم هنوز استفاده نشده (به همان دلیل ردیف ۷). |
| 9 | PWA | ✅ انجام‌شده (پایه) | `vite.config.ts` (`VitePWA`), `lighthouserc.json` | manifest فارسی/RTL، precache workbox، `installable-manifest` در دروازه‌ی Lighthouse. نصب روی دستگاه Android واقعی هنوز تأیید نشده (مستند در `PERFORMANCE.md`). |
| 10 | RTL | ✅ انجام‌شده | `index.html` (`dir="rtl"`), `eslint.config.js` | اجرا با ابزار خودکار: قاعده‌ی `no-restricted-syntax` هر کلاس `ml-/mr-/pl-/pr-/left-/right-/text-left/text-right` را در `apps/web/**/*.{ts,tsx}` خطای lint می‌کند (با اجرای واقعی `pnpm lint` تأیید شد — صفر نقض). ممیزی رسمی RTL (FE-083) هنوز اجرا نشده. |
| 11 | فونت وزیرمتن | ✅ انجام‌شده | `src/styles/globals.css`, `index.html` | نسخه‌ی **بدون لاتین** self-host (۴۷KB به‌جای ۱۰۹KB)، `unicode-range` محدود، عمداً **بدون** `preload` (تصمیم مبتنی‌بر داده‌ی اندازه‌گیری‌شده در `PERFORMANCE.md` — ~۲ ثانیه بهبود LCP). ⚠️ `design-system/MASTER.md` بخش ۲ هنوز می‌گوید فونت preload می‌شود — این جمله با کد فعلی نمی‌خواند؛ کد درست‌تر است، سند باید به‌روزرسانی شود (به‌عنوان بدهی مستندسازی کوچک ثبت شد، نه باگ). |
| 12 | Tabular Numbers | ✅ انجام‌شده | `src/styles/globals.css` | `font-variant-numeric: tabular-nums` + `font-feature-settings:'tnum'` سراسری روی `body, input, button, select, textarea`. |
| 13 | `packages/core-calc` | ✅ انجام‌شده | `packages/core-calc/src/*` (۱۲ ماژول + `index.ts`) | پوشش تست **۱۰۰٪ اجباری** با آستانه‌ی `vitest.config.ts` (`lines/statements/functions/branches: 100`) — با اجرای واقعی تأیید شد (۱۵۵ تست پاس). مصرف واقعی در `apps/web` دارد (`AmountDisplay`, `date.ts`, `useMazneh`, کیپد, `fixtures.ts`). یادداشت جزئی: `coverage/coverage-summary.json` روی دیسک **قدیمی** است — `jewelry-sale.ts` را ندارد (هرچند `test/jewelry-sale.test.ts` هست و در اجرای واقعی پاس شد)؛ صرفاً با یک اجرای مجدد `coverage` رفع می‌شود، نشانه‌ی مشکل واقعی نیست. |
| 14 | بودجه JS | ✅ انجام‌شده | `scripts/check-bundle-size.mjs`, `lighthouserc.json` | دروازه‌ی gzip ۲۰۰KB مستقل از کروم (`pnpm size`) + Lighthouse CI به‌عنوان دروازه‌ی دوم. آخرین عدد ثبت‌شده در `PERFORMANCE.md` (۱۴۰۵/۰۵/۰۸): **۹۸.۶KB gzip (۴۹٪ بودجه)**. از آن تاریخ هیچ کامیت فرانتی در `git log` نبوده (فقط بک‌اند)، پس عدد باید هنوز معتبر باشد؛ در این تسک دوباره اندازه‌گیری نشد چون build کامل لازم دارد و برای هدف ممیزی ضروری نبود. |
| 15 | ESLint rules | 🔧 نیازمند اصلاح | `eslint.config.js` | قواعد دامنه‌ای (منع `Math.round/floor/ceil/trunc`, `parseFloat`, `.toFixed`, `Number()` خارج از `rounding.ts`/`number-bridge.ts`, کلاس جهت‌دار Tailwind، hex خام) **واقعاً کار می‌کنند** — با اجرای `pnpm lint` تأیید شد. سه یافته‌ی دقیق: **(الف)** `pnpm lint` سراسری همین حالا قرمز است چون `apps/api/src/modules/sales/sales-pricing.service.ts:203` قاعده‌ی `Number()` را نقض می‌کند — فایل بک‌اندی، خارج از دامنه‌ی این تسک، **اصلاح نشد**. **(ب)** پوشه‌ی `.agents/**` (اسکریپت‌های نصب‌شده‌ی یک اسکیل Claude Code، مثلاً `.agents/skills/brand/scripts/*.cjs`) در `ignores` نیست در حالی که `.claude/**` هست؛ نتیجه ۱۸ خطای بی‌ربط از ۴ فایل که اصلاً بخشی از محصول نیستند (هم `require()` روی فایل `.cjs`، هم قواعد گردکردن دامنه‌ای که برای این اسکریپت‌ها بی‌معناست). توصیه: افزودن `.agents/**` به آرایه‌ی `ignores` — تغییر یک‌خطی، بدون اثر دامنه‌ای؛ **در این تسک اعمال نشد**، چون فراتر از «اصلاح بسیار کوچک برای اجرای audit» است و باید آگاهانه تصمیم گرفته شود. **(ج)** `eslint-plugin-jsx-a11y` در `apps/web/package.json` نصب است ولی در `eslint.config.js` هیچ `import`/`plugin`/`rules` مربوط به آن نیست — نصب بی‌اثر، باید در یکی از تسک‌های بعدی (FE-003 یا FE-084) وصل شود. |
| 16 | تست‌ها | 🟡 ناقص | `apps/web/src/**/*.test.*`, `packages/*/test/**` | با اجرای واقعی همه سبزند (بخش «نتیجه‌ی اجرای واقعی» بالا). نسبت پوشش: `core-calc` و `contracts` بسیار قوی؛ `apps/web` فقط ۶ فایل تست دارد که `AmountDisplay`, `ThemeToggle`, `useTheme`, `api/client`, `contracts-package`, و کیپد را می‌پوشاند — `HomePage`, `BalanceCard`, `ProfitCard`, `RecentTransactions`, `MaznehBar`, `AppNav`, `UnitToggle`, `SettingsPage`, `api/queries.ts` **هیچ تستی ندارند**. هیچ ابزار e2e نصب نیست (`grep` برای `playwright`/`e2e` در `apps/web` صفر نتیجه داد) — اسکریپت `test:e2e` که FE-002 می‌خواهد فعلاً هیچ ابزار پشت‌صحنه‌ای ندارد. `fast-check` (property-based) نصب و در `core-calc` مصرف‌شده است. |
| 17 | design system | ✅ انجام‌شده (پایه) | `design-system/MASTER.md`, `design-system/pages/{home,keypad}.md` | توکن رنگ (روشن **و** تیره)، تایپوگرافی، فاصله، و نسبت‌های کنتراست همه **اندازه‌گیری‌شده** (نه حدسی) مستندند. بخش «تعارض‌های حل‌شده» طبق الزام بخش ۴-۱ `CLAUDE.md` موجود است (۱۵+ ردیف). فقط دو صفحه (`home`, `keypad`) سند مخصوص صفحه دارند — طبیعی، چون فقط همین دو ساخته شده‌اند؛ برای هر صفحه‌ی جدید باید طبق روال خود `FrontTasks.md` تولید شود. |
| 18 | صفحات فعلی | — | جدول جدا (پایین) | — |
| 19 | Mock dataهای فعلی | ✅ انجام‌شده (پایه) | `src/mocks/handlers/{index,fixtures}.ts`, `src/mocks/browser.ts` | ۷ endpoint (۶ GET + ۱ POST `/api/invoices`)؛ **Idempotency-Key شبیه‌سازی‌شده** (۴۰۰ اگر هدر نباشد، replay از کش برای همان کلید). همه‌ی مقادیر ساختگی از خود `core-calc` محاسبه می‌شوند (`gramRate`, `dualFromPure/dualFromRial`, `mulDivHalfUp`) نه دستی — یعنی mock نمی‌تواند بی‌صدا از فرمول واقعی جدا بیفتد. هر مقدار غیرقطعی با `// TODO(real-data):` علامت خورده. worker فقط در `import.meta.env.DEV` بار می‌شود و با پلاگین `stripMockWorker` از build production حذف می‌شود. |
| 20 | API client فعلی | 🟡 ناقص | `api/client.ts`, `api/contracts.ts`, `api/queries.ts` | fetch wrapper با تولید خودکار `Idempotency-Key` (`crypto.randomUUID` + fallback) روی هر `apiPost`، اعتبارسنجی Zod پاسخ، و تفکیک `ApiError`/`NetworkError` — همه با تست پوشش داده شده و پاس. نسبت به FE-005/006/007: **(۱)** schemaها در `apps/web/src/api/contracts.ts` **محلی و تکراری** تعریف شده‌اند، نه از `@gold/contracts` — با اینکه پکیج نصب است و import‌پذیریش در `api/contracts-package.test.ts` اثبات شده، در کد واقعی مصرف نمی‌شود (این دقیقاً همان چیزی است که قاعده‌ی بخش ۲-۹ `CLAUDE.md` منع می‌کند؛ چون FE-005 هنوز نرسیده، فعلاً یک بدهی شناخته‌شده است، نه یک نقض غافلگیرکننده). **(۲)** بدون timeout، بدون `AbortSignal` روی `apiPost` (فقط `apiGet` سیگنال می‌گیرد). **(۳)** بدون چرخه‌ی نگه‌داری کلید idempotency برای retry واقعی فرم — کلید تازه پیش‌فرض هر فراخوانی است مگر صریح داده شود. **(۴)** ساختار پوشه تخت است (`api/client.ts` + `contracts.ts` + `queries.ts`)، نه تفکیک پیشنهادی FE-006 (`api-client.ts/api-error.ts/request.ts/response.ts`). |
| 21 | ساختار state management | ✅ انجام‌شده | `stores/unit-store.ts`, `stores/theme-store.ts`, `features/keypad/keypad-store.ts` | الگوی ثابت و پیگیری‌شده: Zustand + `persist` **فقط برای تنظیمات UI** در `localStorage` (`gold-ui-unit`, `gold-ui-theme`)؛ هیچ داده‌ی مالی در `localStorage` نمی‌نشیند (بررسی شد — هیچ‌کدام از سه store داده‌ی حسابداری نگه نمی‌دارد). استور کیپد عمداً **بدون** `persist` و جدا از هر صفحه است تا هر ضربه‌ی کاربر فقط همان فیلد را رندر مجدد کند، نه کل درخت. |

**راهنمای وضعیت:** ✅ انجام‌شده · 🟡 ناقص · 🔧 نیازمند اصلاح · (بدون علامت) انجام‌نشده

---

## ردیف ۱۸ — صفحات فعلی

| مسیر | کامپوننت | وضعیت |
|---|---|---|
| `/` | `HomePage` (+ `MaznehBar`, `BalanceCard`, `ProfitCard`, `RecentTransactions`) | واقعی، با mock data زنده از MSW |
| `/sales`, `/purchase`, `/parties` | `PlaceholderPage` (مشترک) | جانگه‌دار — فقط عنوان + توضیح + `UnitToggle` |
| `/more` | `SettingsPage` | واقعی ولی فقط دو تنظیم: واحد نمایش و پوسته |
| `/_dev/smoke` | `SmokePage` | **فقط dev** — اثبات کار کردن هر پکیج نصب‌شده (Tailwind/RTL, shadcn, Router, Query, Zustand, RHF+Zod, Table+Virtual, ECharts, date-fns-jalali, Dexie, PWA, فونت). با `import.meta.env.DEV` از build production حذف می‌شود. |
| `/_dev/keypad` | `KeypadHarness` | **فقط dev** — هارنس اندازه‌گیری کیپد عددی (نتایج در `PERFORMANCE.md`) |
| — | `/login` | **وجود ندارد** — هیچ صفحه‌ی ورود یا route guard نیست؛ `/` مستقیم و بدون احراز هویت باز است (منتظر FE-026/FE-027/FE-028) |
| — | `/dashboard` مجزا | **وجود ندارد** — نقش داشبورد را همین `/` (HomePage) بازی می‌کند؛ FE-013 باید تصمیم بگیرد این دو یکی می‌مانند یا جدا می‌شوند |

یادداشت جانبی: `Dexie` فقط در `SmokePage` آزموده شده و در هیچ مسیر واقعی مصرف نمی‌شود. چون `FrontTasks.md` و `CLAUDE.md` صریحاً «queue آفلاین» و «ثبت آفلاین» را خارج از دامنه می‌دانند (بخش ۵ `CLAUDE.md`، و قواعد FE-090)، مصرف نهایی `Dexie` در فاز ۱ نامشخص است — ارزش دارد وقتی FE-090 اجرا شد آگاهانه تصمیم گرفته شود که آیا اصلاً لازم می‌ماند.

---

## تطبیق با تسک‌های بعدی

تا این تسک‌های بعدی «کد موجود را دوباره طراحی نکنند» یا برعکس «فرض نکنند از صفر شروع می‌کنند»:

| تسک | وضعیت نسبت به کد موجود |
|---|---|
| **FE-002** (اسکریپت‌ها) | اکثر اسکریپت‌های خواسته‌شده در `apps/web/package.json` از قبل هستند (`dev/build/preview/typecheck/test/test:watch`)؛ `lint`، `test:e2e`، `analyze` کم‌اند. `pnpm --filter web ...` با اجرای واقعی تأیید شد که کار می‌کند. |
| **FE-003** (`gate:frontend`) | یک `pnpm gate` سراسری در ریشه از قبل هست (`typecheck && lint && test && build && size`) ولی **کل‌مخزنی** است، نه فرانت‌محور، و همین حالا به‌خاطر یک فایل بک‌اندی + یک شکاف در `ignores` قرمز می‌شود (ردیف ۱۵ بالا). FE-003 باید نسخه‌ی scoped بسازد، نه این‌که فرض کند از صفر می‌سازد. |
| **FE-004** (ساختار پوشه‌ها) | ساختار پیشنهادی `FrontTasks.md` (`app/router/`, `app/providers/`, `app/guards/`, `shared/api`, `shared/formatters`, ...) با ساختار فعلی فرق دارد: الان `app/router.tsx` یک فایل است (نه پوشه)، `shared/` اصلاً وجود ندارد — `api/`, `components/`, `lib/`, `stores/` مستقیم زیر `src/` هستند. FE-004 باید آگاهانه تصمیم بگیرد: مهاجرت به ساختار پیشنهادی، یا مستندکردن اینکه ساختار فعلی (که در ۴ Milestone اول خوب جواب داده) کافی است. |
| **FE-005** (اتصال `packages/contracts`) | زیرساخت آماده و اثبات‌شده است (`api/contracts-package.test.ts`). کار اصلی باقی‌مانده: عوض‌کردن `api/contracts.ts` از تعریف محلی به import از `@gold/contracts`. |
| **FE-006/007/008** (API client, Idempotency, Query) | پایه‌ها کار می‌کنند (ردیف‌های ۴ و ۲۰ بالا)؛ نیاز به **تکمیل**، نه بازنویسی از صفر. |
| **FE-010** (BigInt utils) | نام‌های دقیقاً خواسته‌شده در تسک (`parseBigIntString`, `formatWeightMg`, `compareBigIntStrings`, ...) در `core-calc` با همین نام نیستند؛ معادل‌هایشان با نام‌های دیگر هست (`digitsToBigInt`, `bigIntToDigits`, `formatGram`, `formatRial`, `mulDivHalfUp`). پیش از این تسک باید تصمیم گرفت این توابع موجود کافی‌اند یا wrapper با نام‌های خواسته‌شده در `apps/web` لازم است. |
| **FE-011** (Design System) | توکن‌ها کامل‌اند، **شامل حالت تیره‌ای که در برنامه‌ریزی اولیه (`BOOTSTRAP.md` گام ۵) اصلاً نبود** ولی بعداً با تصمیم مالک محصول اضافه شد. تسک‌های بعدی نباید فرض کنند فقط حالت روشن هست. |
| **FE-012** (App Shell) | تقریباً کامل (Bottom Nav پنج‌آیتمی، سایدبار `≥1024px`، `<AmountDisplay>` مرکزی). این تسک بیشتر نقش تأیید دارد تا ساخت از صفر. |
| **FE-013** (Route Structure) | باید عملاً همه‌ی ۱۶ مسیر فاز ۱ را اضافه کند؛ فقط بخشی از آن‌ها به‌نوعی معادل دارند (و آن معادل‌ها هم مسیر متفاوتی دارند — مثلاً `/more` به‌جای `/settings`). |
| **FE-017 تا FE-019** (نرمال‌سازی فارسی، Numeric Input، کیپد) | در عمل بیشتر پیاده‌سازی شده: `persian.ts`، `DIGIT_SPECS`/`pushDigit`/`digitsToBigInt` در `core-calc/input.ts`، `useKeypadStore`، `shortcuts.ts`، `NumericKeypad.tsx`، `NumericField.tsx`، با تست و هارنس اندازه‌گیری کارایی. این تسک‌ها باید از کد موجود شروع کنند، نه از صفر. |
| **FE-023 تا FE-025** (واحد نمایش) | عملاً انجام شده، با همان نام‌بندی دقیق خواسته‌شده در تسک (`GOLD`/`RIAL` → `'gold'`/`'rial'`، پیش‌فرض `gold`، persist، `<UnitToggle>` مشترک). |
| **FE-090** (PWA پایه) | بیشتر انجام شده (manifest، precache، update notification از طریق `registerType:'autoUpdate'`)؛ باقی‌مانده بیشتر تأیید نصب روی دستگاه واقعی است، نه ساخت. |
| **FE-086** (تست دستگاه Android واقعی) | این دقیقاً همان کار ناتمامی است که `BOOTSTRAP.md` و `PERFORMANCE.md` از قبل به‌عنوان تنها مورد باز علامت زده‌اند. FE-086 باید همین را ببندد. |

---

## آنچه عمداً در این تسک انجام نشد

طبق محدودیت‌های خود FE-001 («کد عملیاتی جدید نوشته نشود»، «فقط اصلاح بسیار کوچک مجاز است»، «چیزی که وجود دارد دوباره طراحی نشود»):

- فایل بک‌اندی نقض‌کننده‌ی lint (`apps/api/src/modules/sales/sales-pricing.service.ts`) **اصلاح نشد** — خارج از دامنه‌ی فرانت.
- شکاف `ignores` در `eslint.config.js` (`.agents/**`) **اصلاح نشد** — با اینکه تک‌خطی و بی‌خطر است، تصمیمی است که باید آگاهانه گرفته شود، نه ضمنی در دل یک تسک ممیزی.
- `coverage-summary.json` قدیمی در `core-calc` دوباره تولید نشد.
- هیچ صفحه، route، کامپوننت یا استور جدیدی ساخته نشد.
- بسته‌ی production دوباره build نشد (عدد `PERFORMANCE.md` به همان اعتبار قبلی‌اش استناد شد، چون از تاریخ آخرین اندازه‌گیری هیچ کامیت فرانتی رخ نداده).

---

## نتیجه — معیار «تمام است وقتی» FE-001

- [x] وضعیت واقعی تمام ۲۱ موردِ Foundation ثبت شد (جدول اصلی) — با شواهد از کد **و** اجرای واقعی دستورها، نه فقط خواندن.
- [x] تسک‌های بعدی با نتایج ممیزی تعارض ندارند — بخش «تطبیق با تسک‌های بعدی» صریحاً هر تسکی را که باید با کد موجود شروع شود (نه از صفر) مشخص کرده.
- [x] موارد پیاده‌شده مشخص و قابل تیک‌زدن‌اند (ستون «وضعیت» جدول اصلی).
