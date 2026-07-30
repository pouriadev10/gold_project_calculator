# BOOTSTRAP.md — راه‌اندازی فرانت‌اند فاز ۱

سند خودبسنده برای کلاد کد. برای اجرای این سند **نیازی به خواندن PRD نیست**؛ هرچه لازم است اینجا آمده.

**دامنه‌ی این سند و نه بیشتر:**

1. ساخت پروژه‌ی React + TypeScript با کل استک
2. نصب و تأیید کارکرد همه‌ی پکیج‌ها
3. نصب اسکیل `ui-ux-pro-max` و تولید سیستم طراحی پروژه
4. ساخت پوسته‌ی موبایل‌فرست و **صفحه‌ی اصلی (داشبورد ورودی)** با داده‌ی ساختگی

**خارج از دامنه:** بک‌اند، دیتابیس، احراز هویت واقعی، فروش، خرید، گزارش، آفلاین. اگر تسکی تو را به این‌ها برد، **متوقف شو و بپرس**.

---

## ۰. محصول در سه جمله

نرم‌افزار حسابداری طلا و سکه برای خرده‌فروش. **واحد پایه‌ی حسابداری در این صنف ریال نیست، طلاست** — کاربر می‌گوید «این ماه ۱۰۰ گرم سود کردم» و «فلانی ۴۰ گرم بدهکار است». کاربر روی گوشی اندروید میان‌رده، با اینترنت ضعیف پاساژ بازار، در حال معامله کار می‌کند.

پیامد مستقیم برای این سند: **هر عدد مالی باید با یک کلید بین طلا و ریال جابه‌جا شود**، و **کارایی روی موبایل ضعیف یک الزام است، نه یک آرزو**.

---

## ۱. قواعد غیرقابل مذاکره

| # | قاعده |
|---|---|
| ۱ | **هیچ‌جا `number` شناور برای پول یا وزن.** ریال → `bigint` · وزن → `bigint` میلی‌گرم · سکه → `number` صحیح (تعداد) |
| ۲ | در JSON، مقادیر پولی و وزنی **رشته** منتقل می‌شوند: `{"amountRial": "12500000"}` |
| ۳ | تمام گرد کردن‌ها فقط در `packages/core-calc/src/rounding.ts`. هیچ `Math.round` دیگری در کدبیس. |
| ۴ | **موبایل‌فرست یعنی از ۳۶۰px شروع کن**، نه اینکه دسکتاپ را کوچک کنی |
| ۵ | فقط خاصیت‌های منطقی CSS: `ms-` `me-` `ps-` `pe-` `start-` `end-`. **هیچ `ml-` `mr-` `pl-` `pr-` `left-` `right-`** |
| ۶ | هدف لمسی حداقل `44×44px`. بدون استثنا. |
| ۷ | اقدام اصلی هر صفحه در **یک‌سوم پایین** (منطقه‌ی شست). هرگز بالای صفحه. |
| ۸ | هیچ اطلاعات یا اقدامی فقط با hover در دسترس نباشد |
| ۹ | اعداد با `Intl.NumberFormat('fa-IR')` نمایش، ولی **مقدار ذخیره‌شده همیشه لاتین و صحیح** |
| ۱۰ | اعداد در جدول و کارت حتماً **Tabular Numbers** وگرنه ستون ارقام موقع تغییر می‌لرزد |
| ۱۱ | فونت **لوکال**. هیچ CDN خارجی — نه گوگل‌فونت، نه jsdelivr. شبکه‌ی ایران. |
| ۱۲ | بدون ایموجی به‌عنوان آیکون. آیکون SVG (Lucide). |
| ۱۳ | هیچ رنگ hex خام در JSX. فقط توکن‌های Tailwind. |

### ضدالگوها

