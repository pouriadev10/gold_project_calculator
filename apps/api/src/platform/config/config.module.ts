import { Global, Module } from '@nestjs/common';
import { loadEnv } from './load-env';
import type { AppConfig } from './env.schema';

/** توکن تزریق تنظیمات. با `@Inject(APP_CONFIG) config: AppConfig` استفاده می‌شود. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * تنظیمات معتبرشده را در سراسر برنامه فراهم می‌کند — BE-004.
 *
 * `@Global` است چون تقریباً هر ماژول زیرساختی به آن نیاز پیدا می‌کند
 * (BE-006 به `databaseUrl`، BE-011 به کلیدهای توکن) و import کردن دستی‌اش
 * در هر ماژول فقط نویز است.
 *
 * اعتبارسنجی داخل factory انجام می‌شود، یعنی هنگام مقداردهی اولیه‌ی Nest.
 * پس `import` کردن `AppModule` به‌تنهایی محیط معتبر نمی‌خواهد، ولی
 * **بالا آمدن** برنامه می‌خواهد.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadEnv(process.env),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
