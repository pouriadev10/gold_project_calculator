import { useParams } from '@tanstack/react-router';
import { FileText, Info, RotateCcw } from 'lucide-react';
import { formatCount } from '@gold/core-calc';
import { useInvoiceVersions } from '@/api/queries';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { PageHeader } from '@/components/common/PageHeader';
import { UnitToggle } from '@/components/common/UnitToggle';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * نقطه‌ی ورود Buyback B2C — FE-061.
 *
 * این صفحه عمداً نه فرم وزن‌کشی است و نه endpoint ثبت را صدا می‌زند. آن‌ها
 * به‌ترتیب در FE-062 و FE-063 اضافه می‌شوند. تنها کار این گام، حفظ
 * `invoiceId` در URL و شفاف‌کردن ماهیت رویداد است: خرید دست‌دومِ جدید با
 * فاکتور فروش قبلی به‌عنوان مرجعِ فقط-خواندنی؛ نه معکوس‌کردن فروش و نه
 * Return همکار.
 */
export default function B2cBuybackStartPage() {
  const { invoiceId } = useParams({ from: '/app-shell/sales/invoices/$invoiceId/b2c-buyback' });
  const invoice = useInvoiceVersions(invoiceId);

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="خرید مجدد از مشتری">
        <UnitToggle />
      </PageHeader>

      <main className="flex-1 space-y-4 p-4 pb-action">
        <Card aria-label="ماهیت خرید مجدد">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <RotateCcw className="size-5 text-primary" aria-hidden="true" />
            <CardTitle className="text-sm">خرید طلای دست‌دوم</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6">
            <p>
              این عملیات یک خرید طلای دست‌دوم از مشتری است؛ فروش قبلی را برنمی‌گرداند و هیچ تغییری در
              فاکتور اصلی ایجاد نمی‌کند.
            </p>
            <p className="text-muted-foreground">
              در گام‌های بعد، وزن و عیار امروز ثبت می‌شود و مبلغ خرید با مظنه‌ی امروز محاسبه خواهد شد.
            </p>
          </CardContent>
        </Card>

        <Card aria-label="فاکتور فروش مرجع">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <FileText className="size-5 text-muted-foreground" aria-hidden="true" />
            <CardTitle className="text-sm">فاکتور فروش مرجع</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {invoice.isLoading ? (
              <div className="space-y-3" aria-label="در حال دریافت فاکتور مرجع">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : invoice.isError ? (
              <ApiErrorNotice error={invoice.error} />
            ) : invoice.data ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">شماره فاکتور</span>
                <span className="tabular-nums font-semibold">{formatCount(invoice.data.invoiceNumber)}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">شناسه فاکتور</span>
                <span className="min-w-0 truncate font-medium" dir="ltr">{invoiceId}</span>
              </div>
            )}
            <p className="flex items-start gap-1.5 border-t border-border pt-3 text-xs leading-5 text-warning" role="note">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              این فاکتور فقط مرجع خرید جدید است؛ مبلغ و شرایط فروش اولیه در آن ویرایش نمی‌شوند.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
