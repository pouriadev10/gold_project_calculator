import { useCallback, useEffect, useRef, useState } from 'react';
import type { DownloadedFile } from '@/api/client';
import { assertPdf, safePdfFileName, saveBlob } from '@/lib/pdf-file';

/**
 * دریافت، پیش‌نمایش، ذخیره و اشتراک یک PDF سرور — FE-077، FE-078، FE-079.
 *
 * - هر بار از سرور می‌گیرد، هرگز از کش؛ پس همیشه نسخه‌ی جاری سند است.
 * - امضای `%PDF-` سنجیده می‌شود؛ پاسخ غیر PDF خطاست، نه فایل خراب.
 * - URL پیش‌نمایش هنگام بستن، عوض شدن `resetKey` (مثلاً نسخه‌ی تازه‌ی
 *   فاکتور) و unmount آزاد می‌شود و درخواست در جریان لغو می‌شود — چیزی از
 *   سند یک نشست یا مستأجر در حافظه‌ی صفحه نمی‌ماند.
 * - اشتراک هرگز URL سند را نمی‌فرستد؛ فقط فایل و/یا متن کوتاه بی‌لینک.
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
  /**
   * متن کوتاه رسید (FE-079) — همراه فایل، یا به‌تنهایی وقتی مرورگر فقط متن را
   * به اشتراک می‌گذارد. هرگز URL در آن نیست (`lib/receipt-share.ts`).
   */
  readonly shareText?: string;
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

/** Web Share بدون فایل (فقط عنوان و متن). */
export function canShareText(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const SHARE_NOTICE = {
  savedOnly: 'اشتراک در این مرورگر پشتیبانی نمی‌شود؛ PDF ذخیره شد.',
  savedAndCopied: 'اشتراک در این مرورگر پشتیبانی نمی‌شود؛ PDF ذخیره شد و متن رسید کپی شد.',
  expired: 'آماده‌سازی فایل طول کشید و مرورگر اجازه‌ی اشتراک را پس گرفت؛ PDF ذخیره شد.',
} as const;

function isShareCancel(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isShareNotAllowed(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError';
}

export function usePdfFile({
  fetchFile,
  fallbackFileName,
  preferredFileName,
  shareTitle,
  shareText,
  resetKey,
}: UsePdfFileOptions) {
  const [pending, setPending] = useState<PdfAction | null>(null);
  const [error, setError] = useState<unknown>(null);
  /** پیام اطلاعی (نه خطا) — مثلاً «اشتراک پشتیبانی نشد؛ PDF ذخیره شد». */
  const [notice, setNotice] = useState<string | null>(null);
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
    setNotice(null);
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
      setNotice(null);

      // مرورگر فقط متن را به اشتراک می‌گذارد: همان لحظه، درون همان لمس کاربر
      // و بدون دریافت فایل (اجازه‌ی اشتراک پس از یک دریافت کند منقضی می‌شود).
      if (action === 'share' && shareText && !canShareFiles() && canShareText()) {
        setError(null);
        try {
          await navigator.share({ title: shareTitle ?? fallbackFileName, text: shareText });
        } catch (caught: unknown) {
          if (!isShareCancel(caught)) setError(caught);
        }
        return;
      }

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
              await navigator.share({
                files: [shared],
                title: shareTitle ?? fileName,
                ...(shareText ? { text: shareText } : {}),
              });
            } catch (shareError: unknown) {
              // دریافت کند بود و «اجازه‌ی کاربر» مرورگر منقضی شد — فایل را ذخیره کن.
              if (!isShareNotAllowed(shareError)) throw shareError;
              saveBlob(file.content, fileName);
              setNotice(SHARE_NOTICE.expired);
            }
          } else {
            // fallback دسکتاپ: فایل ذخیره و متن رسید (اگر هست) در کلیپ‌بورد کپی می‌شود.
            saveBlob(file.content, fileName);
            const copied = shareText ? await copyText(shareText) : false;
            setNotice(copied ? SHARE_NOTICE.savedAndCopied : SHARE_NOTICE.savedOnly);
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
    [fetchFile, fallbackFileName, preferredFileName, shareTitle, shareText, replacePreview],
  );

  return {
    pending,
    error,
    notice,
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
