import 'reflect-metadata';
import { eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import { migrationProbes } from '../src/platform/database/schema';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

/**
 * اتصال دیتابیس واقعی — BE-006.
 *
 * برخلاف بقیه‌ی تست‌های e2e این پکیج، این فایل به PostgreSQLِ **در حال
 * اجرا** روی `DATABASE_URL` نیاز دارد (پیش‌فرض در `test/setup-env.ts`:
 * `postgresql://gold:gold@localhost:5432/gold_test`) و همچنین مهاجرت
 * اولیه از پیش روی آن اعمال شده باشد:
 *
 *   docker compose up -d db
 *   docker exec gold-db-1 createdb -U gold gold_test   # یک‌بار
 *   DATABASE_URL=postgresql://gold:gold@localhost:5432/gold_test pnpm --filter api db:migrate
 *
 * از این پس، `DatabaseModule` روی همه‌ی ماژول‌ها سراسری است، پس واقعیت
 * این است که هر e2e testِ دیگر این پکیج هم دیگر بدون این دیتابیس بالا
 * نمی‌آید — نه فقط این فایل.
 */
describe('اتصال دیتابیس (نیازمند PostgreSQL واقعی)', () => {
  let app: INestApplicationContext;
  let db: Database;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
  });

  afterAll(async () => {
    await app.close();
  });

  it('یک ردیف واقعی درج و همان را می‌خواند', async () => {
    const [inserted] = await db.insert(migrationProbes).values({}).returning();

    expect(inserted).toBeDefined();

    const [found] = await db
      .select()
      .from(migrationProbes)
      .where(eq(migrationProbes.id, inserted!.id));

    expect(found?.id).toBe(inserted!.id);
    expect(found?.createdAt).toBeInstanceOf(Date);
  });

  it('ستون‌ها در PostgreSQL واقعاً snake_case هستند', async () => {
    const rows = await db.execute<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'migration_probes'`,
    );

    const columnNames = rows.rows.map((row) => row.column_name);

    expect(columnNames).toContain('created_at');
    expect(columnNames).not.toContain('createdAt');
  });
});
