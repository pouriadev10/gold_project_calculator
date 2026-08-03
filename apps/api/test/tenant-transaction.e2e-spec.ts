import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import { rlsProbes, tenants } from '../src/platform/database/schema';
import {
  APP_DATABASE_ROLE,
  withTenantTransaction,
} from '../src/platform/database/tenant-transaction';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

/**
 * همان جداسازی BE-009، این بار از مسیر واقعی برنامه (drizzle + Nest).
 *
 * تست `rls.e2e-spec.ts` ثابت می‌کند PostgreSQL سیاست را اعمال می‌کند؛
 * این یکی ثابت می‌کند `withTenantTransaction` واقعاً همان سیاست را
 * فعال می‌کند و کد دامنه‌ای که از آن عبور کند در امان است.
 */
describe('withTenantTransaction (نیازمند PostgreSQL واقعی)', () => {
  let app: INestApplicationContext;
  let db: Database;

  const tenantA = { id: '', slug: `tx-a-${randomUUID().slice(0, 8)}` };
  const tenantB = { id: '', slug: `tx-b-${randomUUID().slice(0, 8)}` };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);

    for (const tenant of [tenantA, tenantB]) {
      const [created] = await db
        .insert(tenants)
        .values({ name: `مستأجر ${tenant.slug}`, slug: tenant.slug })
        .returning();
      tenant.id = created!.id;
    }

    // داده‌ی هر مستأجر، خارج از تراکنش محدود درج می‌شود.
    await db.insert(rlsProbes).values([
      { tenantId: tenantA.id, note: 'الف' },
      { tenantId: tenantB.id, note: 'ب' },
    ]);
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantA.id));
    await db.delete(tenants).where(eq(tenants.id, tenantB.id));
    await app.close();
  });

  it('داخل تراکنش، نقش محدود فعال است', async () => {
    const role = await withTenantTransaction(db, tenantA.id, async (tx) => {
      const result = await tx.execute<{ current_user: string }>(sql`SELECT current_user`);
      return result.rows[0]?.current_user;
    });

    expect(role).toBe(APP_DATABASE_ROLE);
  });

  it('کوئری بدون شرط، فقط داده‌ی مستأجر جاری را برمی‌گرداند', async () => {
    const notes = await withTenantTransaction(db, tenantA.id, async (tx) => {
      const rows = await tx.select().from(rlsProbes);
      return rows.map((row) => row.note);
    });

    expect(notes).toEqual(['الف']);
  });

  it('مستأجر دیگر داده‌ی دیگری می‌بیند — همان کد، همان کوئری', async () => {
    const notes = await withTenantTransaction(db, tenantB.id, async (tx) => {
      const rows = await tx.select().from(rlsProbes);
      return rows.map((row) => row.note);
    });

    expect(notes).toEqual(['ب']);
  });

  it('پس از پایان تراکنش، نقش و مستأجر برمی‌گردند', async () => {
    await withTenantTransaction(db, tenantA.id, async (tx) => {
      await tx.select().from(rlsProbes);
    });

    // خارج از helper، اتصال دوباره کاربر اصلی است و هر دو ردیف را می‌بیند.
    const rows = await db.select().from(rlsProbes);

    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('rollback تراکنش، تنظیمات را هم برمی‌گرداند', async () => {
    await expect(
      withTenantTransaction(db, tenantA.id, async () => {
        throw new Error('شکست عمدی');
      }),
    ).rejects.toThrow('شکست عمدی');

    const role = await withTenantTransaction(db, tenantB.id, async (tx) => {
      const result = await tx.execute<{ current_user: string }>(sql`SELECT current_user`);
      return result.rows[0]?.current_user;
    });

    expect(role).toBe(APP_DATABASE_ROLE);
  });
});
