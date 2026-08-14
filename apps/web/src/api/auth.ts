import { apiPost } from './client';
import { sessionResponseSchema, type LoginInput, type SessionResponse } from './contracts';

/**
 * ورود — `POST /auth/login`.
 *
 * تابع مجزا از `queries.ts` است چون آن فایل فقط `useQuery` (خواندن، قابل
 * کش‌شدن) نگه می‌دارد؛ ورود یک نوشتن یک‌بارمصرف است که `LoginPage` مستقیماً
 * با `useIdempotentSubmit` می‌پوشاند، نه با `useMutation`.
 */
export function login(
  input: LoginInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<SessionResponse> {
  return apiPost('/auth/login', input, sessionResponseSchema, idempotencyKey, signal);
}
