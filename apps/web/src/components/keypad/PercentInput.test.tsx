import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toPersianDigits } from '@gold/core-calc';
import { beforeEach, describe, expect, it } from 'vitest';
import { PercentInput, type PercentInputProps } from './PercentInput';
import { NumericKeypad } from './NumericKeypad';
import { useKeypadStore } from './keypad-store';

/**
 * FE-036 — Percent Input.
 *
 * مکانیک پایه‌ی تایپ/دقت در keypad.test.tsx پوشش داده شده؛ اینجا فقط
 * قرارداد مقیاس ×۱۰۰ (`PERCENT_X100`) را می‌سنجد — «۷٫۵٪» تایپ‌شده باید
 * دقیقاً `750n` در payload بدهد، نه هیچ گرد کردن یا تبدیل شناور.
 */

function Form(props: PercentInputProps) {
  return (
    <>
      <PercentInput {...props} />
      <NumericKeypad />
    </>
  );
}

async function tap(user: ReturnType<typeof userEvent.setup>, aria: string) {
  await user.click(screen.getByRole('button', { name: aria }));
}

async function typeKeys(user: ReturnType<typeof userEvent.setup>, label: string, keys: string) {
  await user.click(screen.getByLabelText(label));
  for (const key of keys) {
    if (key === '.') {
      await tap(user, 'جداکننده اعشار');
    } else {
      await tap(user, `رقم ${toPersianDigits(key)}`);
    }
  }
}

beforeEach(() => {
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
});

describe('مقیاس ×۱۰۰ (PERCENT_X100)', () => {
  it('«۷٫۵» تایپ‌شده دقیقاً ۷۵۰ در payload می‌دهد', async () => {
    const user = userEvent.setup();
    render(<Form label="اجرت" />);

    await typeKeys(user, 'اجرت', '7.5');

    expect(screen.getByLabelText('اجرت')).toHaveAttribute('data-value', '750');
  });

  it('نمایش همان مقدار درصدِ تایپ‌شده است، نه مقیاس ×۱۰۰', async () => {
    const user = userEvent.setup();
    render(<Form label="اجرت" />);

    await typeKeys(user, 'اجرت', '7.5');

    expect(screen.getByLabelText('اجرت')).toHaveValue('۷٫۵');
  });

  it('بدون رقم اعشار هم درست تبدیل می‌شود', async () => {
    const user = userEvent.setup();
    render(<Form label="اجرت" />);

    await typeKeys(user, 'اجرت', '12');

    expect(screen.getByLabelText('اجرت')).toHaveAttribute('data-value', '1200');
  });

  it('واحد نمایشی علامت درصد است', () => {
    render(<Form label="اجرت" />);
    expect(screen.getByText('٪')).toBeInTheDocument();
  });
});

describe('دکمه‌ی پاک‌کردن', () => {
  it('با مقدار، دکمه‌ی پاک‌کردن ظاهر و مقدار را صفر می‌کند', async () => {
    const user = userEvent.setup();
    render(<Form label="اجرت" />);

    await typeKeys(user, 'اجرت', '7.5');
    await tap(user, 'پاک کردن');

    expect(screen.getByLabelText('اجرت')).toHaveAttribute('data-value', '0');
  });
});