| نکن | چرا |
|---|---|
| `float` برای پول یا وزن | مغایرت ریالی تضمین‌شده |
| Glassmorphism / گرادیان مش / blur سنگین | روی اندروید ارزان کند است و بودجه‌ی ۲۰۰KB را می‌شکند |
| انیمیشن‌های تزئینی | INP < 200ms مقدم است |
| طراحی دسکتاپ و بعد «ریسپانسیو کردن» | نتیجه‌اش جدول فشرده و دکمه‌ی ریز است |
| تکیه بر کیبورد سیستم‌عامل برای ورود عدد | فاز بعد کیپد سفارشی می‌آید؛ فیلدها را از حالا آماده کن |
| localStorage برای داده‌ی مالی | فقط برای تنظیمات UI (واحد فعال) مجاز است |

---

## ۲. فرمول‌های دامنه (برای `core-calc`)

```
مثقال              = ۴.۶۰۸۳ گرم
عیار پایه‌ی مظنه   = ۷۰۵            (طلای آبشده‌ی ۱۷ عیار — قرارداد بازار)
ثابت تبدیل         = ۴.۶۰۸۳ × ۷۰۵ = ۳۲۴۸.۸۵۱۵

نرخ هر گرم عیار k  = مظنه × k ÷ ۳۲۴۸.۸۵۱۵
```

**پیاده‌سازی با عدد صحیح (اجباری — بدون float):**

```ts
const RATE_DIVISOR = 32_488_515n;   // 3248.8515 × 10^4
const SCALE = 10_000n;

export function gramRate(maznehRial: bigint, karat: number): bigint {
  return (maznehRial * BigInt(karat) * SCALE) / RATE_DIVISOR;
}
```

**تست پذیرش این تابع:**

| مظنه (ریال) | عیار | نتیجه‌ی انتظاری |
|---|---|---|
| ۱۰۰٬۰۰۰٬۰۰۰ | ۷۰۵ | `21699976` |
| ۱۰۰٬۰۰۰٬۰۰۰ | ۷۴۰ | `22777279` |
| ۱۰۰٬۰۰۰٬۰۰۰ | ۷۵۰ | `23085080` |
| ۱۰۰٬۰۰۰٬۰۰۰ | ۹۹۵ | `30626207` |

> ⚠️ فرمول `(مظنه ÷ ۴.۶۰۸۳) × (عیار ÷ ۷۵۰)` **غلط است** — عیار پایه‌ی مظنه را ۱۰۰۰ فرض می‌کند در حالی که ۷۰۵ است. حدود ۶٪ خطا. اگر جایی دیدی، باگ است.

**مشخصات سکه (فقط برای نمایش صفحه‌ی اصلی در این فاز):**

| نوع | وزن | عیار | طلای خالص |
|---|---|---|---|
| تمام بهار آزادی | ۸.۱۳۳ گرم | ۹۰۰ | ۷.۳۱۹۷ گرم |
| نیم | ۴.۰۶۶۵ گرم | ۹۰۰ | ۳.۶۵۹۹ گرم |
| ربع | ۲.۰۳۳۲ گرم | ۹۰۰ | ۱.۸۲۹۹ گرم |

> **قانون حباب:** فقط سکه‌ی ضرب بانک مرکزی حباب دارد. **هیچ شمشی در هیچ حالتی حباب ندارد.** در این فاز فقط نمایش، ولی مدل داده را از حالا درست بساز.

---

## ۳. ساختار پروژه

```
.
├── CLAUDE.md
├── BOOTSTRAP.md              ← همین فایل
├── design-system/
│   ├── MASTER.md             ← تولید توسط ui-ux-pro-max
│   └── pages/home.md
├── packages/
│   └── core-calc/            ← توابع خالص، بدون I/O
│       ├── src/
│       │   ├── types.ts
│       │   ├── rounding.ts
│       │   ├── karat.ts
│       │   ├── pricing.ts
│       │   ├── coin.ts
│       │   ├── persian.ts    ← نرمال‌سازی ی/ك و ارقام
│       │   └── index.ts
│       └── package.json
└── apps/
    └── web/
        ├── src/
        │   ├── app/          ← routerها
        │   ├── components/
        │   │   ├── ui/       ← shadcn
        │   │   └── common/
        │   ├── features/home/
        │   ├── stores/
        │   ├── lib/
        │   ├── mocks/        ← داده‌ی ساختگی، با TODO
        │   └── styles/
        └── package.json
```

