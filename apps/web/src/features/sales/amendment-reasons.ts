import { invoiceAmendmentReasonSchema, type AmendSalesInvoiceInput } from '@gold/contracts';

export type InvoiceAmendmentReason = AmendSalesInvoiceInput['reason'];

/**
 * یک واژه برای هر دلیل اصلاح فاکتور — M-34، مسئله‌ی #38. فرم اصلاح «اشتباه وزن» می‌پرسید و تاریخچه‌ی
 * نسخه‌ها همان را «اصلاح وزن» نشان می‌داد؛ کاربر دلیلی را که انتخاب کرده بود در تاریخچه پیدا نمی‌کرد.
 * هر دو حالا از همین نقشه می‌خوانند.
 */
export const AMENDMENT_REASON_LABEL: Readonly<Record<InvoiceAmendmentReason, string>> = {
  WEIGHT_ERROR: 'اشتباه وزن',
  KARAT_ERROR: 'اشتباه عیار',
  WAGE_ERROR: 'اشتباه اجرت',
  PARTY_ERROR: 'اشتباه مشتری',
  PAYMENT_ERROR: 'اشتباه پرداخت',
  OTHER: 'سایر',
};

/** گزینه‌های فرم اصلاح، به ترتیب قرارداد. */
export const AMENDMENT_REASON_OPTIONS = invoiceAmendmentReasonSchema.options.map((value) => ({
  value,
  label: AMENDMENT_REASON_LABEL[value],
}));

/** برچسب دلیلی که از سرور آمده؛ دلیل ناشناخته (نسخه‌ی تازه‌تر سرور) همان‌طور که هست نشان داده می‌شود. */
export function amendmentReasonLabel(reason: string): string {
  const known = AMENDMENT_REASON_OPTIONS.find((option) => option.value === reason);
  return known === undefined ? reason : known.label;
}
