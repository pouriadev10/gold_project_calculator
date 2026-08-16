import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { dualFromRial } from '@gold/core-calc';
import { partyBalancesSchema } from '@gold/contracts';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LedgerAccountsService } from '../src/modules/ledger/ledger-accounts.service';
import { LedgerPostingService } from '../src/modules/ledger/ledger-posting.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { assetDimensions, coinTypes, tenants } from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { PasswordService } from '../src/platform/auth/password.service';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import type { PartyBalances } from '@gold/contracts';
import type { Database } from '../src/platform/database/connect';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const PASSWORD = 'party-balance-password-123';

interface TenantFixture {
  id: string;
  slug: string;
}

interface Member {
  token: string;
}

/** Party balance endpoint — independent raw dimensions and optional gold display projection. */
describe('party multi-asset balances (BE-056)', () => {
  const adapter = new FastifyAdapter();
  const tenantA: TenantFixture = { id: '', slug: `party-balance-a-${randomUUID().slice(0, 12)}` };
  const tenantB: TenantFixture = { id: '', slug: `party-balance-b-${randomUUID().slice(0, 12)}` };
  const at = new Date('2026-06-01T00:00:00.000Z');

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
  let partyAId = '';
  let partyBId = '';
  let referenceQuoteId = '';

  async function makeMember(tenant: TenantFixture): Promise<Member> {
    const user = await users.create({
      email: `${randomUUID().slice(0, 12)}@example.com`,
      displayName: 'Party balance owner',
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
    tenantA.id = (await tenantService.create({ name: 'Party balance A', slug: tenantA.slug })).id;
    tenantB.id = (await tenantService.create({ name: 'Party balance B', slug: tenantB.slug })).id;
    ownerA = await makeMember(tenantA);
    actorId = (
      await users.create({
        email: `${randomUUID().slice(0, 12)}@example.com`,
        displayName: 'Balance posting actor',
      })
    ).id;

    partyAId = (
      await withTenantTransaction(db, tenantA.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenantA.id,
          actorUserId: actorId,
          input: { type: 'CONSUMER', displayName: 'Multi asset party' },
        }),
      )
    ).id;
    partyBId = (
      await withTenantTransaction(db, tenantB.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenantB.id,
          actorUserId: actorId,
          input: { type: 'CONSUMER', displayName: 'Foreign party' },
        }),
      )
    ).id;

    const partyAccounts = await accounts.ensurePartyAccounts({
      tenantId: tenantA.id,
      partyId: partyAId,
    });
    const setup = await withTenantTransaction(db, tenantA.id, async (transaction) => {
      const [cash] = await Promise.all([
        accounts.getRequiredSystemAccountInTransaction(transaction, tenantA.id, 'CASH'),
      ]);
      const dimensions = await transaction
        .select({
          id: assetDimensions.id,
          code: assetDimensions.code,
          coinTypeId: assetDimensions.coinTypeId,
        })
        .from(assetDimensions)
        .where(eq(assetDimensions.tenantId, tenantA.id));
      const tenantCoinTypes = await transaction
        .select({ id: coinTypes.id, code: coinTypes.code })
        .from(coinTypes)
        .where(eq(coinTypes.tenantId, tenantA.id))
        .orderBy(asc(coinTypes.code));
      const rialDimensionId = dimensions.find((dimension) => dimension.code === 'RIAL')?.id;
      const goldDimensionId = dimensions.find((dimension) => dimension.code === 'GOLD')?.id;
      const coinDimensions = tenantCoinTypes.map((coinType) => ({
        coinType,
        dimensionId: dimensions.find((dimension) => dimension.coinTypeId === coinType.id)?.id,
      }));
      if (
        rialDimensionId === undefined ||
        goldDimensionId === undefined ||
        coinDimensions.length < 2 ||
        coinDimensions[0]?.dimensionId === undefined ||
        coinDimensions[1]?.dimensionId === undefined
      ) {
        throw new Error('Required party balance dimensions were not seeded');
      }
      return {
        cashAccountId: cash.id,
        rialDimensionId,
        goldDimensionId,
        coinA: { id: coinDimensions[0].coinType.id, dimensionId: coinDimensions[0].dimensionId },
        coinB: { id: coinDimensions[1].coinType.id, dimensionId: coinDimensions[1].dimensionId },
      };
    });

    await posting.post({
      source: { tenantId: tenantA.id, type: 'SALES_INVOICE', id: randomUUID() },
      effectiveAt: new Date('2026-02-01T00:00:00.000Z'),
      description: 'Credit sale increases receivable',
      createdBy: actorId,
      entries: [
        {
          accountId: partyAccounts.receivable.id,
          dimensionId: setup.rialDimensionId,
          quantity: 100_000_000n,
        },
        {
          accountId: setup.cashAccountId,
          dimensionId: setup.rialDimensionId,
          quantity: -100_000_000n,
        },
      ],
    });
    await posting.post({
      source: { tenantId: tenantA.id, type: 'SECOND_HAND_PURCHASE', id: randomUUID() },
      effectiveAt: new Date('2026-03-01T00:00:00.000Z'),
      description: 'Unpaid purchase becomes payable',
      createdBy: actorId,
      entries: [
        {
          accountId: partyAccounts.payable.id,
          dimensionId: setup.rialDimensionId,
          quantity: -25_000_000n,
        },
        {
          accountId: setup.cashAccountId,
          dimensionId: setup.rialDimensionId,
          quantity: 25_000_000n,
        },
      ],
    });
    await posting.post({
      source: { tenantId: tenantA.id, type: 'SETTLEMENT', id: randomUUID() },
      effectiveAt: new Date('2026-04-01T00:00:00.000Z'),
      description: 'Rial settlement reduces receivable',
      createdBy: actorId,
      entries: [
        {
          accountId: partyAccounts.receivable.id,
          dimensionId: setup.rialDimensionId,
          quantity: -30_000_000n,
        },
        {
          accountId: setup.cashAccountId,
          dimensionId: setup.rialDimensionId,
          quantity: 30_000_000n,
        },
      ],
    });
    await posting.post({
      source: { tenantId: tenantA.id, type: 'SALES_INVOICE', id: randomUUID() },
      effectiveAt: new Date('2026-05-01T00:00:00.000Z'),
      description: 'Independent pure gold position',
      createdBy: actorId,
      entries: [
        {
          accountId: partyAccounts.receivable.id,
          dimensionId: setup.goldDimensionId,
          quantity: 5_000n,
        },
        {
          accountId: partyAccounts.payable.id,
          dimensionId: setup.goldDimensionId,
          quantity: -500n,
        },
        { accountId: setup.cashAccountId, dimensionId: setup.goldDimensionId, quantity: -4_500n },
      ],
    });
    await posting.post({
      source: { tenantId: tenantA.id, type: 'SETTLEMENT', id: randomUUID() },
      effectiveAt: new Date('2026-05-02T00:00:00.000Z'),
      description: 'Coin dimensions remain independent',
      createdBy: actorId,
      entries: [
        {
          accountId: partyAccounts.receivable.id,
          dimensionId: setup.coinA.dimensionId,
          quantity: 3n,
        },
        {
          accountId: partyAccounts.payable.id,
          dimensionId: setup.coinA.dimensionId,
          quantity: -1n,
        },
        { accountId: setup.cashAccountId, dimensionId: setup.coinA.dimensionId, quantity: -2n },
        {
          accountId: partyAccounts.receivable.id,
          dimensionId: setup.coinB.dimensionId,
          quantity: -2n,
        },
        { accountId: setup.cashAccountId, dimensionId: setup.coinB.dimensionId, quantity: 2n },
      ],
    });
    referenceQuoteId = (
      await quotes.createManual({
        tenantId: tenantA.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000_000n,
        createdBy: actorId,
      })
    ).id;
  });

  afterAll(async () => {
    if (tenantA.id !== '') await db.delete(tenants).where(eq(tenants.id, tenantA.id));
    if (tenantB.id !== '') await db.delete(tenants).where(eq(tenants.id, tenantB.id));
    await app.close();
  });

  it('keeps sale, purchase, settlement, gold, and each coin type independent while offering gold display', async () => {
    const response = await adapter.getInstance().inject({
      method: 'GET',
      url: `/parties/${partyAId}/balances?at=${encodeURIComponent(at.toISOString())}&referenceQuoteId=${referenceQuoteId}`,
      headers: headers(ownerA, tenantA),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<PartyBalances>();
    expect(partyBalancesSchema.parse(body)).toEqual(body);
    expect(body).toMatchObject({
      partyId: partyAId,
      calculatedAt: at.toISOString(),
      defaultDisplayUnit: 'GOLD',
      rawBalances: {
        rial: '45000000',
        pureGoldMg: '4500',
        coins: expect.arrayContaining([
          expect.objectContaining({ count: 2 }),
          expect.objectContaining({ count: -2 }),
        ]),
      },
      convertedView: expect.objectContaining({
        displayUnit: 'GOLD',
        referenceMazneh: expect.objectContaining({ id: referenceQuoteId }),
        coinsRemainSeparate: true,
      }),
    });
    const converted = body.convertedView!;
    const expectedRialGold = dualFromRial(
      45_000_000n,
      BigInt(converted.referenceMazneh.goldRatePerGramRial),
    ).pureMg;
    expect(converted.rialEquivalentPureGoldMg).toBe(expectedRialGold.toString());
    expect(converted.totalGoldDisplayPureMg).toBe((4_500n + expectedRialGold).toString());
  });

  it('calculates historical balances by effective time and hides parties from other tenants', async () => {
    const historical = await adapter.getInstance().inject({
      method: 'GET',
      url: `/parties/${partyAId}/balances?at=${encodeURIComponent('2026-02-15T00:00:00.000Z')}`,
      headers: headers(ownerA, tenantA),
    });
    const foreign = await adapter.getInstance().inject({
      method: 'GET',
      url: `/parties/${partyBId}/balances`,
      headers: headers(ownerA, tenantA),
    });

    expect(historical.statusCode).toBe(200);
    expect(historical.json<PartyBalances>().rawBalances).toEqual({
      rial: '100000000',
      pureGoldMg: '0',
      coins: [],
    });
    expect(historical.json<PartyBalances>().convertedView).toBeNull();
    expect(foreign.statusCode).toBe(404);
  });
});
