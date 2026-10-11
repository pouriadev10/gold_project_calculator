import { useCallback, useEffect, useRef, useState } from 'react';
import type { DownloadedFile } from '@/api/client';
import { assertPdf, safePdfFileName, saveBlob } from '@/lib/pdf-file';

/**
 * دریافت، پیش‌نمایش، ذخیره و اشتراک یک PDF سرور — FE-077 (و FE-078).
 *
 * - هر بار از سرور می‌گیرد، هرگز از کش؛ پس همیشه نسخه‌ی جاری سند است.
 * - امضای `%PDF-` سنجیده می‌شود؛ پاسخ غیر PDF خطاست، نه فایل خراب.
 * - URL پیش‌نمایش هنگام بستن، عوض شدن `resetKey` (مثلاً نسخه‌ی تازه‌ی
 *   فاکتور) و unmount آزاد می‌شود و درخواست در جریان لغو می‌شود — چیزی از
 *   سند یک نشست یا مستأجر در حافظه‌ی صفحه نمی‌ماند.
 */

export type PdfAction = 'download' | 'preview' | 'share';

export interface PdfPreview {
  readonly url: string;
  readonly fileName: string;
}

export interface UsePdfFileOptions {
  readonly fetchFile: (signal: AbortSignal) => Promise<DownloadedFile>;
  /** نام جایگزین وقتی سرور `Content-Disposition` نفرستد. */
  readonly fallbackFileName: string;
  /**
   * نامی که بر نام سرور مقدم است — برای سندهایی که نام سرورشان گویا نیست
   * (FE-078: رسید خرید و صورت‌حساب هر دو از سرور `invoice-<uuid>.pdf` می‌گیرند).
   */
  readonly preferredFileName?: string;
  /** عنوان برگه‌ی اشتراک سیستم‌عامل. */
  readonly shareTitle?: string;
  /** با تغییرش پیش‌نمایش و خطای قبلی دور ریخته می‌شود. */
  readonly resetKey?: string | number;
}

/**
 * آیا مرورگر می‌تواند **فایل** PDF را با Web Share بفرستد؟ فقط فایل به
 * اشتراک گذاشته می‌شود، هرگز URL خصوصی سند.
 */
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([''], 'document.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

function isShareCancel(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function usePdfFile({
  fetchFile,
  fallbackFileName,
  preferredFileName,
  shareTitle,
  resetKey,
}: UsePdfFileOptions) {
  const [pending, setPending] = useState<PdfAction | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [preview, setPreview] = useState<PdfPreview | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const replacePreview = useCallback((next: PdfPreview | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = next?.url ?? null;
    setPreview(next);
  }, []);

  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPending(null);
    setError(null);
    replacePreview(null);
  }, [resetKey, replacePreview]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    },
    [],
  );

  const run = useCallback(
    async (action: PdfAction) => {
      if (controllerRef.current) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      setPending(action);
      setError(null);
      try {
        const file = await fetchFile(controller.signal);
        await assertPdf(file.content);
        if (controller.signal.aborted) return;
        const fileName = safePdfFileName(preferredFileName ?? file.fileName, fallbackFileName);
        if (action === 'download') {
          saveBlob(file.content, fileName);
        } else if (action === 'share') {
          const shared = new File([file.content], fileName, { type: 'application/pdf' });
          if (canShareFiles() && navigator.canShare({ files: [shared] })) {
            try {
              await navigator.share({ files: [shared], title: shareTitle ?? fileName });
            } catch (shareError: unknown) {
              // دریافت کند بود و «اجازه‌ی کاربر» مرورگر منقضی شد — فایل را ذخیره کن.
              if (shareError instanceof DOMException && shareError.name === 'NotAllowedError') {
                saveBlob(file.content, fileName);
              } else {
                throw shareError;
              }
            }
          } else {
            // اشتراک فایل پشتیبانی نشد — همان فایل ذخیره می‌شود.
            saveBlob(file.content, fileName);
          }
        } else {
          replacePreview({ url: URL.createObjectURL(file.content), fileName });
        }
      } catch (caught: unknown) {
        if (!controller.signal.aborted && !isShareCancel(caught)) setError(caught);
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setPending(null);
        }
      }
    },
    [fetchFile, fallbackFileName, preferredFileName, shareTitle, replacePreview],
  );

  return {
    pending,
    error,
    preview,
    download: useCallback(() => run('download'), [run]),
    openPreview: useCallback(() => run('preview'), [run]),
    share: useCallback(() => run('share'), [run]),
    closePreview: useCallback(() => replacePreview(null), [replacePreview]),
    /** ذخیره‌ی همان فایلی که در پیش‌نمایش است، بدون درخواست دوباره. */
    savePreview: useCallback(() => {
      if (!preview) return;
      const anchor = document.createElement('a');
      anchor.href = preview.url;
      anchor.download = preview.fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    }, [preview]),
  };
}
