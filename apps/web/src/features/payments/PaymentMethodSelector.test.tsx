import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaymentMethodSelector } from './PaymentMethodSelector';

/**
 * FE-050 — انتخاب روش پرداخت. فقط انتخاب‌گر است؛ هیچ فرم روشی اینجا
 * تست نمی‌شود چون هنوز ساخته نشده (FE-051..054).
 */

describe('PaymentMethodSelector — انتخاب روش پرداخت (FE-050)', () => {
  it('هر پنج روش فاز ۱ را به‌عنوان radio مستقل نشان می‌دهد', () => {
    render(<PaymentMethodSelector value={null} onChange={vi.fn()} />);

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    for (const label of ['ریال', 'طلا', 'سکه', 'نسیه', 'ترکیبی']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  it('کلیک روی یک روش onChange را با همان مقدار صدا می‌زند', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<PaymentMethodSelector value={null} onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'طلا' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('GOLD');
  });

  it('فقط روش انتخاب‌شده aria-checked دارد — یک radio-group پنج‌گزینه‌ای، نه چندانتخابی', () => {
    render(<PaymentMethodSelector value="COMBINED" onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'ترکیبی' })).toHaveAttribute('aria-checked', 'true');
    for (const label of ['ریال', 'طلا', 'سکه', 'نسیه']) {
      expect(screen.getByRole('radio', { name: label })).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('غیرفعال، کلیک را نادیده می‌گیرد', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<PaymentMethodSelector value={null} onChange={onChange} disabled />);

    await user.click(screen.getByRole('radio', { name: 'ریال' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'ریال' })).toBeDisabled();
  });
});
