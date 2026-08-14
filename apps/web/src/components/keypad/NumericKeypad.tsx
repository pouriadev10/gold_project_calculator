import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Delete } from 'lucide-react';
import type { NumericFieldKind } from '@gold/core-calc';
import { cn } from '@/lib/utils';
import { KeypadPreview } from './KeypadPreview';
import { useKeypadStore } from './keypad-store';
import { SHORTCUTS_BY_KIND, type Shortcut } from './shortcuts';

/**
 * صفحه‌کلید عددی سفارشی.
 *
 * جایگزین کامل کیبورد سیستم‌عامل. دلایل و معیارهای پذیرش در
 * `design-system/pages/keypad.md`.
 *
 * ## سه تصمیم فنی که در کد پیدا نیستند
 *
 * ۱. **`position: fixed` + `transform`** — کیپد از جریان چیدمان بیرون
 *    است و با `translateY` باز می‌شود، پس سهمش در CLS **صفر** است.
 *    اگر با تغییر `height` باز می‌شد، هر بار کل صفحه می‌پرید.
 *
 * ۲. **`onPointerDown` به‌جای `onClick`** — روی موبایل `click` تا ۳۰۰ms
 *    بعد از تماس شلیک می‌شود. بازخورد روی `pointerdown` گرفته می‌شود تا
 *    هدف «تأخیر ضربه تا رنگ‌آمیزی زیر ۱۰۰ms» شدنی بماند.
 *
 * ۳. **`visibility: hidden` در حالت بسته** — فقط `translate` کافی نیست:
 *    کلیدها با `Tab` قابل دسترس می‌ماندند و صفحه‌خوان آن‌ها را می‌خواند.
 */

const DIGIT_ROWS = ['۷۸۹', '۴۵۶', '۱۲۳'] as const;

/** رقم فارسی نمایشی → رقم لاتینی که در بافر ذخیره می‌شود. */
const PERSIAN_TO_LATIN: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

const LONG_PRESS_MS = 450;

/** لرزش کوتاه — با احترام به prefers-reduced-motion و نبود API روی iOS. */
function tapFeedback(): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  navigator.vibrate?.(10);
}

interface KeyProps {
  children: ReactNode;
  aria: string;
  onPress: () => void;
  onLongPress?: () => void;
  variant?: 'digit' | 'action' | 'shortcut' | 'confirm';
  className?: string;
  disabled?: boolean;
}

