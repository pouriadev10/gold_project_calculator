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
import { NestPinoLogger } from './platform/logging/nest-logger';

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
    // log راه‌اندازی تا نصب logger ساختاریافته نگه داشته می‌شود تا همه‌ی خروجی JSON باشد — BE-067.
    bufferLogs: true,
  });
  app.useLogger(app.get(NestPinoLogger));
  /*
   * M-39: در کانتینر، node فرایند شماره‌ی ۱ است و بدون handler سیگنال SIGTERM را نادیده می‌گیرد؛
   * `docker stop` ده ثانیه صبر می‌کرد و بعد SIGKILL، وسط هر درخواست در راه. با این، Nest
   * پذیرش درخواست تازه را می‌بندد، درخواست‌های در راه را تمام می‌کند و استخر دیتابیس را می‌بندد
   * (`PoolLifecycle`). درستی مالی به آن وابسته نیست — تراکنش نیمه‌کاره rollback می‌شود و تلاش
   * نامعلوم با همان Idempotency-Key تکرار می‌شود — ولی پاسخ ثبت‌های کامل‌شده دیگر گم نمی‌شود.
   */
  app.enableShutdownHooks();

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
