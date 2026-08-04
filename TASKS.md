# TASKS.md — Backend Phase 1

## دستور اجرای تسک‌ها

- همیشه اولین تسک تیک‌نخورده را انجام بده.
- هر تسک باید در یک کامیت مستقل انجام شود.
- پیام کامیت باید با شناسه‌ی تسک شروع شود:
  - `[BE-001] Bootstrap NestJS API`
- بدون اجرای تست‌ها، تسک را تیک نزن.
- هیچ فایل خارج از دامنه‌ی تسک را تغییر نده.
- اگر پیاده‌سازی نیازمند نقض `CLAUDE.md` بود، کدنویسی را متوقف کن.
- هیچ ویژگی خارج از فاز ۱ اضافه نکن.
- هیچ مقدار صنفی را در کد هاردکد نکن.
- هیچ مقدار پولی یا وزنی را با `number` ذخیره یا منتقل نکن.
- تمام ورودی‌ها و خروجی‌های پول و وزن در API باید رشته باشند.
- همه‌ی عملیات نوشتنی باید `Idempotency-Key` داشته باشند.
- تمام جداول داده‌ی مستأجر باید `tenant_id` و RLS داشته باشند.
- `ledger_entries` فقط Append-Only است.
- هر تراکنش دفتر کل باید در هر بُعد مجموع صفر داشته باشد.

> **روال نشست:** پس از پایان هر تسک، اجازه‌ی شروع تسک بعدی از کاربر گرفته می‌شود.

---

# Milestone 1 — زیرساخت بک‌اند

## [x] BE-001 — ساخت اپلیکیشن NestJS

**هدف** — ایجاد اپلیکیشن بک‌اند در همان Monorepo فعلی.

**کارها**

- ساخت `apps/api`
- نصب و تنظیم NestJS روی Node.js 22
- فعال کردن TypeScript strict
- اضافه کردن اسکریپت‌های زیر: `dev` · `build` · `start` · `typecheck` · `test` · `test:integration`
- اضافه کردن API به workspace فعلی
- ایجاد endpoint زیر:

```http
GET /health
```

خروجی:

```json
{
  "status": "ok"
}
```

**محدودیت‌ها**

- از Fastify به‌عنوان HTTP adapter استفاده شود.
- هیچ منطق دامنه‌ای در `AppController` قرار نگیرد.
- هیچ دیتابیسی در این تسک اضافه نشود.

**تمام است وقتی**

- `pnpm --filter api build` موفق باشد.
- `pnpm --filter api typecheck` موفق باشد.
- تست `/health` سبز باشد.
- اجرای کل workspace شکسته نشود.

---

## [x] BE-002 — ساختار Modular Monolith

**هدف** — ایجاد ساختار اولیه‌ی ماژول‌ها بدون پیاده‌سازی منطق تجاری.

**ساختار**

```text
apps/api/src/
├── app.module.ts
├── main.ts
│
├── platform/
│   ├── auth/
│   ├── tenant/
│   ├── users/
│   ├── audit/
│   ├── database/
│   ├── idempotency/
│   └── request-context/
│
├── modules/
│   ├── ledger/
│   ├── pricing/
│   ├── parties/
│   ├── inventory/
│   ├── sales/
│   ├── purchase/
│   ├── settlement/
│   ├── reporting/
│   └── tax/
│
└── shared/
    ├── errors/
    ├── validation/
    ├── serialization/
    └── types/
```

**محدودیت‌ها**

- ماژول `tax` فقط اسکلت خالی باشد.
- هیچ ماژول خارج از فاز ۱ ساخته نشود.
- بین ماژول‌ها circular dependency ایجاد نشود.

**تمام است وقتی**

- همه‌ی ماژول‌ها توسط NestJS قابل resolve باشند.
- API بدون خطای dependency injection اجرا شود.
- برای ماژول `tax` هیچ endpoint عملیاتی وجود نداشته باشد.

---

## [x] BE-003 — پکیج قراردادهای مشترک

**هدف** — ساخت پکیج مشترک برای قراردادهای API میان فرانت و بک‌اند.

**ساختار**

```text
packages/contracts/
├── src/
│   ├── common/
│   ├── pricing/
│   ├── parties/
│   ├── inventory/
│   ├── ledger/
│   ├── sales/
│   └── purchase/
├── package.json
└── tsconfig.json
```

**کارها**

- نصب Zod
- تعریف schemaهای مشترک: UUID · تاریخ ISO · `BigIntString` · `PositiveBigIntString` ·
  `NonNegativeBigIntString` · Pagination · API error
- تعریف typeهای قراردادی:

```ts
type RialString = string;
type WeightMgString = string;
type QuantityString = string;
```

**قواعد**

- schema مربوط به BigInt فقط رشته‌ی صحیح معتبر بپذیرد.
- مقدار `"12.5"` نامعتبر باشد.
- مقدار `"۱۲۳"` در API نامعتبر باشد؛ نرمال‌سازی قبل از validation انجام شود.
- قراردادها نباید به NestJS، Drizzle یا React وابسته باشند.

**تمام است وقتی**

- پکیج هم در `apps/web` و هم در `apps/api` قابل import باشد.
- تست schemaهای معتبر و نامعتبر نوشته شده باشد.
- هیچ type مربوط به دیتابیس در این پکیج وجود نداشته باشد.

---

## [x] BE-004 — تنظیم Config و Environment Validation

**هدف** — اعتبارسنجی متغیرهای محیطی در لحظه‌ی راه‌اندازی.

**متغیرهای اولیه**

```text
NODE_ENV
PORT
DATABASE_URL
LOG_LEVEL
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
```

**کارها**

- validation با Zod
- توقف startup در صورت نبود متغیر اجباری
- ایجاد `.env.example`
- جلوگیری از log شدن secretها

**تمام است وقتی**

- برنامه با env ناقص اجرا نشود.
- پیام خطا نام متغیر نامعتبر را مشخص کند.
- `.env` وارد Git نشده باشد.

---

## [x] BE-005 — Docker Compose توسعه

> **وضعیت:** با `docker compose up --build` روی محیط کاربر تأیید شد —
> هر دو سرویس `healthy` و `GET /health` → `{"status":"ok"}`.

**هدف** — اجرای محیط توسعه‌ی بک‌اند و PostgreSQL با یک دستور.

**سرویس‌ها** — PostgreSQL 16 · API

**کارها**

- ساخت Dockerfile چندمرحله‌ای API
- اضافه کردن healthcheck دیتابیس
- استفاده از volume برای داده‌های توسعه
- اضافه کردن دستور migration هنگام توسعه، بدون اجرای خودکار destructive migration

**محدودیت‌ها**

- Redis در این مرحله اضافه نشود.
- BullMQ در این مرحله اضافه نشود.
- عملیات مالی اصلی بعداً نیز نباید به صف منتقل شود.

**تمام است وقتی**

```bash
docker compose up
```

API و PostgreSQL را بالا بیاورد و `/health` پاسخ دهد.

---

# Milestone 2 — دیتابیس، مستأجر و امنیت پایه

## [x] BE-006 — راه‌اندازی Drizzle و Migration

> **وضعیت:** با `docker compose --profile tools run migrate` روی
> `gold_test` تأیید شد — جدول با ستون‌های snake_case ساخته شد، اجرای
> دوباره‌ی مهاجرت idempotent بود، و کل `test:integration` (۲۶ تست) روی
> دیتابیس واقعی سبز شد.

**هدف** — اتصال PostgreSQL به API با Drizzle ORM.

**کارها**

- نصب Drizzle و driver PostgreSQL
- ایجاد DatabaseModule
- ایجاد migration system
- ساخت جدول آزمایشی migration metadata در صورت نیاز
- تعریف naming convention: نام جداول و ستون‌ها `snake_case` · نام TypeScriptها `camelCase`

**قواعد**

- migrationهای اعمال‌شده هرگز ویرایش نشوند.
- تغییر schema فقط با migration جدید انجام شود.
- SQLهای حساس مالی باید قابل مشاهده و review باشند.

**تمام است وقتی**

- migration اولیه روی دیتابیس خالی اجرا شود.
- اتصال قطع‌شده باعث خطای واضح startup شود.
- integration test اتصال دیتابیس سبز باشد.

---

## [x] BE-007 — جدول Tenants

