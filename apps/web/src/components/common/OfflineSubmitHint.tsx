/**
 * دلیل غیرفعال بودن دکمه‌ی ثبت در حالت آفلاین — FE-090. فرم‌هایی که خودشان «دلیل مسدود
 * بودن» را زیر دکمه نشان می‌دهند همین متن را به‌عنوان اولین دلیل به کار می‌برند؛ بقیه این
 * کامپوننت را زیر دکمه می‌گذارند.
 */
export const OFFLINE_SUBMIT_MESSAGE = 'اتصال اینترنت قطع است؛ ثبت تا وصل شدن غیرفعال است.';

export function OfflineSubmitHint({ offline }: { offline: boolean }) {
  if (!offline) return null;
  return <p className="text-center text-xs text-muted-foreground">{OFFLINE_SUBMIT_MESSAGE}</p>;
}
