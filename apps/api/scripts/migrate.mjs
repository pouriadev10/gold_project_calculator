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
 * پیاده‌سازی واقعی (Drizzle) در BE-006 اینجا می‌نشیند.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));

if (!existsSync(MIGRATIONS_DIR)) {
  console.error(
    'هنوز هیچ مهاجرتی وجود ندارد.\n' +
      'راه‌اندازی Drizzle و ساخت اولین مهاجرت کار BE-006 است؛ تا آن زمان\n' +
      'این دستور عمداً کاری نمی‌کند تا کسی فکر نکند دیتابیس آماده است.',
  );
  process.exit(1);
}

console.error('اجرای مهاجرت هنوز پیاده نشده است — BE-006.');
process.exit(1);
