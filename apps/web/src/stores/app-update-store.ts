import { create } from 'zustand';

/**
 * نسخه‌ی تازه‌ی برنامه که نصب شده و منتظر اجازه‌ی کاربر است — FE-090.
 *
 * سرویس‌ورکر در حالت «prompt» ساخته می‌شود: نسخه‌ی تازه دانلود و نصب می‌شود ولی تا
 * کاربر «به‌روزرسانی» را نزند کنترل را نمی‌گیرد و صفحه بارگذاری دوباره نمی‌شود. وسط ثبت
 * یک فروش، بارگذاری خودکار یعنی از دست رفتن فرم نیمه‌کاره — تصمیمش با کاربر است.
 */
interface AppUpdateState {
  /** سرویس‌ورکر نصب‌شده‌ی منتظر؛ `null` یعنی به‌روزرسانی‌ای در کار نیست. */
  waiting: ServiceWorker | null;
  /** کاربر اعلان را برای همین نشست کنار گذاشت (با نسخه‌ی تازه‌تر دوباره نشان داده می‌شود). */
  dismissed: boolean;
  setWaiting: (worker: ServiceWorker) => void;
  dismiss: () => void;
}

export const useAppUpdateStore = create<AppUpdateState>()((set) => ({
  waiting: null,
  dismissed: false,
  setWaiting: (worker) => set({ waiting: worker, dismissed: false }),
  dismiss: () => set({ dismissed: true }),
}));