> **وضعیت:** مهاجرت روی `gold_test` اعمال و با psql بررسی شد —
> `timezone` پیش‌فرضش در خود ستون دیتابیس است، `tenants_slug_unique`
> محدودیت واقعی است، و `tenant_status` یک enum واقعی PostgreSQL.
> ۴۱ تست e2e سبز، شامل فایل جداگانه‌ای که با `NODE_ENV=production`
> بالا می‌آید و ثابت می‌کند مسیرهای dev اصلاً در جدول مسیریابی نیستند.

**هدف** — ایجاد موجودیت مستأجر برای SaaS چندمستأجری.

**فیلدهای پیشنهادی**

```text
id
name
slug
status
timezone
created_at
updated_at
```

**قواعد**

- timezone پیش‌فرض داده‌ای باشد، نه مقدار پراکنده در کد.
- slug یکتا باشد.
- tenant غیرفعال اجازه‌ی عملیات نوشتنی نداشته باشد.

**endpointهای موقت توسعه**

```http
POST /internal/dev/tenants
GET  /internal/dev/tenants/:id
```

این endpointها فقط در محیط development فعال باشند.

**تمام است وقتی**

- tenant ایجاد و خوانده شود.
- endpointهای dev در production قابل دسترسی نباشند.
- تست uniqueness مربوط به slug وجود داشته باشد.

---

## [x] BE-008 — Request Context مستأجر

> **وضعیت:** جداسازی context هم از سمت سرویس (۵۰ زنجیره‌ی async) و هم از
> مسیر واقعی HTTP (۳۰ درخواست هم‌زمان با سه مستأجر) روی PostgreSQL واقعی
> تأیید شد. مستأجر معلق می‌خواند ولی نمی‌نویسد (۴۰۳).

**هدف** — قرار دادن tenant و user جاری در context هر درخواست.

**کارها**

- ساخت RequestContext با AsyncLocalStorage
- استخراج موقت tenant از header:

```http
X-Tenant-Id
```

- اعتبارسنجی وجود و فعال بودن tenant
- فراهم کردن API داخلی:

```ts
requestContext.getTenantId();
requestContext.getUserId();
```

**محدودیت‌ها**

- هیچ Service دامنه‌ای tenant را از body دریافت نکند.
- tenant باید از context درخواست گرفته شود.
- header موقت بعداً با auth جایگزین خواهد شد.

**تمام است وقتی**

- درخواست بدون tenant معتبر رد شود.
- دو درخواست هم‌زمان context یکدیگر را نبینند.
- integration test جداسازی context نوشته شده باشد.

---

## [x] BE-009 — Row-Level Security

> **وضعیت:** روی PostgreSQL واقعی تأیید شد. نکته‌ی محوری: کاربر `gold`
> هم سوپرکاربر است هم `BYPASSRLS`، پس بدون یک نقش محدود (`gold_app`)
> کل RLS بی‌اثر می‌ماند — یک تست همین را صریحاً نشان می‌دهد تا معلوم
> باشد بقیه‌ی تست‌ها بی‌معنا نیستند.
>
> **بدهی باقی‌مانده:** فقط تراکنش‌هایی که از `withTenantTransaction`
> عبور می‌کنند نقش محدود را می‌گیرند. کوئری‌های غیرمستأجری (مثل خواندن
> جدول `tenants` در میان‌افزار) هنوز با کاربر اصلی اجرا می‌شوند. بستن
> کامل این شکاف کار BE-065 است.

**هدف** — اعمال RLS روی تمام داده‌های مستأجر.

**کارها**

- ایجاد helper migration برای: افزودن `tenant_id` · فعال کردن RLS · ساخت policy
- تنظیم tenant جاری در transaction دیتابیس:

```sql
SET LOCAL app.current_tenant_id = '...';
```

- ایجاد test table برای اثبات جداسازی

**قواعد**

- اتکا به `WHERE tenant_id = ...` به‌تنهایی کافی نیست.
- RLS باید در PostgreSQL enforce شود.
- عملیات superuser در runtime عادی ممنوع باشد.

**تمام است وقتی**

- tenant A نتواند داده tenant B را بخواند.
- tenant A نتواند داده tenant B را update یا delete کند.
- تست مستقیم SQL برای RLS وجود داشته باشد.

---

## [x] BE-010 — کاربران و نقش‌های پایه

> **وضعیت:** روی PostgreSQL واقعی تأیید شد — سه نقش seed شدند، محدودیت
> یکتای `(tenant_id, user_id)` عضویت تکراری را رد می‌کند، و RLS روی
> `tenant_memberships` فعال است (`users` و `roles` عمداً نه).

**هدف** — ساخت مدل کاربر و عضویت در tenant.

**جداول**

```text
users
tenant_memberships
roles
```

**نقش‌های فاز ۱**

```text
OWNER
MANAGER
CASHIER
```

**قواعد**

- یک user بتواند در آینده عضو چند tenant باشد.
- نقش روی membership ذخیره شود، نه روی user.
- فعلاً نقش سفارشی ساخته نشود.

**تمام است وقتی**

- user ایجاد شود.
- user به tenant با یک role متصل شود.
- membership تکراری ایجاد نشود.
- تست جداسازی tenant وجود داشته باشد.

---

## [x] BE-011 — Authentication پایه

> **وضعیت:** ۲۰ تست e2e روی PostgreSQL واقعی — ورود موفق و ناموفق،
> کاربر غیرفعال، مستأجر معلق، چرخش و باطل شدن توکن تمدید، و بررسی
> اینکه هیچ پاسخی `$argon2` یا رمز خام ندارد.
>
> **بدهی باقی‌مانده:** میان‌افزار BE-008 هنوز مستأجر را از هدر
> `X-Tenant-Id` می‌گیرد و توکن دسترسی جایگزینش نشده. مسیرهای `/auth`
> عمومی‌اند و احراز هویت خودشان را دارند؛ اتصال کامل توکن به
> RequestContext کار BE-012 است.

**هدف** — پیاده‌سازی ورود و refresh token.

**endpointها**

```http
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
```

**قواعد**

- رمز عبور با Argon2id hash شود.
- access token کوتاه‌عمر باشد.
- refresh token به‌صورت hash در دیتابیس ذخیره شود.
- tenant فعال در token مشخص باشد.
- پاسخ‌ها اطلاعات حساس نداشته باشند.

**تمام است وقتی**

- login موفق و ناموفق تست شده باشد.
- refresh token قبلی قابل revoke باشد.
- user غیرفعال نتواند وارد شود.
- tenant غیرفعال نتواند session فعال ایجاد کند.

---

## [x] BE-012 — Authorization Guard

> **وضعیت:** ۱۵ تست e2e — هر چهار حالت خواسته‌شده، به‌علاوه‌ی تنزل نقش و
> حذف عضویت که بلافاصله اثر می‌کنند (نقش از دیتابیس خوانده می‌شود، نه
> از توکن).
>
> بررسی منفی روی نگهبان یک شکاف واقعی را نشان داد: تست اولیه‌ی
> «user خارج tenant» حتی با حذف مقایسه‌ی `tid` هم سبز می‌ماند، چون
> جست‌وجوی عضویت جلویش را می‌گرفت. تست کاربری که عضو **هر دو** مستأجر
> است اضافه شد و بدون آن مقایسه، تشدید دسترسی بین مستأجرها رخ می‌داد.

**هدف** — اعمال role-based access در endpointها.

**کارها**

- ساخت decorator:

```ts
@Roles('OWNER', 'MANAGER')
```

- ساخت Guard
- پوشش حالت‌های: بدون login · user خارج tenant · role ناکافی · role معتبر

**تمام است وقتی**

- CASHIER نتواند تنظیمات حساس را تغییر دهد.
- OWNER و MANAGER دسترسی موردنیاز داشته باشند.
- حداقل یک integration test برای هر حالت وجود داشته باشد.

---

## [x] BE-013 — Idempotency برای endpointهای نوشتنی

**هدف** — جلوگیری از ثبت تکراری تراکنش مالی.

**جدول**

```text
idempotency_records
- id
- tenant_id
- key
- request_hash
- status
- response_status
- response_body
- created_at
- expires_at
```

**رفتار**

- هر `POST`، `PUT` و endpoint مالی نوشتنی به `Idempotency-Key` نیاز دارد.
- تکرار همان key با همان request، پاسخ قبلی را برگرداند.
- تکرار همان key با request متفاوت، خطای conflict بدهد.
- ثبت key و عملیات اصلی در transaction هماهنگ باشند.

**تمام است وقتی**

- ارسال دوباره‌ی یک request فقط یک رکورد مالی ایجاد کند.
- request متفاوت با key قبلی رد شود.
- درخواست بدون key روی endpoint نوشتنی رد شود.
- integration test هم‌زمانی نوشته شده باشد.

