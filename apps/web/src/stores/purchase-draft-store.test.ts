import { beforeEach, describe, expect, it } from 'vitest';
import {
  hasPurchaseDraftProgress,
  NAVIGABLE_PURCHASE_STEPS,
  PURCHASE_DRAFT_STORAGE_KEY,
  PURCHASE_STEPS,
  usePurchaseDraftStore,
} from './purchase-draft-store';
import type { PartySelection } from './recent-parties-store';

/**
 * FE-056 — پیش‌نویس خرید دست‌دوم.
 *
 * تمرکز روی سه قاعده‌ی خودِ تسک: رفت‌وبرگشت مراحل داده را از بین نبرد،
 * `sessionStorage` (نه `localStorage`)، و «رسید» که مرحله‌ی پیمایش‌پذیر
 * نیست — با «بعدی» هرگز وارد نمی‌شود، فقط پس از ثبت موفق (FE-059).
 */

const SELLER: PartySelection = {
  id: 'p1',
  displayName: 'حسین مرادی',
  mobile: '09121234567',
  type: 'CONSUMER',
  status: 'ACTIVE',
};

beforeEach(() => {
  usePurchaseDraftStore.getState().reset();
  sessionStorage.clear();
});

describe('usePurchaseDraftStore — پیمایش مراحل', () => {
  it('مرحله‌ی اول SELLER است و فهرست مراحل دقیقاً هشت‌تای تسک است', () => {
    expect(usePurchaseDraftStore.getState().step).toBe('SELLER');
    expect(PURCHASE_STEPS).toEqual([
      'SELLER',
      'WEIGHING',
      'DEDUCTIONS',
      'KARAT',
      'QUOTE',
      'AMOUNT',
      'PAYMENT',
      'RECEIPT',
    ]);
  });

  it('next فقط روی مراحل پیمایش‌پذیر جلو می‌رود و هرگز وارد RECEIPT نمی‌شود', () => {
    for (const expected of NAVIGABLE_PURCHASE_STEPS.slice(1)) {
      usePurchaseDraftStore.getState().next();
      expect(usePurchaseDraftStore.getState().step).toBe(expected);
    }
    // روی آخرین مرحله‌ی پیمایش‌پذیر (PAYMENT)، next بی‌اثر است — رسید فقط پس از ثبت
    usePurchaseDraftStore.getState().next();
    expect(usePurchaseDraftStore.getState().step).toBe('PAYMENT');
  });

  it('back مرحله را به قبلی می‌برد، و روی مرحله‌ی اول بی‌اثر است', () => {
    usePurchaseDraftStore.getState().goToStep('KARAT');
    usePurchaseDraftStore.getState().back();
    expect(usePurchaseDraftStore.getState().step).toBe('DEDUCTIONS');

    usePurchaseDraftStore.getState().back();
    expect(usePurchaseDraftStore.getState().step).toBe('WEIGHING');
    usePurchaseDraftStore.getState().back();
    usePurchaseDraftStore.getState().back();
    expect(usePurchaseDraftStore.getState().step).toBe('SELLER');
  });

  it('رفت‌وبرگشت مراحل، فروشنده‌ی انتخاب‌شده را از بین نمی‌برد', () => {
    usePurchaseDraftStore.getState().setSeller(SELLER);
    usePurchaseDraftStore.getState().goToStep('QUOTE');
    usePurchaseDraftStore.getState().goToStep('SELLER');

    expect(usePurchaseDraftStore.getState().seller).toEqual(SELLER);
  });

  it('goToStep به RECEIPT هم اجازه‌ی set می‌دهد — فقط مسیر ثبت موفق (FE-059) از آن می‌گذرد', () => {
    usePurchaseDraftStore.getState().goToStep('RECEIPT');
    expect(usePurchaseDraftStore.getState().step).toBe('RECEIPT');
  });
});

describe('usePurchaseDraftStore — ماندگاری', () => {
  it('در sessionStorage (نه localStorage) ذخیره می‌شود', () => {
    usePurchaseDraftStore.getState().setSeller(SELLER);
    usePurchaseDraftStore.getState().goToStep('WEIGHING');

    expect(sessionStorage.getItem(PURCHASE_DRAFT_STORAGE_KEY)).not.toBeNull();
  });

  it('پس از reset، مرحله و فروشنده پاک می‌شوند', () => {
    usePurchaseDraftStore.getState().setSeller(SELLER);
    usePurchaseDraftStore.getState().goToStep('PAYMENT');
    usePurchaseDraftStore.getState().reset();

    expect(usePurchaseDraftStore.getState().step).toBe('SELLER');
    expect(usePurchaseDraftStore.getState().seller).toBeNull();
  });
});

describe('hasPurchaseDraftProgress', () => {
  it('روی مرحله‌ی اول بدون فروشنده، یعنی «هنوز شروع نشده»', () => {
    const state = usePurchaseDraftStore.getState();
    expect(hasPurchaseDraftProgress({ step: state.step, seller: state.seller })).toBe(false);
  });

  it('با فروشنده‌ی انتخاب‌شده روشن است', () => {
    usePurchaseDraftStore.getState().setSeller(SELLER);
    const state = usePurchaseDraftStore.getState();
    expect(hasPurchaseDraftProgress({ step: state.step, seller: state.seller })).toBe(true);
  });

  it('بدون انتخاب، فقط جلو رفتن از مرحله‌ی اول کافی است', () => {
    usePurchaseDraftStore.getState().goToStep('WEIGHING');
    const state = usePurchaseDraftStore.getState();
    expect(hasPurchaseDraftProgress({ step: state.step, seller: state.seller })).toBe(true);
  });
});
