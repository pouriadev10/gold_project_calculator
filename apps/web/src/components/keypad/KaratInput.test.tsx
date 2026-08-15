import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toPersianDigits } from '@gold/core-calc';
import { beforeEach, describe, expect, it } from 'vitest';
import { KaratInput, type KaratInputProps } from './KaratInput';
import { NumericKeypad } from './NumericKeypad';
import { useKeypadStore } from './keypad-store';

/**
 * FE-022 — Karat Input.
 *
 * مکانیک پایه‌ی تایپ/کیپد در keypad.test.tsx پوشش داده شده؛ اینجا فقط
 * دو چیز مخصوص Karat Input را تست می‌کند: رد مقدار خارج بازه‌ی [۱,۱۰۰۰]،
 * و اینکه مقدار پیش‌فرضِ بیرونی (آینده‌ی «از تنظیمات») هم نمایش داده
 * می‌شود و هم توسط کاربر قابل‌تغییر می‌ماند.
 */

function Form(props: KaratInputProps) {
  return (
    <>
      <KaratInput {...props} />
      <NumericKeypad />
    </>
  );
}

async function tap(user: ReturnType<typeof userEvent.setup>, aria: string) {
  await user.click(screen.getByRole('button', { name: aria }));
}

/** `keys` با ارقام لاتین نوشته می‌شود؛ برچسب دکمه‌های کیپد فارسی است. */
async function typeKarat(user: ReturnType<typeof userEvent.setup>, label: string, keys: string) {
  await user.click(screen.getByLabelText(label));
  for (const key of keys) {
    await tap(user, `رقم ${toPersianDigits(key)}`);
  }
}

beforeEach(() => {
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
});

describe('بازه‌ی معتبر [۱, ۱۰۰۰]', () => {
  it('فیلد دست‌نخورده خطا نشان نمی‌دهد', () => {
    render(<Form label="عیار" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('مقدار داخل بازه (۷۵۰) خطا ندارد', async () => {
    const user = userEvent.setup();
    render(<Form label="عیار" />);

    await typeKarat(user, 'عیار', '750');

    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '750');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('مرز پایین (۱) معتبر است', async () => {
    const user = userEvent.setup();
    render(<Form label="عیار" />);

    await typeKarat(user, 'عیار', '1');

    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '1');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('مرز بالا (۱۰۰۰) معتبر است', async () => {
    const user = userEvent.setup();
    render(<Form label="عیار" />);

    await typeKarat(user, 'عیار', '1000');

    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '1000');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('مقدار خارج بازه (۱۰۰۱) رد می‌شود — خطا زیر فیلد نمایش داده می‌شود', async () => {
    const user = userEvent.setup();
    render(<Form label="عیار" />);

    await typeKarat(user, 'عیار', '1001');

    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '1001');
    expect(screen.getByRole('alert')).toHaveTextContent('بین ۱ و ۱۰۰۰');
  });

  it('اصلاح مقدار خارج بازه، خطا را پاک می‌کند', async () => {
    const user = userEvent.setup();
    render(<Form label="عیار" />);

    await typeKarat(user, 'عیار', '1001');
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await tap(user, 'حذف یک رقم — برای پاک‌کردن کل فیلد نگه دارید');
    // بافر حالا «۱۰۰» است — داخل بازه
    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '100');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('خطای بیرونی بر خطای داخلی اولویت دارد', async () => {
    const user = userEvent.setup();
    render(<Form label="عیار" error="این فیلد اجباری است" />);

    await typeKarat(user, 'عیار', '750');
    expect(screen.getByRole('alert')).toHaveTextContent('این فیلد اجباری است');
  });
});

describe('مقدار پیش‌فرض — از تنظیمات (آینده) یا کاتالوگ', () => {
  it('مقدار پیش‌فرضِ بیرونی نمایش داده می‌شود', () => {
    // شبیه‌سازی «مقدار پیش‌فرض API»: فراخوان‌کننده یک عدد بیرونی می‌دهد،
    // خودِ KaratInput هیچ عددی را حدس نمی‌زند.
    render(<Form label="عیار" value={740n} />);
    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '740');
  });

  it('کاربر می‌تواند مقدار پیش‌فرض را تغییر دهد', async () => {
    const user = userEvent.setup();
    render(<Form label="عیار" value={740n} />);

    await user.click(screen.getByLabelText('عیار'));
    // «۷۴۰» سه رقم دارد — هر ضربه فقط یک رقم برمی‌دارد، نگه‌داشتن (پاک‌کردن کامل) اینجا لازم نیست
    await tap(user, 'حذف یک رقم — برای پاک‌کردن کل فیلد نگه دارید');
    await tap(user, 'حذف یک رقم — برای پاک‌کردن کل فیلد نگه دارید');
    await tap(user, 'حذف یک رقم — برای پاک‌کردن کل فیلد نگه دارید');
    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '0');

    await typeKarat(user, 'عیار', '995');

    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '995');
  });

  it('تغییر مقدار پیش‌فرض بیرونی، فیلد را به‌روزرسانی می‌کند', () => {
    const { rerender } = render(<Form label="عیار" value={740n} />);
    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '740');

    rerender(
      <>
        <KaratInput label="عیار" value={900n} />
        <NumericKeypad />
      </>,
    );
    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '900');
  });
});

describe('میان‌برهای دامنه‌ای — به ارث از FE-019', () => {
  it('میان‌برهای ۷۴۰، ۷۵۰، ۹۰۰ و ۹۹۵ در دسترس‌اند', async () => {
    const user = userEvent.setup();
    render(<Form label="عیار" />);

    await user.click(screen.getByLabelText('عیار'));

    for (const label of ['عیار ۷۴۰', 'عیار ۷۵۰', 'عیار ۹۰۰', 'عیار ۹۹۵']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('زدن میان‌بر ۹۹۵ مقدار را مستقیم می‌گذارد', async () => {
    const user = userEvent.setup();
    render(<Form label="عیار" />);

    await user.click(screen.getByLabelText('عیار'));
    await tap(user, 'عیار ۹۹۵');

    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '995');
  });
});