مدیر بسته: **pnpm workspace**. TypeScript در حالت `strict`.

---

## ۴. مراحل — به همین ترتیب

### گام ۱ — مونوریپو و ابزار

- [x] `pnpm-workspace.yaml` با `apps/*` و `packages/*`
- [x] TypeScript `strict: true`، `noUncheckedIndexedAccess: true`، target `ES2022` (برای BigInt)
- [x] ESLint + Prettier مشترک در ریشه
- [x] قاعده‌ی `no-restricted-syntax` که این‌ها را خطا بدهد:
  - `Math.round` / `Math.floor` / `Math.ceil` (به‌جز در `core-calc/src/rounding.ts`)
  - `parseFloat`
  - کلاس‌های Tailwind جهت‌دار: `ml-` `mr-` `pl-` `pr-` `left-` `right-` `text-left` `text-right`
  - رنگ hex خام در JSX (`/#[0-9a-fA-F]{3,8}/`)

**✔ تمام است وقتی:** `pnpm install` · `pnpm typecheck` · `pnpm lint` هر سه سبز باشند، و فایلی با `Math.round` باعث خطای lint شود.

---

### گام ۲ — پکیج `core-calc`

- [x] `types.ts` — انواع برند‌شده: `Rial` (bigint)، `PureMg` (bigint)، `Karat`، `CoinCount`، `AssetDimension = 'rial' | 'gold' | 'silver' | \`coin:${string}\``
- [x] `rounding.ts` — `roundHalfUp(value, unit)` با واحد قابل تنظیم (پیش‌فرض ۱۰۰۰ ریال). محاسبات میانی هرگز گرد نمی‌شوند.
- [x] `karat.ts` — `toPureMg(grossMg, karat)`، `fromPureMg(pureMg, karat)`، `gramToMesghal`، `mesghalToGram`
- [x] `pricing.ts` — `gramRate` طبق بخش ۲
- [x] `coin.ts` — `intrinsicValue(coinType, gramRate1000)`، `bubble(coinType, marketPrice)`، `bullionPrice(weightMg, karat, gramRate1000)`
  - امضای `bubble()` باید طوری باشد که **پاس دادن شمش خطای زمان کامپایل بدهد**، نه اینکه صفر برگرداند
- [x] `persian.ts` — نرمال‌سازی `ی/ي`، `ک/ك`، ارقام عربی/فارسی/لاتین، نیم‌فاصله
- [x] `format.ts` — `formatRial(v)`، `formatGram(v)` با `Intl.NumberFormat('fa-IR')`

**✔ تمام است وقتی:**
- چهار مقدار جدول بخش ۲ دقیقاً بازتولید شوند
- تستی ثابت کند فرمول غلط `÷4.6083` رد می‌شود
- `expectTypeOf` ثابت کند `bubble(bullion)` کامپایل نمی‌شود
- رفت‌وبرگشت `750 → pure → 750` روی ۱۰۰۰ مقدار تصادفی (`fast-check`) خطای صفر بدهد
- جست‌وجوی «علي» رکورد «علی» را پیدا کند
- پوشش تست خطوط **۱۰۰٪**

---

### گام ۳ — اسکلت Vite + React + همه‌ی پکیج‌ها

```bash
pnpm create vite apps/web --template react-ts
```

نصب — همه در یک مرحله:

```bash
pnpm add react@18 react-dom@18
pnpm add @tanstack/react-router @tanstack/react-query zustand
pnpm add react-hook-form zod @hookform/resolvers
pnpm add @tanstack/react-table @tanstack/react-virtual
pnpm add echarts echarts-for-react
pnpm add date-fns date-fns-jalali
pnpm add dexie dexie-react-hooks
pnpm add clsx tailwind-merge class-variance-authority lucide-react
pnpm add vazirmatn

pnpm add -D tailwindcss postcss autoprefixer tailwindcss-animate
pnpm add -D vite-plugin-pwa workbox-window
pnpm add -D vitest @testing-library/react @testing-library/user-event jsdom
pnpm add -D fast-check @lhci/cli
```

