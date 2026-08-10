# ساختار پوشه‌های apps/web/src — FE-004

این فایل مرزهای فعلی کد فرانت را مستند می‌کند: چه چیزی کجاست و چرا. دو سند
دیگر عمداً همین حالا نوشته نمی‌شوند تا با این یکی تداخل نکنند:

* `docs/frontend-architecture.md` — سند کامل معماری (API client، contracts،
  BigInt، auth، idempotency، ...) — مال **FE-107** است، خیلی جلوتر.
* `apps/web/README.md` — راهنمای اجرا (dev، build، env، تست روی اندروید) —
  مال **FE-108** است.

این سند فقط یک چیز را جواب می‌دهد: **یک فایل جدید را کجا بگذارم، و چرا آنجا؟**

---

## ۱. ساختار فعلی (واقعی، نه آرمانی)

```text
apps/web/
├── scripts/
│   └── e2e-not-ready.mjs        جاگیر test:e2e تا FE-098 (FE-002)
└── src/
    ├── api/                     لایه‌ی HTTP: client, contracts (zod), queries (TanStack Query)
    ├── app/
    │   └── router.tsx           تعریف routeها + RootLayout (فعلاً یک فایل، نه پوشه)
    ├── components/
    │   ├── common/              کامپوننت‌های عمومی دست‌ساز — بین Featureها مشترک
    │   ├── keypad/               صفحه‌کلید عددی سفارشی — زیرسیستم مشترک، نه یک Feature
    │   └── ui/                  primitiveهای shadcn/ui (button, card, dialog, ...)
    ├── features/                فقط منطق و صفحات مخصوص یک حوزه‌ی کسب‌وکار
    │   ├── dev/                 صفحات فقط-توسعه (حذف از build production)
    │   ├── home/                داشبورد ورودی
    │   └── settings/             تنظیمات کاربر
    ├── hooks/                   هوک‌های عمومی مستقل از Feature (useTheme)
    ├── lib/                     توابع کمکی بدون state (utils, theme, date)
    ├── mocks/                   MSW — handlers + fixtures ساختگی
    ├── stores/                  Zustand — فقط تنظیمات UI (unit, theme)
    ├── styles/                  globals.css — نقطه‌ی ورود Tailwind
    ├── test/                    setup مشترک vitest
    └── main.tsx                 نقطه‌ی ورود برنامه
```

## ۲. نگاشت به ساختار پیشنهادی `FrontTasks.md`

`FrontTasks.md` (بخش FE-004) یک ساختار هدف نشان می‌دهد. جدول زیر نگاشت هر
بخش از آن به وضعیت واقعی امروز است — تا تسک‌های بعدی گمان نکنند باید از صفر
پوشه بسازند یا مسیر اشتباه import بزنند.

| پیشنهادی | وضعیت واقعی | یادداشت |
|---|---|---|
| `app/router/` | `app/router.tsx` | یک فایل کافی است؛ با ۶ route اسپلیت به پوشه زودهنگام است. وقتی route اول nested/lazy پیچیده شد، بشکن. |
| `app/providers/` | داخل `main.tsx` | `QueryClientProvider` فقط ۵ خط است. جدا کردنش الان یک indirection بی‌فایده می‌سازد. |
| `app/layouts/` | `RootLayout` داخل `router.tsx` | فقط یک layout داریم. دومی که آمد (مثلاً layout بدون nav برای auth) جدا شود. |
| `app/guards/` | وجود ندارد | Auth هنوز نیامده (FE-026 تا FE-028). پوشه‌ی خالی نمی‌سازیم. |
| `shared/api` | `api/` (یک سطح بالاتر) | همان نقش را دارد. تغییر نام بدون فایده — کد پایدار است و تست‌شده. |
| `shared/components` | `components/common/` + `components/ui/` | `ui/` = primitive نصب‌شده (shadcn)، `common/` = ساخت خودمان. این تفکیک از خودِ تفکیک shared/features مهم‌تر است. |
| `shared/hooks` | `hooks/` | همان نقش، یک سطح بالاتر. |
| `shared/lib` | `lib/` | همان نقش، یک سطح بالاتر. |
| `shared/formatters` | داخل `@gold/core-calc` | قالب‌بندی مالی باید **عیناً** با سرور یکی باشد (بخش ۴-۱ CLAUDE.md) — یک پکیج مشترک ضامن قوی‌تری از یک پوشه‌ی محلی است. اینجا فقط از آن import می‌کنیم. |
| `shared/schemas` | داخل `api/contracts.ts` | موقتی. FE-005 این فایل را با import از `@gold/contracts` جایگزین می‌کند؛ جدا کردن `shared/schemas` قبل از آن کار دوباره است. |
| `shared/forms` | وجود ندارد | هنوز هیچ فرم واقعی ساخته نشده (React Hook Form فقط در هارنس دود اثبات شده). اولین فرم واقعی (احتمالاً FE-030 یا FE-033) این پوشه را با یک الگوی واقعی می‌سازد، نه خالی. |
| `shared/types` | کنار مصرف‌کننده‌اش | مثلاً `MaznehSnapshot` در `useMazneh.ts`. وقتی یک type بین ≥۲ Feature مشترک شد، به یک مکان مشترک منتقل می‌شود؛ زودتر از آن حدس زدن است. |
| `features/{auth,pricing,parties,inventory,sales,purchase,settlements,invoices,reporting}` | فقط `home/`, `settings/`, `dev/` وجود دارد | بقیه ساخته می‌شوند وقتی تسک مربوطه (Milestone 6 به بعد) برسد. `home` در لیست پیشنهادی نیست ولی همان نقش داشبورد را دارد. |
| (بدون معادل در پیشنهاد) | `stores/`, `mocks/`, `styles/`, `test/` | زیرساخت سراسری برنامه‌اند، نه «کد مشترک بین Featureها» — به همین دلیل در سطح `src/` می‌مانند، نه زیر `shared/`. |

