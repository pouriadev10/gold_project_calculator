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
  /** FE-092: فیلد غیرفعال (مثلاً حین ثبت) هیچ ورودی‌ای نمی‌پذیرد و «بعدی/قبلی» از رویش می‌گذرد. */
  readonly disabled?: boolean;
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
  /** FE-092: غیرفعال شدن فیلد فعال، کیپد را می‌بندد تا ضربه‌ی بعدی مقدارش را عوض نکند. */
  setFieldDisabled: (id: string, disabled: boolean) => void;

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

function isEnabled(field: KeypadFieldDef | undefined): field is KeypadFieldDef {
  return field !== undefined && field.disabled !== true;
}

/** نزدیک‌ترین فیلد فعال (غیر disabled) در جهت `step` از فیلد فعال کنونی. */
export function neighbourField(
  fields: readonly KeypadFieldDef[],
  activeId: string | null,
  step: 1 | -1,
): KeypadFieldDef | undefined {
  const index = fields.findIndex((f) => f.id === activeId);
  if (index === -1) return undefined;
  for (let i = index + step; i >= 0 && i < fields.length; i += step) {
    if (isEnabled(fields[i])) return fields[i];
  }
  return undefined;
}

/**
 * ویرایش بافر فیلد فعال با یک تابع خالص. فیلد غیرفعال هرگز ویرایش نمی‌شود — حتی اگر کیپد
 * پیش از غیرفعال شدنش رویش باز مانده باشد (FE-092).
 */
function editActive(state: KeypadState, edit: (raw: string) => string): Partial<KeypadState> {
  const { activeId } = state;
  if (!activeId) return {};
  if (!isEnabled(state.fields.find((f) => f.id === activeId))) return {};
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

  setFieldDisabled: (id, disabled) =>
    set((state) => {
      const field = state.fields.find((f) => f.id === id);
      if (!field || (field.disabled === true) === disabled) return state;
      const fields = state.fields.map((f) => (f.id === id ? { ...f, disabled } : f));
      return disabled && state.activeId === id ? { fields, activeId: null, isOpen: false } : { fields };
    }),

  open: (id) =>
    set((state) => (state.fields.some((f) => f.id === id && f.disabled === true) ? state : { isOpen: true, activeId: id })),
  close: () => set({ isOpen: false }),
  focusField: (id) =>
    set((state) => (state.fields.some((f) => f.id === id && f.disabled === true) ? state : { activeId: id, isOpen: true })),

  moveNext: () =>
    set((state) => {
      // روی آخرین فیلد فعال، «بعدی» بی‌اثر است — کاربر باید «تمام» بزند
      const next = neighbourField(state.fields, state.activeId, 1);
      return next ? { activeId: next.id } : {};
    }),

  movePrev: () =>
    set((state) => {
      const prev = neighbourField(state.fields, state.activeId, -1);
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
