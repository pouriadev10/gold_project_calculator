import {
  b2cBuybackPreviewSchema,
  secondHandCoinPurchaseSchema,
  secondHandGoldPurchaseSchema,
  type B2cBuybackPreview,
  type CreateSecondHandCoinPurchaseInput,
  type CreateSecondHandGoldPurchaseInput,
  type PreviewB2cBuybackInput,
} from '@gold/contracts';
import { apiPost, apiPostReadOnly } from './client';

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
