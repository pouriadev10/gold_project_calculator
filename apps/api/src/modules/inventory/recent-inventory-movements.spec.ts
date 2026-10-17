import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { recentInventoryMovementListSchema } from '@gold/contracts';
import { ROLES_METADATA_KEY } from '../../platform/auth/roles.decorator';
import { RecentInventoryMovementsController } from './recent-inventory-movements.controller';
import {
  MELTED_GOLD_LABEL,
  latestTitles,
  toRecentInventoryMovement,
} from './recent-inventory-movements.service';
import type { RecentInventoryMovementsService } from './recent-inventory-movements.service';
import type { RequestContextService } from '../../platform/request-context/request-context.service';

/** FE-106b — آخرین حرکات موجودی با برچسب کالای حل‌شده. */

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const JEWELRY = 'b0000000-0000-4000-8000-000000000001';
const COIN = 'c0000000-0000-4000-8000-000000000001';
const SOURCE_ID = 'd0000000-0000-4000-8000-000000000001';
const AT = new Date('2026-09-01T08:30:00.000Z');

function movement(
  overrides: Partial<Parameters<typeof toRecentInventoryMovement>[0]> = {},
): Parameters<typeof toRecentInventoryMovement>[0] {
  return {
    id: 'e0000000-0000-4000-8000-000000000001',
    sourceType: 'SALE',
    itemType: 'JEWELRY',
    itemId: JEWELRY,
    quantity: -1n,
    occurredAt: AT,
    ...overrides,
  };
}

describe('latestTitles', () => {
  it('عنوان آخرین نسخه‌ی هر کالا', () => {
    const titles = latestTitles([
      { itemId: JEWELRY, version: 1, title: 'دستبند' },
      { itemId: JEWELRY, version: 3, title: 'دستبند ۱۸ عیار' },
      { itemId: JEWELRY, version: 2, title: 'دستبند قدیمی' },
      { itemId: COIN, version: 1, title: 'تمام بهار آزادی' },
    ]);
    expect(titles.get(JEWELRY)).toBe('دستبند ۱۸ عیار');
    expect(titles.get(COIN)).toBe('تمام بهار آزادی');
  });
});

describe('toRecentInventoryMovement', () => {
  const titles = new Map([
    [JEWELRY, 'دستبند ۱۸ عیار'],
    [COIN, 'تمام بهار آزادی'],
  ]);

  it('زیورآلات، سکه و آبشده — مقدار علامت‌دار با واحد خود نوع، و قرارداد مشترک', () => {
    const items = [
      toRecentInventoryMovement(movement(), titles),
      toRecentInventoryMovement(movement({ itemType: 'COIN', itemId: COIN, quantity: -2n }), titles),
      toRecentInventoryMovement(
        movement({ sourceType: 'SECOND_HAND_PURCHASE', itemType: 'MELTED_GOLD', itemId: null, quantity: 45_000n }),
        titles,
      ),
    ];
    expect(items.map((item) => [item.itemLabel, item.quantity])).toEqual([
      ['دستبند ۱۸ عیار', '-1'],
      ['تمام بهار آزادی', '-2'],
      [MELTED_GOLD_LABEL, '45000'],
    ]);
    expect(items[2]!.sourceType).toBe('SECOND_HAND_PURCHASE');
    expect(recentInventoryMovementListSchema.parse(items)).toEqual(items);
  });

  it('کالای بی‌نسخه خطای صریح است، نه برچسب خالی', () => {
    expect(() => toRecentInventoryMovement(movement({ itemId: SOURCE_ID }), titles)).toThrow();
  });
});

describe('RecentInventoryMovementsController', () => {
  it('GET /inventory/movements/recent، نقش‌دار، با مستأجر درخواست', async () => {
    expect(Reflect.getMetadata('path', RecentInventoryMovementsController)).toBe('inventory/movements');
    expect(Reflect.getMetadata('path', RecentInventoryMovementsController.prototype.recent)).toBe('recent');
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, RecentInventoryMovementsController)).toEqual([
      'OWNER',
      'MANAGER',
      'CASHIER',
    ]);
    const service = { recent: vi.fn(async () => []) } as unknown as RecentInventoryMovementsService;
    const context = { getTenantId: () => TENANT } as RequestContextService;
    await new RecentInventoryMovementsController(context, service).recent({ limit: 5 });
    expect(service.recent).toHaveBeenCalledWith(TENANT, 5);
  });
});
