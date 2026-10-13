import { memo, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Delete } from 'lucide-react';
import { DIGIT_SPECS, type NumericFieldKind } from '@gold/core-calc';
import { cn } from '@/lib/utils';
import { KeypadPreview } from './KeypadPreview';
import { KEYPAD_ROOT_ATTRIBUTE, isKeypadTarget, releaseKeypadSpace } from './keypad-root';
import { neighbourField, useKeypadStore } from './keypad-store';
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

export { KEYPAD_ROOT_ATTRIBUTE, isKeypadTarget } from './keypad-root';

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
      // FE-084: Enter/Space روی کلید فوکوس‌شده فقط رویداد click می‌سازد (بدون pointer).
      // `detail === 0` یعنی click از کیبورد آمده؛ ضربه‌ی لمسی/موس قبلاً با pointerup اجرا شده.
      onClick={(event) => {
        if (event.detail === 0 && !disabled) onPress();
      }}
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

/**
 * FE-089: `memo` — کیپد داخل خودِ فرم‌ها mount می‌شود و هر رقم با `onChange` فرم را دوباره
 * رندر می‌کرد، پس کل کیپد (۱۹ کلید) هم با هر ضربه دوباره ساخته می‌شد. کیپد هرچه لازم
 * دارد از store می‌گیرد و prop متغیری ندارد؛ پیش‌نمایش (`KeypadPreview`) خودش مشترک store است.
 */
export const NumericKeypad = memo(function NumericKeypad({
  shortcutsByKind = SHORTCUTS_BY_KIND,
}: NumericKeypadProps = {}) {
  const isOpen = useKeypadStore((s) => s.isOpen);
  const activeKind = useKeypadStore((s) => s.fields.find((f) => f.id === s.activeId)?.kind ?? null);
  // FE-092: فقط فیلدهای فعال — فیلد disabled مقصد «بعدی/قبلی» نیست
  const canGoNext = useKeypadStore((s) => neighbourField(s.fields, s.activeId, 1) !== undefined);
  const canGoPrev = useKeypadStore((s) => neighbourField(s.fields, s.activeId, -1) !== undefined);

  const pressDigit = useKeypadStore((s) => s.pressDigit);
  const pressSeparator = useKeypadStore((s) => s.pressSeparator);
  const pressBackspace = useKeypadStore((s) => s.pressBackspace);
  const pressClear = useKeypadStore((s) => s.pressClear);
  const setValue = useKeypadStore((s) => s.setValue);
  const transformValue = useKeypadStore((s) => s.transformValue);
  const moveNext = useKeypadStore((s) => s.moveNext);
  const movePrev = useKeypadStore((s) => s.movePrev);
  const close = useKeypadStore((s) => s.close);

  // مشتق از خودِ DIGIT_SPECS، نه لیست ثابت نام‌ها — وگرنه هر کایند اعشاری تازه (مثل
  // percent در FE-036) باید اینجا هم جداگانه اضافه شود و فراموش‌شدنش بی‌صدا کلید
  // جداکننده را غیرفعال نگه می‌دارد (دقیقاً همین باگ پیش از این فیکس رخ داد).
  const allowsDecimal = activeKind !== null && DIGIT_SPECS[activeKind].decimals > 0;
  const shortcuts = activeKind ? shortcutsByKind[activeKind] : [];

  /** کیبورد فیزیکی — دسکتاپ گالری‌دار هم باید کار کند. */
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      /*
       * FE-084: کلید فیزیکی فقط وقتی مال کیپد است که فوکوس روی یک فیلد عددی، روی
       * خودِ کیپد یا هیچ‌جا (body) باشد. وگرنه — مثلاً تایپ عنوان در یک فیلد متنی
       * در حالی که کیپد هنوز باز است — رقم‌ها نباید دزدیده شوند. روی کلیدهای خودِ
       * کیپد هم Enter/Space فعال‌سازی بومی دکمه است، نه «تمام».
       */
      const target = event.target;
      if (target instanceof HTMLElement && target !== document.body) {
        const onKeypad = isKeypadTarget(target);
        if (!onKeypad && !target.matches('input[data-kind]')) return;
        if (onKeypad && (event.key === 'Enter' || event.key === ' ')) return;
      }

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
          /*
           * FE-084: Tab بومی مرورگر کار خودش را می‌کند و کیپد فقط بسته می‌شود.
           * پیش‌تر Tab بلعیده می‌شد و فقط فیلد فعالِ کیپد عوض می‌شد — فوکوس واقعی
           * DOM جابه‌جا نمی‌شد و روی آخرین فیلد کاربر کیبورد گیر می‌افتاد (WCAG 2.1.2).
           * اگر مقصد Tab خودش فیلد عددی باشد، `onFocus` آن کیپد را دوباره باز می‌کند.
           */
          close();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, allowsDecimal, pressDigit, pressSeparator, pressBackspace, close]);

  /*
   * FE-085: تا کیپد باز است، ته صفحه به اندازه‌ی ارتفاع کیپد جای اسکرول دارد تا
   * حتی آخرین فیلد صفحه بتواند بالای کیپد بیاید (`NumericField` آن را جابه‌جا می‌کند).
   */
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) {
      releaseKeypadSpace();
      return;
    }
    const height = rootRef.current?.offsetHeight ?? 0;
    if (height === 0) return;
    const previous = document.body.style.paddingBottom;
    document.body.style.paddingBottom = `${height}px`;
    return () => {
      document.body.style.paddingBottom = previous;
    };
  }, [isOpen]);

  const applyShortcut = useCallback(
    (shortcut: Shortcut) => {
      if (shortcut.type === 'set') setValue(shortcut.value);
      else transformValue(shortcut.apply);
    },
    [setValue, transformValue],
  );

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="صفحه‌کلید عددی"
      aria-hidden={!isOpen}
      data-testid="numeric-keypad"
      {...{ [KEYPAD_ROOT_ATTRIBUTE]: '' }}
      className={cn(
        // fixed + transform ⇒ سهم CLS صفر
        // z-[60]: بالاتر از Dialog/Drawer (z-50, dialog.tsx/drawer.tsx) — عمداً، چون از
        // FE-036 به بعد فیلد عددی می‌تواند داخل یک ResponsiveDialog باز باشد و کیپد باید
        // رویش دیده شود، نه پشتش گم شود. پایین‌تر از Toast (z-[100]) که همیشه باید برنده بماند.
        //
        // pointer-events-auto: وقتی Dialog باز است، react-remove-scroll (داخل Radix Dialog)
        // روی <body> خودِ صفحه pointer-events:none می‌گذارد و فقط محتوای خودِ دیالوگ را با
        // pointer-events:auto صریح سوراخ می‌کند. کیپد بیرون از دیالوگ (هم‌سطحش) است، پس بدون
        // این override با موس/لمس هم غیرقابل‌کلیک می‌شد — نه فقط از دید صفحه‌خوان.
        'bottom-above-nav pointer-events-auto fixed inset-x-0 z-[60] border-t border-border bg-background shadow-lg',
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
});
