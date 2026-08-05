import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../../platform/audit/audit.service';
import { assetDimensions } from '../../platform/database/schema';
import { RequiredAssetDimensionNotFoundError } from './asset-dimensions.errors';
import type {
  AssetDimension,
  AssetDimensionKind,
  InventoryItemType,
} from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

const BASE_DIMENSIONS = [
  { code: 'RIAL', kind: 'RIAL', title: 'ریال' },
  { code: 'GOLD', kind: 'GOLD', title: 'طلای خالص ۱۰۰۰' },
  { code: 'SILVER', kind: 'SILVER', title: 'نقرهٔ خالص ۱۰۰۰' },
] as const satisfies readonly {
  readonly code: string;
  readonly kind: Exclude<AssetDimensionKind, 'COIN'>;
  readonly title: string;
}[];

export interface SyncCoinAssetDimensionInput {
  readonly tenantId: string;
  readonly coinTypeId: string;
  readonly title: string;
  readonly active: boolean;
}

/**
 * مالک identityهای چندواحدی دفتر کل.
 *
 * این service نه نرخ تبدیل می‌سازد و نه quantity محاسبه می‌کند. وظیفه‌اش فقط
 * این است که هر tenant پایه‌های مستقل خود را داشته باشد و هر coin type دقیقاً
 * یک بعد count-only مستقل بگیرد.
 */
@Injectable()
export class AssetDimensionsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async ensureBaseDimensionsInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
  ): Promise<void> {
    for (const dimension of BASE_DIMENSIONS) {
      const [created] = await transaction
        .insert(assetDimensions)
        .values({ tenantId, ...dimension, active: true })
        .onConflictDoNothing({ target: [assetDimensions.tenantId, assetDimensions.code] })
        .returning();

      if (created !== undefined) {
        await this.audit.recordInTransaction(transaction, {
          tenantId,
          actorUserId: null,
          action: 'ASSET_DIMENSION_CREATED',
          entityType: 'asset_dimension',
          entityId: created.id,
          afterData: { code: created.code, kind: created.kind },
        });
      }
    }
  }

  /**
   * Coin dimension از `coin_type.id` نام می‌گیرد، نه وزن یا عیار آن. تغییر
   * specification سکه هرگز identity شمارشیِ ledger را عوض نمی‌کند.
   */
  async syncCoinDimensionInTransaction(
    transaction: TenantTransaction,
    input: SyncCoinAssetDimensionInput,
  ): Promise<AssetDimension> {
    const [dimension] = await transaction
      .insert(assetDimensions)
      .values({
        tenantId: input.tenantId,
        code: `COIN:${input.coinTypeId}`,
        kind: 'COIN',
        coinTypeId: input.coinTypeId,
        title: input.title,
        active: input.active,
      })
      .onConflictDoUpdate({
        target: [assetDimensions.tenantId, assetDimensions.coinTypeId],
        // code و coinTypeId عمداً immutable می‌مانند؛ تنها عنوان/فعال‌بودن sync می‌شود.
        set: { title: input.title, active: input.active },
      })
      .returning();

    const resolved = dimension!;
    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: null,
      action: 'ASSET_DIMENSION_SYNCED',
      entityType: 'asset_dimension',
      entityId: resolved.id,
      afterData: {
        code: resolved.code,
        kind: resolved.kind,
        coinTypeId: resolved.coinTypeId,
        active: resolved.active,
      },
    });

    return resolved;
  }

  /** بعد درست inventory را بدون اجازه برای تبدیل یا یکی‌کردن سکه‌ها پیدا می‌کند. */
  async resolveInventoryDimensionInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    itemType: InventoryItemType,
    itemId: string | null,
  ): Promise<AssetDimension> {
    const kind: 'GOLD' | 'COIN' = itemType === 'COIN' ? 'COIN' : 'GOLD';
    const coinTypeId = kind === 'COIN' ? itemId : null;

    const [dimension] = await transaction
      .select()
      .from(assetDimensions)
      .where(
        and(
          eq(assetDimensions.tenantId, tenantId),
          eq(assetDimensions.kind, kind),
          coinTypeId === null
            ? isNull(assetDimensions.coinTypeId)
            : eq(assetDimensions.coinTypeId, coinTypeId),
        ),
      )
      .limit(1);

    if (dimension === undefined) {
      throw new RequiredAssetDimensionNotFoundError(tenantId, kind, coinTypeId ?? undefined);
    }

    return dimension;
  }
}