سپس shadcn/ui:

```bash
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button card dialog drawer sheet input badge separator skeleton
```

پیکربندی‌های لازم:

- [x] `index.html` → `<html lang="fa" dir="rtl">`
- [x] فونت **وزیرمتن از پکیج npm**، self-host، با `font-feature-settings: "tnum"` روی اعداد
- [x] Tailwind: breakpointها `640 / 1024 / 1440`، پایه ۳۶۰px
- [x] `tsconfig` → alias `@/*`

**صفحه‌ی دود `/_dev/smoke`** — فقط در حالت توسعه، در بیلد production حذف شود. باید هر پکیج را ثابت کند:

| پکیج | تأیید |
|---|---|
| Tailwind RTL | `ms-4` درست عمل کند |
| shadcn | یک Button و یک Dialog |
| TanStack Router | دو مسیر با ناوبری |
| TanStack Query | یک fetch با loading و error |
| Zustand | یک استور کوچک |
| react-hook-form + zod | فرم با اعتبارسنجی |
| TanStack Table + Virtual | جدول ۱۰۰۰ ردیفی |
| ECharts | نمودار ساده با RTL |
| date-fns-jalali | تاریخ شمسی امروز |
| Dexie | یک read/write |
| vite-plugin-pwa | manifest تولید شود |
| وزیرمتن | متن فارسی + اعداد tabular |

**✔ تمام است وقتی:** `/_dev/smoke` همه‌ی موارد را بدون خطای کنسول نشان دهد، `pnpm build` سبز باشد، و در بیلد production این مسیر وجود نداشته باشد.

---

### گام ۴ — اسکیل `ui-ux-pro-max`

منبع: <https://github.com/nextlevelbuilder/ui-ux-pro-max-skill> (MIT) · پیش‌نیاز **Python 3.x**

```bash
npm install -g ui-ux-pro-max-cli     # از میرور npm داخلی
uipro init --ai claude                # → .claude/skills/ui-ux-pro-max
```

> از مارکت‌پلیس نصب نکن — نسخه‌های پیش از ۲.۵.۱ باگ symlink دارند.
> **پوشه‌ی اسکیل را در ریپو کامیت کن** تا بقیه‌ی تیم دوباره دانلود نکنند.

- [x] نصب و تأیید:
  ```bash
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dashboard" --domain style
  ```

- [x] تولید سیستم طراحی:
  ```bash
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py \
    "gold jewelry retail POS accounting financial dashboard invoice billing" \
    --design-system --persist -p "GoldAccounting" --stack react
  ```

- [x] صفحه‌ی اصلی:
  ```bash
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py \
    "financial dashboard home overview" \
    --design-system --persist -p "GoldAccounting" --page "home"
  ```

#### ⚠️ ترتیب اولویت هنگام تعارض

**قواعد بخش ۱ همین فایل بر هر توصیه‌ی اسکیل اولویت دارند.** این اسکیل عمدتاً برای محصولات LTR و صفحات بازاریابی تنظیم شده. جاهایی که تعارض پیش می‌آید، **قاعده‌ی ما برنده است**:

| توصیه‌ی احتمالی اسکیل | قاعده‌ی ما |
|---|---|
| Glassmorphism / Aurora / گرادیان مش | ممنوع |
| انیمیشن و micro-interaction فراوان | حداقلی |
| breakpoint شروع از دسکتاپ | شروع از ۳۶۰px |
| `margin-left` / `padding-right` | فقط خاصیت‌های منطقی |
| فونت‌های گوگل لاتین | وزیرمتن لوکال |
| تکیه بر hover | ممنوع — محصول لمسی است |
| Luxury E-commerce به‌عنوان نوع محصول | **Financial Dashboard / Invoice & Billing Tool** |

