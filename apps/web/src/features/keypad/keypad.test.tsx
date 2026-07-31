import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { NumericField } from './NumericField';
import { NumericKeypad } from './NumericKeypad';
import { useKeypadStore } from './keypad-store';

/**
 * رفتار صفحه‌کلید.
 *
 * تأکید روی دو چیز است که اگر بشکنند محصول می‌شکند:
 * ۱. کیبورد سیستم‌عامل هرگز باز نشود.
 * ۲. مقدار خروجی `bigint` دقیق باشد، بدون عبور از float.
 */

function Form() {
  return (
    <>
      <NumericField kind="weight" label="وزن" />
      <NumericField kind="karat" label="عیار" />
      <NumericField kind="mazneh" label="مظنه" />
      <NumericKeypad />
    </>
  );
}

/** ضربه روی کلید با برچسب دسترس‌پذیری. */
async function tap(user: ReturnType<typeof userEvent.setup>, aria: string) {
  await user.click(screen.getByRole('button', { name: aria }));
}

beforeEach(() => {
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
});

describe('سرکوب کیبورد سیستم‌عامل', () => {
  it('هر فیلد inputMode=none و readOnly دارد', () => {
    render(<Form />);
    for (const label of ['وزن', 'عیار', 'مظنه']) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute('inputmode', 'none');
      expect(input).toHaveAttribute('readonly');
    }
  });

  it('فیلد غیرفعال نیست — با صفحه‌خوان و Tab در دسترس می‌ماند', () => {
    render(<Form />);
    expect(screen.getByLabelText('وزن')).not.toBeDisabled();
  });
});

describe('ورود مقدار', () => {
  it('تایپ ۱۲٫۳۴۵ گرم دقیقاً ۱۲۳۴۵ میلی‌گرم می‌دهد', async () => {
    const user = userEvent.setup();
    render(<Form />);

    await user.click(screen.getByLabelText('وزن'));
    for (const key of ['رقم ۱', 'رقم ۲', 'جداکننده اعشار', 'رقم ۳', 'رقم ۴', 'رقم ۵']) {
      await tap(user, key);
    }

    expect(screen.getByLabelText('وزن')).toHaveAttribute('data-value', '12345');
  });

  it('مقادیری که float خرابشان می‌کند، دقیق می‌مانند', async () => {
    const user = userEvent.setup();
    render(<Form />);

    await user.click(screen.getByLabelText('وزن'));
    for (const key of ['رقم ۰', 'جداکننده اعشار', 'رقم ۱']) await tap(user, key);

    // ۰.۱ روی float برابر ۰.۱۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۱ است
    expect(screen.getByLabelText('وزن')).toHaveAttribute('data-value', '100');
  });

  it('جداکننده روی فیلد عیار غیرفعال است', async () => {
    const user = userEvent.setup();
    render(<Form />);

    await user.click(screen.getByLabelText('عیار'));
    expect(screen.getByRole('button', { name: 'جداکننده اعشار' })).toBeDisabled();
  });

  it('حذف، آخرین رقم را برمی‌دارد', async () => {
    const user = userEvent.setup();
    render(<Form />);

    await user.click(screen.getByLabelText('عیار'));
    for (const key of ['رقم ۷', 'رقم ۵', 'رقم ۰']) await tap(user, key);
    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '750');

    await tap(user, 'حذف یک رقم — برای پاک‌کردن کل فیلد نگه دارید');
    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '75');
  });
});

