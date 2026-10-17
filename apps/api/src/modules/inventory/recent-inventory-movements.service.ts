import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../../platform/database/database.module';
import { coinTypeVersions, inventoryMovements, jewelryItemVersions } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import type { RecentInventoryMovement } from '@gold/contracts';
import type { Database } from '../../platform/database/connect';
import type { InventoryMovement } from '../../platform/database/schema';

/** آبشده هویت مستقلی ندارد (`item_id` تهی)؛ برچسبش همین نام نوع است. */
export const MELTED_GOLD_LABEL = 'آبشده';

/** Latest version title per item: the label the user knows the item by today. */
export function latestTitles(
  versions: readonly { readonly itemId: string; readonly version: number; readonly title: string }[],
): Map<string, string> {
  const latest = new Map<string, { version: number; title: string }>();
  for (const version of versions) {
    const current = latest.get(version.itemId);
    if (current === undefined || version.version > current.version) {
      latest.set(version.itemId, { version: version.version, title: version.title });
    }
  }
  return new Map([...latest].map(([itemId, { title }]) => [itemId, title] as const));
}

/**
 * One movement with its item resolved to a label. The quantity keeps its sign
 * and its type-specific unit (pieces, coin count, or pure mg for melted gold).
 */
export function toRecentInventoryMovement(
  movement: Pick<InventoryMovement, 'id' | 'sourceType' | 'itemType' | 'itemId' | 'quantity' | 'occurredAt'>,
  titles: ReadonlyMap<string, string>,
): RecentInventoryMovement {
  const label =
    movement.itemType === 'MELTED_GOLD' || movement.itemId === null
      ? MELTED_GOLD_LABEL
      : titles.get(movement.itemId);
  if (label === undefined) {
    throw new Error(`Inventory item ${movement.itemId} has no version to label it`);
  }
  return {
    id: movement.id,
    sourceType: movement.sourceType,
    itemType: movement.itemType,
    itemLabel: label,
    quantity: movement.quantity.toString(),
    occurredAt: movement.occurredAt.toISOString(),
  };
}

/** Read-only, tenant-scoped (RLS) latest inventory movements — FE-106b. */
@Injectable()
export class RecentInventoryMovementsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async recent(tenantId: string, limit: number): Promise<RecentInventoryMovement[]> {
    return withTenantTransaction(this.db, tenantId, async (transaction) => {
      const movements = await transaction
        .select({
          id: inventoryMovements.id,
          sourceType: inventoryMovements.sourceType,
          itemType: inventoryMovements.itemType,
          itemId: inventoryMovements.itemId,
          quantity: inventoryMovements.quantity,
          occurredAt: inventoryMovements.occurredAt,
        })
        .from(inventoryMovements)
        .where(eq(inventoryMovements.tenantId, tenantId))
        .orderBy(desc(inventoryMovements.occurredAt), desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
        .limit(limit);

      const idsOf = (itemType: InventoryMovement['itemType']) => [
        ...new Set(
          movements.flatMap((movement) =>
            movement.itemType === itemType && movement.itemId !== null ? [movement.itemId] : [],
          ),
        ),
      ];
      const jewelryIds = idsOf('JEWELRY');
      const coinIds = idsOf('COIN');
      const [jewelry, coins] = await Promise.all([
        jewelryIds.length === 0
          ? []
          : transaction
              .select({
                itemId: jewelryItemVersions.jewelryItemId,
                version: jewelryItemVersions.version,
                title: jewelryItemVersions.title,
              })
              .from(jewelryItemVersions)
              .where(
                and(
                  eq(jewelryItemVersions.tenantId, tenantId),
                  inArray(jewelryItemVersions.jewelryItemId, jewelryIds),
                ),
              ),
        coinIds.length === 0
          ? []
          : transaction
              .select({
                itemId: coinTypeVersions.coinTypeId,
                version: coinTypeVersions.version,
                title: coinTypeVersions.title,
              })
              .from(coinTypeVersions)
              .where(and(eq(coinTypeVersions.tenantId, tenantId), inArray(coinTypeVersions.coinTypeId, coinIds))),
      ]);
      // شناسه‌ی زیورآلات و نوع سکه هر دو uuid ِ تصادفی‌اند و هم‌پوشانی ندارند
      const titles = latestTitles([...jewelry, ...coins]);
      return movements.map((movement) => toRecentInventoryMovement(movement, titles));
    });
  }
}
