import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { OpeningBalancesService } from '../src/modules/inventory/opening-balances.service';
import { JewelryItemsService } from '../src/modules/inventory/jewelry-items.service';
import { InventoryMovementsService } from '../src/modules/inventory/inventory-movements.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { JewelryCashSalesService } from '../src/modules/sales/jewelry-cash-sales.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { idempotencyRecords, ledgerEntries, ledgerTransactions, salesInvoices, tenants } from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { UserService } from '../src/platform/users/user.service';
import { IdempotencyService } from '../src/platform/idempotency/idempotency.service';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

describe('cash jewelry sale (BE-041)', () => {
  const tenant = { id: '', slug: `cash-sale-${randomUUID().slice(0, 12)}` };
  let app: INestApplicationContext;
  let db: Database;
  let idempotency: IdempotencyService;
  let sales: JewelryCashSalesService;
  let movements: InventoryMovementsService;
  let actorId = '';
  let partyId = '';
  let itemId = '';
  let quoteId = '';
  let effectiveAt = new Date();

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init();
    db = app.get<Database>(DRIZZLE);
    const tenantService = app.get(TenantService);
    const users = app.get(UserService);
    const parties = app.get(PartiesService);
    const items = app.get(JewelryItemsService);
    const quotes = app.get(PriceQuotesService);
    const opening = app.get(OpeningBalancesService);
    idempotency = app.get(IdempotencyService);
    sales = app.get(JewelryCashSalesService);
    movements = app.get(InventoryMovementsService);
    tenant.id = (await tenantService.create({ name: 'Cash sale tenant', slug: tenant.slug })).id;
    effectiveAt = new Date();
    actorId = (await users.create({ email: `${randomUUID().slice(0, 12)}@example.com`, displayName: 'Cashier' })).id;
    partyId = (await withTenantTransaction(db, tenant.id, (transaction) =>
      parties.createInTransaction(transaction, { tenantId: tenant.id, actorUserId: actorId, input: { type: 'CONSUMER', displayName: 'Buyer' } }),
    )).id;
    const item = await items.createItem({
      tenantId: tenant.id, code: `RING-${randomUUID().slice(0, 8)}`, title: 'Ring', grossWeightMg: 12_000n,
      karat: 750, stoneWeightMg: 2_000n, otherDeductionWeightMg: 0n, wageType: 'PER_GRAM', wageValue: 350_000n,
      validFrom: effectiveAt, active: true,
    });
    itemId = item.jewelryItemId;
    quoteId = (await quotes.createManual({ tenantId: tenant.id, quoteType: 'MAZNEH', amountRial: 100_000_000n, createdBy: actorId })).id;
    await withTenantTransaction(db, tenant.id, (transaction) => opening.createInTransaction(transaction, {
      tenantId: tenant.id, effectiveAt, description: 'Opening stock', createdBy: actorId,
      lines: [{ itemType: 'JEWELRY', itemId, quantity: 1n }],
    }));
  });

  afterAll(async () => {
    if (tenant.id !== '') await db.delete(tenants).where(eq(tenants.id, tenant.id));
    await app.close();
  });

  it('finalizes one invoice, deducts inventory, posts balanced ledger entries, and replays idempotently', async () => {
    const request = { partyId, jewelryItemId: itemId, quoteId, effectiveAt: effectiveAt.toISOString() };
    const run = () => idempotency.execute({
      tenantId: tenant.id, key: 'cash-jewelry-sale-1', request: { method: 'POST', path: '/sales/invoices/jewelry', body: request },
      execute: async (transaction) => {
        const result = await sales.createInTransaction(transaction, { tenantId: tenant.id, ...request, effectiveAt, createdBy: actorId });
        return { status: 201, body: { invoiceId: result.invoiceId, payableRial: result.payableRial.toString() } };
      },
    });
    const first = await run();
    const replay = await run();
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, response: first.response });
    expect(await movements.balance(tenant.id, 'JEWELRY', itemId)).toBe(0n);
    const rows = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      invoices: await transaction.select().from(salesInvoices).where(eq(salesInvoices.tenantId, tenant.id)),
      ledger: await transaction.select().from(ledgerTransactions).where(and(eq(ledgerTransactions.tenantId, tenant.id), eq(ledgerTransactions.sourceType, 'SALES_INVOICE'))),
      entries: await transaction.select().from(ledgerEntries).where(eq(ledgerEntries.tenantId, tenant.id)),
    }));
    expect(rows.invoices.filter((invoice) => invoice.status === 'FINALIZED')).toHaveLength(1);
    expect(rows.ledger).toHaveLength(1);
    const saleEntryTotal = rows.entries
      .filter((entry) => entry.transactionId === rows.ledger[0]!.id)
      .reduce((total, entry) => total + entry.quantity, 0n);
    expect(saleEntryTotal).toBe(0n);
  });

  it('rolls back the draft and idempotency claim when a later validation fails', async () => {
    const before = await withTenantTransaction(db, tenant.id, (transaction) => transaction.select().from(salesInvoices).where(eq(salesInvoices.tenantId, tenant.id)));
    await expect(idempotency.execute({
      tenantId: tenant.id, key: 'cash-jewelry-sale-failure', request: { method: 'POST', path: '/sales/invoices/jewelry', body: { partyId, jewelryItemId: randomUUID(), quoteId, effectiveAt: effectiveAt.toISOString() } },
      execute: async (transaction) => {
        const result = await sales.createInTransaction(transaction, { tenantId: tenant.id, partyId, jewelryItemId: randomUUID(), quoteId, effectiveAt, createdBy: actorId });
        return { status: 201, body: { invoiceId: result.invoiceId } };
      },
    })).rejects.toThrow();
    const after = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      invoices: await transaction.select().from(salesInvoices).where(eq(salesInvoices.tenantId, tenant.id)),
      keys: await transaction.select().from(idempotencyRecords).where(and(eq(idempotencyRecords.tenantId, tenant.id), eq(idempotencyRecords.key, 'cash-jewelry-sale-failure'))),
    }));
    expect(after.invoices).toHaveLength(before.length);
    expect(after.keys).toHaveLength(0);
  });
});
