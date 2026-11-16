# حسابداری طلا، نقره و سکه

نرم‌افزار حسابداری برای صنف طلا که واحد پایه‌اش **طلا** است، نه ریال: «این ماه ۱۰۰ گرم سود کردم»،
«فلانی ۴۰ گرم بدهکار است». فاز ۱ برای خرده‌فروشی است که زیورآلات و سکه می‌فروشد و از مصرف‌کننده طلا
می‌خرد.

پیش از هر تغییری [`CLAUDE.md`](CLAUDE.md) را بخوان. قواعد غیرقابل مذاکره (دقت عددی با `bigint`، سکه
به‌عنوان شیء، حباب فقط برای سکه‌ی بانک مرکزی، دفتر کل append-only، قفل نرخ و دامنه‌ی فاز ۱) آنجاست.

## ساختار

| مسیر | چیست |
|---|---|
| `apps/api` | NestJS روی Node 22، مونولیت ماژولار، PostgreSQL 16 با Drizzle و RLS |
| `apps/web` | React 18 + Vite، PWA ِ موبایل‌فرست و RTL |
| `packages/core-calc` | توابع خالص محاسبه (قیمت، عیار، حباب، گرد کردن)، مشترک سرور و مرورگر |
| `packages/contracts` | schemaهای zod ِ مشترک API |

`core-calc` و `contracts` برای وب و آزمون‌ها از منبع TypeScript خوانده می‌شوند و برای اجرای API از
خروجی CommonJS ِ `dist`. پس پس از تغییرشان، پیش از اجرای `node apps/api/dist/main.js` یا ساخت ایمیج،
`pnpm build` لازم است.

## اجرا در توسعه

پیش‌نیاز: Node 22 یا بالاتر، pnpm (نسخه در `packageManager` ِ `package.json`)، و Docker برای دیتابیس.

```bash
pnpm install
```

**فقط وب، با API ِ ساختگی (MSW):**

```bash
pnpm dev
```

**API ِ واقعی:** دیتابیس را بالا بیاور، مهاجرت را صریح اجرا کن، پکیج‌ها را بساز و API را راه بینداز.
API فایل `.env` نمی‌خواند؛ متغیرهای `apps/api/.env.example` باید در محیط شل باشند. دو کلید JWT هم
الزامی‌اند.

```bash
docker compose up -d db
```

```bash
docker compose --profile tools run --rm migrate
```

```bash
pnpm build
```

```bash
pnpm dev:api
```

برای اینکه وب به همین API وصل شود، در `apps/web/.env` مقدار `VITE_API_MODE=real` را بگذار. proxy ِ Vite
پیشوند `/api` را برمی‌دارد و به `http://localhost:3000` می‌فرستد (`VITE_API_PROXY_TARGET`).

## آزمون و دروازه‌ها

| فرمان | چه می‌کند |
|---|---|
| `pnpm typecheck` · `pnpm lint` · `pnpm test` | بررسی نوع، قواعد ESLint (از جمله ممنوعیت گرد کردن بیرون از `rounding.ts`) و همه‌ی آزمون‌ها |
| `pnpm --filter @gold/api test:integration` | آزمون‌های integration ِ API روی PostgreSQL |
| `pnpm build` | بیلد همه‌ی پکیج‌ها؛ بیلد وب بودجه‌ی ۲۰۰KB و نبود mock و `console` را هم می‌سنجد |
| `pnpm gate:frontend` · `pnpm gate:backend` | دروازه‌ی کامل هر طرف، شامل پوشش ۱۰۰٪ ِ core-calc (جزئیات: [`docs/backend-gate.md`](docs/backend-gate.md)) |

CI همان‌ها را در [`.github/workflows/ci.yml`](.github/workflows/ci.yml) اجرا می‌کند.

## استقرار

`docker-compose.yml` محیط توسعه‌ی بک‌اند است: PostgreSQL و API. پشتیبان‌گیری و بازیابی در
[`docs/backup-restore.md`](docs/backup-restore.md) است. چیدمان production (سرو PWA، reverse proxy ای که
`/api` را بردارد، TLS، و `trustProxy`) هنوز تعریف نشده و تصمیم D-18 است.

## مستندات

- کار: [`TASKS.md`](TASKS.md) (بک‌اند) و [`FrontTasks.md`](FrontTasks.md) (فرانت‌اند)، به ترتیب.
- بازبینی ماژول‌به‌ماژول: [`MODULE-AUDIT.md`](MODULE-AUDIT.md). تصمیم‌های باز: [`PENDING-DECISIONS.md`](PENDING-DECISIONS.md).
- دفتر کل و postingها: [`docs/accounting-postings.md`](docs/accounting-postings.md).
- API: [`docs/api.md`](docs/api.md) و [`docs/openapi.json`](docs/openapi.json).
- معماری فرانت‌اند: [`docs/frontend-architecture.md`](docs/frontend-architecture.md). سیستم طراحی: [`design-system/MASTER.md`](design-system/MASTER.md).
- پذیرش فاز ۱، کارایی، دسترس‌پذیری و آزمون روی دستگاه: [`docs/`](docs/).
