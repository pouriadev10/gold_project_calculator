import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PURCHASE_KARAT,
  hasPurchaseDraftProgress,
  NAVIGABLE_PURCHASE_STEPS,
  PURCHASE_DRAFT_STORAGE_KEY,
  PURCHASE_STEPS,
  usePurchaseDraftStore,
} from './purchase-draft-store';
import type { PartySelection } from './recent-parties-store';

/**
 * FE-056 / FE-057 — پیش‌نویس خرید دست‌دوم.
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

  it('رفت‌وبرگشت مراحل، فروشنده و داده‌های وزن‌کشی را از بین نمی‌برد', () => {
    usePurchaseDraftStore.getState().setSeller(SELLER);
    usePurchaseDraftStore.getState().setGrossWeightMg('4500');
    usePurchaseDraftStore.getState().setStoneWeightMg('200');
    usePurchaseDraftStore.getState().setOtherDeductionWeightMg('50');
    usePurchaseDraftStore.getState().setPurchaseKarat(750);
    usePurchaseDraftStore.getState().setFeeRial('100000');

    usePurchaseDraftStore.getState().goToStep('QUOTE');
    usePurchaseDraftStore.getState().goToStep('SELLER');

    expect(usePurchaseDraftStore.getState().seller).toEqual(SELLER);
    expect(usePurchaseDraftStore.getState().grossWeightMg).toBe('4500');
    expect(usePurchaseDraftStore.getState().stoneWeightMg).toBe('200');
    expect(usePurchaseDraftStore.getState().otherDeductionWeightMg).toBe('50');
    expect(usePurchaseDraftStore.getState().purchaseKarat).toBe(750);
    expect(usePurchaseDraftStore.getState().feeRial).toBe('100000');
  });

  it('goToStep به RECEIPT هم اجازه‌ی set می‌دهد — فقط مسیر ثبت موفق (FE-059) از آن می‌گذرد', () => {
    usePurchaseDraftStore.getState().goToStep('RECEIPT');
    expect(usePurchaseDraftStore.getState().step).toBe('RECEIPT');
  });
});

describe('usePurchaseDraftStore — مقادیر و ماندگاری', () => {
  it('در sessionStorage (نه localStorage) ذخیره می‌شود', () => {
    usePurchaseDraftStore.getState().setSeller(SELLER);
    usePurchaseDraftStore.getState().goToStep('WEIGHING');

    expect(sessionStorage.getItem(PURCHASE_DRAFT_STORAGE_KEY)).not.toBeNull();
  });

  it('پس از reset، همه‌ی فیلدها به مقادیر اولیه بازمی‌گردند', () => {
    usePurchaseDraftStore.getState().setSeller(SELLER);
    usePurchaseDraftStore.getState().setGrossWeightMg('5000');
    usePurchaseDraftStore.getState().setStoneWeightMg('100');
    usePurchaseDraftStore.getState().setOtherDeductionWeightMg('50');
    usePurchaseDraftStore.getState().setPurchaseKarat(900);
    usePurchaseDraftStore.getState().setFeeRial('50000');
    usePurchaseDraftStore.getState().goToStep('PAYMENT');

    usePurchaseDraftStore.getState().reset();

    expect(usePurchaseDraftStore.getState().step).toBe('SELLER');
    expect(usePurchaseDraftStore.getState().seller).toBeNull();
    expect(usePurchaseDraftStore.getState().grossWeightMg).toBe('0');
    expect(usePurchaseDraftStore.getState().stoneWeightMg).toBe('0');
    expect(usePurchaseDraftStore.getState().otherDeductionWeightMg).toBe('0');
    expect(usePurchaseDraftStore.getState().purchaseKarat).toBe(DEFAULT_PURCHASE_KARAT);
    expect(usePurchaseDraftStore.getState().feeRial).toBe('0');
  });

  it('hasPurchaseDraftProgress تغییرات وزن یا فروشنده را تشخیص می‌دهد', () => {
    expect(
      hasPurchaseDraftProgress({
        step: 'SELLER',
        seller: null,
        grossWeightMg: '0',
        feeRial: '0',
      }),
    ).toBe(false);

    expect(
      hasPurchaseDraftProgress({
        step: 'SELLER',
        seller: null,
        grossWeightMg: '2500',
        feeRial: '0',
      }),
    ).toBe(true);

    expect(
      hasPurchaseDraftProgress({
        step: 'WEIGHING',
        seller: null,
        grossWeightMg: '0',
        feeRial: '0',
      }),
    ).toBe(true);
  });
});
