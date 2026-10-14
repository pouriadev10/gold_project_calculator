/**
 * ابزار فایل‌های PDF دریافتی از سرور — FE-077 (فاکتور)، قابل استفاده برای
 * رسید خرید و صورت‌حساب (FE-078).
 *
 * PDF همیشه از snapshot تاریخی سرور ساخته می‌شود؛ مرورگر فقط دریافت،
 * اعتبارسنجی، پیش‌نمایش و ذخیره می‌کند.
 */

/** پاسخ با موفقیت آمده ولی محتوایش PDF نیست (مثلاً صفحه‌ی HTML یک proxy). */
export class InvalidPdfError extends Error {
  constructor() {
    super('فایل دریافتی PDF معتبر نیست');
    this.name = 'InvalidPdfError';
  }
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/**
 * نام فایل از هدر `X-File-Name` سرور (FE-098) — `encodeURIComponent` ِ نام، پس نام فارسی هم سالم
 * می‌رسد. سرور عمداً `Content-Disposition` نمی‌فرستد: نرم‌افزارهای امنیتی وب (مثل ESET) هر پاسخ
 * دارای آن را برای `fetch` به ۲۰۴ ِ خالی تبدیل می‌کنند. کدگذاری خراب ← `null`، نه حدس.
 */
export function fileNameFromHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  try {
    const name = decodeURIComponent(header).trim();
    return name === '' ? null : name;
  } catch {
    return null;
  }
}

/**
 * نام فایل از هدر `Content-Disposition` (سرورهای قدیمی‌تر/دیگر). شکل RFC 5987 (`filename*=UTF-8''…`)
 * بر `filename=` مقدم است، چون فقط آن نام غیرلاتین را درست می‌رساند.
 */
export function fileNameFromContentDisposition(header: string | null | undefined): string | null {
  if (!header) return null;

  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/iu.exec(header);
  if (extended?.[2]) {
    try {
      return decodeURIComponent(extended[2].trim().replace(/^"|"$/gu, ''));
    } catch {
      // کدگذاری خراب — سراغ filename ساده برو.
    }
  }

  const quoted = /filename\s*=\s*"([^"]*)"/iu.exec(header);
  if (quoted?.[1]) return quoted[1];

  const bare = /filename\s*=\s*([^;\s]+)/iu.exec(header);
  return bare?.[1] ?? null;
}

// نویسه‌های کنترلی و رزروشده‌ی نام فایل در ویندوز/اندروید/iOS.
// eslint-disable-next-line no-control-regex -- عمداً نویسه‌های کنترلی را حذف می‌کند
const UNSAFE_FILE_NAME_CHARS = /[\u0000-\u001f\u007f<>:"/\\|?*]+/gu;

/**
 * نام امن برای ذخیره: فقط نام پایه (بدون مسیر)، بدون نویسه‌ی ناامن، با
 * پسوند `.pdf`. اگر چیزی نماند، `fallback` (که خودش هم پاک می‌شود).
 */
export function safePdfFileName(candidate: string | null | undefined, fallback: string): string {
  const clean = (value: string) =>
    (value.split(/[\\/]/u).at(-1) ?? '')
      .replace(/\.pdf$/iu, '')
      .replace(UNSAFE_FILE_NAME_CHARS, '-')
      .replace(/\s+/gu, ' ')
      .replace(/^[.\s-]+|[.\s-]+$/gu, '');

  const base = clean(candidate ?? '') || clean(fallback) || 'document';
  return `${base}.pdf`;
}

function readHeader(blob: Blob, length: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new InvalidPdfError());
    reader.readAsArrayBuffer(blob.slice(0, length));
  });
}

/** امضای فایل را می‌سنجد، نه فقط `Content-Type` را — نوع اعلام‌شده قابل اعتماد نیست. */
export async function assertPdf(blob: Blob): Promise<void> {
  if (blob.size < PDF_MAGIC.length) throw new InvalidPdfError();
  const header = await readHeader(blob, PDF_MAGIC.length);
  if (!PDF_MAGIC.every((byte, index) => header[index] === byte)) throw new InvalidPdfError();
}

/**
 * ذخیره‌ی فایل با لینک موقت. آزادسازی URL کمی عقب می‌افتد، چون برخی
 * مرورگرها (فایرفاکس، سافاری) اگر URL بلافاصله پس از `click` باطل شود
 * دانلود را لغو می‌کنند.
 */
export function saveBlob(blob: Blob, fileName: string, revokeDelayMs = 10_000): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), revokeDelayMs);
}
