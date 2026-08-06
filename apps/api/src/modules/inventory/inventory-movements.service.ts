import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../platform/database/database.module';
import { inventoryMovements } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { RequiredSettingMissingError } from '../pricing/versioned-settings.errors';
import { VersionedSettingsService } from '../pricing/versioned-settings.service';
import { AssetDimensionsService } from '../ledger/asset-dimensions.service';
import {
  InvalidInventoryItemIdentityError,
  NegativeInventoryError,
  ZeroInventoryMovementError,
} from './inventory-movements.errors';
import type { Database } from '../../platform/database/connect';
import type {
  InventoryItemType,
  InventoryMovement,
  InventoryMovementSourceType,
  VersionedSettingValue,
} from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

/** کلید سیاست موجودی منفی. مقدارش در `INITIAL_TENANT_SETTINGS` seed می‌شود. */
export const ALLOW_NEGATIVE_STOCK_SETTING = 'inventory.allow_negative_stock';

export interface RecordInventoryMovementInput {
  readonly sourceType: InventoryMovementSourceType;
  readonly sourceId: string;
  readonly itemType: InventoryItemType;
  /** برای `JEWELRY` و `COIN` الزامی، برای `MELTED_GOLD` باید خالی باشد. */
  readonly itemId?: string | null | undefined;
  /** مثبت یعنی ورود به موجودی و منفی یعنی خروج. صفر مجاز نیست. */
  readonly quantity: bigint;
  readonly occurredAt: Date;
}

export interface InventoryBalance {
  readonly itemType: InventoryItemType;
  readonly itemId: string | null;
  readonly quantity: bigint;
}

/**
 * مقدار boolean یک تنظیم.
 *
 * `Boolean('false')` در جاوااسکریپت `true` است، پس تبدیل صریح انجام
 * می‌شود و هر مقدار ناشناخته‌ای خطا می‌دهد — سیاستی که غلط خوانده شود،
 * بی‌صدا موجودی منفی می‌سازد.
 */