- [x] در انتهای `design-system/MASTER.md` بخشی به نام **«تعارض‌های حل‌شده»** اضافه کن که هر توصیه‌ی ردشده را با دلیل فهرست کند.

**✔ تمام است وقتی:** `design-system/MASTER.md` و `design-system/pages/home.md` موجود باشند، پالت رنگ و تایپوگرافی نهایی در آن‌ها قفل شده باشد، و بخش «تعارض‌های حل‌شده» نوشته شده باشد.

---

### گام ۵ — توکن‌های طراحی

- [x] رنگ، فاصله، شعاع و تایپوگرافی از `design-system/MASTER.md` به `tailwind.config.ts`
- [x] حالت روشن اجباری؛ حالت تاریک در این فاز نه
- [x] کنتراست متن حداقل ۴.۵:۱

**✔ تمام است وقتی:** هیچ رنگ hex خامی در `src/` نباشد (با grep بررسی کن) و قاعده‌ی lint آن را بگیرد.

---

### گام ۶ — پوسته‌ی موبایل‌فرست

- [x] Bottom Nav با ۵ آیتم: **خانه · فروش · خرید · اشخاص · بیشتر**
- [x] در `≥1024px` به سایدبار تبدیل شود
- [x] هر آیتم آیکون Lucide + برچسب فارسی، هدف لمسی ≥۴۴px
- [x] `<AmountDisplay>` — کامپوننت مرکزی رندر اعداد مالی
- [x] استور `useUnitStore` (Zustand) با مقدار `'gold' | 'rial'`، پیش‌فرض **`gold`**، ذخیره در `localStorage`
- [x] کلید تعویض واحد `<UnitToggle>` قابل استفاده در هر صفحه

> **هیچ عدد مالی‌ای نباید مستقیم رندر شود.** همه از `<AmountDisplay>` عبور کنند. این را با grep بررسی کن.

**✔ تمام است وقتی:** روی ۳۶۰px هیچ اسکرول افقی نباشد · همه‌ی هدف‌های لمسی ≥۴۴px باشند · تغییر واحد در یک صفحه، اعداد کل برنامه را هم‌زمان عوض کند.

---

### گام ۷ — صفحه‌ی اصلی (داشبورد ورودی)

مسیر `/`. اولین چیزی که کاربر پس از ورود می‌بیند. **با داده‌ی ساختگی از `src/mocks/` بساز**؛ هر ماژول که در فازهای بعد آماده شد، داده‌ی واقعی جای آن می‌نشیند. هر mock را با `// TODO(real-data):` علامت بزن.

پیش از کد زدن، `design-system/pages/home.md` را بخوان.

**چیدمان از بالا به پایین:**

```
┌─────────────────────────────────────────┐
│ ① نوار مظنه  (sticky top)               │
│    مظنه مثقال · نرخ گرم ۷۵۰ · سکه تمام  │
│    برچسب زمان + نشانگر آنلاین/آفلاین     │
├─────────────────────────────────────────┤
│ ② کلید تعویض واحد   [ طلا | ریال ]      │
├─────────────────────────────────────────┤
│ ③ کارت مانده                             │
│    بستانکار / بدهکار — با واحد فعال      │
├─────────────────────────────────────────┤
│ ④ کارت سود                               │
│    امروز · این ماه — پیش‌فرض به گرم      │
│    تفکیک: عملیاتی / نوسان / حباب سکه     │
├─────────────────────────────────────────┤
│ ⑤ آخرین ۵ معامله  (فهرست کارتی)         │
│    زیر ۶۴۰px جدول نداریم                 │
├─────────────────────────────────────────┤
│                                          │
│ ⑥ منطقه‌ی شست — یک‌سوم پایین             │
│   ┌────────────┐  ┌────────────┐        │
│   │   فروش     │  │    خرید    │        │
│   └────────────┘  └────────────┘        │
├─────────────────────────────────────────┤
│ ⑦ Bottom Nav                             │
└─────────────────────────────────────────┘
```

