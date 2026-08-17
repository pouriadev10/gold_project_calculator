import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { partyStatementSchema } from '@gold/contracts';
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
  salesInvoiceVersions,
  salesInvoices,
  secondHandPurchases,
  settlementLines,
  settlements,
  tenants,
} from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import type { PartyStatement } from '@gold/contracts';
import type { Database } from '../src/platform/database/connect';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const PASSWORD = 'party-statement-password-123';
const SALES_AT = new Date('2026-01-02T00:00:00.000Z');
const PURCHASE_AT = new Date('2026-01-03T00:00:00.000Z');
const SETTLEMENT_AT = new Date('2026-01-04T00:00:00.000Z');
const GOLD_AT = new Date('2026-01-05T00:00:00.000Z');
const COIN_AT = new Date('2026-01-06T00:00:00.000Z');

interface TenantFixture {
  id: string;
  slug: string;
}

interface Member {
  token: string;
}

/** Immutable, dimension-by-dimension party subledger statement (BE-057). */
describe('party statements (BE-057)', () => {
  const adapter = new FastifyAdapter();
  const tenantA: TenantFixture = { id: '', slug: `party-statement-a-${randomUUID().slice(0, 12)}` };
  const tenantB: TenantFixture = { id: '', slug: `party-statement-b-${randomUUID().slice(0, 12)}` };

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
  let rialDimensionId = '';
  let goldDimensionId = '';
  let coinDimensionId = '';
  let salesQuoteId = '';
  let settlementQuoteId = '';
  let displayQuoteId = '';
  let salesInvoiceId = '';
  let secondHandPurchaseId = '';
  let foreignSalesInvoiceId = '';
  let foreignSecondHandPurchaseId = '';

  async function makeMember(tenant: TenantFixture): Promise<Member> {
    const user = await users.create({
      email: `${randomUUID().slice(0, 12)}@example.com`,
      displayName: 'Party statement owner',
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

  function renderedPdfText(body: string): string {
    const cmap = Buffer.from(body, 'binary')
      .toString('ascii')
      .match(/begincidchar\n([\s\S]*?)\nendcidchar/);
    if (cmap === null) return '';
    return [...cmap[1]!.matchAll(/<[0-9A-F]{4}> <([0-9A-F]{4})>/g)]
      .map((match) => String.fromCodePoint(Number.parseInt(match[1]!, 16)))
      .join('');
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
    tenantA.id = (await tenantService.create({ name: 'Party statement A', slug: tenantA.slug })).id;
    tenantB.id = (await tenantService.create({ name: 'Party statement B', slug: tenantB.slug })).id;
    ownerA = await makeMember(tenantA);
    actorId = (
      await users.create({
        email: `${randomUUID().slice(0, 12)}@example.com`,
        displayName: 'Statement posting actor',
      })
    ).id;

    partyAId = (
      await withTenantTransaction(db, tenantA.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenantA.id,
          actorUserId: actorId,
          input: { type: 'CONSUMER', displayName: 'Statement party' },
        }),
      )
    ).id;
    partyBId = (
      await withTenantTransaction(db, tenantB.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenantB.id,
          actorUserId: actorId,
          input: { type: 'CONSUMER', displayName: 'Foreign statement party' },
        }),
      )
    ).id;

    const partyAccounts = await accounts.ensurePartyAccounts({
      tenantId: tenantA.id,
      partyId: partyAId,
    });
    const setup = await withTenantTransaction(db, tenantA.id, async (transaction) => {
      const cash = await accounts.getRequiredSystemAccountInTransaction(
        transaction,
        tenantA.id,
        'CASH',
      );
      const dimensions = await transaction
        .select({
          id: assetDimensions.id,
          code: assetDimensions.code,
          coinTypeId: assetDimensions.coinTypeId,
        })
        .from(assetDimensions)
        .where(eq(assetDimensions.tenantId, tenantA.id));
      const [coinType] = await transaction
        .select({ id: coinTypes.id })
        .from(coinTypes)
        .where(eq(coinTypes.tenantId, tenantA.id))
        .orderBy(asc(coinTypes.code))
        .limit(1);
      const rial = dimensions.find((dimension) => dimension.code === 'RIAL')?.id;
      const gold = dimensions.find((dimension) => dimension.code === 'GOLD')?.id;
      const coin = dimensions.find((dimension) => dimension.coinTypeId === coinType?.id)?.id;
      if (rial === undefined || gold === undefined || coin === undefined) {
        throw new Error('Required statement dimensions were not seeded');
      }

      return { cashAccountId: cash.id, rial, gold, coin };
    });
    rialDimensionId = setup.rial;
    goldDimensionId = setup.gold;
    coinDimensionId = setup.coin;

    const [salesQuote, purchaseQuote, settlementQuote, displayQuote] = await Promise.all([
      quotes.createManual({
        tenantId: tenantA.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000_000n,
        createdBy: actorId,
      }),
      quotes.createManual({
        tenantId: tenantA.id,
        quoteType: 'MAZNEH',
        amountRial: 90_000_000n,
        createdBy: actorId,
      }),
      quotes.createManual({
        tenantId: tenantA.id,
        quoteType: 'MAZNEH',
        amountRial: 110_000_000n,
        createdBy: actorId,
      }),
      quotes.createManual({
        tenantId: tenantA.id,
        quoteType: 'MAZNEH',
        amountRial: 200_000_000n,
        createdBy: actorId,
      }),
    ]);
    salesQuoteId = salesQuote.id;
    settlementQuoteId = settlementQuote.id;
    displayQuoteId = displayQuote.id;
    const foreignQuote = await quotes.createManual({
      tenantId: tenantB.id,
      quoteType: 'MAZNEH',
      amountRial: 80_000_000n,
      createdBy: actorId,
    });

    salesInvoiceId = randomUUID();
    secondHandPurchaseId = randomUUID();
    foreignSalesInvoiceId = randomUUID();
    foreignSecondHandPurchaseId = randomUUID();
    const settlementId = randomUUID();
    await withTenantTransaction(db, tenantA.id, async (transaction) => {
      await transaction.insert(salesInvoices).values({
        id: salesInvoiceId,
        tenantId: tenantA.id,
        invoiceNumber: 1,
        currentVersion: 1,
        status: 'FINALIZED',
        partyId: partyAId,
        quoteId: salesQuote.id,
        quoteAmountRial: salesQuote.amountRial,
        quoteObservedAt: salesQuote.observedAt,
        finalizedAt: SALES_AT,
        createdBy: actorId,
      });
      await transaction.insert(salesInvoiceVersions).values({
        tenantId: tenantA.id,
        salesInvoiceId,
        version: 1,
        partyId: partyAId,
        totalsSnapshot: { payableRial: '100000000' },
        settingsSnapshot: { goldRatePerGramRial: '307801100' },
        createdBy: actorId,
      });
      await transaction.insert(secondHandPurchases).values({
        id: secondHandPurchaseId,
        tenantId: tenantA.id,
        partyId: partyAId,
        lockedQuoteId: purchaseQuote.id,
        lockedQuoteAmountRial: purchaseQuote.amountRial,
        lockedQuoteObservedAt: purchaseQuote.observedAt,
        settingsSnapshot: { purchaseKarat: '740', amountRial: '25000000' },
        sellerIdentitySnapshot: {},
        feeRial: 0n,
        finalAmountRial: 25_000_000n,
        effectiveAt: PURCHASE_AT,
        finalizedAt: PURCHASE_AT,
        createdBy: actorId,
      });
      await transaction.insert(settlements).values({
        id: settlementId,
        tenantId: tenantA.id,
        partyId: partyAId,
        status: 'FINALIZED',
        effectiveAt: SETTLEMENT_AT,
        finalizedAt: SETTLEMENT_AT,
        createdBy: actorId,
      });
      await transaction.insert(settlementLines).values([
        {
          tenantId: tenantA.id,
          settlementId,
          lineType: 'RIAL',
          dimensionId: rialDimensionId,
          quantity: 20_000_000n,
          sourceAccountId: partyAccounts.receivable.id,
          destinationAccountId: setup.cashAccountId,
          lockedQuoteId: salesQuote.id,
          lockedQuoteAmountRial: salesQuote.amountRial,
          lockedConversionSnapshot: { quoteObservedAt: salesQuote.observedAt.toISOString() },
        },
        {
          tenantId: tenantA.id,
          settlementId,
          lineType: 'RIAL',
          dimensionId: rialDimensionId,
          quantity: 10_000_000n,
          sourceAccountId: partyAccounts.receivable.id,
          destinationAccountId: setup.cashAccountId,
          lockedQuoteId: settlementQuote.id,
          lockedQuoteAmountRial: settlementQuote.amountRial,
          lockedConversionSnapshot: { quoteObservedAt: settlementQuote.observedAt.toISOString() },
        },
      ]);
    });

    await posting.post({
      source: { tenantId: tenantA.id, type: 'SALES_INVOICE', id: salesInvoiceId },
      effectiveAt: SALES_AT,
      description: 'Credit sale increases receivable',
      createdBy: actorId,
      entries: [
        {
          accountId: partyAccounts.receivable.id,
          dimensionId: rialDimensionId,
          quantity: 100_000_000n,
        },
        { accountId: setup.cashAccountId, dimensionId: rialDimensionId, quantity: -100_000_000n },
      ],
    });
    await posting.post({
      source: { tenantId: tenantA.id, type: 'SECOND_HAND_PURCHASE', id: secondHandPurchaseId },
      effectiveAt: PURCHASE_AT,
      description: 'Unpaid second-hand purchase becomes payable',
      createdBy: actorId,
      entries: [
        {
          accountId: partyAccounts.payable.id,
          dimensionId: rialDimensionId,
          quantity: -25_000_000n,
        },
        { accountId: setup.cashAccountId, dimensionId: rialDimensionId, quantity: 25_000_000n },
      ],
    });
    await posting.post({
      source: { tenantId: tenantA.id, type: 'SETTLEMENT', id: settlementId },
      effectiveAt: SETTLEMENT_AT,
      description: 'Two locked settlement rates remain attached to this event',
      createdBy: actorId,
      entries: [
        {
          accountId: partyAccounts.receivable.id,
          dimensionId: rialDimensionId,
          quantity: -30_000_000n,
        },
        { accountId: setup.cashAccountId, dimensionId: rialDimensionId, quantity: 30_000_000n },
      ],
    });
    await posting.post({
      source: { tenantId: tenantA.id, type: 'OPENING_BALANCE', id: randomUUID() },
      effectiveAt: GOLD_AT,
      description: 'Pure gold remains an independent dimension',
      createdBy: actorId,
      entries: [
        { accountId: partyAccounts.receivable.id, dimensionId: goldDimensionId, quantity: 5_000n },
        { accountId: setup.cashAccountId, dimensionId: goldDimensionId, quantity: -5_000n },
      ],
    });
    await posting.post({
      source: { tenantId: tenantA.id, type: 'OPENING_BALANCE', id: randomUUID() },
      effectiveAt: COIN_AT,
      description: 'Coin count remains an independent dimension',
      createdBy: actorId,
      entries: [
        { accountId: partyAccounts.receivable.id, dimensionId: coinDimensionId, quantity: 3n },
        { accountId: setup.cashAccountId, dimensionId: coinDimensionId, quantity: -3n },
      ],
    });
    await withTenantTransaction(db, tenantB.id, async (transaction) => {
      await transaction.insert(salesInvoices).values({
        id: foreignSalesInvoiceId,
        tenantId: tenantB.id,
        invoiceNumber: 1,
        currentVersion: 1,
        status: 'FINALIZED',
        partyId: partyBId,
        quoteId: foreignQuote.id,
        quoteAmountRial: foreignQuote.amountRial,
        quoteObservedAt: foreignQuote.observedAt,
        finalizedAt: SALES_AT,
        createdBy: actorId,
      });
      await transaction.insert(salesInvoiceVersions).values({
        tenantId: tenantB.id,
        salesInvoiceId: foreignSalesInvoiceId,
        version: 1,
        partyId: partyBId,
        totalsSnapshot: { payableRial: '80000000' },
        settingsSnapshot: { goldRatePerGramRial: '246240880' },
        createdBy: actorId,
      });
      await transaction.insert(secondHandPurchases).values({
        id: foreignSecondHandPurchaseId,
        tenantId: tenantB.id,
        partyId: partyBId,
        lockedQuoteId: foreignQuote.id,
        lockedQuoteAmountRial: foreignQuote.amountRial,
        lockedQuoteObservedAt: foreignQuote.observedAt,
        settingsSnapshot: { purchaseKarat: '740', amountRial: '25000000' },
        sellerIdentitySnapshot: {},
        feeRial: 0n,
        finalAmountRial: 25_000_000n,
        effectiveAt: PURCHASE_AT,
        finalizedAt: PURCHASE_AT,
        createdBy: actorId,
      });
    });
  });

  afterAll(async () => {
    if (tenantA.id !== '') await db.delete(tenants).where(eq(tenants.id, tenantA.id));
    if (tenantB.id !== '') await db.delete(tenants).where(eq(tenants.id, tenantB.id));
    await app.close();
  });

  it('projects all party transactions with independent running balances and immutable document rates', async () => {
    const response = await adapter.getInstance().inject({
      method: 'GET',
      url: `/parties/${partyAId}/statement?to=${encodeURIComponent('2026-01-07T00:00:00.000Z')}&referenceQuoteId=${displayQuoteId}`,
      headers: headers(ownerA, tenantA),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<PartyStatement>();
    expect(partyStatementSchema.parse(body)).toEqual(body);
    expect(body.total).toBe(5);
    expect(body.items.map((item) => item.source.type)).toEqual([
      'SALES_INVOICE',
      'SECOND_HAND_PURCHASE',
      'SETTLEMENT',
      'OPENING_BALANCE',
      'OPENING_BALANCE',
    ]);
    expect(body.items.map((item) => [item.dimension.kind, item.runningBalance])).toEqual([
      ['RIAL', '100000000'],
      ['RIAL', '75000000'],
      ['RIAL', '45000000'],
      ['GOLD', '5000'],
      ['COIN', '3'],
    ]);

    const sale = body.items[0]!;
    const settlement = body.items[2]!;
    expect(sale.documentRateSnapshots).toEqual([
      expect.objectContaining({ quoteId: salesQuoteId, quoteAmountRial: '100000000' }),
    ]);
    expect(settlement.documentRateSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ quoteId: salesQuoteId, quoteAmountRial: '100000000' }),
        expect.objectContaining({ quoteId: settlementQuoteId, quoteAmountRial: '110000000' }),
      ]),
    );
    expect(settlement.documentRateSnapshots).toHaveLength(2);
    expect(body.displayReferenceMazneh).toMatchObject({
      id: displayQuoteId,
      amountRial: '200000000',
    });
  });

  it('exports tenant-scoped sales, purchase, and statement PDFs from locked source snapshots', async () => {
    const [salesPdf, purchasePdf, statementPdf, foreignSalesPdf, foreignPurchasePdf, foreignStatement] =
      await Promise.all([
        adapter.getInstance().inject({
          method: 'GET',
          url: `/sales/invoices/${salesInvoiceId}/pdf`,
          headers: headers(ownerA, tenantA),
        }),
        adapter.getInstance().inject({
          method: 'GET',
          url: `/purchase/second-hand/${secondHandPurchaseId}/pdf`,
          headers: headers(ownerA, tenantA),
        }),
        adapter.getInstance().inject({
          method: 'GET',
          url: `/parties/${partyAId}/statement/pdf`,
          headers: headers(ownerA, tenantA),
        }),
        adapter.getInstance().inject({
          method: 'GET',
          url: `/parties/${partyBId}/statement/pdf`,
          headers: headers(ownerA, tenantA),
        }),
        adapter.getInstance().inject({
          method: 'GET',
          url: `/sales/invoices/${foreignSalesInvoiceId}/pdf`,
          headers: headers(ownerA, tenantA),
        }),
        adapter.getInstance().inject({
          method: 'GET',
          url: `/purchase/second-hand/${foreignSecondHandPurchaseId}/pdf`,
          headers: headers(ownerA, tenantA),
        }),
      ]);

    for (const response of [salesPdf, purchasePdf, statementPdf]) {
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['content-disposition']).toContain('attachment;');
      expect(Buffer.from(response.body, 'binary').subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(Buffer.from(response.body, 'binary').toString('ascii')).toContain('/ToUnicode');
    }
    expect(renderedPdfText(salesPdf.body)).toContain('307801100');
    expect(renderedPdfText(purchasePdf.body)).toContain('۰۰۰٬۰۰۰٬۹۰');
    expect(renderedPdfText(statementPdf.body)).toContain('100000000');
    expect(foreignSalesPdf.statusCode).toBe(404);
    expect(foreignPurchasePdf.statusCode).toBe(404);
    expect(foreignStatement.statusCode).toBe(404);
  });

  it('computes balances before applying range, source, dimension, and pagination filters', async () => {
    const [historical, settlementOnly, rialOnly, secondPage, foreign] = await Promise.all([
      adapter.getInstance().inject({
        method: 'GET',
        url: `/parties/${partyAId}/statement?from=${encodeURIComponent(PURCHASE_AT.toISOString())}&to=${encodeURIComponent('2026-01-07T00:00:00.000Z')}`,
        headers: headers(ownerA, tenantA),
      }),
      adapter.getInstance().inject({
        method: 'GET',
        url: `/parties/${partyAId}/statement?sourceType=SETTLEMENT`,
        headers: headers(ownerA, tenantA),
      }),
      adapter.getInstance().inject({
        method: 'GET',
        url: `/parties/${partyAId}/statement?dimensionId=${rialDimensionId}`,
        headers: headers(ownerA, tenantA),
      }),
      adapter.getInstance().inject({
        method: 'GET',
        url: `/parties/${partyAId}/statement?limit=1&offset=1`,
        headers: headers(ownerA, tenantA),
      }),
      adapter.getInstance().inject({
        method: 'GET',
        url: `/parties/${partyBId}/statement`,
        headers: headers(ownerA, tenantA),
      }),
    ]);

    expect(historical.statusCode).toBe(200);
    expect(historical.json<PartyStatement>().items[0]).toMatchObject({
      source: { type: 'SECOND_HAND_PURCHASE' },
      runningBalance: '75000000',
    });
    expect(settlementOnly.statusCode).toBe(200);
    expect(settlementOnly.json<PartyStatement>().items).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ type: 'SETTLEMENT' }),
        runningBalance: '45000000',
      }),
    ]);
    expect(rialOnly.statusCode).toBe(200);
    expect(rialOnly.json<PartyStatement>().items).toHaveLength(3);
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json<PartyStatement>()).toMatchObject({
      total: 5,
      limit: 1,
      offset: 1,
      items: [
        expect.objectContaining({
          source: expect.objectContaining({ type: 'SECOND_HAND_PURCHASE' }),
        }),
      ],
    });
    expect(foreign.statusCode).toBe(404);
  });
});
