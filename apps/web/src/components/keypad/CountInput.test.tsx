import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toPersianDigits } from '@gold/core-calc';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CountInput, type CountInputProps } from './CountInput';
import { NumericKeypad } from './NumericKeypad';
import { useKeypadStore } from './keypad-store';

/**
 * FE-039 — Count Input.
 *
 * مکانیک پایه‌ی تایپ/کیپد در keypad.test.tsx پوشش داده شده؛ اینجا فقط
 * پوسته‌ی نازک `CountInput` را چک می‌کند — بدون اعتبارسنجی محدوده (برخلاف
 * `KaratInput`)، چون هیچ سقفی برای «تعداد» در دامنه معنا ندارد.
 */

function Form(props: CountInputProps) {
  return (
    <>
      <CountInput {...props} />
      <NumericKeypad />
    </>
  );
}

async function typeCount(user: ReturnType<typeof userEvent.setup>, label: string, keys: string) {
  await user.click(screen.getByLabelText(label));
  for (const key of keys) {
    await user.click(screen.getByRole('button', { name: `رقم ${toPersianDigits(key)}` }));
  }
}

beforeEach(() => {
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
});

describe('CountInput', () => {
  it('بدون مقدار بیرونی، از صفر شروع می‌شود و خطایی ندارد', () => {
    render(<Form label="تعداد" />);
    expect(screen.getByLabelText('تعداد')).toHaveAttribute('data-value', '0');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('تایپ رقم‌ها مقدار صحیح می‌سازد و onChange را با همان مقدار صدا می‌زند', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Form label="تعداد" onChange={onChange} />);

    await typeCount(user, 'تعداد', '12');

    expect(screen.getByLabelText('تعداد')).toHaveAttribute('data-value', '12');
    expect(onChange).toHaveBeenLastCalledWith(12n);
  });

  it('مقدار پیش‌فرض بیرونی نمایش داده می‌شود و کاربر می‌تواند آن را تغییر دهد', async () => {
    const user = userEvent.setup();
    render(<Form label="تعداد" value={5n} />);
    expect(screen.getByLabelText('تعداد')).toHaveAttribute('data-value', '5');

    await typeCount(user, 'تعداد', '0'); // ۵۰
    expect(screen.getByLabelText('تعداد')).toHaveAttribute('data-value', '50');
  });

  it('خطای بیرونی نمایش داده می‌شود', () => {
    render(<Form label="تعداد" error="این فیلد اجباری است" />);
    expect(screen.getByRole('alert')).toHaveTextContent('این فیلد اجباری است');
  });

  it('غیرفعال، ورودی را از تعامل می‌اندازد', () => {
    render(<Form label="تعداد" disabled />);
    expect(screen.getByLabelText('تعداد')).toBeDisabled();
  });
});
