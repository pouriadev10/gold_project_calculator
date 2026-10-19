# مستند API — BE-070

| | |
|---|---|
| مستند ثابت | [`docs/openapi.json`](openapi.json) — OpenAPI 3.0.3، در مخزن |
| Swagger UI | `GET /docs` روی API در حال اجرا (فقط بیرون از production) |
| مستند زنده | `GET /docs/openapi.json` — دقیقاً همان فایل مخزن |

قراردادهای سراسری (احراز هویت، `x-tenant-id`، `Idempotency-Key`، BigInt به‌صورت رشته، snapshot نرخ،
شکل خطا، صفحه‌بندی) در بخش `info.description` همان فایل آمده‌اند و Swagger UI بالای صفحه نشانشان می‌دهد.

## از کجا می‌آید

مستند دستی نوشته نمی‌شود؛ از همان چیزهایی ساخته می‌شود که سرور با آن‌ها کار می‌کند:

- **مسیر، متد، کد وضعیت، احراز هویت، نقش‌ها** ← metadata ِ دکوراتورهای Nest
  (`apps/api/src/platform/openapi/route-discovery.ts`).
- **بدنه و query** ← schema ِ zod ِ همان `ZodValidationPipe` که ورودی را رد یا قبول می‌کند.
- **پاسخ** ← schema ِ `@gold/contracts` که در `route-docs.ts` برای هر مسیر ثبت شده؛ همان که فرانت پاسخ را با
  آن می‌خواند.
- **نمونه‌ها** ← از همان schemaها ساخته و دوباره با zod اعتبارسنجی می‌شوند؛ پس نمونه‌ی پول و وزن همیشه
  رشته است.

## وقتی مسیری اضافه یا عوض شد

```bash
pnpm --filter @gold/api openapi:generate
```

و `docs/openapi.json` را با همان کامیت بفرست. بدون این، `pnpm test` شکست می‌خورد:

- مسیر تازه بدون ورودی در `ROUTE_DOCS` ← «route … has no entry in ROUTE_DOCS».
- ورودی `ROUTE_DOCS` بدون مسیر واقعی ← شکست، تا مستند مسیر حذف‌شده نماند.
- نمونه‌ای که با schema نخواند ← شکست، با فیلد مقصر.
- `docs/openapi.json` کهنه ← شکست snapshot.

مسیرهای `/internal/dev/*` (فقط توسعه) و `/docs` مستند نمی‌شوند. آزمون همچنین هر مسیری با نشانه‌ی دامنه‌ی
خارج از فاز ۱ (نقره، شمش، بازاریاب، امانی، مؤدیان، …) را رد می‌کند.
