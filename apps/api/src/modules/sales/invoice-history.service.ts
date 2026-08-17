import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, or } from 'drizzle-orm';
import { DRIZZLE } from '../../platform/database/database.module';
import {
  coinTypeVersions,
  inventoryMovements,
  jewelryItemVersions,
  ledgerEntries,
  ledgerTransactions,
  salesInvoiceItems,
  salesInvoiceVersions,
  salesInvoices,
  users,
} from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { SalesInvoiceNotFoundError } from './sales-invoices.errors';
import type { SalesInvoiceAmendmentHistory, SalesInvoiceVersionHistory } from '@gold/contracts';
import type { Database } from '../../platform/database/connect';
import type { SalesInvoiceSnapshotValue } from '../../platform/database/schema';

type VersionHistory = SalesInvoiceVersionHistory['versions'][number];
type AmendmentHistory = SalesInvoiceAmendmentHistory['amendments'][number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function snapshotRecord(
  value: SalesInvoiceSnapshotValue,
): Readonly<Record<string, SalesInvoiceSnapshotValue>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, SalesInvoiceSnapshotValue>>;
}

function snapshotInteger(value: SalesInvoiceSnapshotValue, key: string): string | null {
  const candidate = snapshotRecord(value)?.[key];
  return typeof candidate === 'string' && /^\d+$/u.test(candidate) ? candidate : null;
}

function snapshotUuid(value: SalesInvoiceSnapshotValue, key: string): string | undefined {
  const candidate = snapshotRecord(value)?.[key];
  return typeof candidate === 'string' && UUID_PATTERN.test(candidate) ? candidate : undefined;
}

function signedDifference(before: string | null, after: string | null): string | null {
  return before === null || after === null ? null : (BigInt(after) - BigInt(before)).toString();
}

function totalPureWeightMg(
  items: readonly { readonly lineSnapshot: SalesInvoiceSnapshotValue }[],
): string | null {
  let total = 0n;
  let hasJewelryWeight = false;

  for (const item of items) {
    const pureWeightMg = snapshotInteger(item.lineSnapshot, 'pureWeightMg');
    if (pureWeightMg !== null) {
      total += BigInt(pureWeightMg);
      hasJewelryWeight = true;
    }
  }

  return hasJewelryWeight ? total.toString() : null;
}

