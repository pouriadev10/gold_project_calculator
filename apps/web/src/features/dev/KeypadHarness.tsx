import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { RotateCcw } from 'lucide-react';
import { formatCount, formatScaled, measurementToScaled } from '@gold/core-calc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NumericField } from '@/components/keypad/NumericField';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { useKeypadStore } from '@/components/keypad/keypad-store';

/**
 * هارنس اندازه‌گیری کیپد — **فقط توسعه**.
 *
 * بدون این صفحه، عدد «زیر ۱۵ ثانیه» یک ادعاست. اینجا دو چیز واقعاً
 * اندازه گرفته می‌شود:
 *
 * ۱. **زمان ورود کامل** — از اولین ضربه تا زدن «تمام».
 * ۲. **تأخیر ضربه تا رنگ‌آمیزی** — با `performance.now()` در لحظه‌ی
 *    `pointerdown` و سپس `requestAnimationFrame` که پس از رنگ‌آمیزی
 *    اجرا می‌شود. میانه و بدترین حالت هر دو ثبت می‌شوند، چون میانگین
 *    بدترین حالت را پنهان می‌کند و کاربر همان را حس می‌کند.
 *
 * اعداد باید روی **دستگاه واقعی** خوانده و در `PERFORMANCE.md` ثبت شوند.
 */

const TARGET_ENTRY_MS = 8_000;
const TARGET_LATENCY_MS = 100;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/** میلی‌ثانیه با یک رقم اعشار — از پل رسمی اندازه‌گیری عبور می‌کند. */
function ms(value: number): string {
  return formatScaled(measurementToScaled(value, 1), 1);
}

export default function KeypadHarness() {
  const [latencies, setLatencies] = useState<number[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [tapCount, setTapCount] = useState(0);

  const isOpen = useKeypadStore((s) => s.isOpen);
  const reset = useKeypadStore((s) => s.reset);
  const wasOpen = useRef(false);

  /**
   * تأخیر ضربه تا رنگ‌آمیزی.
   *
   * `pointerdown` در فاز capture گرفته می‌شود تا پیش از هندلر خود کلید
   * اجرا شود؛ سپس دو `rAF` پشت سر هم، که تضمین می‌کند فریم واقعاً
   * رنگ‌آمیزی شده است.
   */
  useEffect(() => {
    const onPointerDown = () => {
      const t0 = performance.now();
      setTapCount((n) => n + 1);
      setStartedAt((prev) => prev ?? t0);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setLatencies((prev) => [...prev, performance.now() - t0]);
        });
      });
    };

    const keypad = document.querySelector('[data-testid="numeric-keypad"]');
    keypad?.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => keypad?.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, []);

  /** بسته‌شدن کیپد = پایان ورود */
  useEffect(() => {
    if (wasOpen.current && !isOpen && startedAt !== null) {
      setElapsedMs(performance.now() - startedAt);
    }
    wasOpen.current = isOpen;
  }, [isOpen, startedAt]);

  const restart = useCallback(() => {
    setLatencies([]);
    setStartedAt(null);
    setElapsedMs(null);
    setTapCount(0);
    reset();
  }, [reset]);

  const medianLatency = median(latencies);
  const worstLatency = latencies.length ? Math.max(...latencies) : 0;

  const entryPass = elapsedMs !== null && elapsedMs < TARGET_ENTRY_MS;
  const latencyPass = worstLatency > 0 && worstLatency < TARGET_LATENCY_MS;

  return (
    <div className="space-y-4 p-4 pb-[28rem]">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold">هارنس صفحه‌کلید</h1>
        <Button asChild variant="outline" size="sm">
          <Link to="/">خانه</Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        این صفحه فقط در توسعه وجود دارد. روی دستگاه واقعی باز کنید، سه فیلد را پر کنید و «تمام» را
        بزنید.
      </p>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">فرم نمونه</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <NumericField kind="weight" label="وزن" hint="گرم — تا سه رقم اعشار" />
          <NumericField kind="karat" label="عیار" hint="بین ۳۰۰ تا ۹۹۹" />
          <NumericField kind="mazneh" label="مظنه" hint="ریال" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-sm">اندازه‌گیری</CardTitle>
          <Button variant="outline" size="sm" onClick={restart}>
            <RotateCcw aria-hidden="true" />
            شروع دوباره
          </Button>
        </CardHeader>

        <CardContent>
          <dl className="space-y-3 text-sm">
            <Metric
              label="زمان ورود کامل"
              hint="هدف: زیر ۸ ثانیه"
              value={elapsedMs === null ? '—' : `${ms(elapsedMs)} میلی‌ثانیه`}
              state={elapsedMs === null ? 'idle' : entryPass ? 'pass' : 'fail'}
            />
            <Metric
              label="تأخیر ضربه تا رنگ‌آمیزی — میانه"
              hint="هدف: زیر ۱۰۰ میلی‌ثانیه"
              value={latencies.length === 0 ? '—' : `${ms(medianLatency)} میلی‌ثانیه`}
              state="idle"
            />
            <Metric
              label="تأخیر ضربه تا رنگ‌آمیزی — بدترین"
              hint="این عددی است که کاربر حس می‌کند"
              value={latencies.length === 0 ? '—' : `${ms(worstLatency)} میلی‌ثانیه`}
              state={latencies.length === 0 ? 'idle' : latencyPass ? 'pass' : 'fail'}
            />
            <Metric
              label="تعداد ضربه"
              hint="کمتر یعنی سریع‌تر — میان‌برها را امتحان کنید"
              value={tapCount === 0 ? '—' : formatCount(tapCount)}
              state="idle"
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">بررسی کیبورد سیستم‌عامل</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>
            روی فیلدها ضربه بزنید. اگر کیبورد سیستم باز شد، معیار پذیرش رد شده است — روی Chrome
            اندروید <strong>و</strong> Safari iOS جداگانه بررسی کنید.
          </p>
          <p>
            ارتفاع پنجره:{' '}
            <span className="tabular-nums">{formatCount(window.innerHeight)}</span> پیکسل — اگر با
            باز شدن کیپد این عدد پرید، کیبورد سیستم باز شده است.
          </p>
        </CardContent>
      </Card>

      <NumericKeypad />
    </div>
  );
}

function Metric({
  label,
  hint,
  value,
  state,
}: {
  label: string;
  hint: string;
  value: string;
  state: 'idle' | 'pass' | 'fail';
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <dt className="font-medium">{label}</dt>
        <dd className="text-[0.6875rem] text-muted-foreground">{hint}</dd>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="tabular-nums">{value}</span>
        {state === 'pass' ? <Badge variant="secondary">قبول</Badge> : null}
        {state === 'fail' ? <Badge variant="destructive">رد</Badge> : null}
      </div>
    </div>
  );
}