---

## [x] BE-014 — Audit Log تغییرناپذیر

**هدف** — ثبت عملیات حساس و تغییرات مدیریتی.

**جدول**

```text
audit_logs
- id
- tenant_id
- actor_user_id
- action
- entity_type
- entity_id
- before_data
- after_data
- metadata
- ip_address
- user_agent
- created_at
```

**قواعد**

- Audit log از API عمومی update یا delete نشود.
- اطلاعات secret و password ذخیره نشوند.
- تغییر تنظیمات، اصلاح فاکتور، login حساس و عملیات مدیریتی ثبت شوند.

**تمام است وقتی**

- حداقل تغییر role و تغییر تنظیمات audit شود.
- تلاش برای update/delete audit log در runtime ممکن نباشد.
- تست sanitization داده حساس وجود داشته باشد.

---

# Milestone 3 — قواعد مشترک داده

## [x] BE-015 — Serialization امن BigInt

**هدف** — جلوگیری از خروج `number` برای پول و وزن.

**کارها**

- ساخت serializer مرکزی
- تبدیل تمام BigIntهای API به رشته
- جلوگیری از `JSON.stringify` مستقیم BigInt
- تعریف interceptor یا presenter استاندارد

**قواعد**

- تبدیل global مبهم که همه‌ی BigIntها را بدون قرارداد تغییر دهد انجام نشود.
- DTO خروجی صریحاً نوع string داشته باشد.
- مقدار پول یا وزن هیچ‌گاه JSON number نباشد.

**تمام است وقتی**

- integration test نشان دهد مقدار `12500000n` به `"12500000"` تبدیل می‌شود.
- هیچ خطای serialization برای BigInt وجود نداشته باشد.
- قرارداد خروجی با `packages/contracts` منطبق باشد.

---

## [x] BE-016 — نرمال‌سازی متن فارسی

**هدف** — نرمال‌سازی ورودی‌های متنی پیش از ذخیره.

**موارد**

- `ي` به `ی`
- `ك` به `ک`
- ارقام فارسی و عربی به لاتین
- حذف فاصله‌های اضافی
- استانداردسازی نیم‌فاصله
- trim

**کارها**

- استفاده از تابع مشترک موجود در صورت وجود
- افزودن Pipe یا utility سمت API
- ذخیره‌ی مقدار نمایشی و مقدار قابل جست‌وجو در صورت نیاز

**تمام است وقتی**

- جست‌وجوی `علي` و `علی` نتیجه‌ی یکسان بدهد.
- جست‌وجوی شماره با ارقام فارسی و لاتین یکسان باشد.
- تست‌های فارسی نوشته شده باشند.

---

## [x] BE-017 — Error Contract استاندارد

**هدف** — یکسان‌سازی خطاهای API.

**فرمت**

```json
{
  "error": {
    "code": "PARTY_NOT_FOUND",
    "message": "طرف حساب پیدا نشد",
    "fields": {},
    "requestId": "..."
  }
}
```

**کارها**

- ساخت exception filter
- mapping خطاهای Zod
- mapping خطاهای PostgreSQL
- تولید request ID
- جلوگیری از نمایش stack trace در production

**تمام است وقتی**

- Validation، Not Found، Conflict و Internal Error فرمت یکسان داشته باشند.
- خطاهای دیتابیس اطلاعات داخلی schema را افشا نکنند.
- request ID در log و response یکسان باشد.

---

# Milestone 4 — تنظیمات نسخه‌دار و مظنه

## [x] BE-018 — زیرساخت تنظیمات نسخه‌دار

**هدف** — ذخیره‌ی همه‌ی اعداد صنفی با بازه‌ی اعتبار.

**مدل پایه**

```text
versioned_settings
- id
- tenant_id
- setting_key
- value_json
- valid_from
- valid_to
- version
- created_by
- created_at
```

**قواعد**

- بازه‌های زمانی یک setting هم‌پوشانی نداشته باشند.
- رکورد قدیمی update نشود؛ نسخه‌ی جدید ساخته شود.
- مقدار مؤثر در یک زمان مشخص قابل دریافت باشد.

**تمام است وقتی**

- ایجاد نسخه‌ی جدید، نسخه‌ی قبلی را با `valid_to` ببندد.
- query تنظیمات در تاریخ گذشته مقدار همان تاریخ را بدهد.
- overlap در دیتابیس یا transaction جلوگیری شود.

---

## [x] BE-019 — Seed تنظیمات اولیه tenant

**هدف** — ساخت تنظیمات اولیه هنگام ایجاد tenant.

**تنظیمات فاز ۱**

- عیار پایه‌ی مظنه
- ثابت مثقال
- عیار پیش‌فرض خرید دست‌دوم
- واحد گرد کردن ریال
- سیاست گرد کردن
- عیار نمایش پیش‌فرض گزارش
- محدوده زمانی اصلاح فاکتور
- حد اختلاف نیازمند مجوز مدیر
- نرخ مالیات نسخه‌دار

**قواعد**

- این اعداد فقط در seed یا migration داده‌ای قرار بگیرند.
- هیچ Service دامنه‌ای fallback عددی هاردکد نداشته باشد.
- تغییر مقدار، نسخه‌ی جدید ایجاد کند.

**تمام است وقتی**

- tenant جدید همه‌ی تنظیمات لازم را داشته باشد.
- حذف یک تنظیم ضروری باعث خطای واضح دامنه‌ای شود، نه fallback خاموش.
- بازتولید تنظیمات تاریخی تست شده باشد.

---

## [x] BE-020 — انواع سکه نسخه‌دار

**هدف** — تعریف نوع سکه به‌عنوان بُعد مستقل شمارشی.

**جدول‌ها**

```text
coin_types
coin_type_versions
```

**فیلدها** — code · title · mint_type · gross_weight_ug · karat · is_central_bank_minted ·
valid_from · valid_to · version · active

**قواعد**

- تعداد سکه با integer ذخیره شود.
- سکه در ذخیره‌سازی به وزن تبدیل نشود.
- قابلیت حباب فقط برای `is_central_bank_minted = true` باشد.
- نسخه‌ی مشخصات سکه در اسناد قفل شود.

**تمام است وقتی**

- انواع سکه‌ی اولیه از طریق داده‌ی seed ایجاد شوند.
- تغییر وزن یا عیار، نسخه‌ی جدید بسازد.
- سکه‌ی غیربانکی امکان محاسبه حباب نداشته باشد.
- تست type-level یا domain-level قانون حباب وجود داشته باشد.

---

## [ ] BE-021 — ثبت مظنه دستی

**هدف** — ثبت نرخ دستی که معامله را از فید مستقل می‌کند.

**جدول**

```text
price_quotes
- id
- tenant_id
- quote_type
- amount_rial
- source
- observed_at
- created_by
- created_at
```

**endpointها**

```http
POST /pricing/quotes/manual
GET  /pricing/quotes/latest
GET  /pricing/quotes
```

**قواعد**

- `amount_rial` از API رشته و در دیتابیس bigint باشد.
- رکورد مظنه بعد از استفاده در سند تغییر نکند.
- source برای ورود دستی `MANUAL` باشد.
- latest بر اساس `observed_at` تعیین شود.

**تمام است وقتی**

- مظنه دستی ثبت و خوانده شود.
- tenantها مظنه یکدیگر را نبینند.
- مقدار نامعتبر یا اعشاری رد شود.
- Audit log ثبت شود.

---

## [ ] BE-022 — اسکلت فید مظنه با Fallback

**هدف** — ساخت abstraction فید بدون وابستگی عملیات فروش به آن.

**interface**

```ts
interface PriceFeedProvider {
  fetchLatest(): Promise<PriceFeedResult>;
}
```

**کارها**

- تعریف provider interface
- ساخت provider آزمایشی یا fake
- ثبت نتیجه‌ی فید در `price_quotes`
- timeout و error handling
- fallback به آخرین مظنه معتبر
- امکان ادامه معامله با مظنه دستی

**محدودیت‌ها**

- اتصال به vendor واقعی در این تسک الزامی نیست.
- معامله نباید با خرابی فید متوقف شود.
- BullMQ فقط در صورت نیاز واقعی اضافه شود؛ ثبت مالی وارد صف نشود.

**تمام است وقتی**

- خرابی provider باعث crash API نشود.
- آخرین مظنه معتبر قابل دریافت باشد.
- مظنه دستی بر اساس انتخاب صریح کاربر قابل استفاده باشد.

---

