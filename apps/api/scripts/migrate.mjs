/**
 * اجرای مهاجرت‌های دیتابیس — دستور توسعه.
 *
 * این اسکریپت **هرگز خودکار اجرا نمی‌شود**. سرویس `migrate` در
 * docker-compose.yml زیر profile «tools» است، پس `docker compose up`
 * به آن دست نمی‌زند. دلیلش قاعده‌ی ۲-۷ فایل CLAUDE.md است: دفتر کل
 * Append-Only است و یک مهاجرت مخرب که موقع بالا آمدن سرویس خودش اجرا
 * شود، می‌تواند تاریخچه‌ی مالی را بی‌صدا از بین ببرد. اجرای مهاجرت
 * باید تصمیم صریح یک آدم باشد.
 *
 *   pnpm --filter api db:migrate
 *   docker compose --profile tools run --rm migrate
 *
 * از `drizzle-orm/node-postgres/migrator` استفاده می‌شود، نه CLI
 * `drizzle-kit migrate` — همان درایور و همان تنظیم `casing` که runtime
 * برنامه استفاده می‌کند اینجا هم به کار می‌رود، پس مسیر تولید و اعمال
 * SQL هرگز از هم واگرا نمی‌شود.
 */
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL تنظیم نشده — مهاجرت بدون اتصال دیتابیس ممکن نیست.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });

try {
  await pool.query('SELECT 1');
} catch (error) {
  console.error(`اتصال به دیتابیس برقرار نشد: ${error instanceof Error ? error.message : error}`);
  await pool.end().catch(() => undefined);
  process.exit(1);
}

const db = drizzle(pool, { casing: 'snake_case' });

console.log(`اجرای مهاجرت‌ها از ${MIGRATIONS_FOLDER} ...`);

try {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log('✔ مهاجرت‌ها با موفقیت اعمال شدند.');
} catch (error) {
  console.error('✘ اجرای مهاجرت شکست خورد:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
