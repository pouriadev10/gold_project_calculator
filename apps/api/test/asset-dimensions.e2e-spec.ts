import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { CoinTypesService } from '../src/modules/inventory/coin-types.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { assetDimensions, coinTypes, tenants } from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import type { INestApplicationContext } from '@nestjs/common';
import type { Database } from '../src/platform/database/connect';

/** ابعاد دارایی — BE-030. این آزمون‌ها روی PostgreSQL واقعی اجرا می‌شوند. */
describe('ابعاد دارایی (BE-030)', () => {
  let app: INestApplicationContext;
  let db: Database;
  let tenantService: TenantService;
  let coinTypesService: CoinTypesService;
  const tenantIds: string[] = [];

  async function createTenant() {
    const tenant = await tenantService.create({
      name: 'ابعاد دارایی',
      slug: `asset-dimensions-${randomUUID().slice(0, 12)}`,
    });
    tenantIds.push(tenant.id);
    return tenant;
  }

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = app.get<Database>(DRIZZLE);
    tenantService = app.get(TenantService);
    coinTypesService = app.get(CoinTypesService);
  });

  afterAll(async () => {
    for (const tenantId of tenantIds) {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await app.close();
  });

  it('ریال، طلا و نقره و نیز یک بعد مستقل count-only برای هر سکه‌ی فعال seed می‌شوند', async () => {
    const tenant = await createTenant();
    const seeded = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      dimensions: await transaction
        .select()
        .from(assetDimensions)
        .where(eq(assetDimensions.tenantId, tenant.id)),
      coinTypes: await transaction.select().from(coinTypes).where(eq(coinTypes.tenantId, tenant.id)),
    }));

    const bases = seeded.dimensions.filter((dimension) => dimension.coinTypeId === null);
    expect(bases.map((dimension) => dimension.code).sort()).toEqual(['GOLD', 'RIAL', 'SILVER']);
    expect(bases.every((dimension) => dimension.active)).toBe(true);

    const coinDimensions = seeded.dimensions.filter((dimension) => dimension.kind === 'COIN');
    expect(coinDimensions).toHaveLength(seeded.coinTypes.length);
    expect(new Set(coinDimensions.map((dimension) => dimension.coinTypeId)).size).toBe(
      seeded.coinTypes.length,
    );
    expect(
      coinDimensions.every(
        (dimension) =>
          dimension.coinTypeId !== null && dimension.code === `COIN:${dimension.coinTypeId}`,
      ),
    ).toBe(true);
  });

  it('یک coin type تازه، بعد مستقل خود را در همان transaction می‌گیرد', async () => {
    const tenant = await createTenant();
    const version = await coinTypesService.createType({
      tenantId: tenant.id,
      code: `TEST_${randomUUID().slice(0, 8)}`,
      title: 'سکهٔ آزمون',
      mintType: 'PRIVATE_MINT',
      grossWeightUg: 1_000_000n,
      karat: 999,
      isCentralBankMinted: false,
      validFrom: new Date('2026-08-05T00:00:00Z'),
      active: true,
    });

    const [dimension] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(assetDimensions)
        .where(
          and(
            eq(assetDimensions.tenantId, tenant.id),
            eq(assetDimensions.coinTypeId, version.coinTypeId),
          ),
        )
        .limit(1),
    );

    expect(dimension).toMatchObject({
      kind: 'COIN',
      coinTypeId: version.coinTypeId,
      code: `COIN:${version.coinTypeId}`,
      active: true,
    });
  });

  it('دیتابیس اجازه‌ی share یا remap کردن بعد سکه بین دو نوع را نمی‌دهد', async () => {
    const tenant = await createTenant();
    const [firstCoin, secondCoin] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(coinTypes)
        .where(eq(coinTypes.tenantId, tenant.id))
        .orderBy(coinTypes.code)
        .limit(2),
    );

    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction.insert(assetDimensions).values({
          tenantId: tenant.id,
          code: `DUPLICATE:${firstCoin!.id}`,
          kind: 'COIN',
          coinTypeId: firstCoin!.id,
          title: 'بعد تکراری',
          active: true,
        }),
      ),
    ).rejects.toThrow();

    const [firstDimension] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(assetDimensions)
        .where(
          and(
            eq(assetDimensions.tenantId, tenant.id),
            eq(assetDimensions.coinTypeId, firstCoin!.id),
          ),
        )
        .limit(1),
    );

    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction
          .update(assetDimensions)
          .set({ coinTypeId: secondCoin!.id })
          .where(eq(assetDimensions.id, firstDimension!.id)),
      ),
    ).rejects.toThrow();
  });
});
