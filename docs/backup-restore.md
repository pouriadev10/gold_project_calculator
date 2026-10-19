# Backup و Restore — BE-068

> دفتر کل append-only است و هیچ رکورد مالی‌ای «دوباره ساخته» نمی‌شود. backup تنها نسخه‌ی
> دوم تاریخچه‌ی مالی مشتری است. backupی که restoreش آزموده نشده، backup نیست.

خلاصه: `pg_dump --format=custom` از یک دیتابیس → restore روی **دیتابیس تازه** (هرگز روی
دیتابیس زنده) → `verify-restore.mjs` با مقایسه‌ی اثر انگشت مبدأ → فقط بعد از سبز شدن،
جابه‌جایی.

| فایل | کار |
|---|---|
| `apps/api/scripts/restore-prerequisites.sql` | ساخت نقش `gold_app` و عضویت کاربر برنامه، روی سرور تازه |
| `apps/api/scripts/verify-restore.mjs` | بررسی‌های سلامت + اثر انگشت مبدأ/مقصد |
| `backups/` | محل فایل‌های backup روی ماشین — در `.gitignore`؛ **هرگز کامیت نشود** |

---

## پیش از شروع

- دستورها برای **bash** نوشته شده‌اند و از ریشه‌ی مخزن اجرا می‌شوند. در **Git Bash روی ویندوز**
  اول این را بزن، وگرنه Git Bash مسیر `/tmp/...` داخل کانتینر را به مسیر ویندوزی تبدیل
  می‌کند و `pg_dump` با `could not open output file` شکست می‌خورد:

  ```bash
  export MSYS_NO_PATHCONV=1
  ```

- فایل backup را با `docker compose cp` جابه‌جا کن، نه با `>`/`<`. در PowerShell 5.1،
  redirect خروجی متنی است و فایل باینری custom-format را خراب می‌کند.
- نام کاربر PostgreSQL (`POSTGRES_USER`، پیش‌فرض `gold`) روی سرور مقصد باید همان مبدأ باشد —
  مالکیت جدول‌ها و `ALTER DEFAULT PRIVILEGES` داخل backup به این نام است.
- `verify-restore.mjs` با Node و `pg` اجرا می‌شود (`pnpm install` شده). پورت دیتابیس باید
  از ماشین در دسترس باشد (compose آن را روی `5432` باز می‌کند).

متغیرهای نمونه:

```bash
DB=gold                                   # دیتابیس مبدأ
STAMP=$(date +%Y%m%d-%H%M%S)
FILE=$DB-$STAMP.dump
```

---

## ۱. گرفتن backup

```bash
docker compose exec -T db pg_dump -U gold -d "$DB" --format=custom --compress=6 --file=/tmp/$FILE
mkdir -p backups
docker compose cp db:/tmp/$FILE backups/$FILE
docker compose exec -T db rm /tmp/$FILE
sha256sum backups/$FILE > backups/$FILE.sha256
```

اثر انگشت مبدأ را **همان لحظه** بگیر و کنار backup نگه دار. این همان چیزی است که restore با
آن مقایسه می‌شود:

```bash
DATABASE_URL=postgresql://gold:gold@localhost:5432/$DB \
  node apps/api/scripts/verify-restore.mjs --out backups/$FILE.verify.json > /dev/null
```

اگر API هم‌زمان می‌نویسد، `pg_dump` یک snapshot سازگار می‌گیرد ولی اثر انگشتی که چند ثانیه
بعد گرفته شود ممکن است چند سند بیشتر داشته باشد. برای مقایسه‌ی دقیق، backup و اثر انگشت را
وقتی API متوقف است بگیر (`docker compose stop api`)؛ برای backup روزانه این لازم نیست.

فایل backup و `.sha256` و `.verify.json` را با هم به جای امن خارج از سرور منتقل کن.

## ۲. restore روی دیتابیس تازه

**هرگز روی دیتابیس زنده restore نکن.** اول دیتابیس جدید، بعد بررسی، بعد جابه‌جایی.

### الف) روی همان سرور

```bash
RESTORE=gold_restored
sha256sum -c backups/$FILE.sha256
docker compose exec -T db psql -U gold -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS $RESTORE" -c "CREATE DATABASE $RESTORE"
docker compose cp backups/$FILE db:/tmp/restore.dump
docker compose exec -T db pg_restore -U gold -d $RESTORE --exit-on-error --single-transaction /tmp/restore.dump
docker compose exec -T db rm /tmp/restore.dump
```

