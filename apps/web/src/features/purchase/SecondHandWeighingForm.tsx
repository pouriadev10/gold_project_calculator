import { AlertTriangle, Scale } from 'lucide-react';
import { formatGram, toSafeNumber } from '@gold/core-calc';
import { AmountDisplay, RateDisplay } from '@/components/common/AmountDisplay';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KaratInput } from '@/components/keypad/KaratInput';
import { MoneyInput } from '@/components/keypad/MoneyInput';
import { WeightInput } from '@/components/keypad/WeightInput';
import {
  calculateSecondHandWeighing,
  type SecondHandWeighingResult,
} from './purchase-pricing';

export interface SecondHandWeighingFormProps {
  grossWeightMg: bigint;
  onGrossWeightChange: (value: bigint) => void;
  stoneWeightMg: bigint;
  onStoneWeightChange: (value: bigint) => void;
  otherDeductionWeightMg: bigint;
  onOtherDeductionWeightChange: (value: bigint) => void;
  karat: bigint;
  onKaratChange: (value: bigint) => void;
  feeRial: bigint;
  onFeeChange: (value: bigint) => void;
  maznehRial: bigint;
  /**
   * برای فیلتر بخش‌های فعال در حالت چندمرحله‌ای (Wizard).
   * اگر مشخص نشود، فرم کامل رندر می‌شود.
   */
  mode?: 'WEIGHING' | 'DEDUCTIONS' | 'KARAT' | 'AMOUNT' | 'FULL';
}

export function SecondHandWeighingForm({
  grossWeightMg,
  onGrossWeightChange,
  stoneWeightMg,
  onStoneWeightChange,
  otherDeductionWeightMg,
  onOtherDeductionWeightChange,
  karat,
  onKaratChange,
  feeRial,
  onFeeChange,
  maznehRial,
  mode = 'FULL',
}: SecondHandWeighingFormProps) {
  const result: SecondHandWeighingResult = calculateSecondHandWeighing(
    {
      grossWeightMg: grossWeightMg.toString(),
      stoneWeightMg: stoneWeightMg.toString(),
      otherDeductionWeightMg: otherDeductionWeightMg.toString(),
      purchaseKarat: toSafeNumber(karat),
      feeRial: feeRial.toString(),
    },
    maznehRial,
  );

  const showWeighing = mode === 'FULL' || mode === 'WEIGHING';
  const showDeductions = mode === 'FULL' || mode === 'DEDUCTIONS';
  const showKarat = mode === 'FULL' || mode === 'KARAT';
  const showAmount = mode === 'FULL' || mode === 'AMOUNT';

  return (
    <div className="space-y-4">
      {showWeighing ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Scale className="size-4 text-primary" aria-hidden="true" />
              وزن‌کشی طلای دست‌دوم
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <WeightInput
              label="وزن کل (ناخالص)"
              value={grossWeightMg}
              onChange={onGrossWeightChange}
            />
          </CardContent>
        </Card>
      ) : null}

      {showDeductions ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">کسورات و متعلقات</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <WeightInput
              label="وزن نگین"
              value={stoneWeightMg}
              onChange={onStoneWeightChange}
            />
            <WeightInput
              label="سایر متعلقات (چرم، نخ، موم)"
              value={otherDeductionWeightMg}
              onChange={onOtherDeductionWeightChange}
            />

            {result.ok ? (
              <div className="flex items-center justify-between border-t border-border/60 pt-2 text-xs">
                <span className="text-muted-foreground">وزن خالص پیش از عیار:</span>
                <span className="font-medium tabular-nums" data-testid="net-weight-display">
                  {formatGram(result.calc.netWeightMg)} گرم
                </span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {showKarat ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">عیار خرید</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <KaratInput
              label="عیار خرید"
              value={karat}
              onChange={onKaratChange}
            />
            {result.ok ? (
              <div className="flex items-center justify-between border-t border-border/60 pt-2 text-xs">
                <span className="text-muted-foreground">نرخ هر گرم عیار {toSafeNumber(karat)}:</span>
                <RateDisplay value={result.calc.purchaseKaratRatePerGramRial} size="sm" />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {showAmount ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">کارمزد و پیش‌نمایش مبلغ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <MoneyInput
              label="کارمزد خرید (اختیاری)"
              value={feeRial}
              onChange={onFeeChange}
            />

            {result.ok ? (
              <div className="space-y-2 border-t border-border/60 pt-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">طلای خالص معادل (عیار ۱۰۰۰):</span>
                  <span className="font-medium tabular-nums" data-testid="pure-weight-display">
                    {formatGram(result.calc.pureWeightMg)} گرم
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">مبلغ قبل از کارمزد:</span>
                  <AmountDisplay amount={result.calc.dualGrossPurchaseAmount} size="sm" />
                </div>
                {feeRial > 0n ? (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>کارمزد کسرشده:</span>
                    <AmountDisplay amount={result.calc.dualFeeAmount} size="sm" />
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-t border-dashed border-border pt-2 text-base font-semibold">
                  <span>مبلغ نهایی قابل پرداخت:</span>
                  <AmountDisplay
                    amount={result.calc.dualFinalAmount}
                    size="md"
                    className="text-primary font-bold"
                  />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!result.ok && (grossWeightMg > 0n || stoneWeightMg > 0n || feeRial > 0n) ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive" role="alert">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{result.error}</span>
        </div>
      ) : null}
    </div>
  );
}
