import { useEffect, useId, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import {
  DIGIT_SPECS,
  bigIntToDigits,
  digitsToBigInt,
  formatCount,
  formatKarat,
  formatRial,
  toPersianDigits,
  type NumericFieldKind,
} from '@gold/core-calc';
import { cn } from '@/lib/utils';
import { KEYPAD_ROOT_ATTRIBUTE, reserveKeypadSpace } from './keypad-root';
import { useKeypadStore } from './keypad-store';

/**
 * فیلد عددی — پل میان فرم و صفحه‌کلید سفارشی.
 *
 * ## چرا `readOnly` و `inputMode="none"`
 *
 * این ترکیب تنها راه قابل اتکا برای **باز نشدن کیبورد سیستم‌عامل** است
 * و در عین حال فیلد را focusable و قابل دسترس نگه می‌دارد:
 *
 * - `inputMode="none"` به مرورگر می‌گوید صفحه‌کلید نرم لازم نیست.
 * - `readOnly` تضمین می‌کند حتی اگر مرورگری `inputMode` را نادیده گرفت،
 *   ورودی مستقیم ممکن نباشد؛ برخلاف `disabled`، فوکوس و خواندن با
 *   صفحه‌خوان را از بین نمی‌برد.
 *
 * مقدار نمایشی فارسی است، ولی مقدار واقعی همیشه `bigint` لاتین می‌ماند
 * و در `data-value` هم برای تست و ابزار کمکی گذاشته می‌شود.
 */

export interface NumericFieldProps {
  kind: NumericFieldKind;
  label: string;
  /** ترتیب حرکت کلید «بعدی» را همین ترتیب رندر تعیین می‌کند */
  value?: bigint;
  onChange?: (value: bigint) => void;
  error?: string | undefined;
  hint?: string | undefined;
  disabled?: boolean;
  className?: string;
  /** دکمه‌ی پاک‌کردن مستقیم روی فیلد — علاوه بر نگه‌داشتن ⌫ روی کیپد (FE-021). */
  showClear?: boolean;
}

const UNIT_LABEL: Record<NumericFieldKind, string> = {
  weight: 'گرم',
  coinWeight: 'گرم',
  karat: '',
  rial: 'ریال',
  mazneh: 'ریال',
  count: 'عدد',
  percent: '٪',
};

/** نمایش مقدار با قالب مناسب هر نوع. */
function displayValue(kind: NumericFieldKind, raw: string, value: bigint): string {
  if (raw === '') return '';

  switch (kind) {
    case 'weight':
    case 'coinWeight':
    case 'percent':
      // حین تایپ، خود بافر نمایش داده می‌شود تا «۱۲٫» و صفرهای انتهایی نپرند
      return toPersianDigits(raw.replace('.', '٫'));
    case 'karat':
      return formatKarat(Number.parseInt(raw, 10));
    case 'count':
      return formatCount(Number.parseInt(raw, 10));
    case 'rial':
    case 'mazneh':
      return formatRial(value);
    default:
      return toPersianDigits(raw);
  }
}

/** فاصله‌ی فیلد فعال تا لبه‌ی بالای کیپد. */
const KEYPAD_FIELD_GAP_PX = 16;

/** آیا انگشت/اشاره‌گر الان پایین است — فاز capture، پیش از هر handler دیگری. */
let pointerIsDown = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => (pointerIsDown = true), true);
  window.addEventListener('pointerup', () => (pointerIsDown = false), true);
  window.addEventListener('pointercancel', () => (pointerIsDown = false), true);
}

/**
 * نزدیک‌ترین والد قابل‌اسکرول عمودی (مثلاً بدنه‌ی Bottom Sheet) یا خودِ صفحه را
 * `delta` پایین می‌برد. اگر ظرف تا ته اسکرول شده و جا ندارد (آخرین فیلد یک
 * sheet)، تا بسته شدن کیپد به ته‌اش به اندازه‌ی کیپد جا اضافه می‌شود؛ صفحه این
 * جا را از `NumericKeypad` روی body می‌گیرد.
 */
