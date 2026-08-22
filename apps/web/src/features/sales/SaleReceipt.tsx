import { AlertTriangle, FileText, Loader2 } from 'lucide-react';
import { dualFromRial, formatCount, formatGram, gramRate1000, toSafeNumber } from '@gold/core-calc';
import type { SalesInvoiceVersionHistory } from '@/api/contracts';
import { useInvoiceVersions } from '@/api/queries';
import { AmountDisplay, RateDisplay } from '@/components/common/AmountDisplay';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatJalaliDateTime } from '@/lib/date';
import type { SaleSubmitOutcome } from './useJewelryCashSaleSubmit';

/**
 * رسید فروش — FE-046.
 *
 * **قاعده‌ی حاکم بر کل این فایل:** «هیچ داده‌ای از محاسبه‌ی محلی جایگزین
 * پاسخ ثبت‌شده‌ی سرور نشود.» پس هر عددی که اینجا دیده می‌شود از
 * `GET /sales/invoices/:id/versions` می‌آید، نه از `sale-draft-store` و نه
 * از `calculateLinePricing`. رسید همان چیزی است که روی سرور ثبت شده —
 * اگر با آنچه کاربر لحظه‌ای پیش در «مرور» دید فرق داشته باشد، رسید درست
 * است، نه پیش‌نمایش.
 *
 * تنها استثنا و دلیلش: **نام مشتری**. پاسخ فقط `partyId` می‌دهد و نام یک
 * برچسب است، نه یک عدد مالی — از `outcome.party` (کپیِ لحظه‌ی ثبت)
 * خوانده می‌شود تا رسید یک درخواست شبکه‌ی اضافه نزند. شناسه‌ی همان مشتری
 * با `partyId` پاسخ سنجیده می‌شود و اگر نخواند، نام نشان داده نمی‌شود —
 * برچسب اشتباه روی رسیدی که به مشتری نشان داده می‌شود بدتر از نبود
 * برچسب است.
 *
 * **موبایل‌فرست، برای نشان‌دادن به مشتری** (تمام‌است‌وقتی این تسک): بدون
 * جدول، فهرست کارتی، اعداد `tabular-nums`، و مبلغ نهایی در بزرگ‌ترین
 * اندازه — چیزی که از آن طرف پیشخوان هم خوانده می‌شود.
 *
 * ⚠️ **سه ردیفی که این endpoint نمی‌دهد** و عمداً ساخته نشدند:
 * - **مظنه‌ی قفل‌شده**: روی خودِ فاکتور ذخیره می‌شود
 *   (`sales_invoices.quoteAmountRial`، همان چیزی که
 *   `sales-invoice-pdf.service.ts` می‌خواند) ولی
 *   `salesInvoiceVersionHistorySchema` آن را برنمی‌گرداند. مظنه از
 *   `outcome` (لحظه‌ی ثبت) نشان داده می‌شود و صریح «نرخ قفل‌شده‌ی همین
 *   فروش» برچسب می‌خورد؛ روی رسیدی که از فهرست فاکتورها باز شود (FE-065)
 *   این ردیف بدون یک فیلد تازه در قرارداد قابل ساخت نیست.
 * - **پرداخت و مانده**: فروش نقدی طبق تعریف کامل پرداخت‌شده و مانده‌ی
 *   صفر دارد، ولی نسیه (FE-047) این‌طور نیست. تا وقتی قرارداد
 *   `paidRial` را برنگرداند، «پرداخت کامل» برای نقدی از **نوع خودِ
 *   فروش** نتیجه می‌شود، نه از حدس‌زدن روی اعداد.
 * - **چاپ/PDF**: `GET /sales/invoices/:id/pdf` واقعاً وجود دارد
 *   (`InvoiceHistoryController`)، ولی دانلود فایل جریان و تست خودش را
 *   می‌خواهد — تسک هم صریح می‌گوید «اقدام چاپ یا PDF **در آینده**». دکمه
 *   نشان داده می‌شود و غیرفعال است، نه پنهان: کاربر می‌داند این کار
 *   می‌آید.
 */

const ITEM_TYPE_LABEL: Record<'JEWELRY' | 'COIN', string> = { JEWELRY: 'زیورآلات', COIN: 'سکه' };

function ReceiptRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/**
 * تازه‌ترین نسخه‌ی فاکتور — رسید همیشه وضعیت **فعلی** سند را نشان می‌دهد،
 * نه نسخه‌ی اول. `versions` از سرور صعودی می‌آید؛ بیشترین `version`
 * برنده است، نه آخرین عضو آرایه (تکیه بر ترتیب آرایه یک فرض نانوشته است).
 */
function currentVersion(history: SalesInvoiceVersionHistory) {
  return history.versions.reduce<SalesInvoiceVersionHistory['versions'][number] | undefined>(
    (latest, candidate) => (latest === undefined || candidate.version > latest.version ? candidate : latest),
    undefined,
  );
}

