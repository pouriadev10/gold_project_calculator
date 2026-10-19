# دروازه‌ی بک‌اند — BE-071

```bash
pnpm gate:backend
```

یک دستور برای همه‌ی قواعد اصلی بک‌اند. هر قانون یک مرحله‌ی نام‌دار است؛ اولین شکست بقیه را متوقف
می‌کند و جدول پایانی وضعیت همه را نشان می‌دهد. روی CI همان دستور در job ِ `backend-gate` اجرا می‌شود
(`.github/workflows/ci.yml`، با سرویس `postgres:16-alpine`).

## پیش‌نیاز

یک PostgreSQL 16 که کاربرش اجازه‌ی ساخت دیتابیس دارد — همان سرویس `db` ِ docker compose کافی است:

```bash
docker compose up -d db
```

اتصال مدیریتی با `GATE_DATABASE_URL` (پیش‌فرض `postgresql://gold:gold@localhost:5432/postgres`).
دروازه دیتابیس **تازه‌ی** `gold_gate` را می‌سازد، همه‌ی مهاجرت‌ها را از صفر روی آن اعمال می‌کند،
آزمون‌ها را روی آن اجرا می‌کند و در پایان پاکش می‌کند. دیتابیس توسعه و `gold_test` دست نمی‌خورند.

## مرحله‌ها

| id | چه چیزی | شکست نمونه |
|---|---|---|
| `typescript` | `tsc` روی api، contracts، core-calc | `src/x.ts(12,3): error TS2322` |
| `eslint` | ESLint روی بک‌اند و اسکریپت‌های دروازه | `src/x.ts  1:47  error … no-restricted-syntax` |
| `bans` | `scripts/check-backend-bans.mjs` — پایین | `src/x.ts:9 [money-weight-ts-number] …` |
| `idempotency` | هر endpoint نوشتنی کلید را به `IdempotencyService` می‌دهد | `src/…controller.ts:38 [write-endpoint-idempotency] POST /… — …` |
| `unit` | تست‌های واحد سه بسته، از جمله تازگی `docs/openapi.json` | |
| `coverage` | پوشش ۱۰۰٪ ِ `core-calc` (خط، شاخه، تابع، دستور) | `gate-drill.ts | 0 | … | 1-3` |
| `migrations` | اسکیمای Drizzle = آخرین مهاجرت؛ مهاجرت روی دیتابیس خالی اعمال و تکرارش بی‌اثر است | `apps/api/src/platform/database/schema [migration-drift] …` |
| `property` | آزمون‌های fast-check: موتور محاسبات و ناوردای دفتر کل روی دیتابیس واقعی | |
| `integration` | همه‌ی e2e های `apps/api/test` روی `gold_gate` | |
| `invariants` | `verify-restore.mjs` روی داده‌ی همه‌ی آزمون‌ها: ناوردای دفتر کل، شکاف شماره‌ی فاکتور، موجودی منفی، RLS و جداسازی، append-only | `ledger unbalanced: tx … sums to 7` |
| `build` | build ِ contracts و api | |

### `bans`

1. **قواعد ESLint برای بک‌اند واقعاً روشن‌اند.** قطعه‌های عمداً خطا (`Math.round/floor/ceil/trunc`،
   `parseFloat`، `toFixed`، `Number()`، `any`، `@ts-ignore`) روی مسیرهای واقعی بک‌اند با همان
   `eslint.config.js` lint می‌شوند و هر کدام باید رد شود. اگر override ای قاعده را برای `apps/api`
   خاموش کند، این‌جا می‌شکند — نه بی‌صدا.
2. **پول و وزن با `number`** (نام با پسوند `Rial`/`Mg`/`Ug` و چند نام رایج):
   - `[money-weight-db-type]` ستون Drizzle از نوع `integer`/`numeric`/… یا `bigint({ mode: 'number' })`
   - `[ledger-quantity-type]` ستون `quantity` ِ دفتر کل یا حرکت موجودی که `bigint({ mode: 'bigint' })` نیست
   - `[money-weight-json-number]` فیلد قرارداد با `z.number()`
   - `[money-weight-ts-number]` نوع `number` در `apps/api/src`
3. **`[rule-suppressed]`** — `eslint-disable` برای همین قواعد یا `@ts-nocheck` در کد بک‌اند.

تعداد سکه، عیار، نسخه، شماره‌ی فاکتور و تعداد قلم فاکتور عمداً `number` ِ مجازند (CLAUDE.md ۲-۱).

## گزینه‌ها

```bash
pnpm gate:backend --only=bans,idempotency   # فقط همین مرحله‌ها (دروازه‌ی کامل نیست)
pnpm gate:backend --keep-db                 # gold_gate را برای بررسی نگه دار
```

پس از رفع یک شکست، پیام پایانی دستور تکرار همان مرحله را می‌دهد.

## اثبات «شکستن قانون، دروازه را می‌شکند» — ۱۴۰۵/۰۷/۲۷

هر قانون یک بار عمداً شکسته شد و مرحله‌ی خودش قرمز شد، با مسیر فایل و نام قانون در پیام:
`Math.round`، `any`، `@ts-ignore`، `Number()`، `eslint-disable` (`[rule-suppressed]`)،
`amountRial: z.number()`، ستون `priceRial: integer()`، `payableRial: number`، `quantity` ِ دفتر کل از
نوع `integer`، خاموش کردن `no-restricted-syntax` برای `apps/api` در `eslint.config.js`،
`{ key: undefined }` به‌جای کلید idempotency، ستون تازه در اسکیما بدون مهاجرت، و تابع بی‌تست در
core-calc. دروازه‌ی کامل روی یک `postgres:16-alpine` ِ تازه (همان پیکربندی CI) سبز است.
