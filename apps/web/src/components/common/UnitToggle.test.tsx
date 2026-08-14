import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { UNIT_STORAGE_KEY, useUnitStore } from '@/stores/unit-store';
import { UnitToggle } from './UnitToggle';

beforeEach(() => {
  localStorage.clear();
  useUnitStore.setState({ unit: 'gold' });
});

describe('UnitToggle', () => {
  it('هر دو حالت را نشان می‌دهد', () => {
    render(<UnitToggle />);
    expect(screen.getByRole('radio', { name: 'طلا' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'ریال' })).toBeInTheDocument();
  });

  it('پیش‌فرض «طلا» است — نه ریال', () => {
    render(<UnitToggle />);
    expect(screen.getByRole('radio', { name: 'طلا' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'ریال' })).toHaveAttribute('aria-checked', 'false');
  });

  it('کلیک روی ریال، استور سراسری و localStorage را عوض می‌کند', async () => {
    const user = userEvent.setup();
    render(<UnitToggle />);

    await user.click(screen.getByRole('radio', { name: 'ریال' }));

    expect(useUnitStore.getState().unit).toBe('rial');
    expect(localStorage.getItem(UNIT_STORAGE_KEY)).toContain('rial');
  });

  it('حالت فعال با aria-checked اعلام می‌شود، نه فقط با رنگ', async () => {
    const user = userEvent.setup();
    render(<UnitToggle />);

    await user.click(screen.getByRole('radio', { name: 'ریال' }));

    expect(screen.getByRole('radio', { name: 'ریال' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'طلا' })).toHaveAttribute('aria-checked', 'false');
  });

  it('هر دو هدف لمسی حداقل ۴۴ پیکسل ارتفاع دارند', () => {
    render(<UnitToggle />);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.className).toContain('min-h-touch');
    }
  });

  it('role=radiogroup با برچسب مشخص دارد', () => {
    render(<UnitToggle />);
    expect(screen.getByRole('radiogroup', { name: 'واحد نمایش اعداد' })).toBeInTheDocument();
  });

  it('چون همه از یک استور می‌خوانند، تغییر در یک نمونه بقیه‌ی نمونه‌های همان صفحه را هم عوض می‌کند', async () => {
    const user = userEvent.setup();
    render(
      <>
        <UnitToggle />
        <UnitToggle />
      </>,
    );

    const [firstRial] = screen.getAllByRole('radio', { name: 'ریال' });
    await user.click(firstRial as HTMLElement);

    for (const radio of screen.getAllByRole('radio', { name: 'ریال' })) {
      expect(radio).toHaveAttribute('aria-checked', 'true');
    }
  });
});
