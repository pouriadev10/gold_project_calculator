import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

/**
 * fallback فقط برای توسعه. اعتبارسنجی کامل متغیرهای محیطی
 * (zod + fail-fast در بوت) موضوع تسک جداگانه‌ای است.
 */
const DEFAULT_PORT = '3000';

/** مثل سرور توسعه‌ی فرانت، روی همه‌ی رابط‌ها گوش می‌دهد تا از گوشی هم در دسترس باشد. */
const HOST = '0.0.0.0';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  await app.listen(process.env.PORT ?? DEFAULT_PORT, HOST);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