### ب) روی سرور PostgreSQL تازه (بازیابی پس از حادثه)

نقش‌ها سراسری‌اند و داخل backup نیستند؛ بدون نقش `gold_app` restore روی اولین `GRANT`
متوقف می‌شود. پس روی سرور تازه — بعد از `docker compose up -d db` — **یک بار** پیش‌نیاز را
اجرا کن (تکرارش بی‌خطر است):

```bash
docker compose cp apps/api/scripts/restore-prerequisites.sql db:/tmp/restore-prerequisites.sql
docker compose exec -T db psql -U gold -d postgres -v ON_ERROR_STOP=1 -f /tmp/restore-prerequisites.sql
```

بعد همان مراحل «الف».

دو پرچم `pg_restore` اختیاری نیستند:

- `--exit-on-error`: بدون آن، خطای GRANT یا policy فقط چاپ می‌شود و دیتابیسی بالا می‌آید که
  RLS یا مجوزش ناقص است.
- `--single-transaction`: یا همه‌چیز، یا هیچ. restore نیمه‌کاره‌ای باقی نمی‌ماند که کسی اشتباهی
  به آن وصل شود.

## ۳. بررسی پس از restore

```bash
DATABASE_URL=postgresql://gold:gold@localhost:5432/$RESTORE \
  node apps/api/scripts/verify-restore.mjs --compare backups/$FILE.verify.json > backups/$FILE.restored.json
echo $?   # 0 = سالم · 1 = بررسی شکست خورد · 2 = اجرا ممکن نشد
```

`backups/$FILE.restored.json` را باز کن؛ `ok` باید `true` و همه‌ی فهرست‌های `checks` و
`comparison` خالی باشند.

| بخش | چه چیزی را بررسی می‌کند |
|---|---|
| `migrations` | هر مهاجرت `apps/api/drizzle/meta/_journal.json` در `drizzle.__drizzle_migrations` ثبت شده باشد، و دیتابیس مهاجرتی ناشناخته برای این checkout نداشته باشد. |
| `ledgerInvariant` | برای هر تراکنش، مجموع در **هر بُعد** صفر؛ هیچ entry متعلق به تراکنش مستأجر دیگر نباشد؛ هیچ تراکنش بی‌entry نباشد. |
| `documentsAndStock` | شماره‌ی فاکتور بی‌شکاف (هر شماره‌ی شمارنده یک فاکتور دارد)؛ هیچ موجودی منفی نباشد. |
| `tenantIsolation` | کاربر عضو `gold_app` باشد؛ هر جدول دارای `tenant_id` که نقش برنامه به آن دسترسی دارد RLS **اجباری** داشته باشد؛ و برای **هر** مستأجر، با `SET LOCAL ROLE gold_app` و همان `set_config` برنامه، روی هر جدول هیچ ردیف مستأجر دیگر دیده نشود و همه‌ی ردیف‌های خودش دیده شوند. |
| `appendOnly` | هیچ trigger غیرفعال نباشد؛ UPDATE و DELETE واقعی روی `ledger_entries`، `ledger_transactions`، `inventory_movements` و `audit_logs` رد شوند (داخل تراکنشی که همیشه ROLLBACK می‌شود). |
| `comparison` | برای هر مستأجر: تعداد طرف حساب، فاکتور (کل و نهایی)، بیشینه‌ی شماره‌ی فاکتور، خرید دست‌دوم، تسویه، تراکنش و entry دفتر کل، حرکت موجودی، audit؛ hash مانده‌ی هر حساب×بُعد و hash موجودی هر کالا؛ تعداد trigger، policy، index و FK. |

اسکریپت فقط می‌خواند. باید با کاربر مالک دیتابیس اجرا شود (superuser محیط Docker)، چون RLS
برای او اعمال نمی‌شود و شمارش‌ها کل داده را می‌بینند.

## ۴. جابه‌جایی

فقط وقتی بخش ۳ سبز است:

```bash
docker compose stop api
docker compose exec -T db psql -U gold -d postgres -v ON_ERROR_STOP=1 \
  -c "ALTER DATABASE gold RENAME TO gold_before_restore_$STAMP" \
  -c "ALTER DATABASE $RESTORE RENAME TO gold"
docker compose --profile tools run --rm migrate     # باید «همه اعمال شده» باشد؛ اگر backup قدیمی‌تر است مهاجرت‌های تازه را اعمال می‌کند
docker compose start api
```

