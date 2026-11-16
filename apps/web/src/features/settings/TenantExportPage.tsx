import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Download, FileJson, Loader2 } from 'lucide-react';
import { createTenantExport, getTenantExportFile } from '@/api/platform';
import type { TenantExport } from '@/api/contracts';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { OfflineSubmitHint } from '@/components/common/OfflineSubmitHint';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { formatJalaliDateTime } from '@/lib/date';
import { safeFileName, saveBlob } from '@/lib/pdf-file';

/**
 * خروجی کامل داده‌ی مستأجر — BE-069 / D-03، فقط OWNER (مسیر با `requireRole`).
 *
 * یک فایل JSON با همه‌ی داده‌ی فروشگاه (قالب در `docs/tenant-export.md`). مالک مستأجر معلق هم
 * وارد می‌شود و این تنها نوشتنی است که سرور از او می‌پذیرد، تا کسب‌وکاری که معلق شده یا دارد
 * می‌رود داده‌اش را بگیرد.
 *
 * دو گام جدا: «ساخت» (نوشتن با Idempotency-Key) و «دریافت فایل». دریافت ضربه‌ی خود کاربر است،
 * تا مرورگر ذخیره‌ی فایل را مسدود نکند، و تکرارش خروجی تازه نمی‌سازد.
 */

const SIZE_FORMAT = new Intl.NumberFormat('fa-IR');

/** اندازه به کیلوبایت، رو به بالا و بدون اعشار — `byteSize` پول یا وزن نیست، فقط برای نمایش است. */
function formatKilobytes(byteSize: number): string {
  return `${SIZE_FORMAT.format((BigInt(byteSize) + 1023n) / 1024n)} کیلوبایت`;
}

export default function TenantExportPage() {
  const [created, setCreated] = useState<TenantExport | null>(null);
  const [createError, setCreateError] = useState<unknown>(null);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const { submit, isSubmitting, reset, offline } = useIdempotentSubmit((key: string, _payload: null) =>
    createTenantExport(key),
  );

  async function handleCreate() {
    setCreateError(null);
    setDownloadError(null);
    try {
      const result = await submit(null);
      if (result === undefined) return;
      setCreated(result);
      // ساخت قطعی شد؛ ضربه‌ی بعدی یعنی خروجی تازه‌ی دیگری، نه تکرار همین.
      reset();
    } catch (error) {
      setCreateError(error);
    }
  }

  async function handleDownload(exportRecord: TenantExport) {
    setDownloadError(null);
    setIsDownloading(true);
    try {
      const file = await getTenantExportFile(exportRecord.id);
      saveBlob(file.content, safeFileName(file.fileName, `tenant-export-${exportRecord.id.slice(0, 8)}`, 'json'));
    } catch (error) {
      setDownloadError(error);
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="خروجی کامل داده" />
      <div className="flex flex-1 flex-col gap-4 p-4 pb-6">
        <Link
          to="/settings"
          className="inline-flex min-h-touch cursor-pointer items-center gap-1 self-start rounded-md px-2 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
          بیشتر
        </Link>

        <div className="space-y-2 text-sm leading-6 text-muted-foreground">
          <p>
            یک فایل JSON با همه‌ی داده‌ی این فروشگاه: اشخاص، فاکتورها و اصلاحیه‌ها، خریدها، تسویه‌ها،
            دفتر کل، موجودی، مظنه‌ها، تنظیمات و سابقه‌ی تغییرات. برای نگهداری مستقل یا انتقال به نرم‌افزار
            دیگر.
          </p>
          <p>
            فایل کد ملی و اطلاعات تماس مشتریان را دارد؛ آن را جای امن نگه دارید. هر خروجی عکسی از داده در
            لحظه‌ی ساخت است؛ برای داده‌ی تازه‌تر، خروجی تازه بسازید.
          </p>
        </div>

        {createError ? <ApiErrorNotice error={createError} /> : null}

        {created ? (
          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-start gap-3">
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
                  aria-hidden="true"
                >
                  <FileJson className="size-5" />
                </span>
                <div className="min-w-0 space-y-1">
                  <h2 className="text-sm font-semibold">خروجی آماده است</h2>
                  <dl className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex gap-1">
                      <dt>زمان داده:</dt>
                      <dd className="tabular-nums">{formatJalaliDateTime(new Date(created.snapshotAt))}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>اندازه:</dt>
                      <dd className="tabular-nums">{formatKilobytes(created.byteSize)}</dd>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <dt>اثر انگشت فایل (SHA-256):</dt>
                      <dd dir="ltr" className="break-all font-mono">
                        {created.sha256}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
              {downloadError ? <ApiErrorNotice error={downloadError} /> : null}
              <Button
                type="button"
                className="w-full"
                onClick={() => void handleDownload(created)}
                disabled={isDownloading}
              >
                {isDownloading ? (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <Download className="size-4" aria-hidden="true" />
                )}
                دریافت فایل
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <div className="mt-auto space-y-2">
          <Button
            type="button"
            variant={created ? 'outline' : 'default'}
            className="w-full"
            onClick={() => void handleCreate()}
            disabled={isSubmitting || offline}
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : null}
            {isSubmitting ? 'در حال ساخت خروجی…' : created ? 'ساخت خروجی تازه' : 'ساخت خروجی'}
          </Button>
          <OfflineSubmitHint offline={offline} />
        </div>
      </div>
    </div>
  );
}
