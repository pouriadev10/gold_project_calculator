import { create } from 'zustand';
import { type ApiErrorKind, presentApiError } from '@/api/error-presentation';

/**
 * استور toastهای عملیاتی — پیام کوتاه‌مدت شناور، **نه** جایگزین
 * `ApiErrorNotice` (که خطای مالی را همراه state صفحه نگه می‌دارد؛
 * قاعده‌ی FE-009). این‌جا فقط برای بازخورد لحظه‌ای عملیات است.
 *
 * ماندگاری بر اساس شدت: موفقیت زودتر می‌رود، خطا و conflict دیرتر —
 * چون کاربر باید فرصت خواندن خطای مالی را داشته باشد، حتی اگر همان
 * پیام جای دیگری هم (در صفحه) مانده باشد.
 */

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastInput {
  readonly variant: ToastVariant;
  readonly title: string;
  readonly description?: string;
}

export interface ToastItem extends ToastInput {
  readonly id: string;
  readonly duration: number;
  readonly open: boolean;
}

const VARIANT_DURATION_MS: Record<ToastVariant, number> = {
  success: 4000,
  info: 5000,
  warning: 6000,
  error: 8000,
};

/** باید با مدت انیمیشن خروج در `toast.tsx` (`duration-200`) هماهنگ بماند. */
const REMOVE_DELAY_MS = 200;

function dedupeKey(input: ToastInput): string {
  return `${input.variant}:${input.title}:${input.description ?? ''}`;
}

let idCounter = 0;
function createToastId(): string {
  idCounter += 1;
  return `toast-${idCounter}`;
}

interface ToastState {
  toasts: ToastItem[];
  push: (input: ToastInput) => string;
  /** شروع بستن — گزینه هنوز در فهرست می‌ماند تا انیمیشن خروج تمام شود. */
  dismiss: (id: string) => void;
  /** حذف قطعی از فهرست، بعد از پایان انیمیشن خروج. */
  remove: (id: string) => void;
}

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  push: (input) => {
    const key = dedupeKey(input);
    // toast بسته‌شونده (در حال انیمیشن خروج) مانع toast تازه نمی‌شود —
    // فقط toast هنوز-باز تکراری را رد می‌کنیم
    const duplicate = get().toasts.find((t) => t.open && dedupeKey(t) === key);
    if (duplicate) return duplicate.id;

    const id = createToastId();
    set((state) => ({
      toasts: [...state.toasts, { ...input, id, duration: VARIANT_DURATION_MS[input.variant], open: true }],
    }));
    return id;
  },

  dismiss: (id) => {
    set((state) => ({
      toasts: state.toasts.map((t) => (t.id === id ? { ...t, open: false } : t)),
    }));
    setTimeout(() => get().remove(id), REMOVE_DELAY_MS);
  },

  remove: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/* ── API قابل‌فراخوانی از هر جا (نه فقط از داخل کامپوننت) ────── */

function pushToast(variant: ToastVariant, title: string, description?: string): string {
  return useToastStore.getState().push(
    description !== undefined ? { variant, title, description } : { variant, title },
  );
}

// «نیازمند توجه» نه شکست قطعی — هم‌راستا با معنای توکن warning در design-system/MASTER.md
const WARNING_KINDS: ReadonlySet<ApiErrorKind> = new Set(['conflict', 'validation']);

export const toast = {
  success: (title: string, description?: string) => pushToast('success', title, description),
  error: (title: string, description?: string) => pushToast('error', title, description),
  warning: (title: string, description?: string) => pushToast('warning', title, description),
  info: (title: string, description?: string) => pushToast('info', title, description),

  /**
   * خطای API را به toast تبدیل می‌کند — همیشه از `presentApiError` (FE-009)
   * عبور می‌کند، پس پیام خام سرور یا PostgreSQL هرگز مستقیم به toast راه
   * پیدا نمی‌کند. عمداً هیچ overload برای پیام دستی ندارد؛ برای پیام آزاد
   * از `toast.error` استفاده کن.
   */
  apiError: (error: unknown) => {
    const presentation = presentApiError(error);
    const variant: ToastVariant = WARNING_KINDS.has(presentation.kind) ? 'warning' : 'error';
    return pushToast(variant, presentation.title, presentation.message);
  },
};