# Milestone 5 — اشخاص

## [ ] BE-023 — مدل طرف حساب

**هدف** — ساخت مدل قابل توسعه‌ی Party.

**جدول**

```text
parties
- id
- tenant_id
- type
- display_name
- normalized_name
- mobile
- normalized_mobile
- national_id
- linked_tenant_id
- status
- notes
- created_at
- updated_at
```

**نوع‌های فاز ۱**

```text
CONSUMER
BUSINESS
```

**قواعد**

- فیلد `linked_tenant_id` برای آینده اختیاری باشد.
- کد ملی اختیاری باشد.
- B2B return در فاز ۱ پیاده‌سازی نشود.
- Party حذف فیزیکی نشود؛ غیرفعال شود.

**تمام است وقتی**

- migration و schema ایجاد شده باشند.
- RLS فعال باشد.
- index برای normalized name و mobile وجود داشته باشد.
- حذف فیزیکی endpoint نداشته باشد.

---

## [ ] BE-024 — API اشخاص

**endpointها**

```http
POST   /parties
GET    /parties
GET    /parties/:id
PATCH  /parties/:id
POST   /parties/:id/deactivate
```

**قابلیت‌ها**

- جست‌وجو بر اساس نام و موبایل
- pagination
- فیلتر نوع و وضعیت
- نرمال‌سازی فارسی
- ثبت Audit log

**تمام است وقتی**

- CRUD مجاز کار کند.
- جست‌وجوی فارسی تست شده باشد.
- tenant isolation تست شده باشد.
- Party غیرفعال در ثبت معامله جدید قابل انتخاب نباشد.

---

# Milestone 6 — کاتالوگ و موجودی

## [ ] BE-025 — مدل کالای زیورآلات

**جدول‌ها**

```text
jewelry_items
jewelry_item_versions
```

**فیلدها** — code · title · gross_weight_mg · karat · stone_weight_mg ·
other_deduction_weight_mg · wage_type · wage_value · active · valid_from · valid_to · version

**قواعد**

- وزن‌ها bigint بر حسب میلی‌گرم باشند.
- عیار integer بین ۱ و ۱۰۰۰ باشد.
- اجرت نسخه‌دار باشد.
- اطلاعات استفاده‌شده در فاکتور snapshot شود.

**تمام است وقتی**

- کالای زیورآلات ایجاد و نسخه‌دار شود.
- وزن خالص توسط `core-calc` محاسبه شود.
- هیچ فرمول تکراری در API نوشته نشده باشد.
- مقدار اعشاری وزن در API رد شود.

---

## [ ] BE-026 — API کالای زیورآلات

**endpointها**

```http
POST   /inventory/jewelry-items
GET    /inventory/jewelry-items
GET    /inventory/jewelry-items/:id
PATCH  /inventory/jewelry-items/:id
POST   /inventory/jewelry-items/:id/deactivate
```

**قابلیت‌ها**

- جست‌وجو بر اساس کد و عنوان
- فیلتر موجود/ناموجود
- pagination
- ثبت نسخه جدید در تغییر مشخصات مالی

**تمام است وقتی**

- تغییر عیار، وزن یا اجرت نسخه جدید بسازد.
- تغییر عنوان غیرمالی طبق تصمیم مدل اعمال شود.
- کالای غیرفعال در فروش جدید قابل انتخاب نباشد.

---

## [ ] BE-027 — مدل حرکات موجودی

**هدف** — ثبت Append-Only تغییرات موجودی.

**جدول**

```text
inventory_movements
- id
- tenant_id
- source_type
- source_id
- item_type
- item_id
- dimension_id
- quantity
- occurred_at
- created_at
```

**item typeهای فاز ۱**

```text
JEWELRY
MELTED_GOLD
COIN
```

**قواعد**

- movementها update یا delete نشوند.
- سکه با تعداد ثبت شود.
- طلای آبشده با میلی‌گرم خالص ثبت شود.
- کالای زیورآلات بر اساس مدل انتخابی یا تعداد/شناسه ثبت شود.
- movement مالی و ledger در یک transaction دیتابیس ثبت شوند.

**تمام است وقتی**

- movement ورودی و خروجی ثبت شود.
- موجودی جاری از مجموع movementها محاسبه شود.
- موجودی منفی بر اساس policy مشخص جلوگیری شود.
- update/delete runtime برای movement وجود نداشته باشد.

---

## [ ] BE-028 — موجودی اولیه

**هدف** — امکان ثبت موجودی افتتاحیه برای راه‌اندازی tenant.

**endpointها**

```http
POST /inventory/opening-balances
GET  /inventory/balances
```

**قواعد**

- موجودی افتتاحیه یک source مشخص داشته باشد.
- برای آن دفتر کل متناظر ایجاد شود.
- Idempotency الزامی باشد.
- عملیات فقط OWNER یا MANAGER انجام دهد.

**تمام است وقتی**

- افتتاحیه زیورآلات، آبشده و سکه ثبت شود.
- موجودی و دفتر کل در یک transaction ثبت شوند.
- ارسال تکراری موجودی را دو برابر نکند.

---

# Milestone 7 — دفتر کل چندواحدی

## [ ] BE-029 — سند طراحی Postingها

**هدف** — قبل از کدنویسی دفتر کل، قواعد ثبت حسابداری مستند شوند.

**فایل**

```text
docs/accounting-postings.md
```

**سناریوهای اجباری**

- موجودی افتتاحیه
- فروش نقدی زیورآلات
- فروش نسیه زیورآلات
- فروش سکه
- خرید طلای دست‌دوم
- خرید سکه از مصرف‌کننده
- پرداخت ریالی
- پرداخت با طلا
- پرداخت با سکه
- پرداخت ترکیبی
- مرجوعی B2C متصل به فاکتور
- اصلاح فاکتور با سند تفاضلی

**برای هر سناریو مشخص شود** — حساب‌های درگیر · ابعاد درگیر · علامت یا سمت هر entry ·
نرخ قفل‌شده · اثر روی موجودی · اثر روی مانده شخص · نمونه عددی · اثبات مجموع صفر در هر بُعد

**محدودیت‌ها**

- تا review کامل این سند، تسک‌های بعدی ledger اجرا نشوند.
- B2B return در سند فاز ۱ وارد نشود.

**تمام است وقتی**

- همه‌ی سناریوها مثال عددی داشته باشند.
- مجموع هر بُعد در هر مثال صفر باشد.
- هیچ سکه‌ای در storage به وزن تبدیل نشده باشد.
- تیم مدل posting را تأیید کرده باشد.

---

## [ ] BE-030 — مدل ابعاد دارایی

**جدول**

```text
asset_dimensions
- id
- tenant_id nullable
- code
- kind
- coin_type_id nullable
- title
- active
```

**kindها**

```text
RIAL
GOLD
SILVER
COIN
```

**قواعد**

- فاز ۱ از RIAL، GOLD و COIN استفاده کند.
- SILVER فقط در مدل قابل تعریف باشد و هیچ جریان عملیاتی نداشته باشد.
- هر نوع سکه یک dimension مستقل داشته باشد.
- dimension سکه به `coin_type` متصل باشد.

**تمام است وقتی**

- dimensionهای پایه tenant ایجاد شوند.
- هر coin type فعال dimension مستقل داشته باشد.
- امکان یکی کردن انواع سکه وجود نداشته باشد.

---

## [ ] BE-031 — مدل حساب‌های دفتر کل

**جدول**

```text
ledger_accounts
- id
- tenant_id
- code
- title
- account_type
- party_id nullable
- system_key nullable
- active
```

**حساب‌های پایه** — صندوق ریالی · بانک · موجودی مصنوعات · موجودی آبشده ·
موجودی هر نوع سکه · حساب دریافتنی اشخاص · حساب پرداختنی اشخاص · فروش ·
خرید دست‌دوم · اجرت · سود · مالیات · حساب افتتاحیه

**قواعد**

- حساب‌های سیستمی از seed دیتابیسی ساخته شوند.
- Party account یا subledger قابل اتصال باشد.
- حساب استفاده‌شده حذف نشود.

**تمام است وقتی**

- Chart of Accounts اولیه tenant ساخته شود.
- system keyها یکتا باشند.
- حساب‌های Party قابل ایجاد باشند.

---

## [ ] BE-032 — مدل تراکنش و Entry دفتر کل

**جداول**

```text
ledger_transactions
ledger_entries
```

`ledger_transactions` — id · tenant_id · source_type · source_id · effective_at ·
description · reversal_of_transaction_id · created_by · created_at

