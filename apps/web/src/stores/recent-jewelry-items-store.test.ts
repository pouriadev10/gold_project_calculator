import { beforeEach, describe, expect, it } from 'vitest';
import {
  RECENT_JEWELRY_ITEMS_STORAGE_KEY,
  useRecentJewelryItemsStore,
  type RecentJewelryItem,
} from './recent-jewelry-items-store';

function item(overrides: Partial<RecentJewelryItem> = {}): RecentJewelryItem {
  return {
    jewelryItemId: 'j1',
    code: 'R-100',
    title: 'انگشتر سادگی',
    grossWeightMg: '5000',
    karat: 750,
    active: true,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  useRecentJewelryItemsStore.setState({ recent: [] });
});

describe('recent-jewelry-items-store — پیش‌فرض', () => {
  it('فهرست اخیر خالی شروع می‌شود', () => {
    expect(useRecentJewelryItemsStore.getState().recent).toEqual([]);
  });
});

describe('recent-jewelry-items-store — recordSelection', () => {
  it('کالای تازه به ابتدای فهرست اضافه می‌شود', () => {
    useRecentJewelryItemsStore.getState().recordSelection(item({ jewelryItemId: 'j1' }));
    useRecentJewelryItemsStore.getState().recordSelection(item({ jewelryItemId: 'j2', title: 'گردنبند' }));

    expect(useRecentJewelryItemsStore.getState().recent.map((i) => i.jewelryItemId)).toEqual(['j2', 'j1']);
  });

  it('انتخاب دوباره‌ی همان کالا آن را بدون تکرار به بالا می‌آورد', () => {
    useRecentJewelryItemsStore.getState().recordSelection(item({ jewelryItemId: 'j1' }));
    useRecentJewelryItemsStore.getState().recordSelection(item({ jewelryItemId: 'j2' }));
    useRecentJewelryItemsStore.getState().recordSelection(item({ jewelryItemId: 'j1', title: 'انگشتر (به‌روز)' }));

    const { recent } = useRecentJewelryItemsStore.getState();
    expect(recent.map((i) => i.jewelryItemId)).toEqual(['j1', 'j2']);
    expect(recent[0]?.title).toBe('انگشتر (به‌روز)');
  });

  it('بیشتر از سقف مجاز نگه داشته نمی‌شود', () => {
    for (let i = 0; i < 12; i += 1) {
      useRecentJewelryItemsStore.getState().recordSelection(item({ jewelryItemId: `j${i}` }));
    }

    expect(useRecentJewelryItemsStore.getState().recent.length).toBe(8);
    expect(useRecentJewelryItemsStore.getState().recent[0]?.jewelryItemId).toBe('j11');
  });
});

describe('recent-jewelry-items-store — clear', () => {
  it('فهرست را خالی می‌کند', () => {
    useRecentJewelryItemsStore.getState().recordSelection(item());
    useRecentJewelryItemsStore.getState().clear();
    expect(useRecentJewelryItemsStore.getState().recent).toEqual([]);
  });
});

describe('recent-jewelry-items-store — persistence', () => {
  it('تغییر بلافاصله در localStorage نوشته می‌شود', () => {
    useRecentJewelryItemsStore.getState().recordSelection(item());

    const raw = localStorage.getItem(RECENT_JEWELRY_ITEMS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? '{}');
    expect(parsed.state.recent).toHaveLength(1);
    expect(parsed.state.recent[0].jewelryItemId).toBe('j1');
  });
});
