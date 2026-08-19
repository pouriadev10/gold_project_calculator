import { beforeEach, describe, expect, it } from 'vitest';
import { RECENT_PARTIES_STORAGE_KEY, useRecentPartiesStore, type PartySelection } from './recent-parties-store';

function party(overrides: Partial<PartySelection> = {}): PartySelection {
  return {
    id: 'p1',
    displayName: 'حسین مرادی',
    mobile: '09121234567',
    type: 'CONSUMER',
    status: 'ACTIVE',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  useRecentPartiesStore.setState({ recent: [] });
});

describe('recent-parties-store — پیش‌فرض', () => {
  it('فهرست اخیر خالی شروع می‌شود', () => {
    expect(useRecentPartiesStore.getState().recent).toEqual([]);
  });
});

describe('recent-parties-store — recordSelection', () => {
  it('شخص تازه به ابتدای فهرست اضافه می‌شود', () => {
    useRecentPartiesStore.getState().recordSelection(party({ id: 'p1' }));
    useRecentPartiesStore.getState().recordSelection(party({ id: 'p2', displayName: 'زهرا کریمی' }));

    expect(useRecentPartiesStore.getState().recent.map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('انتخاب دوباره‌ی همان شخص او را بدون تکرار به بالا می‌آورد', () => {
    useRecentPartiesStore.getState().recordSelection(party({ id: 'p1' }));
    useRecentPartiesStore.getState().recordSelection(party({ id: 'p2' }));
    useRecentPartiesStore.getState().recordSelection(party({ id: 'p1', displayName: 'حسین مرادی (به‌روز)' }));

    const { recent } = useRecentPartiesStore.getState();
    expect(recent.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(recent[0]?.displayName).toBe('حسین مرادی (به‌روز)');
  });

  it('بیشتر از سقف مجاز نگه داشته نمی‌شود', () => {
    for (let i = 0; i < 12; i += 1) {
      useRecentPartiesStore.getState().recordSelection(party({ id: `p${i}` }));
    }

    expect(useRecentPartiesStore.getState().recent.length).toBe(8);
    expect(useRecentPartiesStore.getState().recent[0]?.id).toBe('p11');
  });
});

describe('recent-parties-store — clear', () => {
  it('فهرست را خالی می‌کند', () => {
    useRecentPartiesStore.getState().recordSelection(party());
    useRecentPartiesStore.getState().clear();
    expect(useRecentPartiesStore.getState().recent).toEqual([]);
  });
});

describe('recent-parties-store — persistence', () => {
  it('تغییر بلافاصله در localStorage نوشته می‌شود، بدون کد ملی یا یادداشت', () => {
    useRecentPartiesStore.getState().recordSelection(party());

    const raw = localStorage.getItem(RECENT_PARTIES_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? '{}');
    expect(parsed.state.recent).toHaveLength(1);
    expect(parsed.state.recent[0]).not.toHaveProperty('nationalId');
    expect(parsed.state.recent[0]).not.toHaveProperty('notes');
  });
});
