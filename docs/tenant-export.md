# خروجی کامل داده‌ی مستأجر — BE-069

مالک کسب‌وکار (نقش `OWNER`) می‌تواند کل داده‌ی مستأجر خودش را در یک فایل JSON بگیرد: برای
نگهداری مستقل، انتقال به نرم‌افزار دیگر یا حسابرسی.

## API

| | |
|---|---|
| `POST /platform/exports/full` | خروجی تازه می‌سازد. `Idempotency-Key` اجباری؛ بدنه ندارد. پاسخ `201` با فراداده (`tenantExportSchema` در `@gold/contracts`). |
| `GET /platform/exports/:id` | فایل JSON همان خروجی. نام فایل در هدر `X-File-Name` (URL-encoded) و sha256 محتوا در `X-Content-SHA256`. |

- فقط `OWNER`؛ مدیر و صندوقدار `403` می‌گیرند.
- شناسه‌ی خروجی مستأجر دیگر همان `404` شناسه‌ی ناموجود را می‌گیرد.
- ساخت (`TENANT_EXPORT_CREATED`) و هر دانلود (`TENANT_EXPORT_DOWNLOADED`) در audit ثبت می‌شوند.
- خروجی ذخیره‌شده تغییرناپذیر است (`tenant_exports` append-only): هر دانلود همان بایت‌ها و
  همان sha256. داده‌ی تازه‌تر یعنی `POST` تازه.
- ساخت هم‌زمان با درخواست است، نه در صف؛ هیچ عملیات مالی در آن نیست.

```bash
EXPORT=$(curl -s -X POST "$API/platform/exports/full" \
  -H "Authorization: Bearer $TOKEN" -H "x-tenant-id: $TENANT" -H "Idempotency-Key: $(uuidgen)")
ID=$(echo "$EXPORT" | jq -r .id)
curl -s "$API/platform/exports/$ID" -H "Authorization: Bearer $TOKEN" -H "x-tenant-id: $TENANT" -o export.json
echo "$(echo "$EXPORT" | jq -r .sha256)  export.json" | sha256sum -c
```

## قالب فایل

```json
{
  "format": "gold-tenant-export",
  "schemaVersion": 1,
  "exportId": "…",
  "snapshotAt": "2026-10-19T11:20:00.000Z",
  "requestedBy": "…",
  "tenant": { "id": "…", "name": "…", "slug": "…", "status": "ACTIVE", "timezone": "Asia/Tehran" },
  "sections": {
    "parties": { "table": "parties", "rowCount": 2, "rows": [ { "id": "…", "tenantId": "…", "…": "…" } ] }
  }
}
```

مصرف‌کننده اول `format` و `schemaVersion` را بررسی می‌کند. پوسته با
`tenantExportDocumentSchema` در `@gold/contracts` اعتبارسنجی می‌شود (از جمله برابری
`rowCount` با تعداد `rows`).

### نسخه

`schemaVersion` فقط با تغییر **ناسازگار** بالا می‌رود: حذف یا تغییر نام بخش یا ستون، یا
تغییر قرارداد یک مقدار. افزودن بخش یا ستون تازه سازگار است و نسخه را عوض نمی‌کند — پس
مصرف‌کننده باید کلید ناشناخته را نادیده بگیرد. ثابت در `TENANT_EXPORT_SCHEMA_VERSION`.

### قرارداد مقدارها

- **ستون‌ها**: هر ردیف همه‌ی ستون‌های جدولش را دارد، با نام camelCase همان API
  (`tenant_id` → `tenantId`). `table` نام جدول دیتابیس است.
- **`bigint`** (ریال، وزن به میلی‌گرم خالص، تعداد سکه، مقدار ledger و موجودی) → **رشته‌ی
  عدد صحیح**: `"quantity": "-12500000"`. هرگز `number`.
- **زمان** → ISO-8601 UTC.
- **jsonb** (snapshotهای قفل‌شده، metadata) → همان‌طور که ذخیره شده؛ مقادیر پولی داخلش هم رشته‌اند.
- سکه شمارشی است و به گرم تبدیل نمی‌شود؛ مظنه و نرخ قفل‌شده‌ی هر سند همان مقدار لحظه‌ی رویداد است.
- ترتیب ردیف‌ها قطعی است: `createdAt` و بعد `id`.

