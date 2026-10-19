# Logging و ردیابی درخواست — BE-067

خروجی API روی stdout است و **هر خط یک شیء JSON** (pino). Docker Compose همین خروجی
را جمع می‌کند:

```bash
docker compose logs -f api
```

سطح log با `LOG_LEVEL` تنظیم می‌شود (`fatal` · `error` · `warn` · `info` · `debug` ·
`trace`، پیش‌فرض `info`). تست‌ها `error` می‌گذارند.

---

## خط پایانی هر درخواست

هر درخواست HTTP دقیقاً یک خط با `"event":"request_completed"` دارد:

| فیلد | معنا |
|---|---|
| `requestId` | همان هدر پاسخ `x-request-id` و `error.requestId` بدنه‌ی خطا. سرور می‌سازد، نه کلاینت. |
| `tenantId` | مستأجر — از هدر `x-tenant-id` پس از اعتبارسنجی. در `/auth/*` و `/health` نیست. |
| `userId` | کاربر احرازشده (`sub` توکن). |
| `method` · `endpoint` | متد و مسیر **بدون query string**. |
| `statusCode` · `durationMs` | وضعیت پاسخ و مدت پردازش به میلی‌ثانیه. |
| `errorCode` | همان `error.code` پاسخ (`VALIDATION_ERROR`، `NOT_FOUND`، …) — فقط در خطا. |
| `sourceDocuments` | سندهای مالی‌ای که این درخواست ثبت کرد: `sourceType`، `sourceId` (مثلاً شناسه‌ی فاکتور) و `ledgerTransactionId`. |
| `attemptedSourceDocuments` | همان، وقتی درخواست شکست خورده — آن ردیف‌ها rollback شده‌اند و در دیتابیس **نیستند**. |
| `aborted` | اتصال پیش از پایان پاسخ بسته شد. |

سطح خط: `info` برای ۲xx/۳xx، `warn` برای ۴xx، `error` برای ۵xx. خطای ۵xx یک خط
`"event":"request_failed"` هم دارد با `exceptionName` و — فقط بیرون از production —
`stack`.

هر log دیگری که داخل یک درخواست نوشته شود خودکار `requestId`/`tenantId`/`userId` را
می‌گیرد.

## ردیابی یک فروش

کاربر یا پشتیبانی `requestId` را از پیام خطا یا هدر پاسخ دارد:

```bash
docker compose logs api | grep '"requestId":"<REQUEST_ID>"'
```

`sourceDocuments[].ledgerTransactionId` مستقیماً سند دفتر کل است:

```sql
SELECT lt.source_type, lt.source_id, e.account_id, e.dimension_id, e.quantity
FROM ledger_transactions lt
JOIN ledger_entries e ON e.tenant_id = lt.tenant_id AND e.transaction_id = lt.id
WHERE lt.tenant_id = '<TENANT_ID>' AND lt.id = '<LEDGER_TRANSACTION_ID>';
```

برای فروش، `sourceId` همان شناسه‌ی فاکتور (`sales_invoices.id`) است.

## آنچه هرگز log نمی‌شود

- **بدنه، هدرها و query string** هیچ درخواستی. پس رمز، توکن و کد ملی‌ای که در ورود،
  ساخت مشتری یا جست‌وجو فرستاده می‌شود از اساس به logger نمی‌رسد.
- لایه‌ی دوم، روی هر خط: کلیدهای شبیه `password`، `token`، `secret`، `authorization`،
  `cookie`، `apiKey`، `credential` با `[REDACTED]` جایگزین می‌شوند و کد ملی (`nationalId`
  و شکل‌های مشابه) جز ۴ نویسه‌ی آخر ماسک می‌شود — در هر عمقی از شیء.
- **پیام خطا**: پیام خطای دیتابیس پارامترهای کوئری را دارد. فقط نام خطا log می‌شود؛ stack
  (که پیام را دارد) فقط وقتی `NODE_ENV` برابر `production` نیست.

پیاده‌سازی: `apps/api/src/platform/logging/` · آزمون:
`apps/api/test/request-logging.e2e-spec.ts`.
