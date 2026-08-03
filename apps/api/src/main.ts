import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { APP_CONFIG } from './platform/config/config.module';
import { EnvValidationError, loadEnv } from './platform/config/load-env';
import type { AppConfig } from './platform/config/env.schema';

/** مثل سرور توسعه‌ی فرانت، روی همه‌ی رابط‌ها گوش می‌دهد تا از گوشی هم در دسترس باشد. */
const HOST = '0.0.0.0';

async function bootstrap(): Promise<void> {
  /*
   * محیط عمداً **پیش از** بالا آمدن Nest بررسی می‌شود.
   *
   * `ConfigModule` خودش هم همین کار را می‌کند و برای تست‌ها کافی است، ولی اگر
   * خطا آنجا رخ بدهد Nest اول یک stack trace چنددهه‌خطی چاپ می‌کند و بقیه‌ی
   * ماژول‌ها را هم لاگ می‌زند؛ آدمی که سرور را بالا می‌آورد باید در خط اول
   * بفهمد کدام متغیر غایب است، نه اینکه دنبالش در ترمینال بگردد.
   *
   * هزینه‌اش یک بار تجزیه‌ی اضافی است و در عوض `AppModule` خودبسنده می‌ماند.
   */
  loadEnv(process.env);

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    // بدون این، Nest خطای مقداردهی اولیه را با `process.abort()` تمام می‌کند
    // و اجرا هرگز به catch پایین نمی‌رسد.
    abortOnError: false,
  });

  const config = app.get<AppConfig>(APP_CONFIG);

  await app.listen(config.port, HOST);
}

bootstrap().catch((error: unknown) => {
  // خطای محیط برای انسان نوشته شده و stack به آن چیزی اضافه نمی‌کند.
  console.error(error instanceof EnvValidationError ? error.message : error);
  process.exit(1);
});
