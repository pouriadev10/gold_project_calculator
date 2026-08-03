import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DatabaseConnectionError } from './database-connection.error';
import * as schema from './schema';

/**
 * مهلت اتصال. یک مرز ایمنی است، نه عدد صنفی: بدون سقف، `Pool` روی
 * دیتابیس غیرقابل‌دسترس تا مهلت پیش‌فرض TCP سیستم‌عامل (که می‌تواند
 * دقیقه‌ها باشد) بی‌صدا می‌ماند. «اتصال قطع‌شده باعث خطای واضح startup
 * شود» یعنی این خطا در چند ثانیه ظاهر شود، نه بعد از یک انتظار طولانی.
 */
const CONNECTION_TIMEOUT_MS = 5000;

export type Database = NodePgDatabase<typeof schema>;

/**
 * اتصال به PostgreSQL و آزمودن آن با یک `SELECT 1`.
 *
 * خرابی همین‌جا، در لحظه‌ی ساخت pool، ظاهر می‌شود — نه روی اولین کوئری
 * واقعی وسط یک تراکنش مالی. خطا `DatabaseConnectionError` است: پیام‌محور
 * و بدون درز جزئیات داخلی.
 *
 * جدا از `buildDatabase` است تا هر کدام مستقل تست شوند: این تابع را با
 * یک URL خراب صدا می‌زنیم و فقط رفتار خطا را می‌سنجیم، بدون نیاز به
 * ساختن instance واقعی drizzle.
 */
export async function createPool(databaseUrl: string): Promise<Pool> {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });

  try {
    await pool.query('SELECT 1');
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw new DatabaseConnectionError(error);
  }

  return pool;
}

/** pool آزموده‌شده را به instance درزل تبدیل می‌کند. */
export function buildDatabase(pool: Pool): Database {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

/** برای probeهای سلامت (BE-067) — کوئری سبک که فقط اتصال زنده بودن را می‌سنجد. */
export async function pingDatabase(db: Database): Promise<void> {
  await db.execute(sql`SELECT 1`);
}
