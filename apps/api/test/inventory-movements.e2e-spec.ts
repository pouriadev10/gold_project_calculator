import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import { getPostgresConstraintName, isCheckViolation } from '../src/platform/database/pg-errors';
import { coinTypes, inventoryMovements, tenants } from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { RequiredSettingMissingError } from '../src/modules/pricing/versioned-settings.errors';
import { VersionedSettingsService } from '../src/modules/pricing/versioned-settings.service';
import {
  InvalidInventoryItemIdentityError,
  NegativeInventoryError,
  ZeroInventoryMovementError,
} from '../src/modules/inventory/inventory-movements.errors';
import {
  ALLOW_NEGATIVE_STOCK_SETTING,
  InventoryMovementsService,
} from '../src/modules/inventory/inventory-movements.service';
import { JewelryItemsService } from '../src/modules/inventory/jewelry-items.service';
import type { Database } from '../src/platform/database/connect';
import type { RecordInventoryMovementInput } from '../src/modules/inventory/inventory-movements.service';
import type { INestApplicationContext } from '@nestjs/common';

/**
 * حرکات موجودی — BE-027. نیازمند PostgreSQL واقعی.
 *
 * مستأجرها با `TenantService` ساخته می‌شوند و نه با درج مستقیم، چون
 * سیاست موجودی منفی یک تنظیم seed‌شده در همان تراکنشِ ساخت مستأجر است.
 */
