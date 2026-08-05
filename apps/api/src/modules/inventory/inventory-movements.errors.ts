import type { InventoryItemType } from '../../platform/database/schema';

/**
 * حرکت، موجودی را منفی می‌کرد و سیاست مستأجر اجازه نمی‌دهد.
 *
 * مقدارها در پیام می‌آیند تا کاربر بفهمد چقدر کم دارد، نه فقط اینکه
 * «نشد». واحدشان به `itemType` بستگی دارد: تعداد برای زیورآلات و سکه،
 * میلی‌گرم خالص برای آبشده.
 */
export class NegativeInventoryError extends Error {
  readonly itemType: InventoryItemType;
  readonly itemId: string | null;
  readonly available: bigint;
  readonly requested: bigint;

  constructor(
    itemType: InventoryItemType,
    itemId: string | null,
    available: bigint,
    requested: bigint,
  ) {
    super(
      `Inventory for ${itemType}${itemId === null ? '' : ` "${itemId}"`} would go negative: ` +
        `available ${available.toString()}, requested ${requested.toString()}`,
    );
    this.name = 'NegativeInventoryError';
    this.itemType = itemType;
    this.itemId = itemId;
    this.available = available;
    this.requested = requested;
  }
}

/** حرکت صفر یعنی هیچ اتفاقی نیفتاده؛ پیش از رسیدن به دیتابیس رد می‌شود. */
export class ZeroInventoryMovementError extends Error {
  constructor() {
    super('Inventory movement quantity must not be zero');
    this.name = 'ZeroInventoryMovementError';
  }
}

/**
 * شناسه‌ی کالا با نوعش نمی‌خواند.
 *
 * زیورآلات و سکه حتماً شناسه دارند و آبشده حتماً ندارد — همان قاعده‌ای
 * که `inventory_movements_item_identity_check` در دیتابیس اجبار می‌کند.
 */
export class InvalidInventoryItemIdentityError extends Error {
  readonly itemType: InventoryItemType;

  constructor(itemType: InventoryItemType) {
    super(
      itemType === 'MELTED_GOLD'
        ? 'Melted gold movements must not carry an item id; it is tracked by pure weight only'
        : `Movements of type ${itemType} require an item id`,
    );
    this.name = 'InvalidInventoryItemIdentityError';
    this.itemType = itemType;
  }
}
