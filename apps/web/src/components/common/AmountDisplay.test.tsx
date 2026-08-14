import { dualFromPure, gramRate1000, karat, zeroDual } from '@gold/core-calc';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUnitStore } from '@/stores/unit-store';
import { AmountDisplay, RateDisplay } from './AmountDisplay';
import { UnitToggle } from './UnitToggle';

/**
 * این تست‌ها گزاره‌ی ارزش اصلی محصول را نگه می‌دارند:
 * واحد پایه طلاست، و کلید تعویض واحد **همه‌ی** اعداد را هم‌زمان عوض می‌کند.
 *
 * `data-raw` روی هر عدد، مقدار لاتین و صحیح را نگه می‌دارد — تست به آن
 * تکیه می‌کند تا به قالب‌بندی فارسی (که ممکن است با ICU عوض شود) وابسته نباشد.
 */

const RATE = gramRate1000(480_000_000n);

/** ۱۲.۳۵ گرم طلای خالص */
const AMOUNT = dualFromPure(12_350n, RATE);

beforeEach(() => {
  localStorage.clear();
  useUnitStore.setState({ unit: 'gold' });
});

describe('AmountDisplay', () => {
  it('پیش‌فرض طلاست، نه ریال — این وارونگی کل گزاره‌ی ارزش است', () => {
    render(<AmountDisplay amount={AMOUNT} />);
    const node = screen.getByText(/گرم/).closest('[data-unit]');
    expect(node?.getAttribute('data-unit')).toBe('gold');
    expect(node?.getAttribute('data-raw')).toBe('12350');
  });

  it('در واحد ریال، مقدار ریالی همان سند را نشان می‌دهد', () => {
    useUnitStore.setState({ unit: 'rial' });
    render(<AmountDisplay amount={AMOUNT} />);
    const node = screen.getByText(/ریال/).closest('[data-unit]');
    expect(node?.getAttribute('data-unit')).toBe('rial');
    expect(node?.getAttribute('data-raw')).toBe(AMOUNT.rial.toString());
  });

  it('بازنویسی واحد روی یک عدد خاص، تنظیم سراسری را نادیده می‌گیرد', () => {
    render(<AmountDisplay amount={AMOUNT} unit="rial" />);
    expect(screen.getByText(/ریال/)).toBeInTheDocument();
  });

  it('اعداد با ارقام فارسی نمایش داده می‌شوند، ولی مقدار خام لاتین می‌ماند', () => {
    render(<AmountDisplay amount={AMOUNT} />);
    const node = screen.getByText(/گرم/).closest('[data-unit]');
    const shown = node?.textContent ?? '';
    expect(shown).not.toMatch(/[0-9]/);
    expect(node?.getAttribute('data-raw')).toMatch(/^-?[0-9]+$/);
  });

  it('مبلغ منفی رنگ بدهکار می‌گیرد و علامت منفی هم چاپ می‌شود', () => {
    const negative = dualFromPure(-8_600n, RATE);
    render(<AmountDisplay amount={negative} signed />);
    const node = screen.getByText(/گرم/).closest('[data-unit]');
    expect(node?.className).toContain('text-debit');
    // رنگ به‌تنهایی حامل معنا نیست — علامت هم باید دیده شود
    expect(node?.textContent).toContain('−');
  });

  it('مبلغ مثبت رنگ بستانکار می‌گیرد', () => {
    render(<AmountDisplay amount={AMOUNT} signed />);
    expect(screen.getByText(/گرم/).closest('[data-unit]')?.className).toContain('text-credit');
  });
});

