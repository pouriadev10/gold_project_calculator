import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { articlePureMg, grossMg, karat } from '@gold/core-calc';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import { getPostgresConstraintName, isCheckViolation } from '../src/platform/database/pg-errors';
import { jewelryItemVersions, jewelryItems, tenants } from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import {
  InvalidJewelryItemVersionDateError,
  InvalidJewelryKaratError,
  JewelryDeductionExceedsGrossError,
  JewelryItemCodeConflictError,
} from '../src/modules/inventory/jewelry-items.errors';
import { JewelryItemsService, pureWeightOf } from '../src/modules/inventory/jewelry-items.service';
import type { Database } from '../src/platform/database/connect';
import type { CreateJewelryItemInput } from '../src/modules/inventory/jewelry-items.service';
import type { INestApplicationContext } from '@nestjs/common';

/**
 * مدل کالای زیورآلات — BE-025. نیازمند PostgreSQL واقعی.
 */
describe('کالای زیورآلات (نیازمند PostgreSQL واقعی)', () => {
  let app: INestApplicationContext;
  let db: Database;
  let service: JewelryItemsService;

  const tenantA = { id: '', slug: `jw-a-${randomUUID().slice(0, 8)}` };
  const tenantB = { id: '', slug: `jw-b-${randomUUID().slice(0, 8)}` };

  const uniqueCode = (): string => `RING-${randomUUID().slice(0, 8)}`;

  /** انگشتر نمونه: ۱۲ گرم ناخالص، ۲ گرم نگین، عیار ۷۵۰. */
  function sampleItem(overrides: Partial<CreateJewelryItemInput> = {}): CreateJewelryItemInput {
    return {
      tenantId: tenantA.id,
      code: uniqueCode(),
      title: 'انگشتر نگین‌دار',
      grossWeightMg: 12_000n,
      karat: 750,
      stoneWeightMg: 2_000n,
      otherDeductionWeightMg: 0n,
      wageType: 'PER_GRAM',
      wageValue: 350_000n,
      validFrom: new Date('2026-01-01T00:00:00Z'),
      active: true,
      ...overrides,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    service = app.get(JewelryItemsService);

    for (const tenant of [tenantA, tenantB]) {
      const [created] = await db
        .insert(tenants)
        .values({ name: `مستأجر ${tenant.slug}`, slug: tenant.slug })
        .returning();
      tenant.id = created!.id;
    }
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantA.id));
    await db.delete(tenants).where(eq(tenants.id, tenantB.id));
    await app.close();
  });

  describe('ایجاد و نسخه‌داری', () => {
    it('کالا ساخته می‌شود و نسخه‌ی ۱ می‌گیرد', async () => {
      const version = await service.createItem(sampleItem());

      expect(version.version).toBe(1);
      expect(version.grossWeightMg).toBe(12_000n);
      expect(version.karat).toBe(750);
      expect(version.validTo).toBeNull();
    });

    it('وزن‌ها bigint میلی‌گرم برمی‌گردند، نه number', async () => {
      const version = await service.createItem(sampleItem());

      expect(typeof version.grossWeightMg).toBe('bigint');
      expect(typeof version.stoneWeightMg).toBe('bigint');
      expect(typeof version.wageValue).toBe('bigint');
    });

    it('نسخه‌ی دوم، نسخه‌ی قبلی را می‌بندد و شماره‌اش یکی بالاتر است', async () => {
      const first = await service.createItem(sampleItem());

      const second = await service.createVersion({
        tenantId: tenantA.id,
        jewelryItemId: first.jewelryItemId,
        title: 'انگشتر نگین‌دار — اجرت جدید',
        grossWeightMg: 12_000n,
        karat: 750,
        stoneWeightMg: 2_000n,
        otherDeductionWeightMg: 0n,
        wageType: 'PER_GRAM',
        wageValue: 420_000n,
        validFrom: new Date('2026-03-01T00:00:00Z'),
        active: true,
      });

      expect(second.version).toBe(2);
      expect(second.wageValue).toBe(420_000n);

      const [closed] = await db
        .select()
        .from(jewelryItemVersions)
        .where(eq(jewelryItemVersions.id, first.id));

      expect(closed?.validTo?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    });

    it('اجرت نسخه‌دار است — فاکتور قدیمی همان اجرت روز خودش را می‌بیند', async () => {
      const first = await service.createItem(sampleItem({ wageValue: 350_000n }));

      await service.createVersion({
        tenantId: tenantA.id,
        jewelryItemId: first.jewelryItemId,
        title: 'اجرت جدید',
        grossWeightMg: 12_000n,
        karat: 750,
        stoneWeightMg: 2_000n,
        otherDeductionWeightMg: 0n,
        wageType: 'PER_GRAM',
        wageValue: 500_000n,
        validFrom: new Date('2026-03-01T00:00:00Z'),
        active: true,
      });

      const inJanuary = await service.getEffective(
        tenantA.id,
        first.jewelryItemId,
        new Date('2026-01-15T00:00:00Z'),
      );
      const inApril = await service.getEffective(
        tenantA.id,
        first.jewelryItemId,
        new Date('2026-04-15T00:00:00Z'),
      );

      expect(inJanuary?.wageValue).toBe(350_000n);
      expect(inApril?.wageValue).toBe(500_000n);
    });

    it('نسخه‌ی با تاریخ عقب‌تر رد می‌شود', async () => {
      const first = await service.createItem(sampleItem());

      await expect(
        service.createVersion({
          tenantId: tenantA.id,
          jewelryItemId: first.jewelryItemId,
          title: 'عقب‌تر',
          grossWeightMg: 12_000n,
          karat: 750,
          stoneWeightMg: 2_000n,
          otherDeductionWeightMg: 0n,
          wageType: 'PER_GRAM',
          wageValue: 1n,
          validFrom: new Date('2025-12-01T00:00:00Z'),
          active: true,
        }),
      ).rejects.toBeInstanceOf(InvalidJewelryItemVersionDateError);
    });

    it('کد تکراری در همان مستأجر رد می‌شود', async () => {
      const code = uniqueCode();
      await service.createItem(sampleItem({ code }));

      await expect(service.createItem(sampleItem({ code }))).rejects.toBeInstanceOf(
        JewelryItemCodeConflictError,
      );
    });

    it('همان کد در مستأجر دیگر آزاد است', async () => {
      const code = uniqueCode();
      await service.createItem(sampleItem({ code }));

      const other = await service.createItem(sampleItem({ code, tenantId: tenantB.id }));

      expect(other.version).toBe(1);
    });
  });

  describe('وزن خالص از core-calc می‌آید', () => {
    it('کسورات پیش از عیار اعمال می‌شوند', async () => {
      const version = await service.createItem(sampleItem());

      // ۱۲ گرم − ۲ گرم نگین = ۱۰ گرم، × ۰٫۷۵ = ۷٫۵ گرم
      expect(pureWeightOf(version)).toBe(7_500n);
    });

    it('نتیجه دقیقاً همان چیزی است که articlePureMg می‌دهد', async () => {
      const version = await service.createItem(
        sampleItem({ grossWeightMg: 8_133n, karat: 900, stoneWeightMg: 133n }),
      );

      const expected = articlePureMg(
        grossMg(version.grossWeightMg),
        { stone: grossMg(version.stoneWeightMg), other: grossMg(version.otherDeductionWeightMg) },
        karat(version.karat),
      );

      expect(pureWeightOf(version)).toBe(expected);
    });

    it('وزن خالص ستون دیتابیس نیست — تنها منبعش محاسبه است', async () => {
      const version = await service.createItem(sampleItem());

      expect(Object.keys(version)).not.toContain('pureWeightMg');
      expect(Object.keys(version)).not.toContain('netWeightMg');
    });
  });

  describe('اعتبارسنجی', () => {
    it('کسورات بیشتر از وزن ناخالص رد می‌شود', async () => {
      await expect(
        service.createItem(sampleItem({ grossWeightMg: 5_000n, stoneWeightMg: 6_000n })),
      ).rejects.toBeInstanceOf(JewelryDeductionExceedsGrossError);
    });

    it('مجموع کسورات هم بررسی می‌شود، نه هرکدام جدا', async () => {
      await expect(
        service.createItem(
          sampleItem({
            grossWeightMg: 5_000n,
            stoneWeightMg: 3_000n,
            otherDeductionWeightMg: 3_000n,
          }),
        ),
      ).rejects.toBeInstanceOf(JewelryDeductionExceedsGrossError);
    });

    it.each([0, 1001, -750])('عیار خارج از بازه رد می‌شود: %s', async (invalidKarat) => {
      await expect(service.createItem(sampleItem({ karat: invalidKarat }))).rejects.toBeInstanceOf(
        InvalidJewelryKaratError,
      );
    });

    it('عیار نامعتبر پیام مخصوص خودش را می‌گیرد، نه پیام کسورات', async () => {
      // نسخه‌ی اول این سرویس هر CalcError را به «کسورات زیاد» نگاشت
      // می‌کرد و کاربر دنبال مشکلی می‌گشت که وجود نداشت.
      await expect(service.createItem(sampleItem({ karat: 1500 }))).rejects.toThrow(/Karat/);
    });

    it('وزن ناخالص صفر رد می‌شود', async () => {
      await expect(service.createItem(sampleItem({ grossWeightMg: 0n }))).rejects.toThrow(
        /Gross weight/,
      );
    });

    /**
     * دور زدن سرویس و نوشتن مستقیم — محدودیت دیتابیس باید بترکاندش.
     *
     * نام محدودیت با `getPostgresConstraintName` خوانده می‌شود و نه با
     * تطبیق رشته روی پیام: drizzle خطای درایور را می‌پیچد و پیام بیرونی
     * فقط «Failed query» است. همان تله‌ای که در BE-007 روی تشخیص نقض
     * یکتایی خوردیم.
     */
    async function expectCheckViolation(
      insert: () => Promise<unknown>,
      constraint: string,
    ): Promise<void> {
      try {
        await insert();
        expect.unreachable('محدودیت دیتابیس باید جلویش را می‌گرفت');
      } catch (error) {
        expect(isCheckViolation(error)).toBe(true);
        expect(getPostgresConstraintName(error)).toBe(constraint);
      }
    }

    it('دیتابیس هم مستقل از لایه‌ی برنامه جلوی کسورات زیاد را می‌گیرد', async () => {
      const item = await service.createItem(sampleItem());

      await expectCheckViolation(
        () =>
          withTenantTransaction(db, tenantA.id, async (tx) =>
            tx.insert(jewelryItemVersions).values({
              tenantId: tenantA.id,
              jewelryItemId: item.jewelryItemId,
              title: 'ناسازگار',
              normalizedTitle: 'ناسازگار',
              grossWeightMg: 1_000n,
              karat: 750,
              stoneWeightMg: 900n,
              otherDeductionWeightMg: 500n,
              wageType: 'FLAT',
              wageValue: 0n,
              validFrom: new Date('2027-01-01T00:00:00Z'),
              version: 99,
              active: true,
            }),
          ),
        'jewelry_item_versions_deduction_within_gross_check',
      );
    });

    it('دیتابیس عیار خارج از بازه را هم رد می‌کند', async () => {
      const item = await service.createItem(sampleItem());

      await expectCheckViolation(
        () =>
          withTenantTransaction(db, tenantA.id, async (tx) =>
            tx.insert(jewelryItemVersions).values({
              tenantId: tenantA.id,
              jewelryItemId: item.jewelryItemId,
              title: 'عیار غلط',
              normalizedTitle: 'عیار غلط',
              grossWeightMg: 1_000n,
              karat: 1001,
              stoneWeightMg: 0n,
              otherDeductionWeightMg: 0n,
              wageType: 'FLAT',
              wageValue: 0n,
              validFrom: new Date('2027-01-01T00:00:00Z'),
              version: 98,
              active: true,
            }),
          ),
        'jewelry_item_versions_karat_range_check',
      );
    });
  });

  describe('جداسازی مستأجر', () => {
    it('مستأجر الف کالای مستأجر ب را نمی‌بیند', async () => {
      const own = await service.createItem(sampleItem());
      const foreign = await service.createItem(sampleItem({ tenantId: tenantB.id }));

      const visibleToA = await withTenantTransaction(db, tenantA.id, async (tx) =>
        tx.select({ id: jewelryItems.id }).from(jewelryItems),
      );
      const ids = visibleToA.map((row) => row.id);

      expect(ids).toContain(own.jewelryItemId);
      expect(ids).not.toContain(foreign.jewelryItemId);
    });

    it('نسخه‌های مستأجر دیگر هم پنهان‌اند', async () => {
      const foreign = await service.createItem(sampleItem({ tenantId: tenantB.id }));

      const found = await service.getEffective(
        tenantA.id,
        foreign.jewelryItemId,
        new Date('2026-06-01T00:00:00Z'),
      );

      expect(found).toBeUndefined();
    });

    it('جداسازی کار PostgreSQL است، نه شرط کوئری', async () => {
      // با کاربر مهاجرت، همان جدول ردیف‌های هر دو مستأجر را می‌دهد.
      const all = await db.select({ tenantId: jewelryItems.tenantId }).from(jewelryItems);

      expect(new Set(all.map((row) => row.tenantId)).size).toBeGreaterThan(1);
    });
  });

  describe('ممیزی', () => {
    it('نسخه‌ی جدید وزن خالص محاسبه‌شده را در ممیزی ثبت می‌کند', async () => {
      const version = await service.createItem(sampleItem());

      const rows = await withTenantTransaction(db, tenantA.id, async (tx) =>
        tx
          .select()
          .from(jewelryItemVersions)
          .where(
            and(
              eq(jewelryItemVersions.tenantId, tenantA.id),
              eq(jewelryItemVersions.id, version.id),
            ),
          ),
      );

      expect(rows).toHaveLength(1);
      expect(pureWeightOf(rows[0]!)).toBe(7_500n);
    });
  });
});