### بخش‌ها

به ترتیب وابستگی؛ مرجع پیش از سندی که به آن ارجاع می‌دهد.

| بخش | جدول | محتوا |
|---|---|---|
| `settings` | `versioned_settings` | همه‌ی نسخه‌های تنظیمات، با بازه‌ی اعتبار |
| `memberships` | `tenant_memberships` | کاربر و نقش |
| `users` | `users` | فقط `id` و `displayName` اعضای همین مستأجر — بدون ایمیل و رمز |
| `parties` | `parties` | اشخاص، **با** موبایل و کد ملی (داده‌ی خود مستأجر است) |
| `assetDimensions` · `ledgerAccounts` | | ابعاد (ریال، طلا، انواع سکه) و حساب‌های دفتر کل |
| `coinTypes` · `coinTypeVersions` | | انواع سکه و مشخصات نسخه‌دار |
| `jewelryItems` · `jewelryItemVersions` | | کالا و مشخصات نسخه‌دار |
| `priceQuotes` | `price_quotes` | مظنه‌ها |
| `documentCounters` | `document_counters` | شمارنده‌ی فاکتور |
| `openingBalances` | | موجودی افتتاحیه |
| `salesInvoices` · `salesInvoiceVersions` · `salesInvoiceItems` | | فاکتورها، همه‌ی نسخه‌های اصلاح، اقلام با snapshot قیمت |
| `secondHandPurchases` · `secondHandPurchaseItems` | | خرید از مصرف‌کننده |
| `settlements` · `settlementLines` | | تسویه‌ها |
| `ledgerTransactions` · `ledgerEntries` | | دفتر کل کامل |
| `inventoryMovements` | | حرکت‌های موجودی |
| `auditLogs` | `audit_logs` | ممیزی، **بدون** `ipAddress` و `userAgent` |

### عمداً بیرون

| جدول | چرا |
|---|---|
| `idempotency_records` | حافظه‌ی پاسخ تکرار درخواست؛ کپی سندهایی که خودشان صادر شده‌اند |
| `refresh_tokens` | هش توکن نشست — داده‌ی امنیتی |
| `rls_probes` | جدول آزمون RLS |
| `tenant_exports` | خود خروجی‌ها |

هر جدول دارای `tenant_id` یا در یکی از دو فهرست است — آزمون
`apps/api/test/tenant-exports.e2e-spec.ts` این را روی catalog واقعی PostgreSQL بررسی می‌کند؛
جدول تازه‌ای که در هیچ‌کدام نباشد آزمون را می‌شکند.

## جداسازی و سازگاری

همه‌ی بخش‌ها در **یک** تراکنش `REPEATABLE READ READ ONLY` با نقش `gold_app` خوانده می‌شوند:

- یک snapshot در لحظه‌ی `snapshotAt`: سندی که وسط خروجی ثبت شود یا کامل در فایل است یا
  اصلاً نیست — هرگز سربرگ دفتر کل بدون entryهایش.
- RLS اجباری: حتی بخشی که فیلتر `tenant_id` را فراموش کند ردیف مستأجر دیگر را نمی‌گیرد.
  فیلتر صریح لایه‌ی دوم است.

## اندازه و زمان

اندازه‌گیری روی بزرگ‌ترین مستأجر `gold_bench` (یک سال ترافیک BE-066: ۱۸۰۹ فاکتور، ۱۱۹۶۸ entry
دفتر کل، ۱۳۷۲۷ رکورد audit — حدود ۳۹ هزار ردیف): ساخت **۱٫۷ ثانیه**، فایل **۲۰ مگابایت**. کل
فایل در حافظه ساخته می‌شود؛ برای مستأجرهای چندساله‌ی بزرگ‌تر، تولید جریانی (streaming) یا صف
تولید فایل گزینه‌ی بعدی است.

## محدودیت‌های شناخته‌شده

- مستأجر معلق (`SUSPENDED`) فقط خواندن دارد و `POST` برایش رد می‌شود — یعنی دقیقاً وقتی
  کسب‌وکار در حال رفتن است نمی‌تواند خروجی بگیرد. باید تصمیم محصولی گرفته شود.
- خروجی‌ها حذف نمی‌شوند؛ هر خروجی یک کپی کامل داده است. سیاست نگهداری هنوز تعریف نشده.
