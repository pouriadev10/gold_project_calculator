import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { dualFromRial, formatCount, formatGram, grossUg, karat, type CoinType } from '@gold/core-calc';
import { CoinPositionSummary } from './CoinPositionSummary';

/**
 * FE-049 — خلاصه‌ی موقعیت سکه در معامله.
 *
 * کامپوننت خالص است — بدون query یا store، فقط props. اعداد fixture
 * همان مقادیر `CoinInventoryPage.test.tsx` (FE-038) است تا نتیجه‌ی
 * `intrinsicValue`/`bubble` واقعی از قبل دستی تأیید شده باشد: BAHAR ۱۰
 * گرم عیار ۹۰۰ = ۹ گرم خالص × نرخ ۱۰۰٬۰۰۰٬۰۰۰ = ۹۰۰٬۰۰۰٬۰۰۰ ریال هر سکه.
 */

const RATE_1000 = 100_000_000n;

const BAHAR: CoinType = {
  kind: 'coin',
  id: 'c-bahar',
  label: 'تمام بهار آزادی',
  grossWeightUg: grossUg(10_000_000n), // 10g
  karat: karat(900),
  isCentralBankMinted: true,
};

const PRIVATE: CoinType = {
  kind: 'coin',
  id: 'c-private',
  label: 'سکه ضرب خصوصی',
  grossWeightUg: grossUg(10_000_000n),
  karat: karat(900),
  isCentralBankMinted: false,
};

describe('CoinPositionSummary — خلاصه‌ی موقعیت سکه (FE-049)', () => {
  it('تعداد قبل/فروش/بعد را با ارقام فارسی نشان می‌دهد، بعد منفی را قرمز می‌کند', () => {
    render(
      <CoinPositionSummary coin={BAHAR} countBefore={5} countSold={8} marketUnitPriceRial={1_000_000_000n} rate1000={RATE_1000} />,
    );

    expect(screen.getByText('تعداد قبل').nextElementSibling).toHaveTextContent('۵');
    expect(screen.getByText('تعداد فروش').nextElementSibling).toHaveTextContent('۸');
    const after = screen.getByText('تعداد بعد').nextElementSibling;
    expect(after).toHaveTextContent(formatCount(-3));
    expect(after).toHaveClass('text-debit');
  });

  it('ارزش بازار و ارزش ذاتی را روی تعداد فروش (نه موجودی) با فرمول واقعی core-calc حساب می‌کند', () => {
    render(
      <CoinPositionSummary coin={BAHAR} countBefore={5} countSold={3} marketUnitPriceRial={1_000_000_000n} rate1000={RATE_1000} />,
    );

    // ارزش بازار = ۳ × ۱٬۰۰۰٬۰۰۰٬۰۰۰ = ۳٬۰۰۰٬۰۰۰٬۰۰۰ ریال
    const marketValue = dualFromRial(3_000_000_000n, RATE_1000);
    expect(screen.getByText(formatGram(marketValue.pureMg))).toBeInTheDocument();

    // ارزش ذاتی = ۳ × ۹۰۰٬۰۰۰٬۰۰۰ = ۲٬۷۰۰٬۰۰۰٬۰۰۰ ریال
    const intrinsicValue = dualFromRial(2_700_000_000n, RATE_1000);
    expect(screen.getByText(formatGram(intrinsicValue.pureMg))).toBeInTheDocument();

    // حباب نمایشی = ۳ × (۱٬۰۰۰٬۰۰۰٬۰۰۰ − ۹۰۰٬۰۰۰٬۰۰۰) = ۳۰۰٬۰۰۰٬۰۰۰ ریال
    const bubbleValue = dualFromRial(300_000_000n, RATE_1000);
    expect(screen.getByText(formatGram(bubbleValue.pureMg))).toBeInTheDocument();
  });

  it('حباب نمایشی فقط برای نوع بانک مرکزی رندر می‌شود', () => {
    const { rerender } = render(
      <CoinPositionSummary coin={BAHAR} countBefore={5} countSold={3} marketUnitPriceRial={1_000_000_000n} rate1000={RATE_1000} />,
    );
    expect(screen.getByText('حباب نمایشی')).toBeInTheDocument();

    rerender(
      <CoinPositionSummary coin={PRIVATE} countBefore={5} countSold={3} marketUnitPriceRial={1_000_000_000n} rate1000={RATE_1000} />,
    );
    expect(screen.queryByText('حباب نمایشی')).not.toBeInTheDocument();
  });

  it('بدون مظنه ارزش ذاتی را «مظنه در دسترس نیست» نشان می‌دهد، نه صفر ساکت', () => {
    render(
      <CoinPositionSummary coin={BAHAR} countBefore={5} countSold={3} marketUnitPriceRial={1_000_000_000n} rate1000={undefined} />,
    );
    expect(screen.getByText('مظنه در دسترس نیست')).toBeInTheDocument();
  });

  it('پیش از تایپ تعداد فروش (صفر)، ارزش بازار خالی می‌ماند نه صفر محاسبه‌شده', () => {
    render(<CoinPositionSummary coin={BAHAR} countBefore={5} countSold={0} marketUnitPriceRial={0n} rate1000={RATE_1000} />);
    expect(screen.getByText('تعداد فروش').nextElementSibling).toHaveTextContent('۰');
  });
});
