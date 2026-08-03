import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import type { Pool } from 'pg';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { buildDatabase, createPool } from './connect';
import type { Database } from './connect';

/** توکن تزریق pool خام — فقط برای بستنش موقع خاموشی لازم است. */
export const PG_POOL = Symbol('PG_POOL');

/** توکن تزریق نمونه‌ی drizzle. با `@Inject(DRIZZLE) db: Database` استفاده می‌شود. */
export const DRIZZLE = Symbol('DRIZZLE');

/**
 * فقط برای بستن pool موقع خاموش‌شدن ماژول — یک provider واقعی Nest،
 * نه یک متغیر سراسری. هر context تست/برنامه (هر `TestingModule.compile()`
 * یا هر `NestFactory.create()`) نمونه‌ی مستقل خودش از این کلاس را می‌سازد،
 * پس بستن pool یک instance هرگز pool یک instance دیگر را نمی‌بندد —
 * برخلاف نگه‌داشتن pool در یک `Set` سطح فایل که بین چند AppModule هم‌زمان
 * در یک پردازش (مثل چند فایل تست e2e) به اشتباه مشترک می‌شد.
 */
@Injectable()
class PoolLifecycle implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * اتصال PostgreSQL و Drizzle — BE-006.
 *
 * `@Global` است چون تقریباً هر ماژول دامنه‌ای (BE-007 به بعد) به `DRIZZLE`
 * نیاز دارد و import دستی‌اش در هر ماژول فقط نویز است — دقیقاً همان
 * استدلالی که `ConfigModule` دارد.
 *
 * اتصال **در لحظه‌ی ساخت provider** آزموده می‌شود، یعنی پیش از اینکه هر
 * ماژول دیگری بتواند `DRIZZLE` را تزریق کند — Nest وابستگی‌های async
 * factory را پیش از سازنده‌ی مصرف‌کننده resolve می‌کند. پس یک
 * `DATABASE_URL` خراب همین‌جا، حین بالا آمدن برنامه، با پیام روشن
 * متوقف می‌شود؛ نه روی اولین کوئری واقعی وسط یک تراکنش مالی.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Promise<Pool> => createPool(config.databaseUrl.reveal()),
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => buildDatabase(pool),
    },
    PoolLifecycle,
  ],
  exports: [DRIZZLE, PG_POOL],
})
export class DatabaseModule {}