دیتابیس قبلی را تا اطمینان کامل نگه دار؛ پاک کردنش برگشت‌ناپذیر است.

اگر backup از نسخه‌ی قدیمی‌تر برنامه است، `migrations` در بخش ۳ مهاجرت‌های اعمال‌نشده را
گزارش می‌کند — این انتظار می‌رود. مهاجرت را روی دیتابیس restoreشده اجرا کن و بررسی را بدون
`--compare` تکرار کن (اثر انگشت بعد از مهاجرت ممکن است عوض شود).

---

## نتیجه‌ی آزمون بازیابی — ۱۴۰۵/۰۷/۲۷

مبدأ: `gold_bench`، دیتابیس آزمون کارایی BE-066 — دو مستأجر و یک سال ترافیک شبیه‌سازی‌شده.
`gold_test` پس از هر اجرای تست تقریباً خالی است و آزمون معناداری نمی‌داد.

| | مستأجر ۱ | مستأجر ۲ |
|---|---|---|
| فاکتور فروش (بیشینه‌ی شماره) | ۱۸۰۹ (۱۸۰۹) | ۸۵۱ (۸۵۱) |
| خرید دست‌دوم | ۲۳۶ | ۱۰۰ |
| تسویه | ۴۷۲ | ۲۰۰ |
| تراکنش / entry دفتر کل | ۲۵۲۰ / ۱۱۹۶۸ | ۱۱۵۳ / ۵۴۰۸ |
| حرکت موجودی | ۳۳۳۱ | ۱۵۰۳ |

- backup: ۴٫۶ مگابایت (custom، gzip سطح ۶)، ۳۷۳ مدخل، ۳۱ جدول داده؛ ۳۵ مهاجرت تا `0034_be066_report_indexes`.
- **restore الف** (دیتابیس تازه روی همان سرور): ۲٫۴ ثانیه — همه‌ی بررسی‌ها سالم، اثر انگشت یکسان.
- **restore ب** (کانتینر `postgres:16-alpine` تازه، بدون نقش `gold_app`):
  - بدون پیش‌نیاز: روی `GRANT USAGE ON SCHEMA public TO gold_app` متوقف شد و به لطف
    `--single-transaction` **هیچ** جدولی باقی نماند.
  - با `restore-prerequisites.sql`: ۲٫۳ ثانیه — همه‌ی بررسی‌ها سالم، اثر انگشت یکسان (۲۲ trigger،
    ۲۵ policy، ۹۸ index، ۶۵ FK). اجرای `migrate.mjs` روی آن چیزی اعمال نکرد.
- **آزمون منفی** — روی نسخه‌ی restoreشده عمداً خراب شد تا ثابت شود بررسی‌ها واقعاً شکست
  می‌خورند. هر مورد با exit code ۱ گزارش شد:

  | خرابی تزریق‌شده | گزارش |
  |---|---|
  | entry نامتوازن (+۷) با trigger غیرفعال | `ledgerInvariant` + اختلاف تعداد entry و hash مانده |
  | trigger غیرفعال روی `ledger_entries` و `sales_invoices` | `appendOnly`: trigger غیرفعال + UPDATE/DELETE پذیرفته شد |
  | `NO FORCE ROW LEVEL SECURITY` روی `parties` | `tenantIsolation` |
  | حذف policy جدول `settlements` | `tenantIsolation`: هر مستأجر ۰ از N ردیف خودش را دید |
  | تغییر شماره‌ی فاکتور ۵ | `documentsAndStock`: شکاف شماره‌ی ۵ |
  | حرکت موجودی منفی بزرگ | `documentsAndStock`: موجودی منفی + اختلاف تعداد حرکت |

اجرای `verify-restore.mjs` داخل ایمیج API (`docker compose --profile tools run --rm migrate node
apps/api/scripts/verify-restore.mjs ...`) هم ممکن است، چون `scripts/` و `drizzle/` در ایمیج کپی
می‌شوند؛ ایمیج باید بعد از BE-068 دوباره build شده باشد. این مسیر در آزمون بالا اجرا نشد — مسیر
آزموده‌شده Node روی ماشین است.
