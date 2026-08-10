import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { calculateJewelrySale, grossMg, karat, rateDivisorFromMarketSettings } from '@gold/core-calc';
import { eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import { tenants } from '../src/platform/database/schema';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { UserService } from '../src/platform/users/user.service';
import { JewelryItemsService } from '../src/modules/inventory/jewelry-items.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { SalesPricingService } from '../src/modules/sales/sales-pricing.service';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

describe('server-side jewelry sales pricing (BE-040)', () => {
  const tenant = { id: '', slug: `sales-pricing-${randomUUID().slice(0, 12)}` };
  let effectiveAt = new Date();
  let app: INestApplicationContext;
  let db: Database;
  let tenantService: TenantService;
  let users: UserService;
  let jewelryItems: JewelryItemsService;
  let quotes: PriceQuotesService;
  let pricing: SalesPricingService;
  let itemId = '';
  let quoteId = '';
  let actorUserId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    tenantService = app.get(TenantService);
    users = app.get(UserService);
    jewelryItems = app.get(JewelryItemsService);
    quotes = app.get(PriceQuotesService);
    pricing = app.get(SalesPricingService);

    tenant.id = (
      await tenantService.create({ name: 'Sales pricing tenant', slug: tenant.slug })
    ).id;
    effectiveAt = new Date();
    actorUserId = (
      await users.create({
        email: `${randomUUID().slice(0, 12)}@example.com`,
        displayName: 'Sales pricing actor',
      })
    ).id;
    const item = await jewelryItems.createItem({
      tenantId: tenant.id,
      code: `RING-${randomUUID().slice(0, 8)}`,
      title: 'انگشتر نگین‌دار',
      grossWeightMg: 12_000n,
      karat: 750,
      stoneWeightMg: 2_000n,
      otherDeductionWeightMg: 0n,
      wageType: 'PER_GRAM',
      wageValue: 350_000n,
      validFrom: effectiveAt,
      active: true,
    });
    itemId = item.jewelryItemId;
    quoteId = (
      await quotes.createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000_000n,
        createdBy: actorUserId,
      })
    ).id;
  });

  afterAll(async () => {
    if (tenant.id !== '') {
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    }
    await app.close();
  });

  it('recomputes the canonical result from server records and ignores a forged frontend total', async () => {
    const forgedClientInput = {
      tenantId: tenant.id,
      jewelryItemId: itemId,
      quoteId,
      effectiveAt,
      payableRial: '1',
    };
    const actual = await pricing.priceJewelry(forgedClientInput);
    const expected = calculateJewelrySale({
      grossWeightMg: 12_000n,
      karat: karat(750),
      deductions: { stone: grossMg(2_000n), other: grossMg(0n) },
      wageType: 'PER_GRAM',
      wageValue: 350_000n,
      maznehRial: 100_000_000n,
      profitRateBps: 700n,
      taxRateBps: 1_000n,
      roundingUnitRial: 1_000n,
      rateDivisor: rateDivisorFromMarketSettings(karat(705), 46_083n),
    });

    expect(actual.payableRial).toBe(expected.payableRial.toString());
    expect(actual.payableRial).not.toBe(forgedClientInput.payableRial);
    expect(actual).toMatchObject({
      pureWeightMg: expected.pureWeightMg.toString(),
      goldValueRial: expected.goldValueRial.toString(),
      wageRial: expected.wageRial.toString(),
      profitRial: expected.profitRial.toString(),
      taxRial: expected.taxRial.toString(),
      settingsSnapshot: {
        roundingPolicy: 'HALF_UP',
        profitRateBps: '700',
        taxRateBps: '1000',
      },
    });
  });
});
