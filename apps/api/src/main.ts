import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { APP_CONFIG } from './platform/config/config.module';
import { EnvValidationError, loadEnv } from './platform/config/load-env';
import type { AppConfig } from './platform/config/env.schema';
import { DatabaseConnectionError } from './platform/database/database-connection.error';
import { createPool } from './platform/database/connect';

/** مثل سرور توسعه‌ی فرانت، روی همه‌ی رابط‌ها گوش می‌دهد تا از گوشی هم در دسترس باشد. */
const HOST = '0.0.0.0';

async function bootstrap(): Promise<void> {
  /*
   * محیط و اتصال دیتابیس عمداً **پیش از** بالا آمدن Nest بررسی می‌شوند.
   *
   * `ConfigModule` و `DatabaseModule` خودشان هم همین کار را می‌کنند و برای
   * تست‌ها کافی است، ولی اگر خطا آنجا رخ بدهد Nest اول یک stack trace
   * چنددهه‌خطی چاپ می‌کند و بقیه‌ی ماژول‌ها را هم لاگ می‌زند؛ آدمی که سرور
   * را بالا می‌آورد باید در خط اول بفهمد env نامعتبر است یا دیتابیس در
   * دسترس نیست، نه اینکه دنبالش در ترمینال بگردد.
   *
   * هزینه‌اش یک بار تجزیه‌ی env و یک اتصال آزمایشی اضافه به دیتابیس است —
   * که بلافاصله بسته می‌شود و `DatabaseModule` یک اتصال واقعی خودش برای
   * DI می‌سازد. در عوض `AppModule` خودبسنده می‌ماند و مسیر تست هم دقیقاً
   * همین رفتار را از داخل Nest التست می‌کند.
   */
  const config = loadEnv(process.env);

  const probePool = await createPool(config.databaseUrl.reveal());
  await probePool.end();

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    // بدون این، Nest خطای مقداردهی اولیه را با `process.abort()` تمام می‌کند
    // و اجرا هرگز به catch پایین نمی‌رسد.
    abortOnError: false,
  });

  const appConfig = app.get<AppConfig>(APP_CONFIG);

  await app.listen(appConfig.port, HOST);
}

bootstrap().catch((error: unknown) => {
  // این دو خطا برای انسان نوشته شده‌اند و stack به آن‌ها چیزی اضافه نمی‌کند.
  const isKnownStartupError =
    error instanceof EnvValidationError || error instanceof DatabaseConnectionError;
  console.error(isKnownStartupError ? error.message : error);
  process.exit(1);
});
