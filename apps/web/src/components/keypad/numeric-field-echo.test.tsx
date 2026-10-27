import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CountInput } from './CountInput';
import { useKeypadStore } from './keypad-store';

/**
 * M-24، مسئله‌ی #40 — افتادن رقم در تایپ خیلی سریع.
 *
 * فیلد هر مقدار را به والد گزارش می‌کند و والد آن را دوباره به‌صورت `value` برمی‌گرداند («پژواک»).
 * اگر پژواک یک مقدار قدیمی‌تر در همان رندری برسد که کلید بعدی بافر را بزرگ‌تر کرده، فیلد نباید
 * آن را «تغییر بیرونی» بخواند و بافر را به عقب برگرداند.
 */

const harness: { setValue: (value: bigint) => void; reported: bigint[] } = {
  setValue: () => undefined,
  reported: [],
};

function Harness({ initial = 0n }: { readonly initial?: bigint }) {
  const [value, setValue] = useState(initial);
  harness.setValue = setValue;
  // والد گزارش را فقط ثبت می‌کند؛ پژواکش را آزمون خودش و در زمان دلخواه برمی‌گرداند.
  return <CountInput label="تعداد" value={value} onChange={(next) => harness.reported.push(next)} />;
}

/** الگوی seed-race: والد مقدار واقعی را پس از mount در یک effect می‌نشاند. */
function SeededAfterMount({ seed }: { readonly seed: bigint }) {
  const [value, setValue] = useState(0n);
  useEffect(() => setValue(seed), [seed]);
  harness.setValue = setValue;
  return (
    <>
      <CountInput label="تعداد" value={value} onChange={(next) => { harness.reported.push(next); setValue(next); }} />
      <output aria-label="مقدار والد">{value.toString()}</output>
    </>
  );
}

function fieldValue(): string | null {
  return screen.getByLabelText('تعداد').getAttribute('data-value');
}

afterEach(() => {
  // اول unmount، بعد reset — وگرنه فیلد آزمون قبلی پاک‌شدن بافر را به آزمون بعدی گزارش می‌کند.
  cleanup();
  useKeypadStore.getState().reset();
  harness.reported = [];
});

describe('NumericField — پژواک والد رقم تازه را پاک نمی‌کند (#40)', () => {
  it('پژواک ۴۰ هم‌زمان با کلید سوم، بافر ۴۰۰ را به ۴۰ برنمی‌گرداند', () => {
    render(<Harness />);
    act(() => useKeypadStore.getState().focusField(useKeypadStore.getState().fields[0]!.id));

    act(() => useKeypadStore.getState().pressDigit('4'));
    act(() => harness.setValue(4n)); // پژواک ۴
    act(() => useKeypadStore.getState().pressDigit('0'));
    expect(harness.reported).toEqual([4n, 40n]);

    // پژواک ۴۰ هنوز نرسیده که کاربر صفر دوم را می‌زند؛ هر دو در یک رندر commit می‌شوند.
    act(() => {
      harness.setValue(40n);
      useKeypadStore.getState().pressDigit('0');
    });

    expect(fieldValue()).toBe('400');
    expect(harness.reported.at(-1)).toBe(400n);
  });

  it('تغییر واقعاً بیرونی (مقداری که فیلد گزارش نکرده) همچنان بافر را جایگزین می‌کند', () => {
    render(<Harness />);
    act(() => useKeypadStore.getState().focusField(useKeypadStore.getState().fields[0]!.id));
    act(() => useKeypadStore.getState().pressDigit('7'));
    act(() => harness.setValue(7n));

    act(() => harness.setValue(12n)); // مثلاً «تعداد قبلی» از فرم
    expect(fieldValue()).toBe('12');

    act(() => useKeypadStore.getState().pressDigit('3'));
    expect(fieldValue()).toBe('123');
    expect(harness.reported.at(-1)).toBe(123n);
  });

  it('مقدار اولیه‌ی والد همچنان از اولین رندر نشانده می‌شود', () => {
    render(<Harness initial={9n} />);
    expect(fieldValue()).toBe('9');
    expect(harness.reported).toEqual([]);
  });
});

describe('NumericField — seed پس از mount (M-24)', () => {
  it('صفرِ mount مقدار نشانده‌شده‌ی والد را بازنویسی نمی‌کند', () => {
    render(<SeededAfterMount seed={15n} />);
    expect(fieldValue()).toBe('15');
    expect(screen.getByLabelText('مقدار والد')).toHaveTextContent('15');
    expect(harness.reported).toEqual([]);
  });
});

