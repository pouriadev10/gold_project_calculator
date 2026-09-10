import {
  secondHandCoinPurchaseSchema,
  secondHandGoldPurchaseSchema,
  type CreateSecondHandCoinPurchaseInput,
  type CreateSecondHandGoldPurchaseInput,
} from '@gold/contracts';
import { apiPost } from './client';

export function createSecondHandGoldPurchase(input: CreateSecondHandGoldPurchaseInput, key: string) {
  return apiPost('/purchase/second-hand/gold', input, secondHandGoldPurchaseSchema, key);
}

export function createSecondHandCoinPurchase(input: CreateSecondHandCoinPurchaseInput, key: string) {
  return apiPost('/purchase/second-hand/coins', input, secondHandCoinPurchaseSchema, key);
}
