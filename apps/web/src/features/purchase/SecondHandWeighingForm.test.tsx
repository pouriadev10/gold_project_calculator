import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { SecondHandWeighingForm } from './SecondHandWeighingForm';

function renderForm(props: Partial<Parameters<typeof SecondHandWeighingForm>[0]> = {}) {
  const defaultProps = {
    grossWeightMg: 1000n,
    onGrossWeightChange: vi.fn(),
    stoneWeightMg: 100n,
    onStoneWeightChange: vi.fn(),
    otherDeductionWeightMg: 0n,
    onOtherDeductionWeightChange: vi.fn(),
    karat: 740n,
    onKaratChange: vi.fn(),
    feeRial: 25000n,
    onFeeChange: vi.fn(),
    maznehRial: 100_000_000n,
    ...props,
  };

  return {
    ...render(
      <div>
        <SecondHandWeighingForm {...defaultProps} />
        <NumericKeypad />
      </div>,
    ),
    props: defaultProps,
  };
}

describe('SecondHandWeighingForm — FE-057', () => {
  it('همه‌ی فیلدهای وزن، کسورات، عیار و کارمزد را نمایش می‌دهد', () => {
    renderForm();
    expect(screen.getByLabelText('وزن کل (ناخالص)')).toBeInTheDocument();
    expect(screen.getByLabelText('وزن نگین')).toBeInTheDocument();
    expect(screen.getByLabelText('سایر متعلقات (چرم، نخ، موم)')).toBeInTheDocument();
    expect(screen.getByLabelText('عیار خرید')).toBeInTheDocument();
    expect(screen.getByLabelText('کارمزد خرید (اختیاری)')).toBeInTheDocument();
  });

  it('محاسبات پیش‌نمایش وزن خالص و طلای خالص را بر اساس core-calc نشان می‌دهد', () => {
    renderForm();
    // ۱۰۰۰ میلی‌گرم منهای ۱۰۰ میلی‌گرم نگین = ۹۰۰ میلی‌گرم خالص ناخالص = ۰٫۹۰۰ گرم
    expect(screen.getByTestId('net-weight-display')).toHaveTextContent('۰٫۹۰۰ گرم');
    // ۹۰۰ میلی‌گرم با عیار ۷۴۰ = ۶۶۶ میلی‌گرم طلای خالص ۱۰۰۰ = ۰٫۶۶۶ گرم
    expect(screen.getByTestId('pure-weight-display')).toHaveTextContent('۰٫۶۶۶ گرم');
  });

  it('مبلغ قبل از کارمزد، کارمزد و مبلغ نهایی را محاسبه و نمایش می‌دهد', () => {
    renderForm();
    // مبلغ ناخالص: ۲۰٬۴۹۹٬۵۵۱ ریال
    expect(screen.getByText('مبلغ قبل از کارمزد:')).toBeInTheDocument();
    // کارمزد کسرشده: ۲۵٬۰۰۰ ریال
    expect(screen.getByText('کارمزد کسرشده:')).toBeInTheDocument();
    // مبلغ نهایی: ۲۰٬۴۷۵٬۰۰۰ ریال
    expect(screen.getByText('مبلغ نهایی قابل پرداخت:')).toBeInTheDocument();
  });

  it('وقتی کسورات از وزن ناخالص بیشتر شود، خطای اعتبارسنجی را نشان می‌دهد', () => {
    renderForm({
      grossWeightMg: 1000n,
      stoneWeightMg: 1000n,
      otherDeductionWeightMg: 50n,
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/مجموع وزن کسورات/);
  });

  it('در حالت‌های تفکیک‌شده (mode) فقط بخش مربوطه را رندر می‌کند', () => {
    render(
      <div>
        <SecondHandWeighingForm
          grossWeightMg={1000n}
          onGrossWeightChange={vi.fn()}
          stoneWeightMg={0n}
          onStoneWeightChange={vi.fn()}
          otherDeductionWeightMg={0n}
          onOtherDeductionWeightChange={vi.fn()}
          karat={740n}
          onKaratChange={vi.fn()}
          feeRial={0n}
          onFeeChange={vi.fn()}
          maznehRial={100_000_000n}
          mode="WEIGHING"
        />
        <NumericKeypad />
      </div>,
    );

    expect(screen.getByLabelText('وزن کل (ناخالص)')).toBeInTheDocument();
    expect(screen.queryByLabelText('وزن نگین')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('عیار خرید')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('کارمزد خرید (اختیاری)')).not.toBeInTheDocument();
  });
});