`ledger_entries` — id · tenant_id · transaction_id · account_id · dimension_id ·
quantity · metadata · created_at

**قواعد**

- quantity برای ریال و وزن bigint باشد.
- quantity برای سکه نیز در API integer باشد و در storage سازگار ذخیره شود.
- entryها update/delete نشوند.
- source_type و source_id قابل ردیابی باشند.

**تمام است وقتی**

- migrationها اجرا شوند.
- foreign keyها و indexها وجود داشته باشند.
- update/delete توسط role runtime دیتابیس ممنوع باشد.

---

## [ ] BE-033 — Constraint Trigger تراز دفتر کل

**هدف** — اعمال ناوردای مجموع صفر در دیتابیس.

**الزام SQL** — یک Constraint Trigger با ویژگی زیر ساخته شود:

```sql
DEFERRABLE INITIALLY DEFERRED
```

**رفتار** — برای هر `transaction_id`، مجموع `quantity` در هر `dimension_id` باید صفر باشد.

**قواعد**

- بررسی فقط در Service کافی نیست.
- تراکنش نامتوازن حتی با SQL مستقیم commit نشود.
- بررسی بعد از تکمیل همه‌ی entryهای transaction انجام شود.

**تمام است وقتی**

- تراکنش متوازن commit شود.
- تراکنش نامتوازن در commit شکست بخورد.
- تراکنش چندبُعدی مستقل برای هر dimension بررسی شود.
- integration test مستقیم PostgreSQL وجود داشته باشد.

---

## [ ] BE-034 — Ledger Posting Service

**هدف** — تنها مسیر مجاز ساخت تراکنش دفتر کل.

**API داخلی**

```ts
ledgerPostingService.post({
  source,
  effectiveAt,
  description,
  entries,
});
```

**قواعد**

- Service فقط entryهای معتبر بپذیرد.
- account و dimension متعلق به tenant باشند.
- transaction و entryها اتمیک ثبت شوند.
- هیچ update/delete ارائه نشود.
- نرخ تبدیل داخل metadata یا سند source قفل شود، نه از مظنه امروز خوانده شود.

**تمام است وقتی**

- posting متوازن ثبت شود.
- posting نامتوازن قبل یا هنگام commit رد شود.
- tenant mismatch رد شود.
- تست integration نوشته شده باشد.

---

## [ ] BE-035 — Property-Based Tests دفتر کل

**هدف** — اثبات ناوردای دفتر کل با `fast-check`.

**سناریوها**

- تولید تصادفی تراکنش‌های تک‌بُعدی
- تولید تصادفی تراکنش‌های چندبُعدی
- ترکیب ریال و طلا
- ترکیب ریال و چند نوع سکه
- reversal
- تراکنش نامتوازن عمدی

**تمام است وقتی**

- حداقل چندصد اجرای تصادفی انجام شود.
- در تمام تراکنش‌های معتبر، مجموع هر dimension صفر بماند.
- تراکنش نامعتبر commit نشود.
- تست‌ها deterministic و قابل تکرار باشند.

---

## [ ] BE-036 — Reversal دفتر کل

**هدف** — اصلاح حسابداری بدون تغییر تاریخچه.

**رفتار**

- برای تراکنش قبلی، تراکنش جدید با entryهای معکوس ساخته شود.
- `reversal_of_transaction_id` تنظیم شود.
- تراکنش قبلی دست‌نخورده باقی بماند.
- reversal دوباره بدون مجوز یا منطق مشخص ممنوع باشد.

**تمام است وقتی**

- reversal مانده را خنثی کند.
- رکورد قبلی تغییر نکند.
- Audit log ثبت شود.
- idempotency تست شود.

---

## [ ] BE-037 — Query مانده حساب

**هدف** — محاسبه‌ی مانده هر حساب در ابعاد مستقل.

**API داخلی**

```ts
getAccountBalances(accountId, at?);
```

**خروجی نمونه**

```json
{
  "rial": "12000000",
  "gold": "-3500000",
  "coins": {
    "FULL_COIN": 2,
    "HALF_COIN": -1
  }
}
```

**قواعد**

- سکه‌ها مستقل گزارش شوند.
- تاریخ گذشته با `effective_at` قابل محاسبه باشد.
- تبدیل نمایشی به طلا یا ریال در این query باعث از بین رفتن مانده اصلی نشود.

**تمام است وقتی**

- مانده جاری و تاریخی درست باشد.
- tenant isolation رعایت شود.
- query برای چند dimension تست شده باشد.

---

# Milestone 8 — شماره‌گذاری و اسناد فروش

## [ ] BE-038 — شماره فاکتور بدون شکاف

**هدف** — تولید شماره فاکتور Gapless در هر tenant.

**جدول**

```text
document_counters
- tenant_id
- document_type
- period_key
- current_value
```

**الگوریتم** — در transaction:

```sql
SELECT ... FOR UPDATE
```

سپس افزایش شمارنده و ثبت فاکتور.

**قواعد**

- از PostgreSQL sequence استفاده نشود.
- rollback نباید شماره مصرف کند.
- شماره در هر tenant مستقل باشد.
- strategy دوره‌ای صریح و مستند باشد.

**تمام است وقتی**

- ثبت موفق شماره بعدی را مصرف کند.
- rollback شماره را مصرف نکند.
- درخواست‌های هم‌زمان شماره تکراری نگیرند.
- integration test concurrency وجود داشته باشد.

---

## [ ] BE-039 — مدل فاکتور فروش نسخه‌دار

**جدول‌ها**

```text
sales_invoices
sales_invoice_versions
sales_invoice_items
```

**اطلاعات اصلی** — invoice_number · current_version · status · party_id · quote_id ·
quote_amount_rial · quote_observed_at · finalized_at · created_by

**اطلاعات نسخه** — version · reason · totals snapshot · settings snapshot · created_at

**قواعد**

- شماره فاکتور در اصلاح تغییر نکند.
- نسخه قدیمی حذف یا update نشود.
- مظنه و تنظیمات مؤثر snapshot شوند.
- وضعیت‌های پیش‌نویس و نهایی تفکیک شوند.

**تمام است وقتی**

- draft ساخته شود.
- finalize نسخه ۱ ایجاد کند.
- اطلاعات تاریخی مستقل از تنظیمات امروز باقی بمانند.

---

## [ ] BE-040 — Domain Service قیمت‌گذاری فروش

**هدف** — استفاده از `packages/core-calc` برای محاسبه سمت سرور.

**ورودی‌ها** — وزن · عیار · وزن نگین و کسورات · اجرت · سود · مالیات · مظنه ·
سیاست گرد کردن نسخه‌دار

**قواعد**

- هیچ فرمولی در Service تکرار نشود.
- نتیجه فرانت مورد اعتماد قرار نگیرد.
- سرور همه‌چیز را دوباره محاسبه کند.
- گرد کردن فقط با تابع موجود در `core-calc` باشد.

**تمام است وقتی**

- نتایج سرور و `core-calc` یکسان باشند.
- Golden testهای موجود اجرا شوند.
- تغییر عدد ارسالی فرانت نتواند مبلغ نهایی سرور را دست‌کاری کند.

---

## [ ] BE-041 — ثبت فروش نقدی زیورآلات

**endpoint**

```http
POST /sales/invoices/jewelry
```

**جریان اتمیک**

- validation ورودی
- دریافت Party
- دریافت نسخه کالای انتخابی
- دریافت مظنه مشخص
- محاسبه قیمت سمت سرور
- تخصیص شماره بدون شکاف
- ساخت فاکتور نسخه ۱
- ثبت پرداخت ریالی
- ثبت inventory movement
- ثبت ledger transaction
- ثبت audit log
- commit

**قواعد**

- همه مراحل در یک transaction PostgreSQL باشند.
- هر failure کل عملیات را rollback کند.
- Idempotency الزامی باشد.
- مظنه در فاکتور snapshot شود.

**تمام است وقتی**

- فروش موفق موجودی را کم کند.
- دفتر کل متوازن باشد.
- شماره فاکتور بدون شکاف باشد.
- ارسال تکراری یک فاکتور نسازد.
- failure میانی هیچ اثر ناقص باقی نگذارد.

---

## [ ] BE-042 — فروش نسیه ساده

**هدف** — پشتیبانی از مانده ریالی یا طلایی ساده برای مشتری.

**قابلیت**

- کل مبلغ یا بخشی از مبلغ پرداخت نشده باشد.
- مانده در حساب Party ثبت شود.
- پیچیدگی چک، قسط‌بندی و سررسیدهای چندگانه ساخته نشود.

