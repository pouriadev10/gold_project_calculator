import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { CoinTypesService } from '../src/modules/inventory/coin-types.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { auditLogs, coinTypes, coinTypeVersions, tenants } from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import type { INestApplicationContext } from '@nestjs/common';
import type { Database } from '../src/platform/database/connect';

const EXPECTED_COIN_TYPES: Readonly<Record<string, bigint>> = {
  BAHAR_AZADI_NEW: 8_133_000n,
  NIM_BAHAR_AZADI: 4_066_500n,
  ROB_BAHAR_AZADI: 2_033_200n,
  GERAMI: 1_016_600n,
};

describe('versioned coin types (BE-020)', () => {
  let app: INestApplicationContext;
  let db: Database;
  let tenantService: TenantService;
  let coinTypesService: CoinTypesService;
  const createdTenantIds: string[] = [];

  const createTenant = async () => {
    const tenant = await tenantService.create({
      name: 'سکه‌های نسخه‌دار',
      slug: `coin-types-${randomUUID().slice(0, 12)}`,
    });
    createdTenantIds.push(tenant.id);
    return tenant;
  };

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = app.get<Database>(DRIZZLE);
    tenantService = app.get(TenantService);
    coinTypesService = app.get(CoinTypesService);
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await app.close();
  });

  it('seeds exact microgram specifications while keeping coin types as separate identities', async () => {
    const tenant = await createTenant();
    const seeded = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      types: await transaction.select().from(coinTypes).where(eq(coinTypes.tenantId, tenant.id)),
      versions: await transaction
        .select()
        .from(coinTypeVersions)
        .where(eq(coinTypeVersions.tenantId, tenant.id)),
      audit: await transaction
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.tenantId, tenant.id)),
    }));

    expect(seeded.types).toHaveLength(Object.keys(EXPECTED_COIN_TYPES).length);
    expect(seeded.versions).toHaveLength(Object.keys(EXPECTED_COIN_TYPES).length);

    const codeById = new Map(seeded.types.map((coinType) => [coinType.id, coinType.code]));
    expect(
      Object.fromEntries(
        seeded.versions.map((version) => [
          codeById.get(version.coinTypeId),
          version.grossWeightUg,
        ]),
      ),
    ).toEqual(EXPECTED_COIN_TYPES);
    expect(
      seeded.versions.every(
        (version) =>
          version.karat === 900 &&
          version.isCentralBankMinted &&
          version.mintType === 'CENTRAL_BANK' &&
          version.version === 1 &&
          version.validTo === null,
      ),
    ).toBe(true);
    expect(seeded.audit.filter((entry) => entry.action === 'COIN_TYPE_CREATED')).toHaveLength(4);
    expect(seeded.audit.filter((entry) => entry.action === 'COIN_TYPE_VERSION_CREATED')).toHaveLength(
      4,
    );
  });

  it('creates a new version and preserves the prior specification for historical documents', async () => {
    const tenant = await createTenant();
    const [coinType] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(coinTypes)
        .where(
          and(
            eq(coinTypes.tenantId, tenant.id),
            eq(coinTypes.code, 'BAHAR_AZADI_NEW'),
          ),
        ),
    );
    const selectedType = coinType!;
    const later = new Date(tenant.createdAt.getTime() + 60_000);

    const next = await coinTypesService.createVersion({
      tenantId: tenant.id,
      coinTypeId: selectedType.id,
      title: 'تمام بهار آزادی (طرح جدید)',
      mintType: 'CENTRAL_BANK',
      grossWeightUg: 8_133_001n,
      karat: 900,
      isCentralBankMinted: true,
      validFrom: later,
      active: true,
    });
    const historical = await coinTypesService.getEffective(
      tenant.id,
      selectedType.id,
      tenant.createdAt,
    );

    expect(historical?.grossWeightUg).toBe(8_133_000n);
    expect(historical?.validTo?.getTime()).toBe(later.getTime());
    expect(next.version).toBe(2);
    expect(next.grossWeightUg).toBe(8_133_001n);
  });

  it('rejects directly inserted overlapping specification intervals in the database', async () => {
    const tenant = await createTenant();
    const [coinType] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(coinTypes)
        .where(
          and(
            eq(coinTypes.tenantId, tenant.id),
            eq(coinTypes.code, 'GERAMI'),
          ),
        ),
    );
    const selectedType = coinType!;

    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction.insert(coinTypeVersions).values({
          tenantId: tenant.id,
          coinTypeId: selectedType.id,
          title: 'نسخه‌ی هم‌پوشان',
          mintType: 'CENTRAL_BANK',
          grossWeightUg: 1_016_600n,
          karat: 900,
          isCentralBankMinted: true,
          validFrom: tenant.createdAt,
          version: 99,
          active: true,
        }),
      ),
    ).rejects.toThrow();
  });
});
