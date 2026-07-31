import { mulDivHalfUp, type NumericFieldKind } from '@gold/core-calc';

/**
 * ستون میان‌برهای دامنه‌ای — دلیل اصلی وجود کیپد سفارشی.
 *
 * بدون این‌ها کاربر باید `۷۵۰` را رقم‌به‌رقم بزند؛ با این‌ها یک ضربه.
 * روی صد فاکتور در روز، همین تفاوت است که «زیر ۱۵ ثانیه» را ممکن می‌کند.
 *
 * **هیچ‌کدام از این اعداد، عدد صنفیِ محاسباتی نیستند** — میان‌بر ورودی‌اند.
 * عیار واقعی کالا از دیتابیس می‌آید؛ این‌ها فقط تایپ را کوتاه می‌کنند.
 */

export type Shortcut =
  /** جایگزینی مستقیم مقدار */
  | { readonly type: 'set'; readonly label: string; readonly aria: string; readonly value: bigint }
  /** تبدیل مقدار فعلی */
  | {
      readonly type: 'transform';
      readonly label: string;
      readonly aria: string;
      readonly apply: (current: bigint) => bigint;
    };

/** مثقال بر حسب میلی‌گرم × ۱۰ — ۴.۶۰۸۳ گرم */
const MESGHAL_MG_X10 = 46_083n;

const KARAT_SHORTCUTS: readonly Shortcut[] = [
  { type: 'set', label: '۷۵۰', aria: 'عیار ۷۵۰', value: 750n },
  { type: 'set', label: '۹۹۵', aria: 'عیار ۹۹۵', value: 995n },
  { type: 'set', label: '۷۴۰', aria: 'عیار ۷۴۰', value: 740n },
  { type: 'set', label: '۹۲۵', aria: 'عیار ۹۲۵', value: 925n },
  { type: 'set', label: '۹۰۰', aria: 'عیار ۹۰۰', value: 900n },
];

const WEIGHT_SHORTCUTS: readonly Shortcut[] = [
  {
    type: 'transform',
    label: '÷۵',
    aria: 'تقسیم بر پنج',
    apply: (v) => mulDivHalfUp(v, 1n, 5n),
  },
  { type: 'transform', label: '×۲', aria: 'ضرب در دو', apply: (v) => v * 2n },
  {
    type: 'transform',
    label: 'مثقال',
    aria: 'تبدیل عدد واردشده از مثقال به گرم',
    // کاربر «۲» زده یعنی ۲ مثقال → ۹.۲۱۶۶ گرم
    apply: (v) => mulDivHalfUp(v, MESGHAL_MG_X10, 10_000n),
  },
];

const AMOUNT_SHORTCUTS: readonly Shortcut[] = [
  { type: 'transform', label: '۰۰۰', aria: 'افزودن سه صفر', apply: (v) => v * 1_000n },
  { type: 'transform', label: '۰۰۰۰۰', aria: 'افزودن پنج صفر', apply: (v) => v * 100_000n },
];

const COUNT_SHORTCUTS: readonly Shortcut[] = [
  { type: 'set', label: '۱', aria: 'تعداد یک', value: 1n },
  { type: 'set', label: '۲', aria: 'تعداد دو', value: 2n },
  { type: 'set', label: '۵', aria: 'تعداد پنج', value: 5n },
  { type: 'set', label: '۱۰', aria: 'تعداد ده', value: 10n },
];

export const SHORTCUTS_BY_KIND: Record<NumericFieldKind, readonly Shortcut[]> = {
  karat: KARAT_SHORTCUTS,
  weight: WEIGHT_SHORTCUTS,
  rial: AMOUNT_SHORTCUTS,
  mazneh: AMOUNT_SHORTCUTS,
  count: COUNT_SHORTCUTS,
};
