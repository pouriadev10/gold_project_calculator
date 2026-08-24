import { apiPost } from './client';
import {
  rialSettlementSchema,
  goldSettlementSchema,
  coinSettlementSchema,
  type CreateRialSettlementInput,
  type RialSettlement,
  type CreateGoldSettlementInput,
  type GoldSettlement,
  type CreateCoinSettlementInput,
  type CoinSettlement,
} from './contracts';

/**
 * ثبت پرداخت ریالی روی مانده‌ی شخص — `POST /parties/:partyId/settlements/rial`
 * (BE-045، FE-051). `idempotencyKey` اجباری است، همان دلیل فروش نقدی/سکه:
 * کلید تصادفی تازه‌ی هر تلاش یعنی هر ضربه‌ی دوم یک تسویه‌ی دوم.
 */
export function createRialSettlement(
  partyId: string,
  input: CreateRialSettlementInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<RialSettlement> {
  return apiPost(`/parties/${partyId}/settlements/rial`, input, rialSettlementSchema, idempotencyKey, signal);
}

/**
 * ثبت دریافت طلا برای تسویه‌ی مانده‌ی شخص — `POST
 * /parties/:partyId/settlements/gold` (BE-046، FE-052).
 */
export function createGoldSettlement(
  partyId: string,
  input: CreateGoldSettlementInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<GoldSettlement> {
  return apiPost(`/parties/${partyId}/settlements/gold`, input, goldSettlementSchema, idempotencyKey, signal);
}

/**
 * ثبت دریافت سکه برای تسویه‌ی مانده‌ی شخص — `POST
 * /parties/:partyId/settlements/coins` (BE-047، FE-053).
 */
export function createCoinSettlement(
  partyId: string,
  input: CreateCoinSettlementInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<CoinSettlement> {
  return apiPost(`/parties/${partyId}/settlements/coins`, input, coinSettlementSchema, idempotencyKey, signal);
}