**تمام است وقتی**

- فروش بدون پرداخت کامل ثبت شود.
- مانده Party درست افزایش پیدا کند.
- پرداخت بعدی بتواند مانده را کاهش دهد.
- دفتر کل متوازن بماند.

---

## [ ] BE-043 — فروش سکه

**endpoint**

```http
POST /sales/invoices/coins
```

**ورودی** — party · coin type version · count · market unit price · quote snapshot · payment

**قواعد**

- تعداد سکه integer باشد.
- inventory movement بر اساس تعداد باشد.
- ledger dimension همان نوع سکه باشد.
- سکه در storage به وزن تبدیل نشود.
- ارزش ذاتی و حباب فقط به‌عنوان snapshot گزارشی ذخیره شوند.
- حباب فقط برای سکه بانک مرکزی محاسبه شود.

**تمام است وقتی**

- موجودی همان نوع سکه کم شود.
- بعد سکه مربوطه در ledger ثبت شود.
- انواع دیگر سکه تغییر نکنند.
- قانون حباب تست شده باشد.

---

# Milestone 9 — تسویه

## [ ] BE-044 — مدل Settlement

**جدول‌ها**

```text
settlements
settlement_lines
```

**نوع ردیف‌ها**

```text
RIAL
GOLD
COIN
CREDIT
```

**اطلاعات هر ردیف** — dimension · quantity · locked_quote · locked_conversion ·
source account · destination account

**قواعد**

- هر ردیف نرخ لحظه‌ای خود را snapshot کند.
- settlement نهایی Append-Only باشد.
- تسویه پیچیده چک و اقساط خارج از دامنه است.

**تمام است وقتی**

- settlement draft و final مدل شده باشد.
- ردیف‌های چندواحدی قابل ذخیره باشند.
- هیچ نرخ تاریخی از مظنه امروز خوانده نشود.

---

## [ ] BE-045 — پرداخت ریالی روی مانده شخص

**endpoint**

```http
POST /parties/:partyId/settlements/rial
```

**جریان** — دریافت مبلغ · قفل مظنه در صورت تبدیل نمایشی · ثبت settlement ·
ثبت ledger · ثبت audit · idempotency

**تمام است وقتی**

- مانده ریالی Party کاهش یابد.
- دفتر کل متوازن باشد.
- ارسال تکراری دوباره ثبت نشود.

---

## [ ] BE-046 — پرداخت با طلا

**endpoint**

```http
POST /parties/:partyId/settlements/gold
```

**قواعد**

- وزن API رشته و storage bigint میلی‌گرم خالص باشد.
- عیار ورودی با `core-calc` به خالص ۱۰۰۰ تبدیل شود.
- نرخ تبدیل در settlement قفل شود.
- موجودی آبشده در همان transaction تغییر کند.

**تمام است وقتی**

- مانده Party و موجودی آبشده درست تغییر کنند.
- تبدیل عیار test شود.
- هیچ float استفاده نشده باشد.

---

## [ ] BE-047 — پرداخت با سکه

**endpoint**

```http
POST /parties/:partyId/settlements/coins
```

**قواعد**

- coin type و count مشخص باشند.
- هر نوع سکه dimension مستقل داشته باشد.
- نرخ بازار و مظنه snapshot شوند.
- سکه به وزن storage تبدیل نشود.

**تمام است وقتی**

- مانده Party کم شود.
- موجودی نوع سکه مربوطه تغییر کند.
- ledger همان coin dimension را ثبت کند.

---

## [ ] BE-048 — تسویه ترکیبی

**endpoint**

```http
POST /parties/:partyId/settlements/mixed
```

**قابلیت** — ترکیب چند ردیف: ریال · طلا · یک یا چند نوع سکه · مانده اعتباری

**قواعد**

- تمام ردیف‌ها یک سند اتمیک باشند.
- failure یک ردیف کل settlement را rollback کند.
- نرخ هر ردیف مستقل snapshot شود.

**تمام است وقتی**

- تسویه نمونه ریال + طلا + سکه ثبت شود.
- مانده نهایی درست باشد.
- ledger در تمام dimensionها متوازن باشد.
- property/integration test وجود داشته باشد.

---

# Milestone 10 — خرید از مصرف‌کننده

## [ ] BE-049 — مدل خرید طلای دست‌دوم

**جدول‌ها**

```text
second_hand_purchases
second_hand_purchase_items
```

**اطلاعات** — party_id · source_invoice_id nullable · gross_weight_mg · stone_weight_mg ·
other_deduction_weight_mg · purchase_karat · pure_weight_mg · quote snapshot · fee ·
final_amount_rial · destination inventory type · identity snapshot · finalized_at

**قواعد**

- عیار پیش‌فرض از تنظیمات tenant خوانده شود.
- عیار ثابت ۷۴۰ در Service هاردکد نشود.
- مقصد پیش‌فرض موجودی آبشده باشد.
- اجرت خرید اولیه در محاسبه پرداخت امروز وارد نشود.

**تمام است وقتی**

- مدل تمام snapshotهای تاریخی لازم را داشته باشد.
- source invoice اختیاری باشد.
- تنظیمات تاریخی قابل بازتولید باشند.

---

## [ ] BE-050 — ثبت خرید طلای دست‌دوم

**endpoint**

```http
POST /purchase/second-hand/gold
```

**جریان** — اعتبارسنجی فروشنده · محاسبه وزن خالص · دریافت عیار مؤثر · دریافت مظنه ·
محاسبه مبلغ با `core-calc` · ساخت سند خرید · افزایش موجودی آبشده ·
ثبت پرداخت یا مانده Party · ثبت ledger · ثبت audit

**قواعد**

- همه مراحل اتمیک باشند.
- مظنه روز خرید snapshot شود.
- عیار مؤثر snapshot شود.
- شناسه هویتی اختیاری باشد.

**تمام است وقتی**

- موجودی آبشده افزایش یابد.
- مبلغ صحیح محاسبه شود.
- دفتر کل متوازن باشد.
- idempotency و rollback تست شوند.

---

## [ ] BE-051 — خرید سکه از مصرف‌کننده

**endpoint**

```http
POST /purchase/second-hand/coins
```

**قواعد**

- نرخ خرید می‌تواند از نرخ فروش متفاوت باشد.
- تعداد و نوع سکه ذخیره شوند.
- موجودی بر اساس count افزایش یابد.
- بعد سکه مستقل در ledger استفاده شود.
- حباب فقط در صورت سکه بانک مرکزی محاسبه شود.

**تمام است وقتی**

- خرید سکه موجودی count را افزایش دهد.
- پرداخت یا مانده Party ثبت شود.
- دفتر کل متوازن بماند.

---

## [ ] BE-052 — مرجوعی B2C به‌عنوان خرید دست‌دوم

**هدف** — اتصال خرید دست‌دوم به فاکتور قبلی بدون ساخت ماژول Return مشترک.

**endpoint**

```http
POST /sales/invoices/:invoiceId/b2c-buyback
```

**رفتار**

- Party فاکتور باید Consumer باشد.
- یک `second_hand_purchase` ساخته شود.
- `source_invoice_id` تنظیم شود.
- مبلغ خرید اولیه فقط برای مقایسه خوانده شود.
- مبلغ امروز با مظنه و عیار خرید امروز محاسبه شود.
- اختلاف محاسبه و به اجزای زیر تفکیک شود: اجرت سوخته · اختلاف عیار · تغییر مظنه ·
  سایر اختلافات محاسباتی مشخص

**قواعد**

- فروش قبلی reverse نشود.
- این رویداد Return حسابداری محسوب نشود.
- مقصد پیش‌فرض آبشده باشد.
- بیشتر یا کمتر بودن مبلغ امروز خطا نیست.
- B2B return پیاده‌سازی نشود.

**تمام است وقتی**

- سند خرید جدید ایجاد شود.
- به فاکتور اصلی لینک شود.
- فاکتور اصلی تغییر نکند.
- breakdown اختلاف در API برگردد.
- ledger و inventory درست ثبت شوند.

---

# Milestone 11 — اصلاح فاکتور

## [ ] BE-053 — سیاست اصلاح فاکتور

**هدف** — پیاده‌سازی قواعد مجوز اصلاح.

**قواعد**