describe('AmountDisplay — گرم معادل عیار (FE-025)', () => {
  it('با karat=۷۵۰ به‌جای خالص ۱۰۰۰، معادل عیار ۷۵۰ را نشان می‌دهد', () => {
    // ۱۲.۳۵ گرم خالص = ۱۶.۴۶۶۷ گرم معادل عیار ۷۵۰ (وزن × ۱۰۰۰ ÷ ۷۵۰)
    render(<AmountDisplay amount={AMOUNT} karat={karat(750)} />);
    const node = screen.getByText(/گرم/).closest('[data-unit]');
    expect(node?.getAttribute('data-raw')).toBe('16467');
  });

  it('روی واحد ریال بی‌اثر است — karat فقط چهره‌ی طلا را عوض می‌کند', () => {
    render(<AmountDisplay amount={AMOUNT} unit="rial" karat={karat(750)} />);
    const node = screen.getByText(/ریال/).closest('[data-unit]');
    expect(node?.getAttribute('data-raw')).toBe(AMOUNT.rial.toString());
  });

  it('بدون karat، مبنای خالص ۱۰۰۰ همان قبل باقی می‌ماند', () => {
    render(<AmountDisplay amount={AMOUNT} />);
    expect(screen.getByText(/گرم/).closest('[data-unit]')?.getAttribute('data-raw')).toBe('12350');
  });
});

describe('AmountDisplay — حالت‌های مرزی (FE-025)', () => {
  it('مبلغ صفر بدون علامت منفی نمایش داده می‌شود', () => {
    const zero = dualFromPure(0n, RATE);
    render(<AmountDisplay amount={zero} signed />);
    const node = screen.getByText(/گرم/).closest('[data-unit]');
    expect(node?.textContent).not.toContain('−');
    expect(node?.getAttribute('data-raw')).toBe('0');
  });

  it('بدون نرخ (zeroDual پیش از دریافت مظنه) در هر دو واحد بدون خطا صفر نشان می‌دهد', () => {
    const noRate = zeroDual(0n);

    const { rerender } = render(<AmountDisplay amount={noRate} unit="gold" />);
    expect(screen.getByText(/گرم/).closest('[data-unit]')?.getAttribute('data-raw')).toBe('0');

    rerender(<AmountDisplay amount={noRate} unit="rial" />);
    expect(screen.getByText(/ریال/).closest('[data-unit]')?.getAttribute('data-raw')).toBe('0');
  });
});

describe('RateDisplay', () => {
  it('نرخ همیشه ریالی است و از کلید تعویض واحد پیروی نمی‌کند', () => {
    useUnitStore.setState({ unit: 'gold' });
    render(<RateDisplay value={480_000_000n} />);
    const node = screen.getByText(/ریال/).closest('[data-unit]');
    // نرخ طلا برحسب طلا همیشه یک است — تبدیلش بی‌معناست
    expect(node?.getAttribute('data-unit')).toBe('rial');
  });
});

describe('کلید تعویض واحد', () => {
  it('زدن «ریال» همه‌ی اعداد صفحه را هم‌زمان عوض می‌کند', async () => {
    const user = userEvent.setup();

    render(
      <div>
        <UnitToggle />
        <AmountDisplay amount={AMOUNT} />
        <AmountDisplay amount={dualFromPure(41_200n, RATE)} />
        <AmountDisplay amount={dualFromPure(-8_600n, RATE)} />
      </div>,
    );

    expect(document.querySelectorAll('[data-unit="gold"]')).toHaveLength(3);

    await user.click(screen.getByRole('radio', { name: 'ریال' }));

    expect(document.querySelectorAll('[data-unit="gold"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-unit="rial"]')).toHaveLength(3);
  });

  it('انتخاب کاربر در localStorage می‌ماند', async () => {
    const user = userEvent.setup();
    render(<UnitToggle />);

    await user.click(screen.getByRole('radio', { name: 'ریال' }));

    expect(useUnitStore.getState().unit).toBe('rial');
    expect(localStorage.getItem('gold-ui-unit')).toContain('rial');
  });

  it('واحد فعال با aria-checked اعلام می‌شود، نه فقط با رنگ', () => {
    render(<UnitToggle />);
    expect(screen.getByRole('radio', { name: 'طلا' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'ریال' })).toHaveAttribute('aria-checked', 'false');
  });
});