function scrollAncestorBy(element: HTMLElement, delta: number, keypadHeight: number): void {
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (/(auto|scroll)/u.test(overflowY) && parent.scrollHeight > parent.clientHeight) {
      const room = parent.scrollHeight - parent.clientHeight - parent.scrollTop;
      if (room < delta) reserveKeypadSpace(parent, keypadHeight);
      parent.scrollBy({ top: delta });
      return;
    }
  }
  window.scrollBy({ top: delta });
}

export function NumericField({
  kind,
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
  className,
  showClear,
}: NumericFieldProps) {
  const id = useId();
  const spec = DIGIT_SPECS[kind];

  const registerField = useKeypadStore((s) => s.registerField);
  const unregisterField = useKeypadStore((s) => s.unregisterField);
  const setBuffer = useKeypadStore((s) => s.setBuffer);
  const focusField = useKeypadStore((s) => s.focusField);
  const pasteText = useKeypadStore((s) => s.pasteText);

  const raw = useKeypadStore((s) => s.buffers[id] ?? '');
  const isActive = useKeypadStore((s) => s.activeId === id && s.isOpen);

  useEffect(() => {
    registerField({ id, kind, label });
    return () => unregisterField(id);
  }, [id, kind, label, registerField, unregisterField]);

  /** مقدار اولیه‌ی کنترل‌شده از بیرون */
  useEffect(() => {
    if (value === undefined) return;
    const current = digitsToBigInt(useKeypadStore.getState().buffers[id] ?? '', spec);
    if (current !== value) setBuffer(id, bigIntToDigits(value, spec));
    // فقط وقتی مقدار بیرونی عوض شود؛ تایپ کاربر نباید بازنویسی گردد
  }, [value, id, spec, setBuffer]);

  const currentValue = useMemo(() => digitsToBigInt(raw, spec), [raw, spec]);

  const isInitialMount = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * FE-084: «فیلد بعدی/قبلی» کیپد فقط فیلد فعال استور را عوض می‌کند؛ فوکوس واقعی
   * هم باید دنبالش بیاید تا صفحه‌خوان و کاربر کیبورد همان فیلدی را ببینند که
   * کیپد در آن می‌نویسد. فقط وقتی فوکوس روی فیلد عددی دیگر یا خودِ کیپد است —
   * هرگز از جای دیگری فوکوس دزدیده نمی‌شود.
   */
  useEffect(() => {
    const input = inputRef.current;
    if (!isActive || !input || document.activeElement === input) return;
    const current = document.activeElement;
    if (current instanceof HTMLElement && (current.matches('input[data-kind]') || current.closest(`[${KEYPAD_ROOT_ATTRIBUTE}]`))) {
      input.focus();
    }
  }, [isActive]);

  /*
   * FE-085: کیپد نیمه‌ی پایین صفحه‌ی موبایل را می‌پوشاند (روی ۳۶۰×۸۰۰ از y≈۴۰۶).
   * فیلدی که پایین‌تر از آن لمس شود باید بالای کیپد بیاید، وگرنه کاربر عددی را
   * که تایپ می‌کند نمی‌بیند. جای نهایی کیپد از `offsetTop` خوانده می‌شود که
   * transform انیمیشن ورود را نادیده می‌گیرد. بدون چیدمان (jsdom) کاری نمی‌کند.
   */
  useEffect(() => {
    if (!isActive) return;
    let frame = 0;
    const bringAboveKeypad = () => {
      frame = requestAnimationFrame(() => {
        const box = inputRef.current?.parentElement;
        const keypad = document.querySelector<HTMLElement>(`[${KEYPAD_ROOT_ATTRIBUTE}]`);
        if (!box || !keypad || keypad.offsetHeight === 0) return;
        const overlap = box.getBoundingClientRect().bottom + KEYPAD_FIELD_GAP_PX - keypad.offsetTop;
        if (overlap > 0) scrollAncestorBy(box, overlap, keypad.offsetHeight);
      });
    };
    /*
     * تا انگشت روی صفحه است اسکرول نکن: اگر محتوا وسط ضربه جابه‌جا شود، بلند شدن
     * انگشت روی فیلد دیگری می‌افتد و همان فیلد (یا هیچ‌چیز) فوکوس می‌گیرد.
     */
    if (!pointerIsDown) {
      bringAboveKeypad();
      return () => cancelAnimationFrame(frame);
    }
    window.addEventListener('pointerup', bringAboveKeypad, { once: true });
    window.addEventListener('pointercancel', bringAboveKeypad, { once: true });
    return () => {
      window.removeEventListener('pointerup', bringAboveKeypad);
      window.removeEventListener('pointercancel', bringAboveKeypad);
      cancelAnimationFrame(frame);
    };
  }, [isActive]);

  /** اطلاع تغییر به فرم */
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    // The controlled-value effect may have replaced the buffer after this render.
    // StrictMode replays mount effects; never report that stale render back to the form.
    const latest = digitsToBigInt(useKeypadStore.getState().buffers[id] ?? '', spec);
    if (latest !== currentValue || value === currentValue) return;
    onChange?.(currentValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange پایدار نیست و حلقه می‌سازد
  }, [currentValue]);

  const shown = displayValue(kind, raw, currentValue);
  const unit = UNIT_LABEL[kind];

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>

      <div
        className={cn(
          'flex min-h-touch items-center gap-2 rounded-lg border bg-card px-3 transition-colors',
          isActive ? 'border-ring ring-2 ring-ring ring-offset-1 ring-offset-background' : 'border-input',
          error && 'border-destructive',
          disabled && 'opacity-50',
        )}
      >
        <input
          ref={inputRef}
          id={id}
          // این دو با هم، کیبورد سیستم‌عامل را کنار می‌گذارند
          inputMode="none"
          readOnly
          disabled={disabled}
          value={shown}
          placeholder="۰"
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          data-value={currentValue.toString()}
          data-kind={kind}
          onFocus={() => !disabled && focusField(id)}
          onPointerDown={() => {
            if (disabled) return;
            focusField(id);
            // FE-085: داخل Bottom Sheet فوکوس DOM با لمس جابه‌جا نمی‌شد و روی ظرف sheet
            // می‌ماند؛ فیلد لمس‌شده خودش فوکوس می‌گیرد (اسکرول را effect بالا انجام می‌دهد).
            inputRef.current?.focus({ preventScroll: true });
          }}
          // `readOnly` جلوی درج پیش‌فرض مرورگر را می‌گیرد، ولی خودِ رویداد
          // paste همچنان شلیک می‌شود — همان راهی که چسباندن مقدار فارسی
          // (FE-018) را بدون باز کردن کیبورد سیستم ممکن می‌کند.
          onPaste={(event) => {
            if (disabled) return;
            event.preventDefault();
            pasteText(event.clipboardData.getData('text'));
          }}
          className="min-w-0 flex-1 cursor-pointer bg-transparent text-base font-semibold tabular-nums outline-none placeholder:font-normal placeholder:text-muted-foreground"
        />
        {showClear && raw !== '' && !disabled ? (
          <button
            type="button"
            aria-label="پاک کردن"
            onPointerDown={(event) => {
              // نباید فوکوس را از فیلد بگیرد؛ فقط بافر پاک شود
              event.preventDefault();
              setBuffer(id, '');
              focusField(id);
            }}
            className="grid size-touch shrink-0 cursor-pointer place-items-center rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        {unit ? <span className="shrink-0 text-xs text-muted-foreground">{unit}</span> : null}
      </div>

      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
