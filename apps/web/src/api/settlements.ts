import { apiPost } from './client';
import { rialSettlementSchema, type CreateRialSettlementInput, type RialSettlement } from './contracts';

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
