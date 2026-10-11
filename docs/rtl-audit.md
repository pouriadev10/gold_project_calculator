# ممیزی RTL — FE-083

**تاریخ:** ۱۴۰۵/۰۷/۱۹ (۲۰۲۶-۱۰-۱۱) · شاخه‌ی `dev_pouria`
**روش:** جست‌وجوی کامل `apps/web/src` (tsx/ts/css) برای کلاس و خاصیت جهت‌دار، آیکون جهت‌دار، رندر خام عدد و
متن مخلوط، به‌علاوه‌ی خواندن مستقیم کامپوننت‌های drawer/sheet/toast/table و ماژول نمودار. هر یافته یا اصلاح شد یا
دلیل درست بودنش همین‌جا ثبت شده است.

## خلاصه

پایه‌ی RTL از ابتدا محکم بوده: `<html lang="fa" dir="rtl">`، قاعده‌ی ESLint ضد کلاس جهت‌دار، `text-start` در جدول، و
نمودار با محور معکوس. **هیچ کلاس `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`/`text-left`/`text-right` در کد نبود.**
پنج مشکل واقعی پیدا و اصلاح شد (جدول آخر). قاعده‌ی ESLint گسترش یافت تا موارد جاافتاده هم از این به بعد خطا شوند.

## موارد

| مورد | وضعیت | توضیح / فایل |
|---|---|---|
| **logical spacing** | درست · قاعده گسترش یافت | صفر کلاس جهت‌دار در `apps/web/src`؛ CSS هم هیچ `margin-left`/`left:` ندارد. قاعده‌ی `no-restricted-syntax` در `eslint.config.js` حالا `rounded-tl/tr/bl/br-`، `float-left/right`، `scroll-ml/mr/pl/pr-` و `slide-in-from/out-to-left/right` را هم می‌گیرد. تنها استثنا کلاسی است که مستقیماً با `rtl:`/`ltr:` محدود شده (آزمون‌شده: `hover:ml-2` و `sm:float-right` خطا، `data-[state=open]:rtl:slide-in-from-left` مجاز). |
| **آیکون‌های جهت‌دار** | درست | «قبلی»/«بازگشت» `ChevronRight` و «بعدی» `ChevronLeft` در هر پنج صفحه‌ی دارای صفحه‌بندی (`PartyList`، `SalesInvoiceList`، `QuoteHistoryList`، `PartyStatementPage`، `PartyBalanceReportPage`) و همه‌ی لینک‌های بازگشت — درست برای RTL. چون برنامه فقط RTL است، آیکون ثابت انتخاب شده نه `rtl:rotate-180`. `TrendingUp`/`LogOut` جهت معنایی ندارند. |
| **breadcrumb** | ندارد | برنامه breadcrumb ندارد؛ نقش آن را لینک «بازگشت» بالای صفحه‌ها (با `ChevronRight`) دارد که درست است. |
| **drawer** | درست · یک اصلاح | `ResponsiveDialog` زیر ۶۴۰px از `vaul` پایین‌به‌بالا استفاده می‌کند — مستقل از جهت. **اصلاح:** `components/ui/sheet.tsx` جای پنل را منطقی (`start-0`/`end-0`) داشت ولی نام انیمیشن لغزش فیزیکی بود و توضیح کد به‌غلط می‌گفت «خودبه‌خود قرینه می‌شود»؛ حالا برای هر جهت صریح است (`data-[state=open]:rtl:slide-in-from-right` …) و در CSS خروجی با `:where([dir=rtl] …)` تولید می‌شود. |
| **toast** | اصلاح شد | روی دسکتاپ toast در گوشه‌ی `end` (پایین-چپ در RTL) است ولی جهت کشیدن برای بستن پیش‌فرض Radix (`right`) بود که toast را به وسط صفحه می‌کشید. حالا `swipeDirection="left"` (`Toaster.tsx`). |
| **table** | درست | `components/ui/table.tsx` از `text-start` استفاده می‌کند؛ زیر ۶۴۰px جدولی نیست (فهرست کارتی). ستون‌های عددی `tabular-nums` دارند. |
| **chart** | درست | `profit-trend-echarts.ts`: محور x با `inverse: true` (قدیمی‌ترین دوره سمت راست)، محور y در `position: 'right'`، legend در راست، tooltip با `dir="rtl"` و `text-align:right` و هر مقدار عددی در `dir="ltr"` تا علامت منفی (U+2212) کنار عدد بماند. برچسب‌ها از قالب‌بندی core-calc (ارقام فارسی) می‌آیند. |
| **شماره‌ها** | درست · یک اصلاح | همه‌ی مبالغ، وزن‌ها، عیارها و شمارش‌ها از `formatRial`/`formatGram`/`formatKarat`/`formatCount` (`Intl.NumberFormat('fa-IR')`) می‌گذرند؛ هیچ `toLocaleString`/`toFixed` یا رندر خام عدد پیدا نشد. **اصلاح:** موبایل و کد ملی در فهرست اشخاص، جزئیات شخص و خلاصه‌ی فروش با ارقام لاتین نمایش داده می‌شدند در حالی که نسخه‌ی ماسک‌شده‌شان (`maskMobileForDisplay`) فارسی بود؛ حالا با `toPersianDigits` نمایش داده می‌شوند (مقدار ذخیره‌شده و ارسالی همچنان لاتین) و `dir="ltr"` ترتیب ارقام را نگه می‌دارد. |
| **mixed-direction text** | درست · سه اصلاح | کد کالا، شناسه‌ی سند، موبایل، شناسه‌ی درخواست خطا و منطقه‌ی زمانی از قبل `dir="ltr"` یا `<bdi>` داشتند. **اصلاح‌ها:** (۱) متن `<option>` انتخاب کالا در اصلاح فاکتور عنوان و کد را در یک رشته می‌چسباند و عنصر HTML آنجا ممکن نیست → `isolateBidi` (نویسه‌های نامرئی FSI/PDI، `lib/bidi.ts`). (۲) متن اشتراک رسید که به واتس‌اپ/پیامک می‌رود: نام فروشگاه، نام مشتری و شناسه‌ی سند لاتین حالا جدا می‌شوند، تا یک نام لاتین ترتیب سطر را در برنامه‌ی مقصد به‌هم نریزد؛ متن تمام‌فارسی دست نمی‌خورد. (۳) کد نوع سکه در داشبورد، جزئیات شخص و گزارش بدهکاران/بستانکاران داخل `<bdi>` رفت. |

