import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JewelryItemVersion } from '@/api/contracts';
import { JewelryItemList, formatWage, type JewelryItemPage } from './JewelryItemList';

/**
 * FE-036 — فهرست کالای زیورآلات.
 *
 * برخلاف `PartyList` (که خودش `useParties` را صدا می‌زند)، این کامپوننت
 * `data`/`isLoading`/`isError` را مستقیم به‌عنوان prop می‌گیرد — چون
 * `JewelryItemsPage` باید پیش از رسیدن به اینجا حالت فیلتر عیار
 * (batch بزرگ‌تر + صفحه‌بندی سمت کلاینت) را اعمال کند. تست این‌جا فقط
 * خودِ رندر را می‌سنجد، نه منبع داده را.
 */

function item(overrides: Partial<JewelryItemVersion> = {}): JewelryItemVersion {
  return {
    id: 'v1',
    jewelryItemId: 'i1',
    code: 'BR-750-12',
    title: 'دستبند ۱۸ عیار',
    grossWeightMg: '12350',
    karat: 750,
    stoneWeightMg: '0',
    otherDeductionWeightMg: '0',
    wageType: 'PER_GRAM',
    wageValue: '3500000',
    validFrom: '2026-07-30T09:00:00+00:00',
    validTo: null,
    version: 1,
    active: true,
    ...overrides,
  };
}

function page(items: JewelryItemVersion[], total = items.length, limit = 10, offset = 0): JewelryItemPage {
  return { items, total, limit, offset };
}

function mockViewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('640px') && desktop,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    })),
  );
}

const baseProps = { onRetry: vi.fn(), onOffsetChange: vi.fn(), onEdit: vi.fn() };

beforeEach(() => {
  mockViewport(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('formatWage', () => {
  it('PER_GRAM را با پسوند ریال/گرم نشان می‌دهد', () => {
    expect(formatWage('PER_GRAM', '3500000')).toBe('۳٬۵۰۰٬۰۰۰ ریال/گرم');
  });

  it('FLAT را فقط با ریال نشان می‌دهد', () => {
    expect(formatWage('FLAT', '8000000')).toBe('۸٬۰۰۰٬۰۰۰ ریال');
  });

  it('PERCENT_X100 را با مقیاس درست تبدیل می‌کند — ۱۲۰۰ یعنی ۱۲٪', () => {
    expect(formatWage('PERCENT_X100', '1200')).toBe('۱۲٪');
  });

  it('PERCENT_X100 با رقم اعشار — ۷۵۰ یعنی ۷٫۵٪', () => {
    expect(formatWage('PERCENT_X100', '750')).toBe('۷٫۵٪');
  });
});

describe('JewelryItemList — بارگذاری، خطا، خالی', () => {
  it('در حال بارگذاری: اسکلت نشان می‌دهد', () => {
    const { container } = render(<JewelryItemList {...baseProps} data={undefined} isLoading isError={false} />);
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('شکست دریافت: پیام خطا و دکمه‌ی تلاش دوباره', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<JewelryItemList {...baseProps} data={undefined} isLoading={false} isError onRetry={onRetry} />);

    expect(screen.getByText('دریافت فهرست کالا ناموفق بود.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('فهرست خالی: پیام «کالایی پیدا نشد» را نشان می‌دهد', () => {
    render(<JewelryItemList {...baseProps} data={page([])} isLoading={false} isError={false} />);
    expect(screen.getByText('کالایی پیدا نشد')).toBeInTheDocument();
  });
});

describe('JewelryItemList — نمای دسکتاپ (از ۶۴۰px به بالا)', () => {
  it('جدول با ستون‌های کد/عنوان/وزن/عیار/اجرت/وضعیت رندر می‌شود', () => {
    mockViewport(true);
    render(
      <JewelryItemList
        {...baseProps}
        data={page([
          item(),
          item({
            jewelryItemId: 'i2',
            code: 'RG-700-05',
            title: 'انگشتر',
            grossWeightMg: '5600',
            karat: 700,
            active: false,
          }),
        ])}
        isLoading={false}
        isError={false}
      />,
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'کد' })).toBeInTheDocument();
    expect(screen.getByText('دستبند ۱۸ عیار')).toBeInTheDocument();
    expect(screen.getByText('۱۲٫۳۵۰')).toBeInTheDocument();
    expect(screen.getByText('۷۵۰')).toBeInTheDocument();
    expect(screen.getByText('غیرفعال')).toBeInTheDocument();
  });

  it('کلیک روی دکمه‌ی ویرایش، همان کالا را به onEdit می‌دهد', async () => {
    const onEdit = vi.fn();
    const target = item({ title: 'دستبند ۱۸ عیار' });
    const user = userEvent.setup();
    render(<JewelryItemList {...baseProps} data={page([target])} isLoading={false} isError={false} onEdit={onEdit} />);

    await user.click(screen.getByRole('button', { name: 'ویرایش دستبند ۱۸ عیار' }));
    expect(onEdit).toHaveBeenCalledWith(target);
  });
});

describe('JewelryItemList — نمای موبایل (زیر ۶۴۰px)', () => {
  it('بدون جدول، فهرست کارتی رندر می‌شود', () => {
    mockViewport(false);
    render(<JewelryItemList {...baseProps} data={page([item()])} isLoading={false} isError={false} />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('دستبند ۱۸ عیار')).toBeInTheDocument();
    expect(screen.getByText('BR-750-12')).toBeInTheDocument();
  });
});

describe('JewelryItemList — pagination', () => {
  it('با یک صفحه، کنترل صفحه‌بندی نشان داده نمی‌شود', () => {
    render(<JewelryItemList {...baseProps} data={page([item()], 1, 10, 0)} isLoading={false} isError={false} />);
    expect(screen.queryByRole('button', { name: /بعدی/ })).not.toBeInTheDocument();
  });

  it('صفحه‌ی اول: «بعدی» offset درست بعدی را می‌فرستد', async () => {
    const onOffsetChange = vi.fn();
    const user = userEvent.setup();
    render(
      <JewelryItemList
        {...baseProps}
        data={page(Array.from({ length: 10 }, (_, i) => item({ jewelryItemId: `i${i}` })), 14, 10, 0)}
        isLoading={false}
        isError={false}
        onOffsetChange={onOffsetChange}
      />,
    );

    expect(screen.getByText('صفحه ۱ از ۲')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /بعدی/ }));
    expect(onOffsetChange).toHaveBeenCalledWith(10);
  });
});
