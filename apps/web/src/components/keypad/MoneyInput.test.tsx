import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toPersianDigits } from '@gold/core-calc';
import { beforeEach, describe, expect, it } from 'vitest';
import { MoneyInput, type MoneyInputProps } from './MoneyInput';
import { NumericKeypad } from './NumericKeypad';
import { useKeypadStore } from './keypad-store';

/**
 * FE-021 — Money Input.
 *
 * مکانیک پایه‌ی تایپ/پیست/دقت در keypad.test.tsx پوشش داده شده؛ اینجا
 * فقط دو چیز مخصوص Money Input را تست می‌کند: جداییِ نمایش فارسیِ
 * گروه‌بندی‌شده از مقدار لاتینِ payload، و دکمه‌ی پاک‌کردن.
 */

function Form(props: MoneyInputProps) {
  return (
    <>
      <MoneyInput {...props} />
      <NumericKeypad />
    </>
  );
}

async function tap(user: ReturnType<typeof userEvent.setup>, aria: string) {
  await user.click(screen.getByRole('button', { name: aria }));
}

/** `keys` با ارقام لاتین نوشته می‌شود؛ برچسب دکمه‌های کیپد فارسی است. */
async function typeAmount(user: ReturnType<typeof userEvent.setup>, label: string, keys: string) {
  await user.click(screen.getByLabelText(label));
  for (const key of keys) {
    await tap(user, `رقم ${toPersianDigits(key)}`);
  }
}

beforeEach(() => {
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
});

describe('رشته‌ی ریالی و مقادیر بزرگ', () => {
  it('مقدار در payload (data-value) همیشه لاتین و بدون جداساز است', async () => {
    const user = userEvent.setup();
    render(<Form label="مبلغ" />);

    await typeAmount(user, 'مبلغ', '12500000');

    expect(screen.getByLabelText('مبلغ')).toHaveAttribute('data-value', '12500000');
  });

  it('نمایش فارسی با جداساز هزارگان است — از payload جدا', async () => {
    const user = userEvent.setup();
    render(<Form label="مبلغ" />);

    await typeAmount(user, 'مبلغ', '12500000');

    expect(screen.getByLabelText('مبلغ')).toHaveValue('۱۲٬۵۰۰٬۰۰۰');
  });

  it('بزرگ‌ترین مبلغ قابل‌تایپ (ظرفیت ۱۵ رقمی ریال) بدون افت دقت می‌ماند', async () => {
    // سقف تایپ ریالی از DIGIT_SPECS.rial (۱۵ رقم) می‌آید — یک محدودیت UX
    // عمدی، جدا از سقف ۴۰ رقمیِ bigIntStringSchema که lib/bigint.test.ts
    // (FE-010) جدا پوشش داده. اینجا فقط سقف واقعیِ همین رابط را می‌سنجیم.
    const user = userEvent.setup();
    render(<Form label="مبلغ" />);

    await typeAmount(user, 'مبلغ', '999999999999999');

    expect(screen.getByLabelText('مبلغ')).toHaveAttribute('data-value', '999999999999999');
  });

  it('چسباندن مقدار فارسی همچنان کار می‌کند', async () => {
    const user = userEvent.setup();
    render(<Form label="مبلغ" />);

    await user.click(screen.getByLabelText('مبلغ'));
    const dataTransfer = { getData: () => '۱٬۲۵۰٬۰۰۰ ریال' } as unknown as DataTransfer;
    fireEvent.paste(screen.getByLabelText('مبلغ'), { clipboardData: dataTransfer });

    expect(screen.getByLabelText('مبلغ')).toHaveAttribute('data-value', '1250000');
  });
});

describe('دکمه‌ی پاک‌کردن', () => {
  it('بدون مقدار، دکمه‌ی پاک‌کردن نیست', () => {
    render(<Form label="مبلغ" />);
    expect(screen.queryByRole('button', { name: 'پاک کردن' })).not.toBeInTheDocument();
  });

  it('با مقدار، دکمه‌ی پاک‌کردن ظاهر و مقدار را صفر می‌کند', async () => {
    const user = userEvent.setup();
    render(<Form label="مبلغ" />);

    await typeAmount(user, 'مبلغ', '500000');
    expect(screen.getByLabelText('مبلغ')).toHaveAttribute('data-value', '500000');

    await tap(user, 'پاک کردن');

    expect(screen.getByLabelText('مبلغ')).toHaveAttribute('data-value', '0');
    expect(screen.queryByRole('button', { name: 'پاک کردن' })).not.toBeInTheDocument();
  });

  it('بعد از پاک‌کردن، کیپد باز می‌ماند و می‌توان دوباره تایپ کرد', async () => {
    const user = userEvent.setup();
    render(<Form label="مبلغ" />);

    await typeAmount(user, 'مبلغ', '500000');
    await tap(user, 'پاک کردن');
    await tap(user, `رقم ${toPersianDigits('7')}`);

    expect(screen.getByLabelText('مبلغ')).toHaveAttribute('data-value', '7');
  });

  it('روی فیلد غیرفعال، دکمه‌ی پاک‌کردن نیست حتی با مقدار اولیه', () => {
    render(<Form label="مبلغ" value={500000n} disabled />);
    expect(screen.queryByRole('button', { name: 'پاک کردن' })).not.toBeInTheDocument();
  });
});

describe('validation — passthrough', () => {
  it('پیام خطا نمایش داده می‌شود', () => {
    render(<Form label="مبلغ" error="مبلغ نامعتبر است" />);
    expect(screen.getByRole('alert')).toHaveTextContent('مبلغ نامعتبر است');
  });
});
