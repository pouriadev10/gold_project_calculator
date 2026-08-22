import { beforeEach, describe, expect, it } from 'vitest';
import {
  hasSaleDraftProgress,
  SALE_DRAFT_STORAGE_KEY,
  SALE_STEPS,
  useSaleDraftStore,
  type SaleDraftItemLine,
} from './sale-draft-store';
import type { PartySelection } from './recent-parties-store';

/**
 * FE-041 — پیش‌نویس فروش.
 *
 * تمرکز روی سه قاعده‌ی خودِ تسک: رفت‌وبرگشت مراحل داده را از بین نبرد،
 * `sessionStorage` (نه `localStorage`)، و `hasSaleDraftProgress` که پایه‌ی
 * هشدار خروج مسیر است.
 */

const PARTY: PartySelection = {
  id: 'p1',
  displayName: 'حسین مرادی',
  mobile: '09121234567',
  type: 'CONSUMER',
  status: 'ACTIVE',
};

const ITEM: SaleDraftItemLine = {
  lineId: 'l1',
  kind: 'CATALOG',
  jewelryItemId: 'j1',
  code: 'R-100',
  title: 'انگشتر سادگی',
  pricing: null,
};

beforeEach(() => {
  useSaleDraftStore.getState().reset();
  sessionStorage.clear();
});

describe('useSaleDraftStore — پیمایش مراحل', () => {
  it('مرحله‌ی اول QUOTE است', () => {
    expect(useSaleDraftStore.getState().step).toBe('QUOTE');
  });

  it('next مرحله را به بعدی می‌برد، تا انتهای فهرست', () => {
    for (const expected of SALE_STEPS.slice(1)) {
      useSaleDraftStore.getState().next();
      expect(useSaleDraftStore.getState().step).toBe(expected);
    }
    // روی آخرین مرحله، next بی‌اثر است
    useSaleDraftStore.getState().next();
    expect(useSaleDraftStore.getState().step).toBe(SALE_STEPS[SALE_STEPS.length - 1]);
  });

  it('back مرحله را به قبلی می‌برد، و روی مرحله‌ی اول بی‌اثر است', () => {
    useSaleDraftStore.getState().goToStep('PARTY');
    useSaleDraftStore.getState().back();
    expect(useSaleDraftStore.getState().step).toBe('QUOTE');

    useSaleDraftStore.getState().back();
    expect(useSaleDraftStore.getState().step).toBe('QUOTE');
  });

  it('رفت‌وبرگشت مراحل، داده‌ی انتخاب‌شده (مشتری) را از بین نمی‌برد', () => {
    useSaleDraftStore.getState().setParty(PARTY);
    useSaleDraftStore.getState().goToStep('ITEMS');
    useSaleDraftStore.getState().goToStep('QUOTE');
    useSaleDraftStore.getState().goToStep('PARTY');

    expect(useSaleDraftStore.getState().party).toEqual(PARTY);
  });

  it('رفت‌وبرگشت مراحل، اقلام انتخاب‌شده را از بین نمی‌برد', () => {
    useSaleDraftStore.getState().setItems([ITEM]);
    useSaleDraftStore.getState().goToStep('PAYMENT');
    useSaleDraftStore.getState().goToStep('ITEMS');

    expect(useSaleDraftStore.getState().items).toEqual([ITEM]);
  });
});

