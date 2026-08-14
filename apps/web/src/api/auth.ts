import { z } from 'zod';
import { apiPostRaw } from './client';
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
  return apiPostRaw('/auth/login', input, sessionResponseSchema, idempotencyKey, signal);
}

/**
 * تمدید نشست — `POST /auth/refresh`.
 *
 * از `apiPostRaw` استفاده می‌کند، نه `apiPost` عمومی: مسیر خودکار
 * «رفرش-و-تلاش‌مجدد» در `client.ts` روی *بقیه‌ی* درخواست‌ها اعمال می‌شود؛
 * اگر خودِ فراخوانی تمدید هم از همان مسیر عبور کند، یک ۴۰۱ روی تمدید
 * باعث تلاش برای تمدید *همان* تمدید می‌شود — حلقه‌ی بی‌پایان.
 */
export function refresh(refreshToken: string, signal?: AbortSignal): Promise<SessionResponse> {
  return apiPostRaw('/auth/refresh', { refreshToken }, sessionResponseSchema, undefined, signal);
}

/**
 * خروج — `POST /auth/logout`. بک‌اند ۲۰۴ بدون بدنه می‌دهد (حتی برای توکن
 * ناموجود — auth.service.ts)، پس `z.undefined()` فقط برای نوع خروجی
 * `void` است؛ مسیر ۲۰۴ در `client.ts` اصلاً به‌سراغ پارس‌کردن نمی‌رود.
 */
export async function logout(refreshToken: string, signal?: AbortSignal): Promise<void> {
  await apiPostRaw('/auth/logout', { refreshToken }, z.undefined(), undefined, signal);
}
