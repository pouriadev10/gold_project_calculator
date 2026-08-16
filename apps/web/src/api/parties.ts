import { apiPost } from './client';
import { partySchema, type CreatePartyInput, type Party } from './contracts';

/**
 * ثبت شخص جدید — `POST /parties` (BE-024، FE-032).
 *
 * تابع مجزا از `queries.ts` است، به همان دلیل `api/pricing.ts`: این یک
 * نوشتن است که `CreatePartyDialog` مستقیماً با `useIdempotentSubmit`
 * می‌پوشاند، نه با `useMutation`.
 */
export function createParty(
  input: CreatePartyInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Party> {
  return apiPost('/parties', input, partySchema, idempotencyKey, signal);
}
