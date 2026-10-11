import {
  b2cBuybackSchema,
  b2cBuybackPreviewSchema,
  secondHandCoinPurchaseSchema,
  secondHandGoldPurchaseSchema,
  type B2cBuyback,
  type B2cBuybackPreview,
  type CreateB2cBuybackInput,
  type CreateSecondHandCoinPurchaseInput,
  type CreateSecondHandGoldPurchaseInput,
  type PreviewB2cBuybackInput,
} from '@gold/contracts';
import { apiGetFile, apiPost, apiPostReadOnly, type DownloadedFile } from './client';

export function createSecondHandGoldPurchase(
  input: CreateSecondHandGoldPurchaseInput,
  key: string,
) {
  return apiPost('/purchase/second-hand/gold', input, secondHandGoldPurchaseSchema, key);
}

export function createSecondHandCoinPurchase(
  input: CreateSecondHandCoinPurchaseInput,
  key: string,
) {
  return apiPost('/purchase/second-hand/coins', input, secondHandCoinPurchaseSchema, key);
}

/** مقایسه‌ی فقط‌خواندنی فروش اولیه با خرید دست‌دوم امروز؛ هیچ سندی ثبت نمی‌شود. */
export function previewB2cBuyback(
  invoiceId: string,
  input: PreviewB2cBuybackInput,
): Promise<B2cBuybackPreview> {
  return apiPostReadOnly(
    `/sales/invoices/${invoiceId}/b2c-buyback/preview`,
    input,
    b2cBuybackPreviewSchema,
  );
}

/** ثبت خرید دست‌دوم جدیدی که فاکتور فروش فقط مرجع آن است. */
export function createB2cBuyback(
  invoiceId: string,
  input: CreateB2cBuybackInput,
  key: string,
): Promise<B2cBuyback> {
  return apiPost(`/sales/invoices/${invoiceId}/b2c-buyback`, input, b2cBuybackSchema, key);
}

/**
 * PDF رسید یک خرید دست‌دوم — `GET /purchase/second-hand/:purchaseId/pdf`
 * (FE-078). برای هر خرید دست‌دوم کار می‌کند: طلا، سکه و خرید مجدد B2C؛ سرور
 * سند مستأجر دیگر را ۴۰۴ می‌دهد.
 */
export function getSecondHandPurchasePdf(purchaseId: string, signal?: AbortSignal): Promise<DownloadedFile> {
  return apiGetFile(`/purchase/second-hand/${purchaseId}/pdf`, signal);
}
