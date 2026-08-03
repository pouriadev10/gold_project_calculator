import type { ZodError } from 'zod';
import { envSchema, toAppConfig } from './env.schema';
import type { AppConfig } from './env.schema';

/**
 * خطای اعتبارسنجی محیط.
 *
 * پیام این خطا مستقیم جلوی چشم کسی می‌رود که سرور را بالا می‌آورد، پس باید
 * دقیقاً بگوید کدام متغیر و چرا. `names` برای تست است، تا بشود بدون تکیه بر
 * متن پیام مطمئن شد کدام متغیرها گیر داده‌اند.
 */
export class EnvValidationError extends Error {
  readonly names: readonly string[];

  constructor(names: readonly string[], details: string) {
    super(`متغیرهای محیطی نامعتبرند:\n${details}`);
    this.name = 'EnvValidationError';
    this.names = names;
  }
}

/**
 * پیام Zod را به فهرست «نام متغیر: علت» تبدیل می‌کند.
 *
 * عمداً مقدار دریافتی را چاپ نمی‌کند — همین‌جاست که یک کلید امضای اشتباه
 * می‌تواند به لاگ نشت کند.
 */
function formatIssues(error: ZodError): { names: string[]; details: string } {
  const names = error.issues.map((issue) => issue.path.join('.'));
  const details = error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  return { names, details };
}

/**
 * محیط را می‌خواند و اعتبارسنجی می‌کند. ورودی صریح است، نه `process.env`
 * سراسری، تا تست بتواند بدون دست‌کاری محیط فرایند اجرا شود.
 */
export function loadEnv(source: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const { names, details } = formatIssues(result.error);
    throw new EnvValidationError(names, details);
  }

  return toAppConfig(result.data);
}
