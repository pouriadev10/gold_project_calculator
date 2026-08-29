import {
  DIGIT_SPECS,
  bigIntToDigits,
  clearDigits,
  digitsToBigInt,
  pasteDigits,
  popDigit,
  pushDigit,
  pushSeparator,
  type NumericFieldKind,
} from '@gold/core-calc';
import { create } from 'zustand';

/**
 * وضعیت صفحه‌کلید عددی.
 *
 * **چرا استور جدا:** هر ضربه‌ی کاربر یک به‌روزرسانی است. اگر این حالت
 * در `useState` صفحه بنشیند، هر رقم کل درخت صفحه را ری‌رندر می‌کند و
 * تأخیر ضربه تا رنگ‌آمیزی از ۱۰۰ms رد می‌شود. با استور جدا و انتخابگر
 * باریک، فقط همان کلید و همان فیلد دوباره رندر می‌شوند.
 *
 * مقدارها **رشته‌ی ارقام**اند و فقط با `digitsToBigInt` به `bigint`
 * تبدیل می‌شوند — هیچ‌جای این مسیر float نیست.
 */

export interface KeypadFieldDef {
  readonly id: string;
  readonly kind: NumericFieldKind;
  readonly label: string;
}

interface KeypadState {
  isOpen: boolean;
  /** فیلدهای ثبت‌شده به ترتیب حرکت */
  fields: KeypadFieldDef[];
  activeId: string | null;
  /** بافر رشته‌ای هر فیلد */
  buffers: Record<string, string>;

  registerField: (field: KeypadFieldDef) => void;
  unregisterField: (id: string) => void;

  open: (id: string) => void;
  close: () => void;
  focusField: (id: string) => void;
  moveNext: () => void;
  movePrev: () => void;

  pressDigit: (digit: string) => void;
  pressSeparator: () => void;
  pressBackspace: () => void;
  pressClear: () => void;
  /** میان‌بر: جایگزینی مستقیم مقدار */
  setValue: (value: bigint) => void;
  /** میان‌بر: تبدیل مقدار فعلی */
  transformValue: (apply: (current: bigint) => bigint) => void;
  /** چسباندن (paste) — جای‌گزینی کامل بافر فیلد فعال با متن چسبانده‌شده */
  pasteText: (text: string) => void;

  setBuffer: (id: string, raw: string) => void;
  reset: () => void;
}

function specOf(state: KeypadState, id: string | null) {
  const field = state.fields.find((f) => f.id === id);
  return field ? DIGIT_SPECS[field.kind] : null;
}

/** ویرایش بافر فیلد فعال با یک تابع خالص. */
function editActive(state: KeypadState, edit: (raw: string) => string): Partial<KeypadState> {
  const { activeId } = state;
  if (!activeId) return {};
  return { buffers: { ...state.buffers, [activeId]: edit(state.buffers[activeId] ?? '') } };
}

export const useKeypadStore = create<KeypadState>()((set) => ({
  isOpen: false,
  fields: [],
  activeId: null,
  buffers: {},

  registerField: (field) =>
    set((state) =>
      state.fields.some((f) => f.id === field.id)
        ? state
        : { fields: [...state.fields, field] },
    ),

  unregisterField: (id) =>
    set((state) => ({
      fields: state.fields.filter((f) => f.id !== id),
      activeId: state.activeId === id ? null : state.activeId,
    })),

  open: (id) => set({ isOpen: true, activeId: id }),
  close: () => set({ isOpen: false }),
  focusField: (id) => set({ activeId: id, isOpen: true }),

  moveNext: () =>
    set((state) => {
      const index = state.fields.findIndex((f) => f.id === state.activeId);
      const next = state.fields[index + 1];
      // روی آخرین فیلد، «بعدی» بی‌اثر است — کاربر باید «تمام» بزند
      return next ? { activeId: next.id } : {};
    }),

  movePrev: () =>
    set((state) => {
      const index = state.fields.findIndex((f) => f.id === state.activeId);
      const prev = index > 0 ? state.fields[index - 1] : undefined;
      return prev ? { activeId: prev.id } : {};
    }),

  pressDigit: (digit) =>
    set((state) => {
      const spec = specOf(state, state.activeId);
      if (!spec) return {};
      return editActive(state, (raw) => pushDigit(raw, digit, spec));
    }),

  pressSeparator: () =>
    set((state) => {
      const spec = specOf(state, state.activeId);
      if (!spec) return {};
      return editActive(state, (raw) => pushSeparator(raw, spec));
    }),

  pressBackspace: () => set((state) => editActive(state, popDigit)),

  pressClear: () => set((state) => editActive(state, clearDigits)),

  setValue: (value) =>
    set((state) => {
      const spec = specOf(state, state.activeId);
      if (!spec) return {};
      return editActive(state, () => bigIntToDigits(value, spec));
    }),

  transformValue: (apply) =>
    set((state) => {
      const spec = specOf(state, state.activeId);
      if (!spec) return {};
      return editActive(state, (raw) => bigIntToDigits(apply(digitsToBigInt(raw, spec)), spec));
    }),

  pasteText: (text) =>
    set((state) => {
      const spec = specOf(state, state.activeId);
      if (!spec) return {};
      return editActive(state, () => pasteDigits(text, spec));
    }),

  setBuffer: (id, raw) =>
    set((state) => {
      if (state.buffers[id] === raw) return state;
      return { buffers: { ...state.buffers, [id]: raw } };
    }),

  reset: () => set({ isOpen: false, activeId: null, buffers: {} }),
}));

/* ── انتخابگرها ────────────────────────────────────────────── */

/** مقدار `bigint` یک فیلد — خارج از کامپوننت هم قابل استفاده است. */
export function readFieldValue(id: string): bigint {
  const state = useKeypadStore.getState();
  const field = state.fields.find((f) => f.id === id);
  if (!field) return 0n;
  return digitsToBigInt(state.buffers[id] ?? '', DIGIT_SPECS[field.kind]);
}

/** اولین فیلد از نوع داده‌شده — برای پیش‌نمایش زنده. */
export function findFieldByKind(
  fields: KeypadFieldDef[],
  kind: NumericFieldKind,
): KeypadFieldDef | undefined {
  return fields.find((f) => f.kind === kind);
}