function isSettingRecord(
  value: VersionedSettingValue,
): value is { readonly [key: string]: VersionedSettingValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBooleanSetting(key: string, value: VersionedSettingValue): boolean {
  const raw = isSettingRecord(value) ? value['value'] : value;

  if (raw === 'true' || raw === true) {
    return true;
  }
  if (raw === 'false' || raw === false) {
    return false;
  }

  throw new Error(`تنظیم ${key} باید مقدار boolean داشته باشد`);
}

/**
 * دفتر حرکات موجودی — BE-027.
 *
 * ## چرا هیچ متد نوشتنیِ خودایستایی وجود ندارد
 *
 * تنها راه ثبت حرکت، `recordInTransaction` است که تراکنش را از
 * فراخوان می‌گیرد. قاعده‌ی تسک می‌گوید «movement مالی و ledger در یک
 * transaction دیتابیس ثبت شوند»؛ اگر متد راحتی وجود داشت که خودش
 * تراکنش باز کند، اولین جای شلوغ از همان استفاده می‌کرد و موجودی و
 * دفتر کل نیم‌قدم از هم عقب می‌افتادند. اینجا آن راه از اول بسته است.
 *
 * ## اصلاح
 *
 * هیچ ردیفی به‌روزرسانی یا حذف نمی‌شود — نه در سرویس، نه با SQL مستقیم
 * (تریگر مهاجرت ۰۰۱۵). اصلاح یعنی حرکت جدید با علامت مخالف و
 * `sourceType = 'CORRECTION'`.
 */
@Injectable()
export class InventoryMovementsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(VersionedSettingsService) private readonly settings: VersionedSettingsService,
    @Inject(AssetDimensionsService) private readonly dimensions: AssetDimensionsService,
  ) {}

  async recordInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    input: RecordInventoryMovementInput,
  ): Promise<InventoryMovement> {
    const [movement] = await this.recordManyInTransaction(transaction, tenantId, [input]);

    return movement!;
  }

  /**
   * چند حرکت یک سند، در یک تراکنش.
   *
   * هر خط جداگانه قفل و بررسی می‌شود، پس فاکتوری که دو بار از یک کالا
   * برمی‌دارد هم درست سنجیده می‌شود: خط دوم موجودیِ **بعد از** خط اول را
   * می‌بیند، نه موجودی اول سند را.
   */
  async recordManyInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    inputs: readonly RecordInventoryMovementInput[],
  ): Promise<readonly InventoryMovement[]> {
    if (inputs.length === 0) {
      return [];
    }

    const allowNegative = await this.allowsNegativeStock(transaction, tenantId);
    const recorded: InventoryMovement[] = [];

    for (const input of inputs) {
      const itemId = input.itemId ?? null;

      if (input.quantity === 0n) {
        throw new ZeroInventoryMovementError();
      }
      if ((input.itemType === 'MELTED_GOLD') !== (itemId === null)) {
        throw new InvalidInventoryItemIdentityError(input.itemType);
      }

      const dimension = await this.dimensions.resolveInventoryDimensionInTransaction(
        transaction,
        tenantId,
        input.itemType,
        itemId,
      );

      /*
       * قفل مشورتی روی «مستأجر + نوع + کالا». بدون آن، دو فروش هم‌زمان
       * هر دو موجودی قبلی را می‌خوانند، هر دو مجاز تشخیص داده می‌شوند و
       * جمعشان موجودی را منفی می‌کند — همان حالتی که فقط زیر بار واقعی
       * خودش را نشان می‌دهد.
       */
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${input.itemType}:${itemId ?? ''}`}, 0))`,
      );

      if (!allowNegative && input.quantity < 0n) {
        const available = await this.balanceInTransaction(
          transaction,
          tenantId,
          input.itemType,
          itemId,
        );

        if (available + input.quantity < 0n) {
          throw new NegativeInventoryError(input.itemType, itemId, available, -input.quantity);
        }
      }

      const [created] = await transaction
        .insert(inventoryMovements)
        .values({
          tenantId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          itemType: input.itemType,
          itemId,
          dimensionId: dimension.id,
          quantity: input.quantity,
          occurredAt: input.occurredAt,
        })
        .returning();

      recorded.push(created!);
    }

    return recorded;
  }

  /** موجودی جاری یک کالا — همیشه از مجموع حرکات، هرگز از ستون cache. */
  async balance(
    tenantId: string,
    itemType: InventoryItemType,
    itemId: string | null,
  ): Promise<bigint> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      this.balanceInTransaction(transaction, tenantId, itemType, itemId),
    );
  }

  async balanceInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    itemType: InventoryItemType,
    itemId: string | null,
  ): Promise<bigint> {
    const [row] = await transaction
      .select({ total: sql<string>`COALESCE(SUM(${inventoryMovements.quantity}), 0)::text` })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.tenantId, tenantId),
          eq(inventoryMovements.itemType, itemType),
          itemId === null
            ? isNull(inventoryMovements.itemId)
            : eq(inventoryMovements.itemId, itemId),
        ),
      );

    /*
     * جمع با `::text` خوانده می‌شود و بعد `BigInt`. عبور از `number`
     * روی مجموع میلی‌گرم یک انبار واقعی دقت را از دست می‌دهد.
     */
    return BigInt(row?.total ?? '0');
  }

  /**
   * موجودی همه‌ی کالاها.
   *
   * ردیف‌های با مانده‌ی صفر هم می‌آیند: «این کالا بود و تمام شد» خودش یک
   * واقعیت انبار است و پنهان کردنش کار انبارگردانی را سخت می‌کند.
   */
  async balances(
    tenantId: string,
    itemType?: InventoryItemType,
  ): Promise<readonly InventoryBalance[]> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      this.balancesInTransaction(transaction, tenantId, itemType),
    );
  }

  async balancesInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    itemType?: InventoryItemType,
  ): Promise<readonly InventoryBalance[]> {
    const rows = await transaction
      .select({
        itemType: inventoryMovements.itemType,
        itemId: inventoryMovements.itemId,
        total: sql<string>`SUM(${inventoryMovements.quantity})::text`,
      })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.tenantId, tenantId),
          itemType === undefined ? undefined : eq(inventoryMovements.itemType, itemType),
        ),
      )
      .groupBy(inventoryMovements.itemType, inventoryMovements.itemId)
      .orderBy(inventoryMovements.itemType, inventoryMovements.itemId);

    return rows.map((row) => ({
      itemType: row.itemType,
      itemId: row.itemId,
      quantity: BigInt(row.total),
    }));
  }

  /** حرکات یک سند — «این فاکتور دقیقاً چه چیزی را از انبار برداشت؟» */
  async listBySource(
    tenantId: string,
    sourceType: InventoryMovementSourceType,
    sourceId: string,
  ): Promise<readonly InventoryMovement[]> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      transaction
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, tenantId),
            eq(inventoryMovements.sourceType, sourceType),
            eq(inventoryMovements.sourceId, sourceId),
          ),
        )
        .orderBy(asc(inventoryMovements.createdAt)),
    );
  }

  /**
   * سیاست در **لحظه‌ی ثبت** خوانده می‌شود و نه در `occurredAt`.
   *
   * این یک نرده‌ی عملیاتی است، نه عددی که روی سند بنشیند؛ قاعده‌ی ۲-۸
   * درباره‌ی مبالغ سند است. ضمناً موجودی افتتاحیه‌ای که تاریخش پیش از
   * ساخت مستأجر است، وگرنه به تنظیمی می‌رسید که آن روز هنوز وجود نداشت.
   */
  private async allowsNegativeStock(
    transaction: TenantTransaction,
    tenantId: string,
  ): Promise<boolean> {
    const setting = await this.settings.getEffectiveInTransaction(
      transaction,
      tenantId,
      ALLOW_NEGATIVE_STOCK_SETTING,
      new Date(),
    );

    if (setting === undefined) {
      throw new RequiredSettingMissingError(ALLOW_NEGATIVE_STOCK_SETTING);
    }

    return readBooleanSetting(ALLOW_NEGATIVE_STOCK_SETTING, setting.valueJson);
  }
}
