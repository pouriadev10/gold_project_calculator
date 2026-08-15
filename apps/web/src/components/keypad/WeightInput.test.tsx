import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toPersianDigits } from '@gold/core-calc';
import { beforeEach, describe, expect, it } from 'vitest';
import { NumericKeypad } from './NumericKeypad';
import { WeightInput, type WeightInputProps } from './WeightInput';
import { useKeypadStore } from './keypad-store';

/**
 * FE-020 — Weight Input.
 *
 * پوسته‌ی نازکی روی `NumericField kind="weight"` است؛ محاسبه‌ی وزن خالص
 * و دقت میلی‌گرمی تمرکز این فایل است — رفتار خودِ کیپد (پیست، حذف،
 * کیبورد فیزیکی) در keypad.test.tsx پوشش داده شده و اینجا تکرار نمی‌شود.
 */

function Form(props: WeightInputProps) {
  return (
    <>
      <WeightInput {...props} />
      <NumericKeypad />
    </>
  );
}

async function tap(user: ReturnType<typeof userEvent.setup>, aria: string) {
  await user.click(screen.getByRole('button', { name: aria }));
}

/** `keys` با ارقام لاتین نوشته می‌شود؛ برچسب دکمه‌های کیپد فارسی است. */
async function typeWeight(user: ReturnType<typeof userEvent.setup>, label: string, keys: string) {
  await user.click(screen.getByLabelText(label));
  for (const key of keys) {
    if (key === '.') await tap(user, 'جداکننده اعشار');
    else await tap(user, `رقم ${toPersianDigits(key)}`);
  }
}

beforeEach(() => {
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
});

describe('دقت میلی‌گرمی', () => {
  it('۲۳٫۵۰۰ گرم دقیقاً ۲۳۵۰۰ میلی‌گرم می‌دهد', async () => {
    const user = userEvent.setup();
    render(<Form label="وزن" />);

    await typeWeight(user, 'وزن', '23.500');

    expect(screen.getByLabelText('وزن')).toHaveAttribute('data-value', '23500');
  });

  it('ورودی‌های مرزی: کمترین واحد قابل نمایش (۱ میلی‌گرم)', async () => {
    const user = userEvent.setup();
    render(<Form label="وزن" />);

    await typeWeight(user, 'وزن', '0.001');

    expect(screen.getByLabelText('وزن')).toHaveAttribute('data-value', '1');
  });

  it('ورودی‌های مرزی: بدون اعشار، فقط بخش صحیح', async () => {
    const user = userEvent.setup();
    render(<Form label="وزن" />);

    await typeWeight(user, 'وزن', '5');

    expect(screen.getByLabelText('وزن')).toHaveAttribute('data-value', '5000');
  });

  it('ورودی‌های مرزی: بیشینه‌ی ارقام بخش صحیح (۶ رقم) کلمپ می‌شود', async () => {
    const user = userEvent.setup();
    render(<Form label="وزن" />);

    await typeWeight(user, 'وزن', '1234567');

    // ظرفیت بخش صحیح وزن ۶ رقم است؛ رقم هفتم بی‌اثر می‌ماند
    expect(screen.getByLabelText('وزن')).toHaveAttribute('data-value', '123456000');
  });

  it('تبدیل مثقال به میلی‌گرم همچنان از داخل WeightInput کار می‌کند', async () => {
    const user = userEvent.setup();
    render(<Form label="وزن" />);

    await user.click(screen.getByLabelText('وزن'));
    await tap(user, 'رقم ۲'); // ۲ مثقال
    await tap(user, 'تبدیل عدد واردشده از مثقال به گرم');

    // ۲ × ۴.۶۰۸۳ = ۹.۲۱۶۶ گرم = ۹۲۱۷ میلی‌گرم (گرد نیم‌به‌بالا) — همان مقدار keypad.test.tsx
    expect(screen.getByLabelText('وزن')).toHaveAttribute('data-value', '9217');
  });
});

describe('پیش‌نمایش وزن خالص', () => {
  it('بدون عیار، پیش‌نمایش نمایش داده نمی‌شود', async () => {
    const user = userEvent.setup();
    render(<Form label="وزن" />);

    await typeWeight(user, 'وزن', '10');
    expect(screen.queryByText(/وزن خالص/)).not.toBeInTheDocument();
  });

  it('با عیار معتبر، وزن خالص محاسبه و نمایش داده می‌شود', async () => {
    const user = userEvent.setup();
    render(<Form label="وزن" karat={750n} />);

    await typeWeight(user, 'وزن', '10');

    // ۱۰ گرم × ۷۵۰ ÷ ۱۰۰۰ = ۷٫۵ گرم خالص
    expect(screen.getByText(/وزن خالص/)).toHaveTextContent('۷٫۵');
  });

  it('عیار خارج از بازه‌ی معتبر (۰) پیش‌نمایش نمی‌سازد، خطا هم نمی‌دهد', async () => {
    const user = userEvent.setup();
    render(<Form label="وزن" karat={0n} />);

    await typeWeight(user, 'وزن', '10');
    expect(screen.queryByText(/وزن خالص/)).not.toBeInTheDocument();
  });

  it('وزن صفر، حتی با عیار معتبر، پیش‌نمایشی نمی‌سازد', () => {
    render(<Form label="وزن" karat={750n} value={0n} />);
    expect(screen.queryByText(/وزن خالص/)).not.toBeInTheDocument();
  });

  it('تغییر عیار بیرونی، پیش‌نمایش را دوباره محاسبه می‌کند', () => {
    const { rerender } = render(<Form label="وزن" karat={750n} value={10_000n} />);
    expect(screen.getByText(/وزن خالص/)).toHaveTextContent('۷٫۵');

    rerender(<Form label="وزن" karat={995n} value={10_000n} />);
    // ۱۰ گرم × ۹۹۵ ÷ ۱۰۰۰ = ۹٫۹۵ گرم خالص
    expect(screen.getByText(/وزن خالص/)).toHaveTextContent('۹٫۹۵');
  });
});

describe('validation — passthrough به NumericField', () => {
  it('پیام خطا نمایش داده می‌شود', () => {
    render(<Form label="وزن" error="وزن باید بزرگ‌تر از صفر باشد" />);
    expect(screen.getByRole('alert')).toHaveTextContent('وزن باید بزرگ‌تر از صفر باشد');
  });
});
