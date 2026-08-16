import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { profitReportSchema } from '@gold/contracts';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PartiesService } from '../src/modules/parties/parties.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { PasswordService } from '../src/platform/auth/password.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  coinTypes,
  coinTypeVersions,
  salesInvoiceItems,
  salesInvoiceVersions,
  salesInvoices,
  secondHandPurchases,
  tenants,
} from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import type { Database } from '../src/platform/database/connect';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ProfitReport } from '@gold/contracts';

const PASSWORD = 'profit-report-password-123';
const FROM = '2026-01-01T00:00:00.000Z';
const TO = '2026-02-01T00:00:00.000Z';
const SALE_AT = new Date('2026-01-10T12:00:00.000Z');
const BUYBACK_AT = new Date('2026-01-15T12:00:00.000Z');

interface TenantFixture {
  id: string;
  slug: string;
}

interface Member {
  token: string;
}

/**
 * Golden scenario (all source-snapshot amounts are manually calculable):
 *
 * - jewelry: 150,000,000 revenue - 100,000,000 locked gold COGS = 50,000,000 operational
 * - central-bank coin: 440,000,000 revenue - 400,000,000 intrinsic COGS = 40,000,000 bubble
 * - linked B2C buyback: 1 g revalued from 100,000,000 to 200,000,000 = -100,000,000 price effect
 *
 * The chosen immutable settings snapshot makes its locked rate exactly
 * 100,000,000 Rial/g at sale time and 200,000,000 Rial/g at buyback time.
 */