- اصلاح در همان روز کاری طبق تنظیمات
- بعد از پنجره زمانی نیازمند MANAGER یا OWNER
- دلیل اصلاح اجباری
- توضیح برای دلیل `OTHER` اجباری
- فاکتور تسویه‌شده محدودیت اصلاح داشته باشد
- تغییر بالاتر از حد تنظیم‌شده نیازمند مجوز مدیر باشد
- بعد از بستن روز، اصلاح آزاد ممنوع باشد

**دلیل‌ها**

```text
WEIGHT_ERROR
KARAT_ERROR
WAGE_ERROR
PARTY_ERROR
PAYMENT_ERROR
OTHER
```

**تمام است وقتی**

- Policy service مستقل و تست‌شده باشد.
- هیچ عدد زمانی یا درصدی هاردکد نشده باشد.
- تمام حالت‌های نقش و زمان تست شده باشند.

---

## [ ] BE-054 — ساخت نسخه جدید فاکتور

**endpoint**

```http
POST /sales/invoices/:id/amend
```

**جریان** — بررسی policy · خواندن نسخه جاری · محاسبه نسخه جدید · ذخیره snapshot جدید ·
نگه داشتن شماره قبلی · افزایش version · ثبت دلیل و actor · ایجاد ledger transaction تفاضلی ·
ایجاد inventory movement تفاضلی · ثبت audit log

**قواعد**

- نسخه قبلی update/delete نشود.
- ledger قبلی update/delete نشود.
- فقط اختلاف نسخه جدید و قدیم ثبت شود.
- همه مراحل اتمیک باشند.

**تمام است وقتی**

- نسخه ۱ حفظ و نسخه ۲ جاری شود.
- شماره فاکتور ثابت بماند.
- مانده و موجودی فقط به میزان اختلاف تغییر کنند.
- rollback تست شود.

---

## [ ] BE-055 — تاریخچه اصلاحات

**endpointها**

```http
GET /sales/invoices/:id/versions
GET /sales/invoices/:id/amendments
```

**خروجی** — نسخه‌ها · actor · زمان · دلیل · تغییر وزن · تغییر مبلغ · تغییر عیار ·
اثر ledger · اثر inventory

**تمام است وقتی**

- تاریخچه کامل و تغییرناپذیر قابل مشاهده باشد.
- CASHIER فقط طبق policy به اطلاعات مجاز دسترسی داشته باشد.
- tenant isolation تست شده باشد.

---

# Milestone 12 — حساب اشخاص و گزارش‌های پایه

## [ ] BE-056 — مانده چندواحدی Party

**endpoint**

```http
GET /parties/:id/balances
```

**خروجی** — مانده ریال · مانده طلای خالص · مانده مستقل هر نوع سکه · تاریخ محاسبه ·
مظنه مرجع اختیاری برای نمایش تبدیل‌شده

**قواعد**

- مانده اصلی هر dimension مستقل باشد.
- تبدیل نمایشی باعث تغییر یا ادغام مانده اصلی نشود.
- طلا واحد نمایش پیش‌فرض باشد.
- API هم داده خام و هم نمای تبدیل‌شده را تفکیک کند.

**تمام است وقتی**

- مانده پس از فروش، خرید و تسویه درست باشد.
- سکه‌ها جداگانه نمایش داده شوند.
- مانده تاریخی قابل محاسبه باشد.

---

## [ ] BE-057 — صورت‌حساب Party

**endpoint**

```http
GET /parties/:id/statement
```

**قابلیت‌ها** — بازه تاریخ · pagination · فیلتر dimension · فیلتر source type ·
running balance · نمایش snapshot نرخ هر رویداد

**تمام است وقتی**

- تمام تراکنش‌های مرتبط Party نمایش داده شوند.
- running balance برای هر dimension صحیح باشد.
- تبدیل نمایشی با نرخ سند و نرخ نمایش تفکیک شود.

---

## [ ] BE-058 — فهرست بدهکاران و بستانکاران

**endpointها**

```http
GET /reporting/debtors
GET /reporting/creditors
```

**قابلیت‌ها** — مرتب‌سازی بر اساس مانده · واحد نمایش طلا یا ریال · حفظ ابعاد اصلی ·
pagination · جست‌وجوی Party

**قواعد**

- تبدیل گزارش بر اساس سیاست مشخص و مظنه مرجع انجام شود.
- مانده ذخیره‌شده بازنویسی نشود.
- سکه‌ها در جزئیات جدا بمانند.

**تمام است وقتی**

- بدهکار و بستانکار درست تفکیک شوند.
- تغییر واحد نمایش فقط presentation را تغییر دهد.
- queryها برای tenantهای جدا تست شوند.

---

## [ ] BE-059 — داشبورد پایه

**endpoint**

```http
GET /reporting/dashboard
```

**داده‌های فاز ۱** — فروش امروز · خرید امروز · دریافت امروز · پرداخت امروز · تعداد فاکتور ·
مانده بدهکاران · مانده بستانکاران · موجودی آبشده · موجودی انواع سکه · مظنه جاری

**قواعد**

- همه کارت‌های مالی قابلیت نمایش به طلا یا ریال داشته باشند.
- نقره در UI فاز ۱ ارائه نشود.
- گزارش سنگین غیرضروری یا نمودار پیچیده ساخته نشود.

**تمام است وقتی**

- endpoint با داده واقعی ماژول‌ها کار کند.
- واحد نمایش پارامتری و اعتبارسنجی‌شده باشد.
- پاسخ در dataset معقول عملکرد قابل قبول داشته باشد.

---

## [ ] BE-060 — گزارش سود پایه دو مقیاسه

**هدف** — گزارش اولیه سود فاز ۱ بدون پیچیدگی فازهای آینده.

**endpoint**

```http
GET /reporting/profit
```

**خروجی** — درآمد · بهای تمام‌شده · سود ناخالص · سود عملیاتی · اثر نوسان قیمت طلا ·
اثر حباب سکه · نمایش به ریال · نمایش به طلای معادل

**قواعد**

- تبدیل ریال به طلا بر اساس نرخ قفل‌شده رویداد باشد.
- نرخ امروز تاریخ گذشته را بازنویسی نکند.
- اثر حباب فقط برای سکه بانک مرکزی باشد.
- شمش و نقره وارد گزارش فاز ۱ نشوند.

**تمام است وقتی**

- یک سناریوی Golden با محاسبه دستی تطبیق داشته باشد.
- گزارش امروز و گزارش تاریخی با تغییر مظنه امروز تغییر نکند.
- تفکیک سود عملیاتی، نوسانی و حبابی تست شده باشد.

---

# Milestone 13 — رسید و Export

## [ ] BE-061 — InvoiceExporter abstraction

**هدف** — ایجاد abstraction موردنیاز برای خروجی اسناد.

**interface**

```ts
interface InvoiceExporter {
  exportInvoice(input: InvoiceExportInput): Promise<ExportedFile>;
}
```

**کارها**

- تعریف interface
- پیاده‌سازی PDF پایه
- جلوگیری از وابستگی SalesModule به کتابخانه PDF
- پشتیبانی از RTL و فونت پروژه

**تمام است وقتی**

- SalesModule فقط interface را بشناسد.
- یک PDF فاکتور نمونه تولید شود.
- فایل شامل اطلاعات snapshot تاریخی باشد.

---

## [ ] BE-062 — API دریافت رسید PDF

**endpointها**

```http
GET /sales/invoices/:id/pdf
GET /purchase/second-hand/:id/pdf
GET /parties/:id/statement/pdf
```

**قواعد**

- فقط اسناد tenant جاری قابل دریافت باشند.
- اطلاعات مالی با `Intl` سمت template یا formatter مناسب نمایش داده شوند.
- مقدار ذخیره‌شده تغییر نکند.
- PDF فعلاً ساده و کاربردی باشد.

**تمام است وقتی**

- PDF فروش، خرید و صورت‌حساب تولید شود.
- RTL قابل خواندن باشد.
- اطلاعات نسخه و نرخ قفل‌شده صحیح باشند.

---

# Milestone 14 — سخت‌سازی و تحویل فاز ۱

## [ ] BE-063 — محدودیت‌های دیتابیس

**هدف** — افزودن Constraintهای لازم.

**موارد**

- عیار بین ۱ و ۱۰۰۰
- وزن و مبلغ طبق دامنه غیرمنفی یا signed مناسب
- تعداد سکه integer
- version مثبت
- بازه زمانی معتبر
- uniqueهای tenant-aware
- foreign keyها
- جلوگیری از overlap تنظیمات نسخه‌دار
- جلوگیری از update/delete ledger entries
- جلوگیری از update/delete inventory movements

**تمام است وقتی**

