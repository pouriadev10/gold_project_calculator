import { z } from 'zod';
import { Secret } from '../../shared/types/secret';

/**
 * قرارداد متغیرهای محیطی — BE-004.
 *
 * هر متغیری که **پیش‌فرض ندارد اجباری است**؛ نبودش برنامه را در لحظه‌ی
 * راه‌اندازی متوقف می‌کند، نه وقتی اولین درخواست به دیتابیس رسید. یک API که
 * بالا می‌آید و بعد روی هر تراکنش خطا می‌دهد، بدتر از APIای است که اصلاً
 * بالا نمی‌آید.
 */

/** حداقل طول کلید امضا. پارامتر امنیتی است، نه عدد صنفی — قاعده‌ی ۲-۶ شامل آن نمی‌شود. */
const MIN_SECRET_LENGTH = 32;

const MAX_PORT = 65535;

/** سطوح لاگ pino — BE-067 همین‌ها را مصرف می‌کند. */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

export const NODE_ENVS = ['development', 'test', 'production'] as const;

/**
 * `Secret` فقط جایی به کار می‌رود که مقدار واقعاً حساس است.
 * `DATABASE_URL` هم حساس است چون رمز دیتابیس داخل خودِ URL است.
 */
const secretString = (minLength: number, message: string) =>
  z
    .string({ required_error: 'الزامی است' })
    .min(minLength, message)
    .transform((value) => new Secret(value));

/**
 * مقدارهای نمونه‌ای که در مخزن منتشر شده‌اند (`docker-compose.yml`). هرکس مخزن را
 * دیده آن‌ها را می‌داند؛ توکنی که با آن‌ها امضا شود قابل جعل است — با هر نقشی و
 * برای هر مستأجری. در production پذیرفته نمی‌شوند (M-05).
 */
const PUBLISHED_PLACEHOLDER_SECRET = /dev-only|change-in-production/iu;

const SIGNING_SECRET_KEYS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

const envObjectSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),

  PORT: z.coerce.number().int().min(1).max(MAX_PORT).default(3000),

  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

  DATABASE_URL: z
    .string({ required_error: 'الزامی است' })
    .min(1, 'الزامی است')
    .refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'باید با postgresql:// یا postgres:// شروع شود',
    )
    .transform((value) => new Secret(value)),

  JWT_ACCESS_SECRET: secretString(
    MIN_SECRET_LENGTH,
    `باید حداقل ${MIN_SECRET_LENGTH} کاراکتر باشد — با «openssl rand -base64 48» تولید کن`,
  ),

  JWT_REFRESH_SECRET: secretString(
    MIN_SECRET_LENGTH,
    `باید حداقل ${MIN_SECRET_LENGTH} کاراکتر باشد — با «openssl rand -base64 48» تولید کن`,
  ),
});

export const envSchema = envObjectSchema.superRefine((env, context) => {
  if (env.NODE_ENV !== 'production') return;
  for (const key of SIGNING_SECRET_KEYS) {
    // superRefine روی ورودی «dirty» هم اجرا می‌شود؛ اگر کلید کوتاه بود، transform به
    // Secret انجام نشده و مقدار هنوز رشته است.
    const value: unknown = env[key];
    const raw = value instanceof Secret ? value.reveal() : String(value);
    if (PUBLISHED_PLACEHOLDER_SECRET.test(raw)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'مقدار نمونه‌ی منتشرشده در مخزن است و در production پذیرفته نیست — با «openssl rand -base64 48» کلید تازه بساز',
      });
    }
  }
});

type ParsedEnv = z.infer<typeof envSchema>;

export type NodeEnv = ParsedEnv['NODE_ENV'];
export type LogLevel = ParsedEnv['LOG_LEVEL'];

/** تنظیمات اپلیکیشن — نامِ camelCase، جدا از نام SCREAMING_SNAKE متغیر محیطی. */
export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly databaseUrl: Secret;
  readonly jwtAccessSecret: Secret;
  readonly jwtRefreshSecret: Secret;
}

export function toAppConfig(env: ParsedEnv): AppConfig {
  return Object.freeze({
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    jwtAccessSecret: env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: env.JWT_REFRESH_SECRET,
  });
}
