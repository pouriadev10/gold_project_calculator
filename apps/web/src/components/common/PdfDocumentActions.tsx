import { useState } from 'react';
import { Download, Eye, Loader2, Share2 } from 'lucide-react';
import type { DownloadedFile } from '@/api/client';
import { presentPdfError } from '@/api/error-presentation';
import { ApiErrorNoticeContent } from '@/components/common/ApiErrorNotice';
import { PdfPreviewPanel } from '@/components/common/PdfPreviewPanel';
import { Button } from '@/components/ui/button';
import { canShareFiles, usePdfFile, type PdfAction } from '@/hooks/usePdfFile';
import { cn } from '@/lib/utils';

/**
 * اقدامات PDF یک سند سرور — FE-077 (فاکتور)، FE-078 (رسید خرید دست‌دوم،
 * صورت‌حساب شخص) و FE-079 (اشتراک رسید).
 *
 * «دریافت PDF» و «پیش‌نمایش» همیشه. «اشتراک» وقتی مرورگر بتواند خودِ فایل
 * PDF را با Web Share بفرستد، یا وقتی سند یک رسیدِ دارای متن کوتاه است —
 * آن‌گاه به‌ترتیب: فایل + متن، فقط متن، یا روی دسکتاپ ذخیره‌ی PDF و کپی
 * متن (با پیام صریح). هیچ‌وقت URL سند به اشتراک گذاشته نمی‌شود — فقط فایلی
 * که با نشست همین کاربر گرفته شده و متنی که لینک ندارد.
 */

export interface PdfDocumentActionsProps {
  readonly fetchFile: (signal: AbortSignal) => Promise<DownloadedFile>;
  readonly fallbackFileName: string;
  readonly preferredFileName?: string;
  readonly shareTitle?: string;
  /** متن کوتاه رسید (FE-079)؛ با آن «اشتراک» همیشه دیده می‌شود. */
  readonly shareText?: string;
  readonly resetKey?: string | number;
  /** عنوان پنل پیش‌نمایش. */
  readonly previewTitle: string;
  /** متن زیر دکمه‌ها وقتی کاری در جریان نیست. */
  readonly description: string;
  readonly available?: boolean;
  readonly unavailableReason?: string;
  /** پیشوند یکتای شناسه‌ها برای `aria-describedby`. */
  readonly idPrefix: string;
  /** `action` برای اقدام اصلی صفحه، `default` برای رسیدهای فشرده. */
  readonly size?: 'action' | 'default';
}

const PENDING_TEXT: Record<PdfAction, string> = {
  download: 'در حال دریافت PDF از سرور…',
  preview: 'در حال آماده‌سازی پیش‌نمایش…',
  share: 'در حال آماده‌سازی فایل برای اشتراک…',
};

function ActionIcon({ pending, icon: Icon }: { pending: boolean; icon: typeof Download }) {
  const size = 'size-5';
  return pending ? (
    <Loader2 className={cn(size, 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
  ) : (
    <Icon className={size} aria-hidden="true" />
  );
}

export function PdfDocumentActions({
  fetchFile,
  fallbackFileName,
  preferredFileName,
  shareTitle,
  shareText,
  resetKey,
  previewTitle,
  description,
  available = true,
  unavailableReason,
  idPrefix,
  size = 'action',
}: PdfDocumentActionsProps) {
  const pdf = usePdfFile({
    fetchFile,
    fallbackFileName,
    ...(preferredFileName !== undefined ? { preferredFileName } : {}),
    ...(shareTitle !== undefined ? { shareTitle } : {}),
    ...(shareText !== undefined ? { shareText } : {}),
    ...(resetKey !== undefined ? { resetKey } : {}),
  });
  const [fileShareSupported] = useState(canShareFiles);
  // بدون متن رسید، اشتراک فقط وقتی معنا دارد که فایل قابل اشتراک باشد (صورت‌حساب).
  const shareSupported = shareText !== undefined || fileShareSupported;
  const busy = pdf.pending !== null;
  const disabled = !available || busy;
  const statusId = `${idPrefix}-pdf-status`;

  return (
    <div className="space-y-2">
      <div className={cn('grid gap-2', shareSupported ? 'grid-cols-3' : 'grid-cols-2')}>
        <Button
          type="button"
          size={size}
          onClick={() => void pdf.download()}
          disabled={disabled}
          aria-describedby={statusId}
        >
          <ActionIcon pending={pdf.pending === 'download'} icon={Download} />
          دریافت PDF
        </Button>
        <Button
          type="button"
          size={size}
          variant="outline"
          onClick={() => void pdf.openPreview()}
          disabled={disabled}
          aria-describedby={statusId}
        >
          <ActionIcon pending={pdf.pending === 'preview'} icon={Eye} />
          پیش‌نمایش
        </Button>
        {shareSupported ? (
          <Button
            type="button"
            size={size}
            variant="outline"
            onClick={() => void pdf.share()}
            disabled={disabled}
            aria-describedby={statusId}
          >
            <ActionIcon pending={pdf.pending === 'share'} icon={Share2} />
            اشتراک
          </Button>
        ) : null}
      </div>
      <p id={statusId} className="text-xs leading-5 text-muted-foreground" aria-live="polite">
        {!available ? unavailableReason : pdf.pending ? PENDING_TEXT[pdf.pending] : (pdf.notice ?? description)}
      </p>
      {pdf.error ? <ApiErrorNoticeContent presentation={presentPdfError(pdf.error)} /> : null}
      {pdf.preview ? (
        <PdfPreviewPanel
          url={pdf.preview.url}
          fileName={pdf.preview.fileName}
          title={previewTitle}
          onClose={pdf.closePreview}
          onSave={pdf.savePreview}
        />
      ) : null}
    </div>
  );
}