describe('میان‌برهای دامنه‌ای', () => {
  it('ستون میان‌برها با نوع فیلد فعال عوض می‌شود', async () => {
    const user = userEvent.setup();
    render(<Form />);

    await user.click(screen.getByLabelText('عیار'));
    expect(screen.getByRole('button', { name: 'عیار ۷۵۰' })).toBeInTheDocument();

    await user.click(screen.getByLabelText('وزن'));
    expect(screen.queryByRole('button', { name: 'عیار ۷۵۰' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ضرب در دو' })).toBeInTheDocument();
  });

  it('میان‌بر عیار با یک ضربه مقدار را می‌گذارد', async () => {
    const user = userEvent.setup();
    render(<Form />);

    await user.click(screen.getByLabelText('عیار'));
    await tap(user, 'عیار ۷۵۰');

    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '750');
  });

  it('میان‌بر مثقال، عدد واردشده را به گرم تبدیل می‌کند', async () => {
    const user = userEvent.setup();
    render(<Form />);

    await user.click(screen.getByLabelText('وزن'));
    await tap(user, 'رقم ۲'); // ۲ مثقال
    await tap(user, 'تبدیل عدد واردشده از مثقال به گرم');

    // ۲ × ۴.۶۰۸۳ = ۹.۲۱۶۶ گرم = ۹۲۱۷ میلی‌گرم (گرد نیم‌به‌بالا)
    expect(screen.getByLabelText('وزن')).toHaveAttribute('data-value', '9217');
  });

  it('میان‌بر افزودن صفر روی مبلغ کار می‌کند', async () => {
    const user = userEvent.setup();
    render(<Form />);

    await user.click(screen.getByLabelText('مظنه'));
    await tap(user, 'رقم ۴');
    await tap(user, 'رقم ۸');
    await tap(user, 'افزودن سه صفر');

    expect(screen.getByLabelText('مظنه')).toHaveAttribute('data-value', '48000');
  });
});

describe('حرکت بین فیلدها', () => {
  it('«بعدی» بدون بستن کیپد جابه‌جا می‌شود', async () => {
    const user = userEvent.setup();
    render(<Form />);

    await user.click(screen.getByLabelText('وزن'));
    expect(useKeypadStore.getState().isOpen).toBe(true);

    await tap(user, 'فیلد بعدی');

    expect(useKeypadStore.getState().isOpen).toBe(true);
    const activeId = useKeypadStore.getState().activeId;
    expect(screen.getByLabelText('عیار').id).toBe(activeId);
  });

  it('روی اولین فیلد «قبلی» و روی آخرین «بعدی» غیرفعال است', async () => {
    const user = userEvent.setup();
    render(<Form />);

    await user.click(screen.getByLabelText('وزن'));
    expect(screen.getByRole('button', { name: 'فیلد قبلی' })).toBeDisabled();

    await user.click(screen.getByLabelText('مظنه'));
    expect(screen.getByRole('button', { name: 'فیلد بعدی' })).toBeDisabled();
  });

  it('«تمام» کیپد را می‌بندد', async () => {
    const user = userEvent.setup();
    render(<Form />);

    await user.click(screen.getByLabelText('وزن'));
    await tap(user, 'پایان ورود و بستن صفحه‌کلید');

    expect(useKeypadStore.getState().isOpen).toBe(false);
  });
});

describe('دسترس‌پذیری', () => {
  it('در حالت باز، role و برچسب در درخت دسترس‌پذیری هست', async () => {
    const user = userEvent.setup();
    render(<Form />);
    await user.click(screen.getByLabelText('وزن'));

    expect(screen.getByRole('group', { name: 'صفحه‌کلید عددی' })).toBeInTheDocument();
  });

  /**
   * در حالت بسته عمداً `aria-hidden` است، پس از درخت دسترس‌پذیری بیرون
   * می‌ماند و با `getByRole` پیدا نمی‌شود — همین رفتار درست است، وگرنه
   * صفحه‌خوان ۱۸ کلید نامرئی را می‌خواند.
   */
  it('در حالت بسته از درخت دسترس‌پذیری بیرون است', () => {
    render(<Form />);

    expect(screen.queryByRole('group', { name: 'صفحه‌کلید عددی' })).not.toBeInTheDocument();
    expect(screen.getByTestId('numeric-keypad')).toHaveAttribute('aria-hidden', 'true');
  });

  it('همه‌ی کلیدها aria-label فارسی دارند', async () => {
    const user = userEvent.setup();
    render(<Form />);
    await user.click(screen.getByLabelText('وزن'));

    const buttons = screen.getByTestId('numeric-keypad').querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(12);
    for (const button of buttons) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('پیش‌نمایش با aria-live اعلام می‌شود', () => {
    render(<Form />);
    expect(
      screen.getByTestId('numeric-keypad').querySelector('[aria-live="polite"]'),
    ).toBeTruthy();
  });
});

describe('کیبورد فیزیکی', () => {
  it('ارقام و Backspace و Enter کار می‌کنند', async () => {
    const user = userEvent.setup();
    render(<Form />);

    await user.click(screen.getByLabelText('عیار'));
    await user.keyboard('750');
    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '750');

    await user.keyboard('{Backspace}');
    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '75');

    await user.keyboard('{Enter}');
    expect(useKeypadStore.getState().isOpen).toBe(false);
  });
});
