import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { dualFromPure, gramRate1000, toPersianDigits } from '@gold/core-calc';
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { UnitToggle } from '@/components/common/UnitToggle';
import { useUnitStore } from '@/stores/unit-store';
import { KaratInput } from './KaratInput';
import { MoneyInput } from './MoneyInput';
import { NumericKeypad } from './NumericKeypad';
import { WeightInput } from './WeightInput';
import { useKeypadStore } from './keypad-store';

/**
 * FE-092 — تست componentهای فرم مالی.
 *
 * ماتریس «component × معیار»: عدم precision loss · رفتار keyboard · خطا · disabled ·
 * readonly · paste. «SettlementLine» ردیف تسویه‌ی ترکیبی است و تست‌هایش کنار همان فرم
 * (`features/payments/MixedSettlementForm.test.tsx`، بخش FE-092) هستند، چون به mock همان
 * فرم نیاز دارند. تست‌های پیشین هر component (FE-019…FE-024) سر جایشان‌اند؛ اینجا شکاف‌ها
 * و مرزها پر می‌شوند.
 *
 * «readonly» در این برنامه یعنی: هر فیلد عددی برای کیبورد سیستم‌عامل فقط‌خواندنی است
 * (`readOnly` + `inputMode="none"`) و مقدار فقط از کیپد، کیبورد فیزیکیِ مسیرشده به کیپد
 * یا paste می‌آید — هیچ prop جداگانه‌ی readOnly ای وجود ندارد.
 */

beforeEach(() => {
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
  localStorage.clear();
  useUnitStore.setState({ unit: 'gold' });
});

const withKeypad = (children: ReactNode) => (
  <>
    {children}
    <NumericKeypad />
  </>
);

const valueOf = (label: string) => screen.getByLabelText(label).getAttribute('data-value');

async function tapDigits(user: ReturnType<typeof userEvent.setup>, digits: string) {
  for (const digit of digits) {
    await user.click(screen.getByRole('button', { name: `رقم ${toPersianDigits(digit)}` }));
  }
}

function paste(label: string, text: string) {
  const input = screen.getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.paste(input, { clipboardData: { getData: () => text } });
}

/** سه فیلد ورودی مالی؛ هر کدام با یک عدد نمونه‌ی مرزی و یک paste نادقیق. */
const INPUTS = [
  {
    name: 'MoneyInput',
    label: 'مبلغ',
    render: (props: { disabled?: boolean; error?: string; onChange?: (v: bigint) => void }) => (
      <MoneyInput label="مبلغ" {...props} />
    ),
    // بیشینه‌ی ظرفیت ریال: ۱۵ رقم
    typed: '999999999999999',
    expected: 999_999_999_999_999n,
    exactPaste: ['۱۲۵٬۰۰۰٬۰۰۰٫۰۰ ریال', 125_000_000n],
    inexactPaste: '12500.75',
  },
  {
    name: 'WeightInput',
    label: 'وزن',
    render: (props: { disabled?: boolean; error?: string; onChange?: (v: bigint) => void }) => (
      <WeightInput label="وزن" {...props} />
    ),
    // بیشینه‌ی ظرفیت وزن: ۶ رقم صحیح و ۳ رقم اعشار
    typed: '999999.999',
    expected: 999_999_999n,
    exactPaste: ['۲/۵ گرم', 2_500n],
    inexactPaste: '1.2345',
  },
  {
    name: 'KaratInput',
    label: 'عیار',
    render: (props: { disabled?: boolean; error?: string; onChange?: (v: bigint) => void }) => (
      <KaratInput label="عیار" {...props} />
    ),
    typed: '1000',
    expected: 1000n,
    exactPaste: ['۷۵۰٫۰', 750n],
    inexactPaste: '750.5',
  },
] as const;

async function typeOnKeypad(user: ReturnType<typeof userEvent.setup>, text: string) {
  for (const ch of text) {
    if (ch === '.') await user.click(screen.getByRole('button', { name: 'جداکننده اعشار' }));
    else await user.click(screen.getByRole('button', { name: `رقم ${toPersianDigits(ch)}` }));
  }
}

