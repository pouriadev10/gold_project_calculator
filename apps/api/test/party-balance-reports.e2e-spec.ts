import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { dualFromPure, dualFromRial } from '@gold/core-calc';
import { partyBalanceReportSchema } from '@gold/contracts';
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
import { assetDimensions, coinTypes, tenants } from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import type { PartyBalanceReport } from '@gold/contracts';
import type { Database } from '../src/platform/database/connect';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const PASSWORD = 'party-report-password-123';

interface TenantFixture {
  id: string;
  slug: string;
}

interface Member {
  token: string;
}

interface TenantLedgerSetup {
  readonly cashAccountId: string;
  readonly rialDimensionId: string;
  readonly goldDimensionId: string;
  readonly coinDimensionId: string;
  readonly receivableAccountId: string;
  readonly payableAccountId: string;
}

/** Debtor/creditor report projections keep raw dimensions tenant-isolated (BE-058). */
describe('party balance reports (BE-058)', () => {
  const adapter = new FastifyAdapter();
  const tenantA: TenantFixture = { id: '', slug: `party-report-a-${randomUUID().slice(0, 12)}` };
  const tenantB: TenantFixture = { id: '', slug: `party-report-b-${randomUUID().slice(0, 12)}` };

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
  let debtorId = '';
  let creditorId = '';
  let coinDebtorId = '';
  let coinCreditorId = '';
  let referenceQuoteId = '';
  let foreignQuoteId = '';

  async function makeMember(tenant: TenantFixture): Promise<Member> {
    const user = await users.create({
      email: `${randomUUID().slice(0, 12)}@example.com`,
      displayName: 'Party report owner',
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

  async function createParty(tenant: TenantFixture, displayName: string): Promise<string> {
    return (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenant.id,
          actorUserId: actorId,
          input: { type: 'CONSUMER', displayName },
        }),
      )
    ).id;
  }

  async function setupLedger(tenant: TenantFixture, partyId: string): Promise<TenantLedgerSetup> {
    const partyAccounts = await accounts.ensurePartyAccounts({ tenantId: tenant.id, partyId });
    return withTenantTransaction(db, tenant.id, async (transaction) => {
      const cash = await accounts.getRequiredSystemAccountInTransaction(
        transaction,
        tenant.id,
        'CASH',
      );
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
        coinDimensionId === undefined
      ) {
        throw new Error('Required report dimensions were not seeded');
      }

      return {
        cashAccountId: cash.id,
        rialDimensionId,
        goldDimensionId,
        coinDimensionId,
        receivableAccountId: partyAccounts.receivable.id,
        payableAccountId: partyAccounts.payable.id,
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
    tenantA.id = (await tenantService.create({ name: 'Party report A', slug: tenantA.slug })).id;
    tenantB.id = (await tenantService.create({ name: 'Party report B', slug: tenantB.slug })).id;
    ownerA = await makeMember(tenantA);
    actorId = (
      await users.create({
        email: `${randomUUID().slice(0, 12)}@example.com`,
        displayName: 'Report posting actor',
      })
    ).id;

    debtorId = await createParty(tenantA, 'Debtor Alpha');
    creditorId = await createParty(tenantA, 'Creditor Beta');
    coinDebtorId = await createParty(tenantA, 'Coin debtor');
    coinCreditorId = await createParty(tenantA, 'Coin creditor');
    const foreignPartyId = await createParty(tenantB, 'Foreign huge debtor');
    const [debtorSetup, creditorSetup, coinDebtorSetup, coinCreditorSetup, foreignSetup] =
      await Promise.all([
        setupLedger(tenantA, debtorId),
        setupLedger(tenantA, creditorId),
        setupLedger(tenantA, coinDebtorId),
        setupLedger(tenantA, coinCreditorId),
        setupLedger(tenantB, foreignPartyId),
      ]);

    const [referenceQuote, foreignQuote] = await Promise.all([
      quotes.createManual({
        tenantId: tenantA.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000_000n,
        createdBy: actorId,
      }),
      quotes.createManual({
        tenantId: tenantB.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000_000n,
        createdBy: actorId,
      }),
    ]);
    referenceQuoteId = referenceQuote.id;
    foreignQuoteId = foreignQuote.id;

    await Promise.all([
      posting.post({
        source: { tenantId: tenantA.id, type: 'OPENING_BALANCE', id: randomUUID() },
        effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
        description: 'Convertible debtor balance',
        createdBy: actorId,
        entries: [
          {
            accountId: debtorSetup.receivableAccountId,
            dimensionId: debtorSetup.rialDimensionId,
            quantity: 100_000_000n,
          },
          {
            accountId: debtorSetup.cashAccountId,
            dimensionId: debtorSetup.rialDimensionId,
            quantity: -100_000_000n,
          },
          {
            accountId: debtorSetup.receivableAccountId,
            dimensionId: debtorSetup.goldDimensionId,
            quantity: 1_000n,
          },
          {
            accountId: debtorSetup.cashAccountId,
            dimensionId: debtorSetup.goldDimensionId,
            quantity: -1_000n,
          },
          {
            accountId: debtorSetup.receivableAccountId,
            dimensionId: debtorSetup.coinDimensionId,
            quantity: 2n,
          },
          {
            accountId: debtorSetup.cashAccountId,
            dimensionId: debtorSetup.coinDimensionId,
            quantity: -2n,
          },
        ],
      }),
      posting.post({
        source: { tenantId: tenantA.id, type: 'OPENING_BALANCE', id: randomUUID() },
        effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
        description: 'Convertible creditor balance',
        createdBy: actorId,
        entries: [
          {
            accountId: creditorSetup.payableAccountId,
            dimensionId: creditorSetup.rialDimensionId,
            quantity: -75_000_000n,
          },
          {
            accountId: creditorSetup.cashAccountId,
            dimensionId: creditorSetup.rialDimensionId,
            quantity: 75_000_000n,
          },
          {
            accountId: creditorSetup.payableAccountId,
            dimensionId: creditorSetup.coinDimensionId,
            quantity: -1n,
          },
          {
            accountId: creditorSetup.cashAccountId,
            dimensionId: creditorSetup.coinDimensionId,
            quantity: 1n,
          },
        ],
      }),
      posting.post({
        source: { tenantId: tenantA.id, type: 'OPENING_BALANCE', id: randomUUID() },
        effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
        description: 'Coin-only debtor remains a separate count',
        createdBy: actorId,
        entries: [
          {
            accountId: coinDebtorSetup.receivableAccountId,
            dimensionId: coinDebtorSetup.coinDimensionId,
            quantity: 3n,
          },
          {
            accountId: coinDebtorSetup.cashAccountId,
            dimensionId: coinDebtorSetup.coinDimensionId,
            quantity: -3n,
          },
        ],
      }),
      posting.post({
        source: { tenantId: tenantA.id, type: 'OPENING_BALANCE', id: randomUUID() },
        effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
        description: 'Coin-only creditor remains a separate count',
        createdBy: actorId,
        entries: [
          {
            accountId: coinCreditorSetup.payableAccountId,
            dimensionId: coinCreditorSetup.coinDimensionId,
            quantity: -4n,
          },
          {
            accountId: coinCreditorSetup.cashAccountId,
            dimensionId: coinCreditorSetup.coinDimensionId,
            quantity: 4n,
          },
        ],
      }),
      posting.post({
        source: { tenantId: tenantB.id, type: 'OPENING_BALANCE', id: randomUUID() },
        effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
        description: 'Foreign tenant balance must never leak',
        createdBy: actorId,
        entries: [
          {
            accountId: foreignSetup.receivableAccountId,
            dimensionId: foreignSetup.rialDimensionId,
            quantity: 999_000_000n,
          },
          {
            accountId: foreignSetup.cashAccountId,
            dimensionId: foreignSetup.rialDimensionId,
            quantity: -999_000_000n,
          },
        ],
      }),
    ]);
  });

  afterAll(async () => {
    if (tenantA.id !== '') await db.delete(tenants).where(eq(tenants.id, tenantA.id));
    if (tenantB.id !== '') await db.delete(tenants).where(eq(tenants.id, tenantB.id));
    if (app !== undefined) await app.close();
  });

  it('separates debtors and creditors while keeping raw coin positions independent', async () => {
    const [debtors, creditors] = await Promise.all([
      adapter.getInstance().inject({
        method: 'GET',
        url: `/reporting/debtors?referenceQuoteId=${referenceQuoteId}&displayUnit=GOLD`,
        headers: headers(ownerA, tenantA),
      }),
      adapter.getInstance().inject({
        method: 'GET',
        url: `/reporting/creditors?referenceQuoteId=${referenceQuoteId}&displayUnit=GOLD`,
        headers: headers(ownerA, tenantA),
      }),
    ]);

    expect(debtors.statusCode).toBe(200);
    expect(creditors.statusCode).toBe(200);
    const debtorBody = debtors.json<PartyBalanceReport>();
    const creditorBody = creditors.json<PartyBalanceReport>();
    expect(partyBalanceReportSchema.parse(debtorBody)).toEqual(debtorBody);
    expect(partyBalanceReportSchema.parse(creditorBody)).toEqual(creditorBody);
    expect(debtorBody.items.map((item) => item.party.id)).toEqual([debtorId, coinDebtorId]);
    expect(creditorBody.items.map((item) => item.party.id)).toEqual([creditorId, coinCreditorId]);
    expect(debtorBody.items[0]).toMatchObject({
      party: { id: debtorId },
      rawBalances: { rial: '100000000', pureGoldMg: '1000', coins: [{ count: 2 }] },
      convertibleDirection: 'DEBTOR',
      coinsRemainSeparate: true,
    });
    expect(creditorBody.items[0]).toMatchObject({
      party: { id: creditorId },
      rawBalances: { rial: '-75000000', pureGoldMg: '0', coins: [{ count: -1 }] },
      convertibleDirection: 'CREDITOR',
      coinsRemainSeparate: true,
    });
    expect(debtorBody.items[1]).toMatchObject({
      party: { id: coinDebtorId },
      displayBalance: '0',
      convertibleDirection: 'SETTLED',
      rawBalances: { coins: [{ count: 3 }] },
    });
  });

  it('changes only presentation while retaining report membership, raw dimensions, paging, search, and tenant boundaries', async () => {
    const [gold, rial, searched, secondPage, foreignQuote] = await Promise.all([
      adapter.getInstance().inject({
        method: 'GET',
        url: `/reporting/debtors?referenceQuoteId=${referenceQuoteId}&displayUnit=GOLD`,
        headers: headers(ownerA, tenantA),
      }),
      adapter.getInstance().inject({
        method: 'GET',
        url: `/reporting/debtors?referenceQuoteId=${referenceQuoteId}&displayUnit=RIAL`,
        headers: headers(ownerA, tenantA),
      }),
      adapter.getInstance().inject({
        method: 'GET',
        url: `/reporting/debtors?referenceQuoteId=${referenceQuoteId}&search=${encodeURIComponent('Alpha')}`,
        headers: headers(ownerA, tenantA),
      }),
      adapter.getInstance().inject({
        method: 'GET',
        url: `/reporting/debtors?referenceQuoteId=${referenceQuoteId}&limit=1&offset=1`,
        headers: headers(ownerA, tenantA),
      }),
      adapter.getInstance().inject({
        method: 'GET',
        url: `/reporting/debtors?referenceQuoteId=${foreignQuoteId}`,
        headers: headers(ownerA, tenantA),
      }),
    ]);

    expect(gold.statusCode).toBe(200);
    expect(rial.statusCode).toBe(200);
    const goldBody = gold.json<PartyBalanceReport>();
    const rialBody = rial.json<PartyBalanceReport>();
    expect(goldBody.items.map((item) => item.party.id)).toEqual(
      rialBody.items.map((item) => item.party.id),
    );
    expect(goldBody.items.map((item) => item.rawBalances)).toEqual(
      rialBody.items.map((item) => item.rawBalances),
    );
    const goldRate = BigInt(goldBody.referenceMazneh.goldRatePerGramRial);
    const convertibleGold = goldBody.items[0]!;
    expect(convertibleGold.displayBalance).toBe(
      (1_000n + dualFromRial(100_000_000n, goldRate).pureMg).toString(),
    );
    expect(rialBody.items[0]!.displayBalance).toBe(
      (100_000_000n + dualFromPure(1_000n, goldRate).rial).toString(),
    );
    expect(searched.statusCode).toBe(200);
    expect(searched.json<PartyBalanceReport>()).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ party: expect.objectContaining({ id: debtorId }) })],
    });
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json<PartyBalanceReport>()).toMatchObject({
      total: 2,
      limit: 1,
      offset: 1,
      items: [expect.objectContaining({ party: expect.objectContaining({ id: coinDebtorId }) })],
    });
    expect(foreignQuote.statusCode).toBe(404);
  });
});
