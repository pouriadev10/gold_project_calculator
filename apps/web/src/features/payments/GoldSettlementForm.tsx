import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  bullionPrice,
  dualFromRial,
  formatGram,
  formatRial,
  grossMg,
  karat as toKarat,
  rial,
  toSafeNumber,
} from '@gold/core-calc';
import type { CreateGoldSettlementInput, GoldSettlement } from '@/api/contracts';
import { createGoldSettlement } from '@/api/settlements';
import { usePartyBalances } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KaratInput } from '@/components/keypad/KaratInput';
import { WeightInput } from '@/components/keypad/WeightInput';
import { useMazneh, type MaznehSnapshot } from '@/features/home/useMazneh';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { toast } from '@/stores/toast-store';

/**
 * پرداخت با طلا (دریافت طلا برای تسویه‌ی مانده) — FE-052، «هر روش
 * component مستقل داشته باشد» (FE-050). آینه‌ی `RialSettlementForm`
 * (FE-051): فقط `partyId` می‌گیرد و مستقیم `POST
 * /parties/:partyId/settlements/gold` (BE-046) را می‌زند.
 *
 * **مظنه قفل‌شونده** — برخلاف تسویه‌ی ریالی که هیچ تبدیل واحدی ندارد،
 * اینجا نرخ لازم است؛ اگر مظنه‌ی زنده وسط تایپ کاربر عوض شود نباید
 * پیش‌نمایش را بی‌صدا جابه‌جا کند (بخش ۲-۸ CLAUDE.md). قفل فقط **یک بار**
 * از `null` به اولین مظنه‌ی در دسترس می‌رود — شرط `lockedQuote === null`
 * خودش تضمین می‌کند افکت بعد از آن هیچ‌وقت دوباره ننویسد، برخلاف باگ
 * FE-047/FE-048 که مقدار مشتق‌شده هر رندر عوض می‌شد؛ اینجا یک گذار
 * یک‌طرفه‌ی ساده است، نه یک منبع دائماً زنده که به یک فیلد کیپدی می‌رود.
 *
 * **پیش‌نمایش («معادل نمایشی») دقیقاً فرمول سرور را آینه می‌کند** —
 * `bullionPrice` همان `valueOfPure(toPureMg(...), rate1000)` است که
 * `GoldSettlementsService` واقعی حساب می‌کند؛ طلا هیچ‌وقت حباب ندارد
 * (بخش ۲-۳)، پس این فرمول همیشه دقیق است، نه فقط تقریبی. مبلغ نهایی و
 * «نرخ ردیف» بعد از ثبت از پاسخ سرور می‌آیند، نه از این پیش‌نمایش.
 *
 * «مانده پس از این پرداخت» (FE-055، «preview مانده بعد») از
 * `receivableRial - previewSettledRial` می‌آید — این فرم برای همین
 * خودش `usePartyBalances` را می‌خواند، نه اینکه صفحه‌ی میزبان مقدار
 * زنده‌ی وسط تایپ را از این فرم بیرون بکشد.
 */

export interface GoldSettlementFormProps {
  readonly partyId: string;
  readonly onSuccess?: (settlement: GoldSettlement) => void;
}

export function GoldSettlementForm({ partyId, onSuccess }: GoldSettlementFormProps) {
  const balancesQuery = usePartyBalances(partyId, {});
  const mazneh = useMazneh();
  const queryClient = useQueryClient();

  const [grossWeightMg, setGrossWeightMg] = useState(0n);
  const [karatValue, setKaratValue] = useState(0n);
  const [lockedQuote, setLockedQuote] = useState<MaznehSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<GoldSettlement | null>(null);

  useEffect(() => {
    if (lockedQuote === null && mazneh.data) setLockedQuote(mazneh.data);
  }, [mazneh.data, lockedQuote]);

  const { submit: runSubmit, isSubmitting, reset: resetKey } = useIdempotentSubmit(
    (key: string, input: CreateGoldSettlementInput) => createGoldSettlement(partyId, input, key),
  );

  const karatValid = karatValue >= 1n && karatValue <= 1000n;
  const previewSettledRial =
    grossWeightMg > 0n && karatValid && lockedQuote !== null
      ? bullionPrice(grossMg(grossWeightMg), toKarat(toSafeNumber(karatValue)), rial(lockedQuote.gram1000))
      : undefined;
  const receivableRial = balancesQuery.data ? BigInt(balancesQuery.data.rawBalances.rial) : undefined;

  const reason: string | null =
    grossWeightMg <= 0n
      ? 'وزن باید بزرگ‌تر از صفر باشد.'
      : !karatValid
        ? 'عیار باید عددی بین ۱ و ۱۰۰۰ باشد.'
        : lockedQuote === null
          ? 'مظنه هنوز دریافت نشده — چند لحظه صبر کنید.'
          : null;

  function resetForm() {
    setGrossWeightMg(0n);
    setKaratValue(0n);
    setLockedQuote(null);
    setError(null);
    setResult(null);
    resetKey();
  }

  async function handleSubmit() {
    if (reason !== null || lockedQuote === null) return;

    setError(null);
    const input: CreateGoldSettlementInput = {
      grossWeightMg: grossWeightMg.toString(),
      karat: toSafeNumber(karatValue),
      quoteId: lockedQuote.quoteId,
      effectiveAt: new Date().toISOString(),
    };

    try {
      const settlement = await runSubmit(input);
      if (!settlement) return;

      setResult(settlement);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.parties.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventoryBalances.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventoryMovements.all() }),
      ]);

      toast.success('پرداخت طلا ثبت شد', `${formatGram(settlement.pureWeightMg)}`);
      onSuccess?.(settlement);
    } catch (caught) {
      setError(caught);
    }
  }

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">پرداخت با طلا ثبت شد</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">وزن خالص دریافتی</span>
            <span className="tabular-nums font-medium">{formatGram(result.pureWeightMg)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">مبلغ تسویه‌شده</span>
            <AmountDisplay amount={dualFromRial(result.settledRial, result.goldRatePerGramRial)} size="sm" />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>نرخ ردیف</span>
            <span className="tabular-nums">{formatRial(result.goldRatePerGramRial)} ریال/گرم</span>
          </div>
          <Button size="action" className="w-full" onClick={resetForm}>
            پرداخت طلای جدید
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">پرداخت با طلا</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <WeightInput label="وزن" value={grossWeightMg} onChange={setGrossWeightMg} karat={karatValue} />
        <KaratInput label="عیار" value={karatValue} onChange={setKaratValue} />

        <div className="space-y-1.5 border-t border-border pt-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">معادل نمایشی</span>
            {previewSettledRial !== undefined ? (
              <AmountDisplay amount={dualFromRial(previewSettledRial, lockedQuote!.gram1000)} size="sm" />
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>
          {lockedQuote !== null ? (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>نرخ ردیف</span>
              <span className="tabular-nums">{formatRial(lockedQuote.gram1000)} ریال/گرم</span>
            </div>
          ) : null}
          {receivableRial !== undefined && previewSettledRial !== undefined ? (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>مانده پس از این پرداخت</span>
              <AmountDisplay amount={dualFromRial(receivableRial - previewSettledRial, lockedQuote!.gram1000)} signed size="sm" />
            </div>
          ) : null}
        </div>

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