**جزئیات:**

- [x] نوار مظنه از یک هوک `useMazneh()` بخواند که فعلاً mock برمی‌گرداند. برچسب زمان همیشه دیده شود — **هرگز وانمود نکن قیمت به‌روز است.**
- [x] کارت سود در حالت طلا این‌طور بخواند: «این ماه ۲۵۰ گرم سود — ۲۵٪»
- [x] دکمه‌های فروش و خرید: ارتفاع ≥۵۶px، در یک‌سوم پایین، همیشه بدون اسکرول دیده شوند
- [x] حالت‌های `loading` (Skeleton) و `empty` برای هر کارت
- [x] در `≥1024px` چیدمان به دو یا سه ستون باز شود، نه اینکه کشیده شود

**✔ تمام است وقتی:**

- روی ۳۶۰px بدون اسکرول، مظنه و مانده و هر دو دکمه‌ی اصلی دیده شوند
- تغییر واحد، همه‌ی اعداد صفحه را هم‌زمان عوض کند
- هیچ خطای کنسولی نباشد
- LCP روی 3G شبیه‌سازی‌شده **زیر ۲.۵ ثانیه**
- بسته‌ی اولیه‌ی JS **زیر ۲۰۰KB فشرده**
- چک‌لیست pre-delivery اسکیل `ui-ux-pro-max` اجرا و پاس شده باشد

---

### گام ۸ — PWA و دروازه‌ی کارایی

- [x] `vite-plugin-pwa` با precache پوسته + manifest فارسی + آیکون‌ها
- [x] Lighthouse CI با بودجه: JS < 200KB · LCP < 2.5s · INP < 200ms
- [x] بودجه به‌عنوان **دروازه‌ی merge** در CI

**✔ تمام است وقتی:** PR‌ای که بسته را به ۲۵۰KB برساند، در CI قرمز شود.

---

## ۵. بررسی نهایی پیش از تحویل

- [x] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` همه سبز
- [x] پوشش تست `packages/core-calc` برابر ۱۰۰٪
- [x] grep: هیچ `Math.round` خارج از `rounding.ts`
- [x] grep: هیچ `ml-` `mr-` `pl-` `pr-` `left-` `right-` در JSX
- [x] grep: هیچ رنگ hex خام در `src/`
- [x] grep: هیچ عدد مالی خارج از `<AmountDisplay>`
- [x] grep: هیچ URL خارجی برای فونت یا CDN
- [x] `/_dev/smoke` در بیلد production وجود ندارد
- [ ] تست روی یک اندروید میان‌رده‌ی **واقعی** — شبیه‌ساز کافی نیست
      ⚠️ انجام نشده: دستگاه فیزیکی در دسترس نبود. اندازه‌گیری‌ها با شبیه‌سازی
      Lighthouse (CPU ×۴) انجام شده — طبق بخش ۷ CLAUDE.md این کافی نیست و
      پیش از تحویل فاز ۱ باید روی دستگاه واقعی تکرار شود. جزئیات در `PERFORMANCE.md`.
- [x] `design-system/MASTER.md` بخش «تعارض‌های حل‌شده» دارد

---

## ۶. روال کار

1. گام‌ها ترتیب دارند. اولین چک‌باکس تیک‌نخورده را بردار.
2. اگر گامی بیش از یک نشست طول می‌کشد، اول آن را بشکن و در همین فایل بنویس.
3. برای هر کار UI، ابتدا `design-system/pages/<صفحه>.md` و در نبودش `MASTER.md` را بخوان.
4. **معیار «✔ تمام است وقتی» را واقعاً بررسی کن.** تیک زدن بدون بررسی ممنوع.
5. یک گام، یک کامیت: `[bootstrap] عنوان گام`.
6. اگر چیزی خلاف بخش ۱ لازم شد، **کد نزن — بپرس.**