describe('حرکات موجودی (نیازمند PostgreSQL واقعی)', () => {
  let app: INestApplicationContext;
  let db: Database;
  let movements: InventoryMovementsService;
  let jewelry: JewelryItemsService;
  let settings: VersionedSettingsService;
  let tenantService: TenantService;

  /** مستأجر عادی: موجودی منفی مسدود است. */
  const tenantA = { id: '', slug: `inv-a-${randomUUID().slice(0, 12)}` };
  /** مستأجر دوم برای بررسی جداسازی. */
  const tenantB = { id: '', slug: `inv-b-${randomUUID().slice(0, 12)}` };
  /** مستأجری که سیاستش روی «اجازه بده» تنظیم می‌شود. */
  const tenantNegative = { id: '', slug: `inv-neg-${randomUUID().slice(0, 12)}` };

  let coinTypeId = '';

  function movement(
    overrides: Partial<RecordInventoryMovementInput> = {},
  ): RecordInventoryMovementInput {
    return {
      sourceType: 'OPENING_BALANCE',
      sourceId: randomUUID(),
      itemType: 'MELTED_GOLD',
      quantity: 10_000n,
      occurredAt: new Date('2026-02-01T00:00:00Z'),
      ...overrides,
    };
  }

  /** حرکت را در تراکنش مستأجر ثبت می‌کند — تنها مسیر نوشتن سرویس. */
  async function record(tenantId: string, input: RecordInventoryMovementInput) {
    return withTenantTransaction(db, tenantId, (transaction) =>
      movements.recordInTransaction(transaction, tenantId, input),
    );
  }

  /** کالای زیورآلات واقعی می‌سازد تا `item_id` شناسه‌ی ساختگی نباشد. */
  async function newJewelryItemId(tenantId: string): Promise<string> {
    const version = await jewelry.createItem({
      tenantId,
      code: `INV-${randomUUID().slice(0, 8)}`,
      title: 'انگشتر موجودی',
      grossWeightMg: 12_000n,
      karat: 750,
      stoneWeightMg: 0n,
      otherDeductionWeightMg: 0n,
      wageType: 'PER_GRAM',
      wageValue: 350_000n,
      validFrom: new Date('2026-01-01T00:00:00Z'),
      active: true,
    });

    return version.jewelryItemId;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    movements = app.get(InventoryMovementsService);
    jewelry = app.get(JewelryItemsService);
    settings = app.get(VersionedSettingsService);
    tenantService = app.get(TenantService);

    for (const tenant of [tenantA, tenantB, tenantNegative]) {
      const created = await tenantService.create({
        name: `مستأجر ${tenant.slug}`,
        slug: tenant.slug,
      });
      tenant.id = created.id;
    }

    // انواع سکه هنگام ساخت مستأجر seed می‌شوند؛ یکی‌شان کافی است.
    const [coinType] = await withTenantTransaction(db, tenantA.id, (transaction) =>
      transaction.select().from(coinTypes).where(eq(coinTypes.tenantId, tenantA.id)).limit(1),
    );
    coinTypeId = coinType!.id;

    await settings.createVersion({
      tenantId: tenantNegative.id,
      settingKey: ALLOW_NEGATIVE_STOCK_SETTING,
      valueJson: { value: 'true' },
      validFrom: new Date(),
      createdBy: null,
    });
  });

  afterAll(async () => {
    for (const tenant of [tenantA, tenantB, tenantNegative]) {
      if (tenant.id !== '') {
        await db.delete(tenants).where(eq(tenants.id, tenant.id));
      }
    }
    await app.close();
  });

  describe('ثبت ورودی و خروجی', () => {
    it('ورودی مثبت و خروجی منفی ثبت می‌شود', async () => {
      const itemId = await newJewelryItemId(tenantA.id);

      const inbound = await record(
        tenantA.id,
        movement({ itemType: 'JEWELRY', itemId, quantity: 5n }),
      );
      const outbound = await record(
        tenantA.id,
        movement({ itemType: 'JEWELRY', itemId, quantity: -2n, sourceType: 'SALE' }),
      );

      expect(inbound.quantity).toBe(5n);
      expect(outbound.quantity).toBe(-2n);
      expect(outbound.sourceType).toBe('SALE');
    });

    it('مقدارها bigint برمی‌گردند، نه number', async () => {
      const created = await record(tenantA.id, movement({ quantity: 9_007_199_254_740_993n }));

      expect(typeof created.quantity).toBe('bigint');
      expect(created.quantity).toBe(9_007_199_254_740_993n);
    });

    it('سکه با تعداد ثبت می‌شود و شناسه‌اش نوع سکه است', async () => {
      const created = await record(
        tenantA.id,
        movement({ itemType: 'COIN', itemId: coinTypeId, quantity: 3n }),
      );

      expect(created).toMatchObject({ itemType: 'COIN', itemId: coinTypeId, quantity: 3n });
    });

    it('آبشده با میلی‌گرم خالص و بدون شناسه ثبت می‌شود', async () => {
      const created = await record(
        tenantB.id,
        movement({ itemType: 'MELTED_GOLD', quantity: 7_319_700n }),
      );

      expect(created.itemId).toBeNull();
      expect(created.quantity).toBe(7_319_700n);
    });

    it('چند خط یک سند در یک فراخوانی ثبت می‌شوند', async () => {
      const sourceId = randomUUID();
      const itemId = await newJewelryItemId(tenantA.id);

      const recorded = await withTenantTransaction(db, tenantA.id, (transaction) =>
        movements.recordManyInTransaction(transaction, tenantA.id, [
          movement({ sourceId, itemType: 'JEWELRY', itemId, quantity: 4n }),
          movement({ sourceId, itemType: 'MELTED_GOLD', quantity: 50_000n }),
        ]),
      );

      expect(recorded).toHaveLength(2);
      expect(await movements.listBySource(tenantA.id, 'OPENING_BALANCE', sourceId)).toHaveLength(2);
    });

    it('فهرست خالی هیچ ردیفی نمی‌سازد', async () => {
      const recorded = await withTenantTransaction(db, tenantA.id, (transaction) =>
        movements.recordManyInTransaction(transaction, tenantA.id, []),
      );

      expect(recorded).toEqual([]);
    });
  });

  describe('موجودی جاری', () => {
    it('مانده مجموع حرکات است', async () => {
      const itemId = await newJewelryItemId(tenantA.id);
      await record(tenantA.id, movement({ itemType: 'JEWELRY', itemId, quantity: 10n }));
      await record(
        tenantA.id,
        movement({ itemType: 'JEWELRY', itemId, quantity: -3n, sourceType: 'SALE' }),
      );
      await record(
        tenantA.id,
        movement({ itemType: 'JEWELRY', itemId, quantity: -2n, sourceType: 'SALE' }),
      );

      expect(await movements.balance(tenantA.id, 'JEWELRY', itemId)).toBe(5n);
    });

    it('کالای بدون حرکت مانده‌ی صفر دارد', async () => {
      const itemId = await newJewelryItemId(tenantA.id);

      expect(await movements.balance(tenantA.id, 'JEWELRY', itemId)).toBe(0n);
    });

    it('مانده‌ی آبشده مستقل از مانده‌ی زیورآلات است', async () => {
      const itemId = await newJewelryItemId(tenantB.id);
      await record(tenantB.id, movement({ itemType: 'JEWELRY', itemId, quantity: 6n }));
      const meltedBefore = await movements.balance(tenantB.id, 'MELTED_GOLD', null);

      await record(tenantB.id, movement({ itemType: 'MELTED_GOLD', quantity: 1_000n }));

      expect(await movements.balance(tenantB.id, 'JEWELRY', itemId)).toBe(6n);
      expect(await movements.balance(tenantB.id, 'MELTED_GOLD', null)).toBe(meltedBefore + 1_000n);
    });

    it('فهرست مانده‌ها به تفکیک نوع و کالا گروه می‌شود', async () => {
      const itemId = await newJewelryItemId(tenantB.id);
      await record(tenantB.id, movement({ itemType: 'JEWELRY', itemId, quantity: 8n }));

      const all = await movements.balances(tenantB.id);
      const jewelryOnly = await movements.balances(tenantB.id, 'JEWELRY');

      expect(all.find((row) => row.itemId === itemId)?.quantity).toBe(8n);
      expect(all.some((row) => row.itemType === 'MELTED_GOLD')).toBe(true);
      expect(jewelryOnly.every((row) => row.itemType === 'JEWELRY')).toBe(true);
    });

    it('مانده‌ی مجموع از محدوده‌ی امن number رد می‌شود بدون از دست دادن رقم', async () => {
      const itemId = await newJewelryItemId(tenantB.id);
      await record(
        tenantB.id,
        movement({ itemType: 'JEWELRY', itemId, quantity: 9_007_199_254_740_993n }),
      );
      await record(tenantB.id, movement({ itemType: 'JEWELRY', itemId, quantity: 1n }));

      expect(await movements.balance(tenantB.id, 'JEWELRY', itemId)).toBe(9_007_199_254_740_994n);
    });

    it('مانده‌ی مستأجر دیگر دیده نمی‌شود', async () => {
      const itemId = await newJewelryItemId(tenantA.id);
      await record(tenantA.id, movement({ itemType: 'JEWELRY', itemId, quantity: 12n }));

      expect(await movements.balance(tenantB.id, 'JEWELRY', itemId)).toBe(0n);
    });
  });

  describe('سیاست موجودی منفی', () => {
    it('خروجی بیشتر از موجودی رد می‌شود', async () => {
      const itemId = await newJewelryItemId(tenantA.id);
      await record(tenantA.id, movement({ itemType: 'JEWELRY', itemId, quantity: 2n }));

      await expect(
        record(
          tenantA.id,
          movement({ itemType: 'JEWELRY', itemId, quantity: -3n, sourceType: 'SALE' }),
        ),
      ).rejects.toBeInstanceOf(NegativeInventoryError);
    });

    it('خطا مقدار موجود و مقدار درخواستی را می‌گوید', async () => {
      const itemId = await newJewelryItemId(tenantA.id);
      await record(tenantA.id, movement({ itemType: 'JEWELRY', itemId, quantity: 2n }));

      await expect(
        record(
          tenantA.id,
          movement({ itemType: 'JEWELRY', itemId, quantity: -5n, sourceType: 'SALE' }),
        ),
      ).rejects.toMatchObject({ available: 2n, requested: 5n, itemType: 'JEWELRY' });
    });

    it('خروجی دقیقاً به اندازه‌ی موجودی مجاز است', async () => {
      const itemId = await newJewelryItemId(tenantA.id);
      await record(tenantA.id, movement({ itemType: 'JEWELRY', itemId, quantity: 4n }));

      await record(
        tenantA.id,
        movement({ itemType: 'JEWELRY', itemId, quantity: -4n, sourceType: 'SALE' }),
      );

      expect(await movements.balance(tenantA.id, 'JEWELRY', itemId)).toBe(0n);
    });

    it('حرکت ردشده هیچ ردیفی باقی نمی‌گذارد', async () => {
      const itemId = await newJewelryItemId(tenantA.id);
      const sourceId = randomUUID();

      await expect(
        record(
          tenantA.id,
          movement({ sourceId, itemType: 'JEWELRY', itemId, quantity: -1n, sourceType: 'SALE' }),
        ),
      ).rejects.toBeInstanceOf(NegativeInventoryError);

      expect(await movements.listBySource(tenantA.id, 'SALE', sourceId)).toHaveLength(0);
      expect(await movements.balance(tenantA.id, 'JEWELRY', itemId)).toBe(0n);
    });

    it('خط دومِ یک سند، موجودیِ بعد از خط اول را می‌بیند', async () => {
      const itemId = await newJewelryItemId(tenantA.id);
      await record(tenantA.id, movement({ itemType: 'JEWELRY', itemId, quantity: 3n }));

      await expect(
        withTenantTransaction(db, tenantA.id, (transaction) =>
          movements.recordManyInTransaction(transaction, tenantA.id, [
            movement({ itemType: 'JEWELRY', itemId, quantity: -2n, sourceType: 'SALE' }),
            movement({ itemType: 'JEWELRY', itemId, quantity: -2n, sourceType: 'SALE' }),
          ]),
        ),
      ).rejects.toBeInstanceOf(NegativeInventoryError);

      // کل سند برمی‌گردد، پس خط اول هم ثبت نمی‌ماند.
      expect(await movements.balance(tenantA.id, 'JEWELRY', itemId)).toBe(3n);
    });

    it('مستأجری که سیاستش اجازه می‌دهد، مانده‌ی منفی می‌گیرد', async () => {
      const itemId = await newJewelryItemId(tenantNegative.id);

      await record(
        tenantNegative.id,
        movement({ itemType: 'JEWELRY', itemId, quantity: -7n, sourceType: 'SALE' }),
      );

      expect(await movements.balance(tenantNegative.id, 'JEWELRY', itemId)).toBe(-7n);
    });

    it('سیاست تنظیم مستأجری است، نه ثابت کد — مستأجر دیگر همچنان مسدود است', async () => {
      const itemId = await newJewelryItemId(tenantA.id);

      await expect(
        record(
          tenantA.id,
          movement({ itemType: 'JEWELRY', itemId, quantity: -1n, sourceType: 'SALE' }),
        ),
      ).rejects.toBeInstanceOf(NegativeInventoryError);
    });

    it('نبودِ تنظیم، خطای صریح می‌دهد و پیش‌فرض کدی جایش را نمی‌گیرد', async () => {
      // مستأجر با درج مستقیم ساخته می‌شود، پس هیچ تنظیمی seed نشده است.
      const [bare] = await db
        .insert(tenants)
        .values({ name: 'بدون تنظیم', slug: `inv-bare-${randomUUID().slice(0, 12)}` })
        .returning();

      try {
        await expect(record(bare!.id, movement())).rejects.toBeInstanceOf(
          RequiredSettingMissingError,
        );
      } finally {
        await db.delete(tenants).where(eq(tenants.id, bare!.id));
      }
    });
  });

  describe('اعتبارسنجی', () => {
    it('حرکت صفر رد می‌شود', async () => {
      await expect(record(tenantA.id, movement({ quantity: 0n }))).rejects.toBeInstanceOf(
        ZeroInventoryMovementError,
      );
    });

    it('زیورآلات بدون شناسه رد می‌شود', async () => {
      await expect(
        record(tenantA.id, movement({ itemType: 'JEWELRY', itemId: null })),
      ).rejects.toBeInstanceOf(InvalidInventoryItemIdentityError);
    });

    it('آبشده با شناسه رد می‌شود', async () => {
      await expect(
        record(tenantA.id, movement({ itemType: 'MELTED_GOLD', itemId: randomUUID() })),
      ).rejects.toBeInstanceOf(InvalidInventoryItemIdentityError);
    });

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

    it('دیتابیس مستقل از سرویس جلوی حرکت صفر را می‌گیرد', async () => {
      await expectCheckViolation(
        () =>
          withTenantTransaction(db, tenantA.id, (transaction) =>
            transaction.insert(inventoryMovements).values({
              tenantId: tenantA.id,
              sourceType: 'OPENING_BALANCE',
              sourceId: randomUUID(),
              itemType: 'MELTED_GOLD',
              quantity: 0n,
              occurredAt: new Date(),
            }),
          ),
        'inventory_movements_quantity_nonzero_check',
      );
    });

    it('دیتابیس مستقل از سرویس جلوی شناسه‌ی ناسازگار را می‌گیرد', async () => {
      await expectCheckViolation(
        () =>
          withTenantTransaction(db, tenantA.id, (transaction) =>
            transaction.insert(inventoryMovements).values({
              tenantId: tenantA.id,
              sourceType: 'OPENING_BALANCE',
              sourceId: randomUUID(),
              itemType: 'MELTED_GOLD',
              itemId: randomUUID(),
              quantity: 5n,
              occurredAt: new Date(),
            }),
          ),
        'inventory_movements_item_identity_check',
      );
    });
  });

  describe('Append-Only', () => {
    it('سرویس هیچ متد به‌روزرسانی یا حذفی ندارد', () => {
      const methods = Object.getOwnPropertyNames(InventoryMovementsService.prototype);

      expect(methods.some((name) => /^(update|delete|remove|reverse)/u.test(name))).toBe(false);
    });

    it('به‌روزرسانی در زمان اجرا حتی با SQL مستقیم شکست می‌خورد', async () => {
      const created = await record(tenantA.id, movement());

      await expect(
        withTenantTransaction(db, tenantA.id, (transaction) =>
          transaction
            .update(inventoryMovements)
            .set({ quantity: 1n })
            .where(eq(inventoryMovements.id, created.id)),
        ),
      ).rejects.toThrow();
    });

    it('حذف در زمان اجرا حتی با SQL مستقیم شکست می‌خورد', async () => {
      const created = await record(tenantA.id, movement());

      await expect(
        withTenantTransaction(db, tenantA.id, (transaction) =>
          transaction.delete(inventoryMovements).where(eq(inventoryMovements.id, created.id)),
        ),
      ).rejects.toThrow();

      const rows = await withTenantTransaction(db, tenantA.id, (transaction) =>
        transaction
          .select()
          .from(inventoryMovements)
          .where(
            and(eq(inventoryMovements.tenantId, tenantA.id), eq(inventoryMovements.id, created.id)),
          ),
      );
      expect(rows).toHaveLength(1);
    });

    it('اصلاح یعنی حرکت جدید با علامت مخالف، نه ویرایش ردیف قبلی', async () => {
      const itemId = await newJewelryItemId(tenantA.id);
      const wrong = await record(
        tenantA.id,
        movement({ itemType: 'JEWELRY', itemId, quantity: 9n }),
      );

      await record(
        tenantA.id,
        movement({
          itemType: 'JEWELRY',
          itemId,
          quantity: -9n,
          sourceType: 'CORRECTION',
          sourceId: wrong.sourceId,
        }),
      );

      expect(await movements.balance(tenantA.id, 'JEWELRY', itemId)).toBe(0n);
      expect(await movements.listBySource(tenantA.id, 'CORRECTION', wrong.sourceId)).toHaveLength(
        1,
      );
    });
  });

  describe('یک تراکنش با سند مسبب', () => {
    /**
     * قاعده‌ی «movement و ledger در یک transaction» فعلاً قابل تست
     * مستقیم نیست چون دفتر کل در BE-032 ساخته می‌شود. آنچه اینجا اثبات
     * می‌شود سازوکاری است که آن قاعده رویش سوار خواهد شد: نوشتن حرکت
     * داخل تراکنشِ فراخوان انجام می‌شود، پس با rollback او برمی‌گردد.
     */
    it('rollback تراکنشِ فراخوان، حرکت را هم برمی‌گرداند', async () => {
      const itemId = await newJewelryItemId(tenantA.id);
      const sourceId = randomUUID();

      await expect(
        withTenantTransaction(db, tenantA.id, async (transaction) => {
          await movements.recordInTransaction(transaction, tenantA.id, {
            sourceType: 'SALE',
            sourceId,
            itemType: 'JEWELRY',
            itemId,
            quantity: 3n,
            occurredAt: new Date(),
          });

          throw new Error('سند مسبب شکست خورد');
        }),
      ).rejects.toThrow('سند مسبب شکست خورد');

      expect(await movements.listBySource(tenantA.id, 'SALE', sourceId)).toHaveLength(0);
      expect(await movements.balance(tenantA.id, 'JEWELRY', itemId)).toBe(0n);
    });

    it('حرکات یک سند با شناسه‌ی همان سند پیدا می‌شوند', async () => {
      const sourceId = randomUUID();
      await record(tenantA.id, movement({ sourceId, sourceType: 'PURCHASE', quantity: 2_000n }));

      const found = await movements.listBySource(tenantA.id, 'PURCHASE', sourceId);

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ sourceId, sourceType: 'PURCHASE', quantity: 2_000n });
    });

    it('بُعد دفتر کل فعلاً خالی است و در BE-030 پر می‌شود', async () => {
      const created = await record(tenantA.id, movement());

      expect(created.dimensionId).toBeNull();
    });
  });
});
