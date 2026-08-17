import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { dualFromRial } from '@gold/core-calc';
import { dashboardSchema } from '@gold/contracts';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LedgerAccountsService } from '../src/modules/ledger/ledger-accounts.service';
import { LedgerPostingService } from '../src/modules/ledger/ledger-posting.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { PasswordService } from '../src/platform/auth/password.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  assetDimensions,
  coinTypes,
  inventoryMovements,
  tenants,
} from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import type { Dashboard } from '@gold/contracts';
import type { Database } from '../src/platform/database/connect';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const PASSWORD = 'dashboard-password-123';

interface TenantFixture {
  id: string;
  slug: string;
}

interface Member {
  token: string;
}

interface LedgerSetup {
  readonly cashAccountId: string;
  readonly salesRevenueAccountId: string;
  readonly purchaseFromConsumerAccountId: string;
  readonly receivableAccountId: string;
  readonly payableAccountId: string;
  readonly rialDimensionId: string;
  readonly goldDimensionId: string;
  readonly coinDimensionId: string;
  readonly coinTypeId: string;
}

/** Base dashboard reads current ledger/inventory state without mutating it (BE-059). */
describe('reporting dashboard (BE-059)', () => {
  const adapter = new FastifyAdapter();
  const tenantA: TenantFixture = { id: '', slug: `dashboard-a-${randomUUID().slice(0, 12)}` };
  const tenantB: TenantFixture = { id: '', slug: `dashboard-b-${randomUUID().slice(0, 12)}` };

  let app: NestFastifyApplication;
  let db: Database;
  let accounts: LedgerAccountsService;
  let posting: LedgerPostingService;
  let parties: PartiesService;
  let quotes: PriceQuotesService;
  let passwords: PasswordService;
  let memberships: MembershipService;
  let users: UserService;
  let ownerA: Member;
  let actorId = '';
  let currentQuoteId = '';

  async function makeMember(tenant: TenantFixture): Promise<Member> {
    const user = await users.create({
      email: `${randomUUID().slice(0, 12)}@example.com`,
      displayName: 'Dashboard owner',
    });
    await users.setPasswordHash(user.id, await passwords.hash(PASSWORD));
    await memberships.add(tenant.id, { userId: user.id, roleCode: 'OWNER' });
    const login = await adapter.getInstance().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password: PASSWORD, tenantSlug: tenant.slug },
    });
    expect(login.statusCode).toBe(200);
    return { token: login.json<{ accessToken: string }>().accessToken };
  }

  function headers(member: Member, tenant: TenantFixture): Record<string, string> {
    return { authorization: `Bearer ${member.token}`, 'x-tenant-id': tenant.id };
  }

  async function setupLedger(tenant: TenantFixture, partyName: string): Promise<LedgerSetup> {
    const party = await withTenantTransaction(db, tenant.id, (transaction) =>
      parties.createInTransaction(transaction, {
        tenantId: tenant.id,
        actorUserId: actorId,
        input: { type: 'CONSUMER', displayName: partyName },
      }),
    );
    const partyAccounts = await accounts.ensurePartyAccounts({
      tenantId: tenant.id,
      partyId: party.id,
    });
    return withTenantTransaction(db, tenant.id, async (transaction) => {
      const [cash, salesRevenue, purchaseFromConsumer] = await Promise.all([
        accounts.getRequiredSystemAccountInTransaction(transaction, tenant.id, 'CASH'),
        accounts.getRequiredSystemAccountInTransaction(transaction, tenant.id, 'SALES_REVENUE'),
        accounts.getRequiredSystemAccountInTransaction(
          transaction,
          tenant.id,
          'PURCHASE_FROM_CONSUMER',
        ),
      ]);
      const dimensions = await transaction
        .select({
          id: assetDimensions.id,
          code: assetDimensions.code,
          coinTypeId: assetDimensions.coinTypeId,
        })
        .from(assetDimensions)
        .where(eq(assetDimensions.tenantId, tenant.id));
      const [coinType] = await transaction
        .select({ id: coinTypes.id })
        .from(coinTypes)
        .where(eq(coinTypes.tenantId, tenant.id))
        .orderBy(asc(coinTypes.code))
        .limit(1);
      const rialDimensionId = dimensions.find((dimension) => dimension.code === 'RIAL')?.id;
      const goldDimensionId = dimensions.find((dimension) => dimension.code === 'GOLD')?.id;
      const coinDimensionId = dimensions.find(
        (dimension) => dimension.coinTypeId === coinType?.id,
      )?.id;
      if (
        rialDimensionId === undefined ||
        goldDimensionId === undefined ||
        coinDimensionId === undefined ||
        coinType === undefined
      ) {
        throw new Error('Required dashboard dimensions were not seeded');
      }
      return {
        cashAccountId: cash.id,
        salesRevenueAccountId: salesRevenue.id,
        purchaseFromConsumerAccountId: purchaseFromConsumer.id,
        receivableAccountId: partyAccounts.receivable.id,
        payableAccountId: partyAccounts.payable.id,
        rialDimensionId,
        goldDimensionId,
        coinDimensionId,
        coinTypeId: coinType.id,
      };
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();

    db = app.get<Database>(DRIZZLE);
    accounts = app.get(LedgerAccountsService);
    posting = app.get(LedgerPostingService);
    parties = app.get(PartiesService);
    quotes = app.get(PriceQuotesService);
    passwords = app.get(PasswordService);
    memberships = app.get(MembershipService);
    users = app.get(UserService);
    const tenantService = app.get(TenantService);
    tenantA.id = (await tenantService.create({ name: 'Dashboard A', slug: tenantA.slug })).id;
    tenantB.id = (await tenantService.create({ name: 'Dashboard B', slug: tenantB.slug })).id;
    ownerA = await makeMember(tenantA);
    actorId = (
      await users.create({
        email: `${randomUUID().slice(0, 12)}@example.com`,
        displayName: 'Dashboard posting actor',
      })
    ).id;

    const [setupA, creditorSetup, setupB] = await Promise.all([
      setupLedger(tenantA, 'Dashboard party'),
      setupLedger(tenantA, 'Dashboard creditor'),
      setupLedger(tenantB, 'Foreign dashboard party'),
    ]);
    currentQuoteId = (
      await quotes.createManual({
        tenantId: tenantA.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000_000n,
        createdBy: actorId,
      })
    ).id;
    const today = new Date();

    await Promise.all([
      posting.post({
        source: { tenantId: tenantA.id, type: 'SALES_INVOICE', id: randomUUID() },
        effectiveAt: today,
        description: 'Today cash sale',
        createdBy: actorId,
        entries: [
          {
            accountId: setupA.cashAccountId,
            dimensionId: setupA.rialDimensionId,
            quantity: 100_000_000n,
          },
          {
            accountId: setupA.salesRevenueAccountId,
            dimensionId: setupA.rialDimensionId,
            quantity: -100_000_000n,
          },
        ],
      }),
      posting.post({
        source: { tenantId: tenantA.id, type: 'SECOND_HAND_PURCHASE', id: randomUUID() },
        effectiveAt: today,
        description: 'Today paid purchase',
        createdBy: actorId,
        entries: [
          {
            accountId: setupA.purchaseFromConsumerAccountId,
            dimensionId: setupA.rialDimensionId,
            quantity: 30_000_000n,
          },
          {
            accountId: setupA.cashAccountId,
            dimensionId: setupA.rialDimensionId,
            quantity: -30_000_000n,
          },
        ],
      }),
      posting.post({
        source: { tenantId: tenantA.id, type: 'SETTLEMENT', id: randomUUID() },
        effectiveAt: today,
        description: 'Today debt collection',
        createdBy: actorId,
        entries: [
          {
            accountId: setupA.cashAccountId,
            dimensionId: setupA.rialDimensionId,
            quantity: 20_000_000n,
          },
          {
            accountId: setupA.receivableAccountId,
            dimensionId: setupA.rialDimensionId,
            quantity: -20_000_000n,
          },
        ],
      }),
      posting.post({
        source: { tenantId: tenantA.id, type: 'OPENING_BALANCE', id: randomUUID() },
        effectiveAt: today,
        description: 'Current debtor balance',
        createdBy: actorId,
        entries: [
          {
            accountId: setupA.receivableAccountId,
            dimensionId: setupA.rialDimensionId,
            quantity: 70_000_000n,
          },
          {
            accountId: setupA.cashAccountId,
            dimensionId: setupA.rialDimensionId,
            quantity: -70_000_000n,
          },
        ],
      }),
      posting.post({
        source: { tenantId: tenantA.id, type: 'OPENING_BALANCE', id: randomUUID() },
        effectiveAt: today,
        description: 'Current creditor balance',
        createdBy: actorId,
        entries: [
          {
            accountId: creditorSetup.payableAccountId,
            dimensionId: creditorSetup.rialDimensionId,
            quantity: -40_000_000n,
          },
          {
            accountId: creditorSetup.cashAccountId,
            dimensionId: creditorSetup.rialDimensionId,
            quantity: 40_000_000n,
          },
        ],
      }),
      posting.post({
        source: { tenantId: tenantB.id, type: 'SALES_INVOICE', id: randomUUID() },
        effectiveAt: today,
        description: 'Foreign sale must never leak',
        createdBy: actorId,
        entries: [
          {
            accountId: setupB.cashAccountId,
            dimensionId: setupB.rialDimensionId,
            quantity: 999_000_000n,
          },
          {
            accountId: setupB.salesRevenueAccountId,
            dimensionId: setupB.rialDimensionId,
            quantity: -999_000_000n,
          },
        ],
      }),
    ]);
    await withTenantTransaction(db, tenantA.id, (transaction) =>
      transaction.insert(inventoryMovements).values([
        {
          tenantId: tenantA.id,
          sourceType: 'OPENING_BALANCE',
          sourceId: randomUUID(),
          itemType: 'MELTED_GOLD',
          itemId: null,
          dimensionId: setupA.goldDimensionId,
          quantity: 5_000n,
          occurredAt: today,
        },
        {
          tenantId: tenantA.id,
          sourceType: 'OPENING_BALANCE',
          sourceId: randomUUID(),
          itemType: 'COIN',
          itemId: setupA.coinTypeId,
          dimensionId: setupA.coinDimensionId,
          quantity: 3n,
          occurredAt: today,
        },
      ]),
    );
  });

  afterAll(async () => {
    if (tenantA.id !== '') await db.delete(tenants).where(eq(tenants.id, tenantA.id));
    if (tenantB.id !== '') await db.delete(tenants).where(eq(tenants.id, tenantB.id));
    if (app !== undefined) await app.close();
  });

  it('returns current-day module data, independent inventory, and a current mazneh display projection', async () => {
    const response = await adapter.getInstance().inject({
      method: 'GET',
      url: '/reporting/dashboard?displayUnit=GOLD',
      headers: headers(ownerA, tenantA),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<Dashboard>();
    expect(dashboardSchema.parse(body)).toEqual(body);
    expect(body.displayUnit).toBe('GOLD');
    expect(body.currentMazneh).toMatchObject({ id: currentQuoteId, amountRial: '100000000' });
    expect(body.today).toMatchObject({
      sales: { raw: { rial: '100000000', pureGoldMg: '0' } },
      purchases: { raw: { rial: '30000000', pureGoldMg: '0' } },
      receipts: { raw: { rial: '120000000', pureGoldMg: '0' } },
      payments: { raw: { rial: '30000000', pureGoldMg: '0' } },
      invoiceCount: 1,
    });
    expect(body.partyBalances).toMatchObject({
      debtors: { raw: { rial: '50000000', pureGoldMg: '0' } },
      creditors: { raw: { rial: '-40000000', pureGoldMg: '0' } },
      coinsRemainSeparate: true,
    });
    expect(body.inventory).toMatchObject({
      meltedGoldPureMg: '5000',
      coins: [expect.objectContaining({ count: 3 })],
    });
    const goldRate = BigInt(body.currentMazneh!.goldRatePerGramRial);
    expect(body.today.sales.displayAmount).toBe(
      dualFromRial(100_000_000n, goldRate).pureMg.toString(),
    );
  });

  it('validates the unit parameter and changes only financial presentation', async () => {
    const [gold, rial, invalid] = await Promise.all([
      adapter.getInstance().inject({
        method: 'GET',
        url: '/reporting/dashboard?displayUnit=GOLD',
        headers: headers(ownerA, tenantA),
      }),
      adapter.getInstance().inject({
        method: 'GET',
        url: '/reporting/dashboard?displayUnit=RIAL',
        headers: headers(ownerA, tenantA),
      }),
      adapter.getInstance().inject({
        method: 'GET',
        url: '/reporting/dashboard?displayUnit=SILVER',
        headers: headers(ownerA, tenantA),
      }),
    ]);

    expect(gold.statusCode).toBe(200);
    expect(rial.statusCode).toBe(200);
    const goldBody = gold.json<Dashboard>();
    const rialBody = rial.json<Dashboard>();
    expect(goldBody.today.sales.raw).toEqual(rialBody.today.sales.raw);
    expect(goldBody.today.purchases.raw).toEqual(rialBody.today.purchases.raw);
    expect(goldBody.partyBalances).toEqual(
      expect.objectContaining({
        debtors: expect.objectContaining({ raw: rialBody.partyBalances!.debtors.raw }),
        creditors: expect.objectContaining({ raw: rialBody.partyBalances!.creditors.raw }),
      }),
    );
    expect(goldBody.today.sales.displayAmount).not.toBe(rialBody.today.sales.displayAmount);
    expect(rialBody.today.sales.displayAmount).toBe('100000000');
    expect(invalid.statusCode).toBe(400);
  });
});