describe.each(INPUTS)('$name — FE-092', (field) => {
  it('عدم precision loss: بیشینه‌ی ظرفیت دقیقاً همان bigint را به فرم می‌دهد', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(withKeypad(field.render({ onChange })));
    await user.click(screen.getByLabelText(field.label));
    await typeOnKeypad(user, field.typed);
    expect(valueOf(field.label)).toBe(field.expected.toString());
    expect(onChange).toHaveBeenLastCalledWith(field.expected);
  });

  it('keyboard: ارقام فیزیکی (فارسی هم) و Backspace از مسیر کیپد کار می‌کنند و Enter می‌بندد', async () => {
    const user = userEvent.setup();
    render(withKeypad(field.render({})));
    await user.click(screen.getByLabelText(field.label));
    await user.keyboard('7۵');
    expect(valueOf(field.label)).toBe(field.name === 'WeightInput' ? '75000' : '75');
    await user.keyboard('{Backspace}');
    expect(valueOf(field.label)).toBe(field.name === 'WeightInput' ? '7000' : '7');
    await user.keyboard('{Enter}');
    expect(useKeypadStore.getState().isOpen).toBe(false);
  });

  it('خطا: role=alert، aria-invalid و aria-describedby به همان پیام وصل‌اند', () => {
    render(withKeypad(field.render({ error: 'مقدار نامعتبر است' })));
    const input = screen.getByLabelText(field.label);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('مقدار نامعتبر است');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('disabled: لمس کیپد را باز نمی‌کند و paste اثری ندارد', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(withKeypad(field.render({ disabled: true, onChange })));
    const input = screen.getByLabelText(field.label);
    expect(input).toBeDisabled();
    await user.click(input);
    expect(useKeypadStore.getState().isOpen).toBe(false);
    paste(field.label, '123');
    expect(valueOf(field.label)).toBe('0');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disabled: غیرفعال شدن حین باز بودن کیپد (مثلاً حین ثبت) کیپد را می‌بندد و هیچ ضربه‌ای مقدار را عوض نمی‌کند', async () => {
    const onChange = vi.fn();
    let setDisabled: (value: boolean) => void = () => {};
    function Form() {
      const [disabled, set] = useState(false);
      setDisabled = set;
      return withKeypad(field.render({ disabled, onChange }));
    }
    const user = userEvent.setup();
    render(<Form />);
    await user.click(screen.getByLabelText(field.label));
    await tapDigits(user, '5');
    onChange.mockClear();

    act(() => setDisabled(true));
    expect(useKeypadStore.getState().isOpen).toBe(false);
    const before = valueOf(field.label);
    // کیبورد فیزیکی و فراخوانی مستقیم استور — هر دو باید بی‌اثر باشند
    fireEvent.keyDown(window, { key: '9' });
    act(() => useKeypadStore.getState().pressDigit('9'));
    act(() => useKeypadStore.getState().pasteText('42'));
    expect(valueOf(field.label)).toBe(before);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('readonly: ورودی کیبورد سیستم‌عامل را باز نمی‌کند و تغییر مستقیم input مقدار را عوض نمی‌کند', () => {
    render(withKeypad(field.render({})));
    const input = screen.getByLabelText(field.label);
    expect(input).toHaveAttribute('readonly');
    expect(input).toHaveAttribute('inputmode', 'none');
    fireEvent.change(input, { target: { value: '999' } });
    expect(valueOf(field.label)).toBe('0');
  });

  it('paste: عدد دقیق (با ارقام فارسی، جداساز و واحد) پذیرفته می‌شود', () => {
    render(withKeypad(field.render({})));
    paste(field.label, field.exactPaste[0]);
    expect(valueOf(field.label)).toBe(field.exactPaste[1].toString());
  });

  it('paste: عددی که فیلد دقیقاً نگه نمی‌دارد رد می‌شود — نه بریده، نه چسبیده', () => {
    render(withKeypad(field.render({})));
    paste(field.label, field.inexactPaste);
    expect(valueOf(field.label)).toBe('0');
    paste(field.label, '-500');
    expect(valueOf(field.label)).toBe('0');
  });
});

describe('MoneyInput — دکمه‌ی پاک‌کردن با کیبورد (FE-092)', () => {
  it.each(['{Enter}', ' '])(
    '%s روی دکمه‌ی فوکوس‌شده فیلد را پاک می‌کند و فوکوس را به فیلد برمی‌گرداند',
    async (key) => {
      const user = userEvent.setup();
      render(withKeypad(<MoneyInput label="مبلغ" value={5_000n} />));
      const clear = screen.getByRole('button', { name: 'پاک کردن' });
      clear.focus();
      await user.keyboard(key);
      expect(valueOf('مبلغ')).toBe('0');
      expect(screen.getByLabelText('مبلغ')).toHaveFocus();
    },
  );
});

describe('NumericKeypad — FE-092', () => {
  it('عدم precision loss: میان‌برهای تبدیل روی بیشینه‌ی ظرفیت دقیق می‌مانند', async () => {
    const user = userEvent.setup();
    render(withKeypad(<MoneyInput label="مبلغ" />));
    await user.click(screen.getByLabelText('مبلغ'));
    await tapDigits(user, '9999999999');
    await user.click(screen.getByRole('button', { name: 'افزودن پنج صفر' }));
    expect(valueOf('مبلغ')).toBe('999999999900000');
  });

  it('keyboard: Escape کیپد را می‌بندد و Tab به فیلد بعدی می‌رود', async () => {
    const user = userEvent.setup();
    render(
      withKeypad(
        <>
          <MoneyInput label="مبلغ" />
          <WeightInput label="وزن" />
        </>,
      ),
    );
    await user.click(screen.getByLabelText('مبلغ'));
    await user.tab();
    expect(screen.getByLabelText('وزن')).toHaveFocus();
    expect(useKeypadStore.getState().isOpen).toBe(true);
    await user.keyboard('{Escape}');
    expect(useKeypadStore.getState().isOpen).toBe(false);
  });

  it('disabled: «بعدی/قبلی» از روی فیلد غیرفعال می‌گذرند و وقتی فیلد فعالی نمانده غیرفعال‌اند', async () => {
    const user = userEvent.setup();
    render(
      withKeypad(
        <>
          <MoneyInput label="مبلغ" />
          <WeightInput label="وزن" disabled />
          <KaratInput label="عیار" />
        </>,
      ),
    );
    await user.click(screen.getByLabelText('مبلغ'));
    expect(screen.getByRole('button', { name: 'فیلد قبلی' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'فیلد بعدی' }));
    expect(screen.getByLabelText('عیار')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'فیلد بعدی' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'فیلد قبلی' }));
    expect(screen.getByLabelText('مبلغ')).toHaveFocus();
  });

  it('disabled: کلید جداکننده‌ی اعشار روی فیلد بی‌اعشار غیرفعال است و روی وزن فعال', async () => {
    const user = userEvent.setup();
    render(
      withKeypad(
        <>
          <MoneyInput label="مبلغ" />
          <WeightInput label="وزن" />
        </>,
      ),
    );
    await user.click(screen.getByLabelText('مبلغ'));
    expect(screen.getByRole('button', { name: 'جداکننده اعشار' })).toBeDisabled();
    await user.click(screen.getByLabelText('وزن'));
    expect(screen.getByRole('button', { name: 'جداکننده اعشار' })).toBeEnabled();
  });

  it('readonly: بسته که باشد از درخت دسترس‌پذیری و Tab بیرون است', () => {
    render(withKeypad(<MoneyInput label="مبلغ" />));
    expect(screen.getByTestId('numeric-keypad')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('group', { name: 'صفحه‌کلید عددی' })).not.toBeInTheDocument();
  });

  it('paste: هنگام باز بودن کیپد، paste در فیلد فعال همان قاعده‌ی دقیق‌یا‌هیچ را دارد', async () => {
    const user = userEvent.setup();
    render(withKeypad(<WeightInput label="وزن" />));
    await user.click(screen.getByLabelText('وزن'));
    act(() => useKeypadStore.getState().pasteText('۱۲٫۳۴۵'));
    expect(valueOf('وزن')).toBe('12345');
    act(() => useKeypadStore.getState().pasteText('12.3456'));
    expect(valueOf('وزن')).toBe('0');
  });

  it('خطا: ضربه روی فیلدی که دیگر ثبت نیست (unmount شده) کاری نمی‌کند و خطا نمی‌دهد', async () => {
    const user = userEvent.setup();
    const { rerender } = render(withKeypad(<MoneyInput label="مبلغ" />));
    await user.click(screen.getByLabelText('مبلغ'));
    rerender(withKeypad(null));
    expect(() => act(() => useKeypadStore.getState().pressDigit('5'))).not.toThrow();
    expect(useKeypadStore.getState().activeId).toBeNull();
  });
});

