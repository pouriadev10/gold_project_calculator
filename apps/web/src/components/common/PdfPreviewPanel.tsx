import { Download, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * پیش‌نمایش درون‌صفحه‌ای PDF — FE-077.
 *
 * عمداً پنل درون‌خطی است، نه `ResponsiveDialog` (باگ شناخته‌شده‌ی گیر کردن
 * دیالوگ/Bottom Sheet). بسیاری از مرورگرهای موبایل PDF را درون `<object>`
 * نشان نمی‌دهند؛ برای همین محتوای جایگزین داخل خودِ `<object>` و دو اقدام
 * «ذخیره» و «باز کردن در تب جدید» همیشه زیر پیش‌نمایش در دسترس‌اند.
 */
export function PdfPreviewPanel({
  url,
  fileName,
  title,
  onClose,
  onSave,
}: {
  url: string;
  fileName: string;
  title: string;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-2" aria-label={title}>
      <div className="flex items-center justify-between gap-2 ps-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="truncate text-xs text-muted-foreground" dir="ltr">
            {fileName}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="بستن پیش‌نمایش" onClick={onClose}>
          <X className="size-5" aria-hidden="true" />
        </Button>
      </div>

      <object data={url} type="application/pdf" className="h-[70dvh] w-full rounded-md bg-muted" aria-label={title}>
        <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
          <p>این مرورگر PDF را درون صفحه نشان نمی‌دهد؛ آن را ذخیره کنید یا در تب جدید باز کنید.</p>
        </div>
      </object>

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={onSave}>
          <Download className="size-4" aria-hidden="true" />
          ذخیره فایل
        </Button>
        <Button asChild variant="outline">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" aria-hidden="true" />
            باز کردن در تب جدید
          </a>
        </Button>
      </div>
    </section>
  );
}