/** Read-only projection of immutable invoice versions and their correction effects. */
@Injectable()
export class InvoiceHistoryService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async getVersions(tenantId: string, invoiceId: string): Promise<SalesInvoiceVersionHistory> {
    return withTenantTransaction(this.db, tenantId, async (transaction) => {
      const [invoice] = await transaction
        .select({ id: salesInvoices.id, invoiceNumber: salesInvoices.invoiceNumber })
        .from(salesInvoices)
        .where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, invoiceId)))
        .limit(1);
      if (invoice === undefined || invoice.invoiceNumber === null) {
        throw new SalesInvoiceNotFoundError(invoiceId);
      }

      const versionsWithActors = await transaction
        .select({
          version: salesInvoiceVersions,
          actorId: users.id,
          actorDisplayName: users.displayName,
        })
        .from(salesInvoiceVersions)
        .leftJoin(users, eq(users.id, salesInvoiceVersions.createdBy))
        .where(
          and(
            eq(salesInvoiceVersions.tenantId, tenantId),
            eq(salesInvoiceVersions.salesInvoiceId, invoiceId),
          ),
        )
        .orderBy(salesInvoiceVersions.version);

      const versions = versionsWithActors.map(({ version }) => version);
      const versionIds = versions.map((version) => version.id);
      const items = await transaction
        .select()
        .from(salesInvoiceItems)
        .where(
          and(
            eq(salesInvoiceItems.tenantId, tenantId),
            eq(salesInvoiceItems.salesInvoiceId, invoiceId),
          ),
        );
      const itemsByVersion = new Map<string, typeof items>();
      for (const item of items) {
        const existing = itemsByVersion.get(item.salesInvoiceVersionId) ?? [];
        existing.push(item);
        itemsByVersion.set(item.salesInvoiceVersionId, existing);
      }

      const jewelryVersionIds = items
        .filter((item) => item.itemType === 'JEWELRY')
        .map((item) => snapshotUuid(item.lineSnapshot, 'jewelryItemVersionId'))
        .filter((id): id is string => id !== undefined);
      const coinVersionIds = items
        .filter((item) => item.itemType === 'COIN')
        .map((item) => snapshotUuid(item.lineSnapshot, 'coinTypeVersionId'))
        .filter((id): id is string => id !== undefined);
      const [jewelryVersions, coinVersions] = await Promise.all([
        jewelryVersionIds.length === 0
          ? []
          : transaction
              .select({ id: jewelryItemVersions.id, karat: jewelryItemVersions.karat })
              .from(jewelryItemVersions)
              .where(
                and(
                  eq(jewelryItemVersions.tenantId, tenantId),
                  inArray(jewelryItemVersions.id, jewelryVersionIds),
                ),
              ),
        coinVersionIds.length === 0
          ? []
          : transaction
              .select({ id: coinTypeVersions.id, karat: coinTypeVersions.karat })
              .from(coinTypeVersions)
              .where(
                and(
                  eq(coinTypeVersions.tenantId, tenantId),
                  inArray(coinTypeVersions.id, coinVersionIds),
                ),
              ),
      ]);
      const karats = new Map<string, number>([
        ...jewelryVersions.map((version) => [version.id, version.karat] as const),
        ...coinVersions.map((version) => [version.id, version.karat] as const),
      ]);

      const transactions = await transaction
        .select()
        .from(ledgerTransactions)
        .where(
          and(
            eq(ledgerTransactions.tenantId, tenantId),
            or(
              and(
                eq(ledgerTransactions.sourceType, 'SALES_INVOICE'),
                eq(ledgerTransactions.sourceId, invoiceId),
              ),
              and(
                eq(ledgerTransactions.sourceType, 'SALES_INVOICE_AMENDMENT'),
                inArray(ledgerTransactions.sourceId, versionIds),
              ),
            ),
          ),
        );
      const transactionIds = transactions.map((entry) => entry.id);
      const entries =
        transactionIds.length === 0
          ? []
          : await transaction
              .select()
              .from(ledgerEntries)
              .where(
                and(
                  eq(ledgerEntries.tenantId, tenantId),
                  inArray(ledgerEntries.transactionId, transactionIds),
                ),
              );
      const entriesByTransaction = new Map<string, typeof entries>();
      for (const entry of entries) {
        const existing = entriesByTransaction.get(entry.transactionId) ?? [];
        existing.push(entry);
        entriesByTransaction.set(entry.transactionId, existing);
      }

      const movements = await transaction
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, tenantId),
            or(
              and(
                eq(inventoryMovements.sourceType, 'SALE'),
                eq(inventoryMovements.sourceId, invoiceId),
              ),
              and(
                eq(inventoryMovements.sourceType, 'CORRECTION'),
                inArray(inventoryMovements.sourceId, versionIds),
              ),
            ),
          ),
        );

      const versionById = new Map(versions.map((version) => [version.id, version.version]));
      const ledgerByVersion = new Map<number, VersionHistory['ledgerEffects']>();
      for (const entry of transactions) {
        const version = entry.sourceType === 'SALES_INVOICE' ? 1 : versionById.get(entry.sourceId);
        if (version === undefined) continue;
        const effects = ledgerByVersion.get(version) ?? [];
        effects.push({
          transactionId: entry.id,
          effectiveAt: entry.effectiveAt.toISOString(),
          entries: (entriesByTransaction.get(entry.id) ?? []).map((ledgerEntry) => ({
            accountId: ledgerEntry.accountId,
            dimensionId: ledgerEntry.dimensionId,
            quantity: ledgerEntry.quantity.toString(),
          })),
        });
        ledgerByVersion.set(version, effects);
      }
      const inventoryByVersion = new Map<number, VersionHistory['inventoryEffects']>();
      for (const movement of movements) {
        const version = movement.sourceType === 'SALE' ? 1 : versionById.get(movement.sourceId);
        if (version === undefined) continue;
        const effects = inventoryByVersion.get(version) ?? [];
        effects.push({
          movementId: movement.id,
          itemType: movement.itemType,
          itemId: movement.itemId,
          dimensionId: movement.dimensionId,
          quantity: movement.quantity.toString(),
          occurredAt: movement.occurredAt.toISOString(),
        });
        inventoryByVersion.set(version, effects);
      }

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        versions: versionsWithActors.map(({ version, actorId, actorDisplayName }) => {
          const versionItems = itemsByVersion.get(version.id) ?? [];
          const itemHistory = versionItems.map((item) => {
            const itemVersionId = snapshotUuid(
              item.lineSnapshot,
              item.itemType === 'JEWELRY' ? 'jewelryItemVersionId' : 'coinTypeVersionId',
            );
            return {
              itemType: item.itemType,
              itemId: item.itemId,
              quantity: BigInt(item.quantity).toString(),
              pureWeightMg: snapshotInteger(item.lineSnapshot, 'pureWeightMg'),
              karat: itemVersionId === undefined ? null : (karats.get(itemVersionId) ?? null),
            };
          });
          const distinctKarats = [
            ...new Set(itemHistory.flatMap((item) => (item.karat === null ? [] : [item.karat]))),
          ];
          return {
            version: version.version,
            reason: version.reason,
            reasonDetail: version.reasonDetail,
            partyId: version.partyId,
            actor:
              actorId === null || actorDisplayName === null
                ? null
                : { id: actorId, displayName: actorDisplayName },
            createdAt: version.createdAt.toISOString(),
            payableRial: snapshotInteger(version.totalsSnapshot, 'payableRial'),
            pureWeightMg: totalPureWeightMg(versionItems),
            karat: distinctKarats.length === 1 ? distinctKarats[0]! : null,
            items: itemHistory,
            totalsSnapshot: version.totalsSnapshot,
            settingsSnapshot: version.settingsSnapshot,
            ledgerEffects: ledgerByVersion.get(version.version) ?? [],
            inventoryEffects: inventoryByVersion.get(version.version) ?? [],
          };
        }),
      };
    });
  }

  async getAmendments(tenantId: string, invoiceId: string): Promise<SalesInvoiceAmendmentHistory> {
    const history = await this.getVersions(tenantId, invoiceId);
    const amendments: AmendmentHistory[] = [];
    for (let index = 1; index < history.versions.length; index += 1) {
      const before = history.versions[index - 1]!;
      const after = history.versions[index]!;
      if (after.reason === null) continue;
      amendments.push({
        version: after.version,
        reason: after.reason,
        reasonDetail: after.reasonDetail,
        actor: after.actor,
        createdAt: after.createdAt,
        changes: {
          pureWeightMg: {
            before: before.pureWeightMg,
            after: after.pureWeightMg,
            delta: signedDifference(before.pureWeightMg, after.pureWeightMg),
          },
          payableRial: {
            before: before.payableRial,
            after: after.payableRial,
            delta: signedDifference(before.payableRial, after.payableRial),
          },
          karat: { before: before.karat, after: after.karat },
        },
        ledgerEffects: after.ledgerEffects,
        inventoryEffects: after.inventoryEffects,
      });
    }
    return { invoiceId: history.invoiceId, invoiceNumber: history.invoiceNumber, amendments };
  }
}