**نتیجه:** هیچ `shared/` به‌عنوان یک پوشه‌ی واحد ساخته نشد. نقشش را همین
حالا `components/` + `hooks/` + `lib/` + `api/` + `stores/` در سطح `src/`
بازی می‌کنند. تغییر نامش یک rename بزرگ روی ~۴۰ فایل پایدار و تست‌شده بود
بدون این‌که هیچ قاعده‌ی جدیدی را ممکن کند که همین ساختار نکند — دقیقاً همان
چیزی که قاعده‌ی «ساختار موجود بدون دلیل بازنویسی نشود» (FE-004) منع می‌کند.

## ۳. قواعد مرز (روی نام‌های واقعی)

* **منطق Feature در `features/*` می‌ماند.** چیزی که فقط یک حوزه‌ی کسب‌وکار
  به آن نیاز دارد (مثلاً `BalanceCard` که فقط داشبورد استفاده می‌کند) داخل
  همان `features/<name>/` می‌ماند، نه در `components/`.
* **کامپوننت عمومی فقط در `components/` قرار می‌گیرد** — چه `ui/` (primitive
  بیرونی) چه `common/` (ساخت خودمان). معیار: اگر **بیش از یک Feature** به آن
  نیاز دارد یا در آینده‌ی نزدیک نیاز خواهد داشت (طبق `FrontTasks.md`)، اینجا
  می‌آید، نه در یک `features/*` که اسمش گمراه‌کننده می‌شود.
* **هیچ Feature مستقیماً internals یک Feature دیگر را import نمی‌کند.**
  `app/router.tsx` صفحه‌ی سطح‌بالای هر Feature را import می‌کند — این جزو
  قاعده نیست، چون `app/` لایه‌ی composition است، نه یک Feature. آنچه ممنوع
  است: `features/x/*` که مستقیماً از `features/y/InternalThing` بخواند.

## ۴. اجرای خودکار (نه فقط قرارداد نوشته‌شده)

دو قاعده‌ی بالا با ابزار خودکار پشتیبانی می‌شوند، نه فقط با این سند:

* **بدون import از `apps/api`:** قاعده‌ی ESLint `no-restricted-imports`
  (`eslint.config.js`, از FE-003) هم نام پکیج `@gold/api` و هم مسیر نسبی به
  داخل `apps/api/` را می‌گیرد.
* **بدون circular dependency:** `pnpm --filter web check:circular`
  (madge، با نگاشت alias از `tsconfig.json`) — بخشی از `pnpm gate:frontend`.
  بدون تنظیم صریح `--ts-config`، madge حدود یک‌سوم فایل‌ها (هرچه با `@/`
  import شده) را بی‌صدا نادیده می‌گرفت؛ این نکته عمداً اینجا ثبت شد تا اگر
  روزی نسخه‌ی madge عوض شد، این رفتار دوباره کشف نشود.

madge فعلاً مرز `features/x` در برابر `features/y` را به‌صورت مستقیم چک
نمی‌کند (فقط چرخه را می‌گیرد، نه جهت مجاز/غیرمجاز). اگر تعداد Featureها
زیاد شد و این مرز مهم‌تر شد، `eslint-plugin-boundaries` گزینه‌ی بعدی است —
تا آن زمان، مرور PR کافی است چون تعداد Featureها کم است.

## ۵. جابه‌جایی‌های همین تسک

* `features/keypad/` → `components/keypad/` — کیپد عددی زیرساخت مشترک
  ورودی است، نه یک حوزه‌ی کسب‌وکار؛ طبق FE-018 تا FE-022 قرار است از
  **چند** Feature آینده (فروش، خرید، تسویه) مستقیماً استفاده شود. قبل از
  این جابه‌جایی، `features/dev/KeypadHarness.tsx` همین حالا داشت
  internals یک «Feature» دیگر (`features/keypad`) را import می‌کرد —
  دقیقاً همان الگویی که این تسک قرار است جلویش را بگیرد.
* `features/placeholder/PlaceholderPage.tsx` → `components/common/PlaceholderPage.tsx`
  — یک stub عمومی بدون هیچ منطق دامنه‌ای، از سه route نامرتبط
  (`/sales`, `/purchase`, `/parties`) استفاده می‌شود.
* هیچ فایل دیگری جابه‌جا یا بازنویسی نشد.

## ۶. Aliasها

فقط یک alias در کل پروژه: `@/*` → `./src/*` (هم در `tsconfig.json` هم در
`vite.config.ts`). alias جدا برای `@features/*` یا `@shared/*` اضافه نشد —
یک alias با مسیر کامل (`@/features/home/HomePage`) هم به‌اندازه‌ی کافی
گویا است و نگهداری‌اش ساده‌تر از هماهنگ‌نگه‌داشتن چند alias در دو ابزار
(tsc و vite) است.