describe('useSaleDraftStore — قفل مظنه‌ی مرور (lockMazneh)', () => {
  const SNAPSHOT_1 = { quoteId: 'c1000000-0000-4000-8000-000000000001', mazneh: '324885150', source: 'MANUAL' as const, observedAt: '2026-08-01T08:00:00.000Z' };
  const SNAPSHOT_2 = { quoteId: 'c1000000-0000-4000-8000-000000000002', mazneh: '400000000', source: 'FEED' as const, observedAt: '2026-08-02T08:00:00.000Z' };

  it('پیش از فراخوانی، مقدار null است', () => {
    expect(useSaleDraftStore.getState().lockedMazneh).toBeNull();
  });

  it('اولین فراخوانی مقدار را قفل می‌کند', () => {
    useSaleDraftStore.getState().lockMazneh(SNAPSHOT_1);
    expect(useSaleDraftStore.getState().lockedMazneh).toEqual(SNAPSHOT_1);
  });

  it('فراخوانی دوباره بعد از قفل‌شدن، مقدار اول را بی‌صدا نگه می‌دارد', () => {
    useSaleDraftStore.getState().lockMazneh(SNAPSHOT_1);
    useSaleDraftStore.getState().lockMazneh(SNAPSHOT_2);
    expect(useSaleDraftStore.getState().lockedMazneh).toEqual(SNAPSHOT_1);
  });

  it('reset قفل را پاک می‌کند تا فروش بعدی بتواند دوباره قفل کند', () => {
    useSaleDraftStore.getState().lockMazneh(SNAPSHOT_1);
    useSaleDraftStore.getState().reset();
    expect(useSaleDraftStore.getState().lockedMazneh).toBeNull();

    useSaleDraftStore.getState().lockMazneh(SNAPSHOT_2);
    expect(useSaleDraftStore.getState().lockedMazneh).toEqual(SNAPSHOT_2);
  });
});

describe('useSaleDraftStore — hasSaleDraftProgress', () => {
  it('مرحله‌ی اول بدون مشتری یعنی هنوز شروع نشده', () => {
    expect(hasSaleDraftProgress(useSaleDraftStore.getState())).toBe(false);
  });

  it('انتخاب مشتری یعنی draft شروع شده، حتی روی مرحله‌ی اول', () => {
    useSaleDraftStore.getState().setParty(PARTY);
    expect(hasSaleDraftProgress(useSaleDraftStore.getState())).toBe(true);
  });

  it('رفتن به مرحله‌ی بعد بدون هیچ انتخابی هم draft حساب می‌شود', () => {
    useSaleDraftStore.getState().goToStep('PARTY');
    expect(hasSaleDraftProgress(useSaleDraftStore.getState())).toBe(true);
  });

  it('افزودن قلم یعنی draft شروع شده، حتی روی مرحله‌ی اول', () => {
    useSaleDraftStore.getState().setItems([ITEM]);
    expect(hasSaleDraftProgress(useSaleDraftStore.getState())).toBe(true);
  });

  it('reset، draft را کاملاً پاک می‌کند', () => {
    useSaleDraftStore.getState().setParty(PARTY);
    useSaleDraftStore.getState().setItems([ITEM]);
    useSaleDraftStore.getState().goToStep('ITEMS');
    useSaleDraftStore.getState().reset();

    expect(useSaleDraftStore.getState().step).toBe('QUOTE');
    expect(useSaleDraftStore.getState().party).toBeNull();
    expect(useSaleDraftStore.getState().items).toEqual([]);
    expect(hasSaleDraftProgress(useSaleDraftStore.getState())).toBe(false);
  });
});

describe('useSaleDraftStore — ماندگاری فقط در sessionStorage', () => {
  it('در sessionStorage نوشته می‌شود، نه localStorage', () => {
    useSaleDraftStore.getState().setParty(PARTY);
    useSaleDraftStore.getState().goToStep('PARTY');

    expect(sessionStorage.getItem(SALE_DRAFT_STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem(SALE_DRAFT_STORAGE_KEY)).toBeNull();

    const persisted = JSON.parse(sessionStorage.getItem(SALE_DRAFT_STORAGE_KEY)!);
    expect(persisted.state.step).toBe('PARTY');
    expect(persisted.state.party).toEqual(PARTY);
  });

  it('اقلام هم در sessionStorage نوشته می‌شوند', () => {
    useSaleDraftStore.getState().setItems([ITEM]);

    const persisted = JSON.parse(sessionStorage.getItem(SALE_DRAFT_STORAGE_KEY)!);
    expect(persisted.state.items).toEqual([ITEM]);
  });
});