export function SaleReceipt({ outcome }: { readonly outcome: SaleSubmitOutcome }) {
  const history = useInvoiceVersions(outcome.sale.invoiceId);
  const rate1000 = gramRate1000(BigInt(outcome.lockedMazneh.mazneh));

  if (history.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        در حال دریافت رسید...
      </div>
    );
  }

  if (history.isError) return <ApiErrorNotice error={history.error} />;

  const version = history.data ? currentVersion(history.data) : undefined;
  if (!history.data || version === undefined) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        این فاکتور ثبت شد ولی هنوز نسخه‌ای برایش برنگشته است.
      </p>
    );
  }

  const partyMatches = version.partyId === outcome.party.id;
  const payableRial = version.payableRial === null ? null : BigInt(version.payableRial);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-sm">رسید فروش</CardTitle>
          {version.version > 1 ? <Badge variant="outline">اصلاح‌شده</Badge> : null}
        </CardHeader>
        <CardContent className="space-y-2">
          <ReceiptRow label="شماره فاکتور">
            <span className="tabular-nums text-lg font-bold">{formatCount(history.data.invoiceNumber)}</span>
          </ReceiptRow>
          <ReceiptRow label="نسخه">
            <span className="tabular-nums text-sm font-medium">{formatCount(version.version)}</span>
          </ReceiptRow>
          <ReceiptRow label="زمان ثبت">
            <span className="tabular-nums text-sm">{formatJalaliDateTime(new Date(version.createdAt))}</span>
          </ReceiptRow>
          <ReceiptRow label="مشتری">
            {partyMatches ? (
              <span className="truncate text-sm font-medium">{outcome.party.displayName}</span>
            ) : (
              <span className="tabular-nums text-xs text-muted-foreground" dir="ltr">
                {version.partyId}
              </span>
            )}
          </ReceiptRow>
          <ReceiptRow label="نرخ قفل‌شده‌ی این فروش">
            <RateDisplay value={BigInt(outcome.lockedMazneh.mazneh)} size="sm" />
          </ReceiptRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">اقلام ({formatCount(version.items.length)})</CardTitle>
        </CardHeader>
        <CardContent>
          {version.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">این نسخه قلمی ندارد.</p>
          ) : (
            <ul className="divide-y divide-border">
              {version.items.map((item) => (
                <li key={`${item.itemType}-${item.itemId}`} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-medium">{ITEM_TYPE_LABEL[item.itemType]}</p>
                    <span className="truncate tabular-nums text-xs text-muted-foreground" dir="ltr">
                      {item.itemId}
                    </span>
                  </div>
                  <div className="shrink-0 space-y-0.5 text-end">
                    <p className="tabular-nums text-sm">تعداد {formatCount(toSafeNumber(BigInt(item.quantity)))}</p>
                    {item.pureWeightMg !== null ? (
                      <p className="tabular-nums text-xs text-muted-foreground">
                        {formatGram(BigInt(item.pureWeightMg))} گرم خالص
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">جمع و پرداخت</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {version.pureWeightMg !== null ? (
            <ReceiptRow label="مجموع وزن خالص">
              <span className="tabular-nums text-sm font-semibold">
                {formatGram(BigInt(version.pureWeightMg))}
              </span>
            </ReceiptRow>
          ) : null}

          {payableRial === null ? (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              مبلغ این نسخه در پاسخ سرور نیامده است.
            </p>
          ) : (
            <>
              <div className="space-y-2 border-t border-border pt-2">
                <ReceiptRow label="جمع فاکتور">
                  <AmountDisplay amount={dualFromRial(payableRial, rate1000)} size="lg" />
                </ReceiptRow>
                {/* فروش نقدی طبق تعریفش کامل پرداخت می‌شود — از نوع فروش نتیجه می‌شود، نه از مقایسه‌ی اعداد */}
                <ReceiptRow label="پرداخت‌شده (نقدی)">
                  <AmountDisplay amount={dualFromRial(payableRial, rate1000)} size="sm" />
                </ReceiptRow>
                <ReceiptRow label="مانده">
                  <AmountDisplay amount={dualFromRial(0n, rate1000)} size="sm" />
                </ReceiptRow>
              </div>
            </>
          )}

          {outcome.previewMismatchRial !== undefined ? (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              مبلغ ثبت‌شده با پیش‌نمایش مرحله‌ی مرور یکی نیست؛ اعداد این رسید — همان که روی سرور ثبت شده —
              معتبرند.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Button type="button" variant="outline" size="action" className="w-full" disabled>
        <FileText className="size-4" aria-hidden="true" />
        چاپ یا دریافت PDF (به‌زودی)
      </Button>
    </div>
  );
}