function KeypadKey({
  children,
  aria,
  onPress,
  onLongPress,
  variant = 'digit',
  className,
  disabled,
}: KeyProps) {
  const timer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const handleDown = useCallback(
    (event: React.PointerEvent) => {
      // فوکوس فیلد نباید برود و متن نباید انتخاب شود
      event.preventDefault();
      if (disabled) return;

      longPressFired.current = false;
      tapFeedback();

      if (onLongPress) {
        timer.current = window.setTimeout(() => {
          longPressFired.current = true;
          onLongPress();
        }, LONG_PRESS_MS);
      }
    },
    [disabled, onLongPress],
  );

  const handleUp = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      if (disabled) return;
      clearTimer();
      // اگر نگه‌داشتن عمل کرده، ضربه‌ی کوتاه دیگر اجرا نمی‌شود
      if (!longPressFired.current) onPress();
    },
    [disabled, onPress, clearTimer],
  );

  useEffect(() => clearTimer, [clearTimer]);

  return (
    <button
      type="button"
      aria-label={aria}
      disabled={disabled}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerLeave={clearTimer}
      onPointerCancel={clearTimer}
      onContextMenu={(event) => event.preventDefault()}
      className={cn(
        // ۴۸px — بالاتر از کف ۴۴px پروژه، چون پرضربه‌ترین عناصر برنامه‌اند
        'flex min-h-12 min-w-12 cursor-pointer touch-manipulation select-none items-center justify-center',
        'rounded-lg text-lg font-semibold tabular-nums transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-40',
        variant === 'digit' && 'bg-card text-foreground shadow-sm active:bg-muted',
        variant === 'action' && 'bg-muted text-muted-foreground active:bg-border',
        variant === 'shortcut' && 'bg-secondary text-base text-secondary-foreground active:bg-border',
        variant === 'confirm' && 'bg-primary text-primary-foreground active:bg-primary/80',
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface NumericKeypadProps {
  /**
   * بازنویسی ستون میان‌برها — پیش‌فرض `SHORTCUTS_BY_KIND`. عیارهای ۷۵۰/۹۹۵/۹۰۰
   * مشخصات استاندارد جهانی‌اند (بدون ابهام مستأجری)، ولی «عیار خرید از
   * مصرف‌کننده» طبق CLAUDE.md بخش ۳ **قابل‌تنظیم هر مستأجر** است؛ این prop
   * همان نقطه‌ای است که یک تسک بعدی (خواندن تنظیمات واقعی مستأجر) بدون
   * دست‌زدن به داخل کیپد، مقدار ۷۴۰ ثابت را با مقدار واقعی تنظیمات
   * جایگزین می‌کند.
   */
  shortcutsByKind?: Readonly<Record<NumericFieldKind, readonly Shortcut[]>>;
}

export function NumericKeypad({ shortcutsByKind = SHORTCUTS_BY_KIND }: NumericKeypadProps = {}) {
  const isOpen = useKeypadStore((s) => s.isOpen);
  const activeKind = useKeypadStore((s) => s.fields.find((f) => f.id === s.activeId)?.kind ?? null);
  const canGoNext = useKeypadStore(
    (s) => s.activeId !== null && s.fields.findIndex((f) => f.id === s.activeId) < s.fields.length - 1,
  );
  const canGoPrev = useKeypadStore((s) => s.fields.findIndex((f) => f.id === s.activeId) > 0);

  const pressDigit = useKeypadStore((s) => s.pressDigit);
  const pressSeparator = useKeypadStore((s) => s.pressSeparator);
  const pressBackspace = useKeypadStore((s) => s.pressBackspace);
  const pressClear = useKeypadStore((s) => s.pressClear);
  const setValue = useKeypadStore((s) => s.setValue);
  const transformValue = useKeypadStore((s) => s.transformValue);
  const moveNext = useKeypadStore((s) => s.moveNext);
  const movePrev = useKeypadStore((s) => s.movePrev);
  const close = useKeypadStore((s) => s.close);

  const allowsDecimal = activeKind === 'weight';
  const shortcuts = activeKind ? shortcutsByKind[activeKind] : [];

  /** کیبورد فیزیکی — دسکتاپ گالری‌دار هم باید کار کند. */
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const latin = PERSIAN_TO_LATIN[event.key] ?? event.key;

      if (latin.length === 1 && latin >= '0' && latin <= '9') {
        event.preventDefault();
        pressDigit(latin);
        return;
      }

      switch (event.key) {
        case '.':
        case '/':
          if (allowsDecimal) {
            event.preventDefault();
            pressSeparator();
          }
          break;
        case 'Backspace':
          event.preventDefault();
          pressBackspace();
          break;
        case 'Enter':
        case 'Escape':
          event.preventDefault();
          close();
          break;
        case 'Tab':
          event.preventDefault();
          if (event.shiftKey) movePrev();
          else moveNext();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, allowsDecimal, pressDigit, pressSeparator, pressBackspace, close, moveNext, movePrev]);

  const applyShortcut = useCallback(
    (shortcut: Shortcut) => {
      if (shortcut.type === 'set') setValue(shortcut.value);
      else transformValue(shortcut.apply);
    },
    [setValue, transformValue],
  );

  return (
    <div
      role="group"
      aria-label="صفحه‌کلید عددی"
      aria-hidden={!isOpen}
      data-testid="numeric-keypad"
      className={cn(
        // fixed + transform ⇒ سهم CLS صفر
        'bottom-above-nav fixed inset-x-0 z-40 border-t border-border bg-background shadow-lg',
        'transition-transform duration-200 motion-reduce:transition-none',
        isOpen ? 'visible translate-y-0' : 'invisible translate-y-full',
      )}
    >
      <KeypadPreview />

      <div className="flex gap-2 p-2">
        <div className="grid flex-1 grid-cols-3 gap-2">
          {DIGIT_ROWS.join('')
            .split('')
            .map((digit) => (
              <KeypadKey
                key={digit}
                aria={`رقم ${digit}`}
                onPress={() => pressDigit(PERSIAN_TO_LATIN[digit] as string)}
              >
                {digit}
              </KeypadKey>
            ))}

          <KeypadKey
            aria="جداکننده اعشار"
            variant="action"
            disabled={!allowsDecimal}
            onPress={pressSeparator}
          >
            ٫
          </KeypadKey>

          <KeypadKey aria="رقم ۰" onPress={() => pressDigit('0')}>
            ۰
          </KeypadKey>

          <KeypadKey
            aria="حذف یک رقم — برای پاک‌کردن کل فیلد نگه دارید"
            variant="action"
            onPress={pressBackspace}
            onLongPress={pressClear}
          >
            <Delete className="size-5" aria-hidden="true" />
          </KeypadKey>
        </div>

        {/* ستون میان‌برها — محتوایش با نوع فیلد فعال عوض می‌شود */}
        <div className="flex w-16 flex-col gap-2">
          {shortcuts.map((shortcut) => (
            <KeypadKey
              key={shortcut.label}
              aria={shortcut.aria}
              variant="shortcut"
              onPress={() => applyShortcut(shortcut)}
              className="flex-1"
            >
              {shortcut.label}
            </KeypadKey>
          ))}
        </div>
      </div>

      {/* حرکت بین فیلدها بدون بستن کیپد */}
      <div className="flex gap-2 border-t border-border p-2 pb-safe">
        <KeypadKey
          aria="فیلد قبلی"
          variant="action"
          disabled={!canGoPrev}
          onPress={movePrev}
          className="flex-1 text-sm"
        >
          قبلی
        </KeypadKey>
        <KeypadKey
          aria="فیلد بعدی"
          variant="action"
          disabled={!canGoNext}
          onPress={moveNext}
          className="flex-1 text-sm"
        >
          بعدی
        </KeypadKey>
        <KeypadKey
          aria="پایان ورود و بستن صفحه‌کلید"
          variant="confirm"
          onPress={close}
          className="flex-1 text-sm"
        >
          تمام
        </KeypadKey>
      </div>
    </div>
  );
}
