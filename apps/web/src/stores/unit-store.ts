import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * واحد نمایش اعداد مالی.
 *
 * پیش‌فرض **طلا** است، نه ریال — این وارونگی کل گزاره‌ی ارزش محصول است.
 * انتخاب کاربر یک تنظیم سراسری است که در هر صفحه هم لحظه‌ای تغییر می‌کند.
 */
export type MoneyUnit = 'gold' | 'rial';

interface UnitState {
  unit: MoneyUnit;
  setUnit: (unit: MoneyUnit) => void;
  toggleUnit: () => void;
}

/**
 * `localStorage` اینجا فقط **تنظیم رابط کاربری** را نگه می‌دارد، نه داده‌ی
 * مالی. داده‌ی مالی هرگز در localStorage نمی‌نشیند.
 */
export const useUnitStore = create<UnitState>()(
  persist(
    (set) => ({
      unit: 'gold',
      setUnit: (unit) => set({ unit }),
      toggleUnit: () => set((state) => ({ unit: state.unit === 'gold' ? 'rial' : 'gold' })),
    }),
    { name: 'gold-ui-unit' },
  ),
);

/** برچسب فارسی واحد — یک منبع، تا در صفحات مختلف فرق نکند. */
export const UNIT_LABEL: Record<MoneyUnit, string> = {
  gold: 'گرم',
  rial: 'ریال',
};

export const UNIT_TITLE: Record<MoneyUnit, string> = {
  gold: 'طلا',
  rial: 'ریال',
};
