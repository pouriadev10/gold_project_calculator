import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_JALALI_RANGE, jalaliRangeToIso, type JalaliDateRange } from '@/lib/jalali';
import { JalaliDateRangeFilter } from './JalaliDateRangeFilter';

/**
 * FE-071 — فیلتر مشترک بازه‌ی تاریخ شمسی.
 *
 * فقط `Date` جعلی می‌شود (نه تایمرها) تا userEvent عادی کار کند. ساعت
 * دوشنبه ۲۰ مهر ۱۴۰۵، ۱۱:۳۰ تهران است.
 */
const TEHRAN = 'Asia/Tehran';
const NOW = new Date('2026-10-12T08:00:00.000Z');

let latest: JalaliDateRange = EMPTY_JALALI_RANGE;

function Harness({
  initial = EMPTY_JALALI_RANGE,
  timeZone = TEHRAN,
}: {
  initial?: JalaliDateRange;
  timeZone?: string;
}) {
  const [range, setRange] = useState(initial);
  return (
    <JalaliDateRangeFilter
      idPrefix="test-date"
      value={range}
      timeZone={timeZone}
      onChange={(next) => {
        latest = next;
        setRange(next);
      }}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  latest = EMPTY_JALALI_RANGE;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('JalaliDateRangeFilter — FE-071', () => {
  it('میان‌برهای امروز، این هفته و این ماه را در منطقه‌ی مستأجر می‌سازد', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'امروز' }));
    expect(latest).toEqual({
      from: { year: 1405, month: 7, day: 20 },
      to: { year: 1405, month: 7, day: 20 },
    });
    expect(screen.getByRole('button', { name: 'امروز' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /از تاریخ/ })).toHaveTextContent('۲۰ مهر ۱۴۰۵');

    await user.click(screen.getByRole('button', { name: 'این هفته' }));
    expect(latest).toEqual({
      from: { year: 1405, month: 7, day: 18 },
      to: { year: 1405, month: 7, day: 24 },
    });

    await user.click(screen.getByRole('button', { name: 'این ماه' }));
    expect(jalaliRangeToIso(latest, TEHRAN)).toEqual({
      from: '2026-09-22T20:30:00.000Z',
      to: '2026-10-22T20:29:59.999Z',
    });
    expect(screen.getByRole('button', { name: 'امروز' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('پاک کردن تا وقتی تاریخی نیست غیرفعال است و بازه را خالی می‌کند', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const clear = screen.getByRole('button', { name: /پاک کردن تاریخ/ });
    expect(clear).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'این ماه' }));
    expect(clear).toBeEnabled();
    await user.click(clear);
    expect(latest).toEqual(EMPTY_JALALI_RANGE);
    expect(screen.getAllByText('انتخاب نشده')).toHaveLength(2);
  });

  it('با تقویم شمسی شروع و پایان را انتخاب می‌کند', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /از تاریخ/ }));
    const calendar = screen.getByRole('group', { name: 'تقویم از تاریخ' });
    expect(within(calendar).getByText('مهر ۱۴۰۵')).toBeInTheDocument();
    expect(within(calendar).getByRole('button', { name: '۲۰ مهر ۱۴۰۵' })).toHaveAttribute(
      'aria-current',
      'date',
    );
    // مهر ۳۰ روزه است.
    expect(within(calendar).getByRole('button', { name: '۳۰ مهر ۱۴۰۵' })).toBeInTheDocument();
    expect(within(calendar).queryByRole('button', { name: '۳۱ مهر ۱۴۰۵' })).not.toBeInTheDocument();

    await user.click(within(calendar).getByRole('button', { name: '۵ مهر ۱۴۰۵' }));
    expect(latest).toEqual({ from: { year: 1405, month: 7, day: 5 }, to: null });

    // پایان خالی بود، پس تقویم مستقیم سراغ «تا تاریخ» رفت.
    const toCalendar = screen.getByRole('group', { name: 'تقویم تا تاریخ' });
    expect(within(toCalendar).getByRole('button', { name: '۵ مهر ۱۴۰۵' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await user.click(within(toCalendar).getByRole('button', { name: '۱۰ مهر ۱۴۰۵' }));
    expect(latest).toEqual({
      from: { year: 1405, month: 7, day: 5 },
      to: { year: 1405, month: 7, day: 10 },
    });
    expect(screen.queryByRole('group', { name: /تقویم/ })).not.toBeInTheDocument();
  });

  it('بین ماه‌ها و از مرز سال جابه‌جا می‌شود و با کلیک دوباره بسته می‌شود', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ from: { year: 1405, month: 1, day: 5 }, to: null }} />);

    const trigger = screen.getByRole('button', { name: /از تاریخ/ });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const calendar = screen.getByRole('group', { name: 'تقویم از تاریخ' });
    expect(within(calendar).getByRole('button', { name: '۵ فروردین ۱۴۰۵' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(within(calendar).getByRole('button', { name: 'ماه قبل' }));
    expect(within(calendar).getByText('اسفند ۱۴۰۴')).toBeInTheDocument();
    // ۱۴۰۴ کبیسه نیست: اسفندش ۲۹ روز است.
    expect(within(calendar).queryByRole('button', { name: '۳۰ اسفند ۱۴۰۴' })).not.toBeInTheDocument();

    await user.click(within(calendar).getByRole('button', { name: 'ماه بعد' }));
    await user.click(within(calendar).getByRole('button', { name: 'ماه بعد' }));
    expect(within(calendar).getByText('اردیبهشت ۱۴۰۵')).toBeInTheDocument();

    await user.click(trigger);
    expect(screen.queryByRole('group', { name: /تقویم/ })).not.toBeInTheDocument();
  });

  it('روزهای پیش از اول ماه را با خانه‌ی خالی از شنبه می‌چیند', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /از تاریخ/ }));

    // ۱ مهر ۱۴۰۵ چهارشنبه است: چهار خانه‌ی خالی (ش ی د س).
    const firstDay = screen.getByRole('button', { name: '۱ مهر ۱۴۰۵' });
    const grid = firstDay.parentElement!;
    expect([...grid.children].indexOf(firstDay)).toBe(4);
  });

  it('بازه‌ی وارونه را اعلام می‌کند', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{ from: { year: 1405, month: 7, day: 19 }, to: { year: 1405, month: 7, day: 25 } }}
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /تا تاریخ/ }));
    await user.click(screen.getByRole('button', { name: '۱ مهر ۱۴۰۵' }));
    expect(screen.getByRole('alert')).toHaveTextContent('تاریخ پایان نمی‌تواند پیش از تاریخ شروع باشد.');
    expect(jalaliRangeToIso(latest, TEHRAN)).toBeNull();
  });

  it('امروز را در منطقه‌ی مستأجر نشان می‌دهد، نه در منطقه‌ی دستگاه', async () => {
    // ۲۱:۰۰ UTC روز ۹ اکتبر = بامداد ۱۸ مهر در تهران، ولی هنوز ۱۷ مهر در UTC.
    vi.setSystemTime(new Date('2026-10-09T21:00:00.000Z'));
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'امروز' }));
    expect(latest.from).toEqual({ year: 1405, month: 7, day: 18 });
    expect(screen.getByText(TEHRAN)).toBeInTheDocument();
    unmount();

    render(<Harness timeZone="UTC" />);
    await user.click(screen.getByRole('button', { name: 'امروز' }));
    expect(latest.from).toEqual({ year: 1405, month: 7, day: 17 });
  });
});
