import { useCallback } from 'react';
import { getSecondHandPurchasePdf } from '@/api/purchase';
import { PdfDocumentActions } from '@/components/common/PdfDocumentActions';
import type { ReceiptShareContent } from '@/lib/receipt-share';

/**
 * PDF رسید خرید دست‌دوم — FE-078. روی هر سه رسید خرید دست‌دوم (طلا، سکه،
 * خرید مجدد B2C) نشسته است. نام سرور برای این سند گویا نیست
 * (`invoice-<uuid>.pdf`)، پس نام فایل این‌جا ساخته می‌شود.
 */
export function PurchaseReceiptPdf({
  purchaseId,
  share,
}: {
  purchaseId: string;
  /** متن کوتاه رسید برای اشتراک (FE-079) — از `purchaseReceiptShareText`. */
  share?: ReceiptShareContent;
}) {
  const fetchFile = useCallback(
    (signal: AbortSignal) => getSecondHandPurchasePdf(purchaseId, signal),
    [purchaseId],
  );
  const fileName = `purchase-receipt-${purchaseId.slice(0, 8)}`;

  return (
    <PdfDocumentActions
      idPrefix={`purchase-${purchaseId}`}
      fetchFile={fetchFile}
      preferredFileName={fileName}
      fallbackFileName={fileName}
      shareTitle={share?.title ?? 'رسید خرید طلای دست‌دوم'}
      {...(share ? { shareText: share.text } : {})}
      resetKey={purchaseId}
      previewTitle="پیش‌نمایش رسید خرید"
      description="رسید از سند ثبت‌شده‌ی همین خرید در سرور ساخته می‌شود."
      size="default"
    />
  );
}
