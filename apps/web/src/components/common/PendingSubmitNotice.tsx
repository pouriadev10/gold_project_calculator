/**
 * تلاش ثبتی که پاسخش نرسیده — FE-100. کنار `ApiErrorNotice` می‌نشیند و توضیح می‌دهد چرا فرم
 * قفل است و دکمه‌ی اصلی چه می‌کند: همان درخواست با همان شناسه دوباره فرستاده می‌شود، پس اگر
 * سند قبلاً ثبت شده باشد سند دوم ساخته نمی‌شود.
 */
export const PENDING_SUBMIT_ACTION = 'بررسی نتیجه‌ی ثبت';

export function PendingSubmitNotice({ uncertain }: { readonly uncertain: boolean }) {
  if (!uncertain) return null;
  return (
    <p className="text-sm text-warning" role="status">
      نتیجه‌ی ثبت قبلی هنوز مشخص نیست. «{PENDING_SUBMIT_ACTION}» همان درخواست را با همان شناسه دوباره
      می‌فرستد؛ اگر قبلاً ثبت شده باشد، سند دوم ساخته نمی‌شود.
    </p>
  );
}
