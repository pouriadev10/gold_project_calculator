import { apiPost } from './client';
import {
  coinTypeVersionSchema,
  type CoinTypeVersion,
  type CreateCoinTypeInput,
  type CreateCoinTypeVersionInput,
} from './contracts';

/**
 * نوع سکه‌ی تازه با نسخه‌ی ۱ از «اکنون» — `POST /inventory/coin-types` (FE-081).
 * فقط OWNER و MANAGER؛ کلید idempotency پایدار را فراخوان (`useIdempotentSubmit`) می‌دهد.
 */
export function createCoinType(
  input: CreateCoinTypeInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<CoinTypeVersion> {
  return apiPost('/inventory/coin-types', input, coinTypeVersionSchema, idempotencyKey, signal);
}

/**
 * نسخه‌ی بعدی یک نوع سکه از «اکنون» — `POST /inventory/coin-types/:id/versions`
 * (FE-081). نسخه‌ی قبلی در سرور بسته می‌شود و هرگز overwrite نمی‌شود.
 */
export function createCoinTypeVersion(
  coinTypeId: string,
  input: CreateCoinTypeVersionInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<CoinTypeVersion> {
  return apiPost(
    `/inventory/coin-types/${coinTypeId}/versions`,
    input,
    coinTypeVersionSchema,
    idempotencyKey,
    signal,
  );
}