- داده نامعتبر حتی با SQL مستقیم رد شود.
- همه Constraintها integration test داشته باشند.

---

## [ ] BE-064 — تست تراکنش اتمیک End-to-End

**سناریوها**

- فروش موفق
- failure بعد از صدور شماره
- failure هنگام inventory movement
- failure هنگام ledger posting
- تکرار Idempotency-Key
- دو درخواست هم‌زمان
- اصلاح فاکتور
- خرید دست‌دوم
- تسویه ترکیبی

**معیار** — در هیچ failure نباید بخشی از عملیات باقی بماند.

**تمام است وقتی**

- فاکتور بدون ledger وجود نداشته باشد.
- ledger بدون source document وجود نداشته باشد.
- inventory بدون source معتبر وجود نداشته باشد.
- شماره rollback شده مصرف نشده باشد.

---

## [ ] BE-065 — تست امنیت Multi-Tenant

**سناریوها** — Tenant A نباید بتواند داده Tenant B را: بخواند · ویرایش کند · حذف کند ·
در source transaction استفاده کند · به Party خودش لینک کند · از طریق شناسه مستقیم حدس بزند ·
در PDF دریافت کند

**تمام است وقتی**

- تست‌ها هم در API و هم در SQL مستقیم وجود داشته باشند.
- تمام تست‌های دسترسی غیرمجاز با پاسخ مناسب شکست بخورند.

---

## [ ] BE-066 — Performance Baseline

**هدف** — اندازه‌گیری ثبت تراکنش و Queryهای اصلی.

**سناریوها** — ثبت فروش نقدی · ثبت فروش نسیه · تسویه · مانده Party · داشبورد · صورت‌حساب

**معیار هدف**

- ثبت تراکنش معمولی زیر ۳۰۰ میلی‌ثانیه در محیط نزدیک به production
- Queryهای پرکاربرد دارای index مناسب
- جلوگیری از N+1

**تمام است وقتی**

- نتایج benchmark در `docs/performance-baseline.md` ثبت شوند.
- Query planهای کند بررسی شده باشند.
- indexهای ضروری migration شده باشند.

---

## [ ] BE-067 — Logging و Observability پایه

**هدف** — ایجاد log ساختاریافته برای عیب‌یابی.

**داده‌های log** — request ID · tenant ID · user ID · endpoint · status · duration ·
error code · source document ID

**قواعد**

- password، token، کد ملی کامل و داده حساس log نشود.
- log تراکنش مالی قابل ردیابی باشد.
- stack trace فقط در محیط مناسب ثبت شود.

**تمام است وقتی**

- یک فروش از request تا ledger با request ID قابل ردیابی باشد.
- sensitive data masking تست شده باشد.

---

## [ ] BE-068 — Backup و Restore مستند

**هدف** — مستندسازی و تست اولیه بازیابی PostgreSQL.

**فایل**

```text
docs/backup-restore.md
```

**موارد** — گرفتن backup · restore روی دیتابیس جدید · بررسی migration version ·
بررسی تعداد فاکتورها · بررسی تراز دفتر کل · بررسی موجودی · بررسی tenant isolation

**تمام است وقتی**

- یک backup واقعی محیط تست restore شده باشد.
- پس از restore، invariant دفتر کل بررسی شود.
- مراحل به‌صورت قابل اجرا مستند باشند.

---

## [ ] BE-069 — Export کامل داده Tenant

**هدف** — فراهم کردن خروجی کامل داده‌های مستأجر.

**endpoint**

```http
POST /platform/exports/full
GET  /platform/exports/:id
```

**دامنه خروجی** — تنظیمات · اشخاص · فاکتورها و نسخه‌ها · خریدها · settlementها · ledger ·
inventory movements · مظنه‌ها · audit log مجاز

**قواعد**

- خروجی فقط OWNER
- tenant isolation کامل
- فرمت مستند و قابل پردازش
- عملیات مالی اصلی وارد queue نشود
- در صورت استفاده از job، فقط تولید فایل export در صف باشد

**تمام است وقتی**

- tenant بتواند داده کامل خود را دانلود کند.
- هیچ داده tenant دیگر وارد خروجی نشود.
- schema خروجی version داشته باشد.

---

## [ ] BE-070 — Swagger و مستندات API

**هدف** — مستندسازی endpointهای فاز ۱.

**کارها** — OpenAPI · نمونه request/response · توضیح `Idempotency-Key` ·
توضیح رشته بودن BigInt · خطاهای دامنه · authentication · pagination · snapshot نرخ

**تمام است وقتی**

- تمام endpointهای فاز ۱ در Swagger باشند.
- نمونه‌ها از JSON number برای پول و وزن استفاده نکنند.
- endpoint خارج از فاز ۱ مستند نشده باشد.

---

## [ ] BE-071 — Gate نهایی بک‌اند

**هدف** — تعریف دستور واحد کنترل کیفیت.

**دستور پیشنهادی**

```bash
pnpm gate:backend
```

**شامل** — typecheck · lint · unit tests · integration tests · property-based tests · build ·
migration check · بررسی ممنوعیت `Math.round` · بررسی ممنوعیت `any` ·
بررسی ممنوعیت `@ts-ignore` · بررسی پول و وزن با `number` ·
بررسی endpointهای نوشتنی بدون Idempotency

**تمام است وقتی**

- دستور روی CI سبز باشد.
- شکستن هر قانون اصلی build را fail کند.
- خروجی خطا مسیر فایل و قانون نقض‌شده را مشخص کند.

---

## [ ] BE-072 — تست سناریوی کامل پایلوت

**هدف** — اثبات آمادگی فاز ۱ برای استفاده‌ی روزانه.

**سناریوی اجباری**

1. ایجاد tenant
2. ایجاد OWNER و CASHIER
3. ثبت تنظیمات
4. ثبت مظنه
5. ایجاد مشتری
6. ثبت موجودی اولیه زیورآلات و سکه
7. فروش نقدی زیورآلات
8. فروش نسیه سکه
9. پرداخت بخشی از مانده با ریال
10. پرداخت بخشی با طلا
11. خرید طلای دست‌دوم از مصرف‌کننده
12. مرجوعی B2C متصل به فاکتور
13. اصلاح یک فاکتور
14. مشاهده مانده Party
15. مشاهده صورت‌حساب
16. مشاهده گزارش بدهکاران
17. مشاهده سود به طلا و ریال
18. تولید PDF
19. export کامل tenant
20. بررسی تراز همه ledger transactionها

**تمام است وقتی**

- کل سناریو بدون اصلاح دستی دیتابیس اجرا شود.
- هیچ تراکنش نامتوازن وجود نداشته باشد.
- موجودی منفی غیرمجاز وجود نداشته باشد.
- گزارش تاریخی با تغییر مظنه جدید تغییر نکند.
- تمام تست‌ها و `pnpm gate:backend` سبز باشند.

---

# موارد خارج از دامنه این TASKS

موارد زیر در فاز ۱ پیاده‌سازی نشوند:

مرجوعی B2B · نقره عملیاتی · شمش · کارخانه · تولیدی زیورآلات · بنکدار · بازاریاب ·
پورسانت · امانی · چندشعبه‌ای · آفلاین · شبکه تسویه · سامانه مؤدیان · اتصال سخت‌افزار ·
RFID · باشگاه مشتریان · چک پیچیده · اقساط پیچیده · GraphQL · Microservice · Kubernetes ·
Event Sourcing framework · اتصال واقعی مالیاتی

---

# Definition of Done عمومی

هر تسک فقط وقتی تمام است که:

- [ ] معیارهای همان تسک انجام شده باشند.
- [ ] `pnpm typecheck` سبز باشد.
- [ ] `pnpm test` سبز باشد.
- [ ] تست integration مرتبط سبز باشد.
- [ ] هیچ `any` جدیدی اضافه نشده باشد.
- [ ] هیچ `@ts-ignore` جدیدی اضافه نشده باشد.
- [ ] هیچ `Math.round` جدیدی اضافه نشده باشد.
- [ ] هیچ مقدار پول یا وزن با `number` پیاده‌سازی نشده باشد.
- [ ] هیچ عدد صنفی در کد هاردکد نشده باشد.
- [ ] `tenant_id` و RLS برای جداول مربوطه اعمال شده باشد.
- [ ] endpoint نوشتنی Idempotency داشته باشد.
- [ ] Audit log عملیات حساس ثبت شده باشد.
- [ ] تسک در `TASKS.md` تیک خورده باشد.
- [ ] کامیت با شناسه همان تسک ایجاد شده باشد.