describe('profit report (BE-060)', () => {
  const adapter = new FastifyAdapter();
  const tenant: TenantFixture = { id: '', slug: `profit-report-${randomUUID().slice(0, 12)}` };
  let app: NestFastifyApplication;
  let db: Database;
  let actorId = '';
  let owner: Member;
  let partyId = '';
  let saleQuoteId = '';
  let buybackQuoteId = '';
  let jewelryInvoiceId = '';
  let centralCoinVersionId = '';
  let privateCoinVersionId = '';

  function headers(): Record<string, string> {
    return { authorization: `Bearer ${owner.token}`, 'x-tenant-id': tenant.id };
  }

  async function makeOwner(
    users: UserService,
    passwords: PasswordService,
    memberships: MembershipService,
  ): Promise<Member> {
    const user = await users.create({
      email: `${randomUUID().slice(0, 12)}@example.com`,
      displayName: 'Profit report owner',
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

  async function seedInvoice(input: {
    readonly invoiceNumber: number;
    readonly quoteId: string;
    readonly payableRial: string;
    readonly itemType: 'JEWELRY' | 'COIN';
    readonly itemId: string;
    readonly itemSnapshot: Record<string, string | null>;
    readonly quantity: number;
  }): Promise<string> {
    return withTenantTransaction(db, tenant.id, async (transaction) => {
      const [invoice] = await transaction
        .insert(salesInvoices)
        .values({
          tenantId: tenant.id,
          invoiceNumber: input.invoiceNumber,
          currentVersion: 1,
          status: 'FINALIZED',
          partyId,
          quoteId: input.quoteId,
          quoteAmountRial: 100_000n,
          quoteObservedAt: SALE_AT,
          finalizedAt: SALE_AT,
          createdBy: actorId,
        })
        .returning();
      const [version] = await transaction
        .insert(salesInvoiceVersions)
        .values({
          tenantId: tenant.id,
          salesInvoiceId: invoice!.id,
          version: 1,
          partyId,
          totalsSnapshot: {
            payableRial: input.payableRial,
            goldValueRial: input.itemType === 'JEWELRY' ? '100000000' : '0',
            pureWeightMg: input.itemType === 'JEWELRY' ? '1000' : '0',
          },
          settingsSnapshot: { baseQuoteKarat: '1', mithqalGrams: '1.0000' },
          createdBy: actorId,
        })
        .returning();
      await transaction.insert(salesInvoiceItems).values({
        tenantId: tenant.id,
        salesInvoiceId: invoice!.id,
        salesInvoiceVersionId: version!.id,
        itemType: input.itemType,
        itemId: input.itemId,
        quantity: input.quantity,
        lineSnapshot: input.itemSnapshot,
      });
      return invoice!.id;
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();

    db = app.get<Database>(DRIZZLE);
    const users = app.get(UserService);
    const passwords = app.get(PasswordService);
    const memberships = app.get(MembershipService);
    const tenantService = app.get(TenantService);
    const parties = app.get(PartiesService);
    const quotes = app.get(PriceQuotesService);
    tenant.id = (await tenantService.create({ name: 'Profit report', slug: tenant.slug })).id;
    owner = await makeOwner(users, passwords, memberships);
    actorId = (
      await users.create({
        email: `${randomUUID().slice(0, 12)}@example.com`,
        displayName: 'Profit report actor',
      })
    ).id;
    partyId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenant.id,
          actorUserId: actorId,
          input: { type: 'CONSUMER', displayName: 'Profit report customer' },
        }),
      )
    ).id;
    saleQuoteId = (
      await quotes.createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000n,
        createdBy: actorId,
      })
    ).id;
    buybackQuoteId = (
      await quotes.createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: 200_000n,
        createdBy: actorId,
      })
    ).id;

    const coinIds = await withTenantTransaction(db, tenant.id, async (transaction) => {
      const [central] = await transaction
        .insert(coinTypes)
        .values({ tenantId: tenant.id, code: `CENTRAL-${randomUUID().slice(0, 8)}` })
        .returning();
      const [privateCoin] = await transaction
        .insert(coinTypes)
        .values({ tenantId: tenant.id, code: `PRIVATE-${randomUUID().slice(0, 8)}` })
        .returning();
      const [centralVersion] = await transaction
        .insert(coinTypeVersions)
        .values({
          tenantId: tenant.id,
          coinTypeId: central!.id,
          title: 'Central bank coin',
          mintType: 'CENTRAL_BANK',
          grossWeightUg: 1_000_000n,
          karat: 1000,
          isCentralBankMinted: true,
          validFrom: SALE_AT,
          version: 1,
          active: true,
        })
        .returning();
      const [privateVersion] = await transaction
        .insert(coinTypeVersions)
        .values({
          tenantId: tenant.id,
          coinTypeId: privateCoin!.id,
          title: 'Private coin',
          mintType: 'PRIVATE_MINT',
          grossWeightUg: 1_000_000n,
          karat: 1000,
          isCentralBankMinted: false,
          validFrom: SALE_AT,
          version: 1,
          active: true,
        })
        .returning();
      return {
        centralTypeId: central!.id,
        privateTypeId: privateCoin!.id,
        centralVersionId: centralVersion!.id,
        privateVersionId: privateVersion!.id,
      };
    });
    centralCoinVersionId = coinIds.centralVersionId;
    privateCoinVersionId = coinIds.privateVersionId;

    jewelryInvoiceId = await seedInvoice({
      invoiceNumber: 1,
      quoteId: saleQuoteId,
      payableRial: '150000000',
      itemType: 'JEWELRY',
      itemId: randomUUID(),
      itemSnapshot: { pureWeightMg: '1000' },
      quantity: 1,
    });
    await seedInvoice({
      invoiceNumber: 2,
      quoteId: saleQuoteId,
      payableRial: '440000000',
      itemType: 'COIN',
      itemId: coinIds.centralTypeId,
      itemSnapshot: {
        coinTypeVersionId: centralCoinVersionId,
        intrinsicValueRial: '200000000',
        bubbleRial: '20000000',
      },
      quantity: 2,
    });
    await seedInvoice({
      invoiceNumber: 3,
      quoteId: saleQuoteId,
      payableRial: '200000000',
      itemType: 'COIN',
      itemId: coinIds.privateTypeId,
      itemSnapshot: {
        coinTypeVersionId: privateCoinVersionId,
        intrinsicValueRial: '200000000',
        bubbleRial: '999999999',
      },
      quantity: 1,
    });
    await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction.insert(secondHandPurchases).values({
        tenantId: tenant.id,
        partyId,
        sourceInvoiceId: jewelryInvoiceId,
        lockedQuoteId: buybackQuoteId,
        lockedQuoteAmountRial: 200_000n,
        lockedQuoteObservedAt: BUYBACK_AT,
        settingsSnapshot: { goldRatePerGramRial: '200000000' },
        sellerIdentitySnapshot: { partyType: 'CONSUMER' },
        feeRial: 0n,
        finalAmountRial: 200_000_000n,
        effectiveAt: BUYBACK_AT,
        finalizedAt: BUYBACK_AT,
        createdBy: actorId,
      }),
    );
  });

  afterAll(async () => {
    if (tenant.id !== '') await db.delete(tenants).where(eq(tenants.id, tenant.id));
    await app.close();
  });

  it('returns the hand-calculated operating, gold-price, and central-bank bubble components in both scales', async () => {
    const response = await adapter.getInstance().inject({
      method: 'GET',
      url: `/reporting/profit?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
      headers: headers(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ProfitReport>();
    expect(profitReportSchema.parse(body)).toEqual(body);
    expect(body).toMatchObject({
      revenue: { rial: '790000000', goldEquivalentMg: '7900' },
      costOfGoods: { rial: '700000000', goldEquivalentMg: '7000' },
      grossProfit: { rial: '90000000', goldEquivalentMg: '900' },
      operatingProfit: { rial: '50000000', goldEquivalentMg: '500' },
      goldPriceEffect: { rial: '-100000000', goldEquivalentMg: '-500' },
      coinBubbleEffect: { rial: '40000000', goldEquivalentMg: '400' },
      totalProfit: { rial: '-10000000', goldEquivalentMg: '400' },
    });
  });

  it('does not let a newly entered mazneh rewrite the historical report', async () => {
    const before = await adapter.getInstance().inject({
      method: 'GET',
      url: `/reporting/profit?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
      headers: headers(),
    });
    expect(before.statusCode).toBe(200);

    const quotes = app.get(PriceQuotesService);
    await quotes.createManual({
      tenantId: tenant.id,
      quoteType: 'MAZNEH',
      amountRial: 999_999_999n,
      createdBy: actorId,
    });

    const after = await adapter.getInstance().inject({
      method: 'GET',
      url: `/reporting/profit?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
      headers: headers(),
    });
    expect(after.statusCode).toBe(200);
    expect(after.json<ProfitReport>()).toEqual(before.json<ProfitReport>());
  });

  it('rejects an invalid time range before reading any tenant data', async () => {
    const response = await adapter.getInstance().inject({
      method: 'GET',
      url: `/reporting/profit?from=${encodeURIComponent(TO)}&to=${encodeURIComponent(FROM)}`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(400);
  });

  it('keeps the source rows immutable while querying the report', async () => {
    const sources = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select({ id: salesInvoices.id, currentVersion: salesInvoices.currentVersion })
        .from(salesInvoices)
        .where(and(eq(salesInvoices.tenantId, tenant.id), eq(salesInvoices.id, jewelryInvoiceId))),
    );
    expect(sources).toEqual([{ id: jewelryInvoiceId, currentVersion: 1 }]);
  });
});