## اصلاح‌های این تسک

| # | فایل | تغییر |
|---|---|---|
| ۱ | `eslint.config.js` | گسترش قاعده‌ی کلاس جهت‌دار + استثنای `rtl:`/`ltr:` |
| ۲ | `components/ui/sheet.tsx` | انیمیشن لغزش صریح برای هر جهت |
| ۳ | `components/common/Toaster.tsx` | `swipeDirection="left"` |
| ۴ | `lib/bidi.ts` (تازه) | `isolateBidi` برای متن ساده؛ در `SalesInvoiceAmendPage` و `receipt-share.ts` |
| ۵ | `PartyList`، `PartyDetailPage`، `SaleSummary` | موبایل/کد ملی با ارقام فارسی |
| ۶ | `DashboardOverview`، `PartyDetailPage`، `PartyBalanceReportPage` | کد سکه در `<bdi>` |

## خارج از دامنه (ثبت‌شده)

- این صفحه‌ها کد نوع سکه (مثلاً `BAHAR_AZADI_NEW`) را به‌جای عنوانش نشان می‌دهند، چون قرارداد API برای آن‌ها فقط `code` دارد. این مسئله‌ی RTL نیست، مسئله‌ی تجربه‌ی کاربری و قرارداد است.
- تست دستی روی دستگاه و مرورگر واقعی انجام نشد (مطابق درخواست کاربر پیش‌نمایش مرورگر اجرا نشد)؛ همه‌ی موارد بالا با بررسی کد، تست واحد و CSS خروجی build تأیید شده‌اند.