describe('UnitToggle — FE-092', () => {
  const RATE = gramRate1000(480_000_000n);
  // مقدار طلایی بزرگ‌تر از MAX_SAFE_INTEGER میلی‌گرم
  const HUGE = dualFromPure(9_007_199_254_740_993n, RATE);

  it('عدم precision loss: رفت‌وبرگشت طلا ↔ ریال مقدار خام سند را عوض نمی‌کند', async () => {
    const user = userEvent.setup();
    render(
      <>
        <UnitToggle />
        <AmountDisplay amount={HUGE} />
      </>,
    );
    const shown = () => document.querySelector('[data-raw]')?.getAttribute('data-raw');
    expect(shown()).toBe('9007199254740993');
    await user.click(screen.getByRole('radio', { name: 'ریال' }));
    expect(shown()).toBe(HUGE.rial.toString());
    await user.click(screen.getByRole('radio', { name: 'طلا' }));
    expect(shown()).toBe('9007199254740993');
  });

  it('keyboard: یک توقف Tab؛ جهت‌ها (راست‌به‌چپ) و Home/End انتخاب می‌کنند و فوکوس را می‌برند', async () => {
    const user = userEvent.setup();
    render(<UnitToggle />);
    const gold = screen.getByRole('radio', { name: 'طلا' });
    const rial = screen.getByRole('radio', { name: 'ریال' });
    expect(gold).toHaveAttribute('tabindex', '0');
    expect(rial).toHaveAttribute('tabindex', '-1');

    await user.tab();
    expect(gold).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(useUnitStore.getState().unit).toBe('rial');
    expect(rial).toHaveFocus();
    expect(rial).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowRight}');
    expect(useUnitStore.getState().unit).toBe('gold');
    expect(gold).toHaveFocus();
    await user.keyboard('{End}');
    expect(useUnitStore.getState().unit).toBe('rial');
    await user.keyboard('{Home}');
    expect(useUnitStore.getState().unit).toBe('gold');
    await user.keyboard('{ArrowUp}'); // دور می‌زند
    expect(useUnitStore.getState().unit).toBe('rial');
  });

  it('keyboard: کلیدهای دیگر انتخاب را عوض نمی‌کنند', async () => {
    const user = userEvent.setup();
    render(<UnitToggle />);
    await user.tab();
    await user.keyboard('a');
    expect(useUnitStore.getState().unit).toBe('gold');
  });

  it('خطا/disabled/readonly/paste: کلید ورودی ندارد — فقط دو گزینه با وضعیت aria-checked صریح', () => {
    render(<UnitToggle />);
    const group = screen.getByRole('radiogroup', { name: 'واحد نمایش اعداد' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios.filter((radio) => radio.getAttribute('aria-checked') === 'true')).toHaveLength(1);
  });
});
