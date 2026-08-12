import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LedgerAccountsService } from '../src/modules/ledger/ledger-accounts.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import {
  InvalidSettlementFinalizeInputError,
  SettlementNotDraftError,
  SettlementRequiresLinesError,
} from '../src/modules/settlement/settlements.errors';
import { SettlementsService } from '../src/modules/settlement/settlements.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  assetDimensions,
  ledgerAccounts,
  settlementLines,
  tenants,
} from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { UserService } from '../src/platform/users/user.service';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

describe('settlement model and lifecycle (BE-044)', () => {
  const tenant = { id: '', slug: `settlement-${randomUUID().slice(0, 12)}` };
  let app: INestApplicationContext;
  let db: Database;
  let settlementsService: SettlementsService;
  let actorId = '';
  let partyId = '';
  let rialDimensionId = '';
  let cashAccountId = '';
  let receivableAccountId = '';
  const effectiveAt = new Date();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    const tenantService = app.get(TenantService);
    const users = app.get(UserService);
    const parties = app.get(PartiesService);
    settlementsService = app.get(SettlementsService);

    tenant.id = (await tenantService.create({ name: 'Settlement tenant', slug: tenant.slug })).id;
    actorId = (
      await users.create({ email: `${randomUUID().slice(0, 12)}@example.com`, displayName: 'Cashier' })
    ).id;
    partyId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenant.id,
          actorUserId: actorId,
          input: { type: 'CONSUMER', displayName: 'Debtor' },
        }),
      )
    ).id;

    const seeded = await withTenantTransaction(db, tenant.id, (transaction) =>
      Promise.all([
        transaction
          .select({ id: assetDimensions.id })
          .from(assetDimensions)
          .where(and(eq(assetDimensions.tenantId, tenant.id), eq(assetDimensions.code, 'RIAL')))
          .then(([found]) => found!),
        transaction
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.tenantId, tenant.id), eq(ledgerAccounts.systemKey, 'CASH')))
          .then(([found]) => found!),
      ]),
    );
    rialDimensionId = seeded[0].id;
    cashAccountId = seeded[1].id;

    const ledgerAccountsService = app.get(LedgerAccountsService);
    receivableAccountId = (
      await ledgerAccountsService.ensurePartyAccounts({ tenantId: tenant.id, partyId })
    ).receivable.id;
  });

  afterAll(async () => {
    if (tenant.id !== '') await db.delete(tenants).where(eq(tenants.id, tenant.id));
    await app.close();
  });

  it('finalizes a draft into append-only, multi-dimension lines and rejects further mutation', async () => {
    const draft = await settlementsService.createDraft({
      tenantId: tenant.id,
      partyId,
      createdBy: actorId,
    });
    expect(draft.status).toBe('DRAFT');

    const finalized = await settlementsService.finalize({
      tenantId: tenant.id,
      settlementId: draft.id,
      effectiveAt,
      createdBy: actorId,
      lines: [
        {
          lineType: 'RIAL',
          dimensionId: rialDimensionId,
          quantity: 100_000_000n,
          sourceAccountId: receivableAccountId,
          destinationAccountId: cashAccountId,
          lockedConversionSnapshot: { note: 'cash payment, no conversion' },
        },
      ],
    });

    expect(finalized.settlement.status).toBe('FINALIZED');
    expect(finalized.lines).toHaveLength(1);
    expect(finalized.lines[0]!.quantity).toBe(100_000_000n);

    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction
          .update(settlementLines)
          .set({ quantity: 1n })
          .where(eq(settlementLines.id, finalized.lines[0]!.id)),
      ),
    ).rejects.toThrow();

    await expect(
      settlementsService.finalize({
        tenantId: tenant.id,
        settlementId: draft.id,
        effectiveAt,
        createdBy: actorId,
        lines: [
          {
            lineType: 'RIAL',
            dimensionId: rialDimensionId,
            quantity: 1n,
            sourceAccountId: receivableAccountId,
            destinationAccountId: cashAccountId,
          },
        ],
      }),
    ).rejects.toThrow(SettlementNotDraftError);
  });

  it('rejects finalize without lines, with a non-positive quantity, or a number inside the snapshot', async () => {
    const draft = await settlementsService.createDraft({
      tenantId: tenant.id,
      partyId,
      createdBy: actorId,
    });

    await expect(
      settlementsService.finalize({
        tenantId: tenant.id,
        settlementId: draft.id,
        effectiveAt,
        createdBy: actorId,
        lines: [],
      }),
    ).rejects.toThrow(SettlementRequiresLinesError);

    await expect(
      settlementsService.finalize({
        tenantId: tenant.id,
        settlementId: draft.id,
        effectiveAt,
        createdBy: actorId,
        lines: [
          {
            lineType: 'RIAL',
            dimensionId: rialDimensionId,
            quantity: 0n,
            sourceAccountId: receivableAccountId,
            destinationAccountId: cashAccountId,
          },
        ],
      }),
    ).rejects.toThrow(InvalidSettlementFinalizeInputError);

    await expect(
      settlementsService.finalize({
        tenantId: tenant.id,
        settlementId: draft.id,
        effectiveAt,
        createdBy: actorId,
        lines: [
          {
            lineType: 'RIAL',
            dimensionId: rialDimensionId,
            quantity: 1n,
            sourceAccountId: receivableAccountId,
            destinationAccountId: cashAccountId,
            lockedConversionSnapshot: { rate: 50_000_000 as unknown as string },
          },
        ],
      }),
    ).rejects.toThrow(InvalidSettlementFinalizeInputError);
  });

  it('stores a multi-dimension settlement (rial + coin) with each line independently, per bullet-2 of BE-044', async () => {
    const [coinDimension, coinInventoryAccount] = await withTenantTransaction(db, tenant.id, (transaction) =>
      Promise.all([
        transaction
          .select({ id: assetDimensions.id })
          .from(assetDimensions)
          .where(and(eq(assetDimensions.tenantId, tenant.id), eq(assetDimensions.kind, 'COIN')))
          .limit(1)
          .then(([found]) => found!),
        transaction
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.tenantId, tenant.id),
              eq(ledgerAccounts.accountType, 'ASSET'),
              eq(ledgerAccounts.active, true),
            ),
          )
          .then((rows) => rows.find((row) => row.id !== cashAccountId && row.id !== receivableAccountId)!),
      ]),
    );

    const draft = await settlementsService.createDraft({ tenantId: tenant.id, partyId, createdBy: actorId });
    const finalized = await settlementsService.finalize({
      tenantId: tenant.id,
      settlementId: draft.id,
      effectiveAt,
      createdBy: actorId,
      lines: [
        {
          lineType: 'RIAL',
          dimensionId: rialDimensionId,
          quantity: 50_000_000n,
          sourceAccountId: receivableAccountId,
          destinationAccountId: cashAccountId,
        },
        {
          lineType: 'COIN',
          dimensionId: coinDimension.id,
          quantity: 1n,
          sourceAccountId: receivableAccountId,
          destinationAccountId: coinInventoryAccount.id,
          lockedQuoteAmountRial: 100_000_000n,
          lockedConversionSnapshot: { marketUnitPriceRial: '250000000' },
        },
      ],
    });

    expect(finalized.lines).toHaveLength(2);
    expect(new Set(finalized.lines.map((line) => line.dimensionId)).size).toBe(2);
  });
});
