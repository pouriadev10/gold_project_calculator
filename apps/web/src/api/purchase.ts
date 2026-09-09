import { secondHandGoldPurchaseSchema, type CreateSecondHandGoldPurchaseInput } from '@gold/contracts';
import { apiPost } from './client';

export function createSecondHandGoldPurchase(input: CreateSecondHandGoldPurchaseInput, key: string) {
  return apiPost('/purchase/second-hand/gold', input, secondHandGoldPurchaseSchema, key);
}
