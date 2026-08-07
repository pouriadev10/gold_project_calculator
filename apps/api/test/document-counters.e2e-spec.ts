import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import {
  DocumentCountersService,
  jalaliYearPeriodKey,
} from '../src/modules/sales/document-counters.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { documentCounters, tenants } from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import type { INestApplicationContext } from '@nestjs/common';
import type { Database } from '../src/platform/database/connect';

/** شماره‌ی بدون شکاف سند — BE-038. Runs against a real PostgreSQL database. */
describe('شمارنده‌ی بدون شکاف سند (BE-038)', () => {
  let app: INestApplicationContext;
  let db: Database;
  let counters: DocumentCountersService;
  let tenantService: TenantService;
  const tenantIds: string[] = [];

  async function createTenant(label = 'counters') {
    const tenant = await tenantService.create({
      name: label,
      slug: `document-counters-${randomUUID().slice(0, 12)}`,
    });
    tenantIds.push(tenant.id);
    return tenant;
  }

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = app.get<Database>(DRIZZLE);
    counters = app.get(DocumentCountersService);
    tenantService = app.get(TenantService);
  });

  afterAll(async () => {
    for (const tenantId of tenantIds) {
      await db.delete(documentCounters).where(eq(documentCounters.tenantId, tenantId));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await app.close();
  });

  it('شماره‌ها پشت سر هم و از یک شروع می‌شوند', async () => {
    const tenant = await createTenant();
    const periodKey = '1405';

    const first = await counters.getNextNumber({
      tenantId: tenant.id,
      documentType: 'SALES_INVOICE',
      periodKey,
    });
    const second = await counters.getNextNumber({
      tenantId: tenant.id,
      documentType: 'SALES_INVOICE',
      periodKey,
    });
    const third = await counters.getNextNumber({
      tenantId: tenant.id,
      documentType: 'SALES_INVOICE',
      periodKey,
    });

    expect([first, second, third]).toEqual([1, 2, 3]);
  });

  it('rollback تراکنشِ فراخوان، شماره را مصرف‌نشده نگه می‌دارد', async () => {
    const tenant = await createTenant();
    const periodKey = '1405';

    await expect(
      withTenantTransaction(db, tenant.id, async (transaction) => {
        const number = await counters.getNextNumberInTransaction(transaction, {
          tenantId: tenant.id,
          documentType: 'SALES_INVOICE',
          periodKey,
        });
        expect(number).toBe(1);
        throw new Error('ثبت فاکتور بعد از گرفتن شماره شکست خورد');
      }),
    ).rejects.toThrow('ثبت فاکتور بعد از گرفتن شماره شکست خورد');

    // چون شماره‌ی ۱ مصرف نشد، تلاش موفق بعدی همان ۱ را می‌گیرد، نه ۲.
    const nextSuccessful = await counters.getNextNumber({
      tenantId: tenant.id,
      documentType: 'SALES_INVOICE',
      periodKey,
    });
    expect(nextSuccessful).toBe(1);
  });

  it('درخواست‌های هم‌زمان شماره‌ی تکراری نمی‌گیرند و شکاف نمی‌سازند', async () => {
    const tenant = await createTenant();
    const periodKey = '1405';
    const concurrency = 20;

    const results = await Promise.all(
      Array.from({ length: concurrency }, () =>
        counters.getNextNumber({
          tenantId: tenant.id,
          documentType: 'SALES_INVOICE',
          periodKey,
        }),
      ),
    );

    expect(new Set(results).size).toBe(concurrency);
    expect([...results].sort((a, b) => a - b)).toEqual(
      Array.from({ length: concurrency }, (_, index) => index + 1),
    );
  });

  it('شماره‌گذاری هر مستأجر مستقل است', async () => {
    const tenantA = await createTenant('counters A');
    const tenantB = await createTenant('counters B');
    const periodKey = '1405';

    await counters.getNextNumber({ tenantId: tenantA.id, documentType: 'SALES_INVOICE', periodKey });
    await counters.getNextNumber({ tenantId: tenantA.id, documentType: 'SALES_INVOICE', periodKey });
    const firstForB = await counters.getNextNumber({
      tenantId: tenantB.id,
      documentType: 'SALES_INVOICE',
      periodKey,
    });

    expect(firstForB).toBe(1);
  });

  it('هر period_key شمارنده‌ی مستقل خودش را دارد', async () => {
    const tenant = await createTenant();

    await counters.getNextNumber({ tenantId: tenant.id, documentType: 'SALES_INVOICE', periodKey: '1404' });
    await counters.getNextNumber({ tenantId: tenant.id, documentType: 'SALES_INVOICE', periodKey: '1404' });
    const firstOf1405 = await counters.getNextNumber({
      tenantId: tenant.id,
      documentType: 'SALES_INVOICE',
      periodKey: '1405',
    });

    expect(firstOf1405).toBe(1);
  });

  it('ردیف شمارنده در دیتابیس دقیقاً منعکس‌کننده‌ی آخرین شماره‌ی مصرف‌شده است', async () => {
    const tenant = await createTenant();
    const periodKey = '1405';

    await counters.getNextNumber({ tenantId: tenant.id, documentType: 'SALES_INVOICE', periodKey });
    await counters.getNextNumber({ tenantId: tenant.id, documentType: 'SALES_INVOICE', periodKey });

    const [row] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select({ currentValue: documentCounters.currentValue })
        .from(documentCounters)
        .where(
          and(
            eq(documentCounters.tenantId, tenant.id),
            eq(documentCounters.documentType, 'SALES_INVOICE'),
            eq(documentCounters.periodKey, periodKey),
          ),
        ),
    );

    expect(row?.currentValue).toBe(2);
  });

  describe('jalaliYearPeriodKey — استراتژی دوره‌ای فاز ۱', () => {
    it('تاریخ‌های یک سال جلالی همان period_key را می‌گیرند', () => {
      expect(jalaliYearPeriodKey(new Date('2026-08-07T00:00:00.000Z'))).toBe('1405');
      expect(jalaliYearPeriodKey(new Date('2026-03-21T12:00:00.000Z'))).toBe('1405');
    });

    it('نوروز مرز دو دوره را دقیقاً جدا می‌کند', () => {
      // یک روز پیش از نوروز ۱۴۰۵ هنوز ۱۴۰۴ است؛ خودِ نوروز ۱۴۰۵ می‌شود.
      expect(jalaliYearPeriodKey(new Date('2026-03-20T12:00:00.000Z'))).toBe('1404');
      expect(jalaliYearPeriodKey(new Date('2026-03-21T12:00:00.000Z'))).toBe('1405');
    });

    it('رقم‌ها همیشه لاتین‌اند، نه فارسی', () => {
      const key = jalaliYearPeriodKey(new Date('2026-08-07T00:00:00.000Z'));
      expect(key).toMatch(/^[0-9]+$/u);
    });
  });
});
