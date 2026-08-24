import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dualFromRial, formatRial } from '@gold/core-calc';
import type { CreateRialSettlementInput, RialSettlement } from '@/api/contracts';
import { createRialSettlement } from '@/api/settlements';
import { usePartyBalances } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MoneyInput } from '@/components/keypad/MoneyInput';
import { useMazneh } from '@/features/home/useMazneh';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { toast } from '@/stores/toast-store';

/**
 * پرداخت ریالی روی مانده‌ی شخص — FE-051 («هر روش component مستقل داشته
 * باشد»، FE-050). `partyId` تنها ورودی بیرونی است؛ خودش موجودی جاری را
 * می‌خواند و مستقیم `POST /parties/:partyId/settlements/rial` (BE-045) را
 * می‌زند — بدون نیاز به اسمبل‌شدن در صفحه‌ای که هنوز ساخته نشده (FE-055).
 *
 * **فقط «مبلغ» فیلد واقعی است.** «حساب مقصد در صورت نیاز» و «توضیح» در
 * فهرست فیلدهای این تسک بودند، اما `createRialSettlementSchema` واقعی
 * (`.strict()`) فقط `amountRial`/`effectiveAt` می‌پذیرد —
 * `RialSettlementsService` مقصد را همیشه ثابت (صندوق) می‌سازد، نه از
 * ورودی کاربر. فیلدی که سرور می‌پذیرد‌اش را رد می‌کند بدتر از نبودنش
 * است، پس این دو فیلد عمداً ساخته نشدند؛ اگر روزی بک‌اند تغییر کرد، اینجا
 * هم عوض می‌شود.
 *
 * **بدون سقف «بیشتر از طلب»** — برخلاف فروش سکه (FE-048)، سرویس واقعی
 * هیچ مقایسه‌ای با مانده ندارد؛ پرداخت بیشتر فقط شخص را بستانکار می‌کند،
 * خطا نیست (دقیقاً مثل اختلاف طبیعی خرید دست‌دوم B2C، بخش ۲-۵ CLAUDE.md).
 * پس تنها اعتبارسنجی همان قرارداد است: مبلغ مثبت.
 *
 * **«پرداخت کامل» یک کپی یک‌باره است**، نه هم‌گامی پیوسته — همان درسی که
 * از باگ واقعی `SalePaymentInput`/`CoinSaleForm` (FE-047/FE-048) آمد:
 * دادن مقدار مشتق‌شده‌ای که هر رندر عوض می‌شود به `value` یک فیلد کیپدی،
 * وقتی `onChange`اش state را می‌نویسد، فیلد را با یک عدد میانی «لمس‌شده»
 * علامت می‌زند. `amountRial` فقط از خودش می‌آید.
 *
 * «مانده پس از این پرداخت» (FE-055، «preview مانده بعد») مستقیم همینجا
 * از `receivableRial - amountRial` محاسبه می‌شود — این فرم از قبل موجودی
 * جاری را برای «پرداخت کامل» می‌خواند، پس صفحه‌ی میزبان لازم نیست همان
 * داده را دوباره بگیرد یا این مقدار زنده را از این فرم بیرون بکشد.
 */

export interface RialSettlementFormProps {
  readonly partyId: string;
  readonly onSuccess?: (settlement: RialSettlement) => void;
}

export function RialSettlementForm({ partyId, onSuccess }: RialSettlementFormProps) {
  const balancesQuery = usePartyBalances(partyId, {});
  const mazneh = useMazneh();
  const queryClient = useQueryClient();

  const [amountRial, setAmountRial] = useState(0n);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<RialSettlement | null>(null);

  const { submit: runSubmit, isSubmitting, reset: resetKey } = useIdempotentSubmit(
    (key: string, input: CreateRialSettlementInput) => createRialSettlement(partyId, input, key),
  );

  const receivableRial = balancesQuery.data ? BigInt(balancesQuery.data.rawBalances.rial) : undefined;
  // فقط وقتی شخص واقعاً بدهکار است معنا دارد؛ صفر/منفی یعنی چیزی برای «کامل» نیست
  const fullAmount = receivableRial !== undefined && receivableRial > 0n ? receivableRial : undefined;
  const rate1000 = mazneh.data?.gram1000;

  const reason = amountRial <= 0n ? 'مبلغ باید بزرگ‌تر از صفر باشد.' : null;

  function resetForm() {
    setAmountRial(0n);
    setError(null);
    setResult(null);
    resetKey();
  }

  async function handleSubmit() {
    if (reason !== null) return;

    setError(null);
    const input: CreateRialSettlementInput = {
      amountRial: amountRial.toString(),
      effectiveAt: new Date().toISOString(),
    };

    try {
      const settlement = await runSubmit(input);
      if (!settlement) return;

      setResult(settlement);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.parties.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all() }),
      ]);

      toast.success('پرداخت ثبت شد', `${formatRial(settlement.amountRial)} ریال`);
      onSuccess?.(settlement);
    } catch (caught) {
      setError(caught);
    }
  }

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">پرداخت ریالی ثبت شد</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">مبلغ پرداختی</span>
            {rate1000 !== undefined ? (
              <AmountDisplay amount={dualFromRial(result.amountRial, rate1000)} size="sm" />
            ) : (
              <span className="tabular-nums">{formatRial(result.amountRial)} ریال</span>
            )}
          </div>
          <Button size="action" className="w-full" onClick={resetForm}>
            پرداخت ریالی جدید
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">پرداخت ریالی</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {fullAmount !== undefined ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">مانده‌ی بدهکار فعلی</span>
            {rate1000 !== undefined ? (
              <AmountDisplay amount={dualFromRial(fullAmount, rate1000)} size="sm" />
            ) : (
              <span className="tabular-nums">{formatRial(fullAmount)} ریال</span>
            )}
          </div>
        ) : null}

        <MoneyInput label="مبلغ" value={amountRial} onChange={setAmountRial} />

        {receivableRial !== undefined && amountRial > 0n ? (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>مانده پس از این پرداخت</span>
            {rate1000 !== undefined ? (
              <AmountDisplay amount={dualFromRial(receivableRial - amountRial, rate1000)} signed size="sm" />
            ) : (
              <span className="tabular-nums">{formatRial(receivableRial - amountRial)} ریال</span>
            )}
          </div>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fullAmount === undefined}
          onClick={() => setAmountRial(fullAmount ?? 0n)}
        >
          پرداخت کامل
        </Button>

        {error ? <ApiErrorNotice error={error} /> : null}

        <Button
          size="action"
          className="w-full"
          disabled={reason !== null || isSubmitting}
          onClick={() => void handleSubmit()}
        >
          {isSubmitting ? 'در حال ثبت…' : 'ثبت پرداخت'}
        </Button>
        {reason !== null ? <p className="text-center text-xs text-muted-foreground">{reason}</p> : null}
      </CardContent>
    </Card>
  );
}
