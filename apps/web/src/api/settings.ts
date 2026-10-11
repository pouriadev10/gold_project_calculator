import { apiPost } from './client';
import { generalSettingSchema, type GeneralSetting, type UpdateGeneralSettingInput } from './contracts';

/**
 * ساخت نسخه‌ی تازه‌ی یک تنظیم عمومی — `POST /settings/general` (FE-080).
 * فقط OWNER و MANAGER؛ کلید idempotency پایدار را فراخوان (`useIdempotentSubmit`)
 * می‌دهد تا تلاش دوباره نسخه‌ی تکراری نسازد.
 */
export function updateGeneralSetting(
  input: UpdateGeneralSettingInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<GeneralSetting> {
  return apiPost('/settings/general', input, generalSettingSchema, idempotencyKey, signal);
}
