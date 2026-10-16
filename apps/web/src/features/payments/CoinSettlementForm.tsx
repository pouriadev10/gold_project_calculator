import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  bubble,
  coinPositionValue,
  dualFromRial,
  formatGram,
  formatRial,
  grossUg,
  intrinsicValue,
  karat as toKarat,
  rial,
  toSafeNumber,
  type CoinType,
} from '@gold/core-calc';
import {
  createCoinSettlementSchema,
  type CoinSettlement,
  type CoinTypeVersion,
  type CreateCoinSettlementInput,
} from '@/api/contracts';
import { createCoinSettlement } from '@/api/settlements';
import { useCoinTypes, usePartyBalances } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { RialAmount } from '@/components/common/RialAmount';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { ErrorState } from '@/components/common/ErrorState';
import { OFFLINE_SUBMIT_MESSAGE } from '@/components/common/OfflineSubmitHint';
import { PENDING_SUBMIT_ACTION, PendingSubmitNotice } from '@/components/common/PendingSubmitNotice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { CountInput } from '@/components/keypad/CountInput';
import { MoneyInput } from '@/components/keypad/MoneyInput';
import { UnsavedChangesGuard } from '@/components/common/UnsavedChangesGuard';
import { useMazneh } from '@/features/home/useMazneh';
import { useFinancialSubmit } from '@/hooks/useFinancialSubmit';
import { documentQuoteRate } from '@/lib/document-rate';
import { toast } from '@/stores/toast-store';

/**
 * پرداخت با سکه (دریافت سکه برای تسویه‌ی مانده) — FE-053، «هر روش
 * component مستقل داشته باشد» (FE-050). آینه‌ی `GoldSettlementForm`
 * (FE-052): فقط `partyId` می‌گیرد و مستقیم `POST
 * /parties/:partyId/settlements/coins` (BE-047) را می‌زند.
 *
 * **بدون قفل مظنه** — برخلاف تسویه‌ی طلا، این تسک قاعده‌ی «قفل‌شونده»
 * ندارد؛ نرخ زنده تا لحظه‌ی ثبت می‌آید، همان الگوی `CoinSaleForm`
 * (FE-048) پیش از هر مرحله‌ی مروری.
 *
 * **قانون حباب** با همان الگوی `CoinSaleForm`/`CoinInventoryList` اجرا
 * می‌شود: `toCoinType` یک کپی محلی است، `bubble()` فقط
 * `CentralBankMintedCoinType` می‌پذیرد.
 *
 * **«تبدیل به وزن فقط نمایشی»** — `grossWeightMg` زیر تعداد فقط برای
 * چشم کاربر است؛ نه در payload می‌رود نه جایی ذخیره می‌شود (بخش ۲-۲
 * CLAUDE.md — سکه هرگز در لایه‌ی ذخیره‌سازی به وزن تبدیل نمی‌شود).
 *
 * «مانده پس از این پرداخت» (FE-055، «preview مانده بعد») از
 * `receivableRial - settledRial` می‌آید — این فرم برای همین خودش
 * `usePartyBalances` را می‌خواند.
 */

export interface CoinSettlementFormProps {
  readonly partyId: string;
  readonly onSuccess?: (settlement: CoinSettlement) => void;
}

function toCoinType(version: CoinTypeVersion): CoinType {
  const shared = {
    kind: 'coin' as const,
    id: version.coinTypeId,
    label: version.title,
    grossWeightUg: grossUg(BigInt(version.grossWeightUg)),
    karat: toKarat(version.karat),
  };
  return version.isCentralBankMinted
    ? { ...shared, isCentralBankMinted: true }
    : { ...shared, isCentralBankMinted: false };
}

export function CoinSettlementForm({ partyId, onSuccess }: CoinSettlementFormProps) {
  const coinTypesQuery = useCoinTypes();
  const balancesQuery = usePartyBalances(partyId, {});
  const mazneh = useMazneh();
  const queryClient = useQueryClient();

  const [coinTypeId, setCoinTypeId] = useState<string | null>(null);
  const [count, setCount] = useState(0n);
  const [marketUnitPriceRial, setMarketUnitPriceRial] = useState(0n);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<CoinSettlement | null>(null);
  /** FE-104: نرخ مظنه‌ای که سند با آن ثبت شد، در لحظه‌ی ثبت — نه مظنه‌ی زنده‌ی هر رندر. */
  const [resultRate1000, setResultRate1000] = useState<bigint | null>(null);

  // FE-100: کلید و بدنه (همراه quoteId و effectiveAt) تا پاسخ قطعی سنجاق می‌مانند
  const {
    submit: runSubmit,
    retry,
    isSubmitting,
    locked,
    uncertain,
    pending,
    reset: resetKey,
    offline,
  } = useFinancialSubmit(
    (key: string, input: CreateCoinSettlementInput) => createCoinSettlement(partyId, input, key),
    { persist: { scope: `settlement:coin:${partyId}`, schema: createCoinSettlementSchema } },
  );

  const activeTypes = (coinTypesQuery.data ?? []).filter((c) => c.active);
  const selectedType = activeTypes.find((c) => c.coinTypeId === coinTypeId);
  const coin = selectedType ? toCoinType(selectedType) : undefined;
  const rate1000 = mazneh.data?.gram1000;

  const intrinsicValueRial = coin && rate1000 !== undefined ? intrinsicValue(coin, rial(rate1000)) : undefined;
  const bubbleRial =
    coin && !coin.isCentralBankMinted
      ? null
      : coin && rate1000 !== undefined && marketUnitPriceRial > 0n
        ? bubble(coin, rial(marketUnitPriceRial), rial(rate1000))
        : undefined;
  const settledRial =
    count > 0n && marketUnitPriceRial > 0n
      ? coinPositionValue(toSafeNumber(count), rial(marketUnitPriceRial))
      : undefined;
  const grossWeightMg =
    selectedType && count > 0n ? (count * BigInt(selectedType.grossWeightUg)) / 1000n : undefined;
  const receivableRial = balancesQuery.data ? BigInt(balancesQuery.data.rawBalances.rial) : undefined;

  const reason: string | null = offline
    ? OFFLINE_SUBMIT_MESSAGE
    : locked
      ? null // تلاش سنجاق‌شده فقط تکرار می‌شود؛ فیلدهای فرم دیگر مبنا نیستند
      : coinTypeId === null || coin === undefined
      ? 'نوع سکه انتخاب نشده است.'
      : mazneh.data === null || mazneh.data === undefined
        ? 'مظنه هنوز دریافت نشده — چند لحظه صبر کنید.'
        : count <= 0n
          ? 'تعداد باید بزرگ‌تر از صفر باشد.'
          : marketUnitPriceRial <= 0n
            ? 'نرخ بازار باید بزرگ‌تر از صفر باشد.'
            : null;

  function resetForm() {
    setCoinTypeId(null);
    setCount(0n);
    setMarketUnitPriceRial(0n);
    setError(null);
    setResult(null);
    setResultRate1000(null);
    resetKey();
  }

  async function handleSubmit() {
    if (reason !== null) return;
    const quote = mazneh.data;
    const ready = coinTypeId !== null && quote !== undefined && quote !== null;
    if (!locked && !ready) return;

    setError(null);
    // تلاش سنجاق‌شده quoteId ِ خودش را دارد؛ اگر مظنه از آن زمان عوض شده، نرخ سند معلوم نیست (null)
    const documentRate = documentQuoteRate(locked || !ready ? pending?.payload.quoteId : quote.quoteId, quote);
    try {
      const settlement =
        locked || !ready
          ? await retry()
          : await runSubmit({
              coinTypeId,
              count: toSafeNumber(count),
              marketUnitPriceRial: marketUnitPriceRial.toString(),
              quoteId: quote.quoteId,
              effectiveAt: new Date().toISOString(),
            });
      if (!settlement) return;

      setResultRate1000(documentRate);
      setResult(settlement);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.parties.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventoryBalances.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventoryMovements.all() }),
      ]);

      toast.success('پرداخت با سکه ثبت شد', `${formatRial(settlement.settledRial)} ریال`);
      onSuccess?.(settlement);
    } catch (caught) {
      setError(caught);
    }
  }

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">پرداخت با سکه ثبت شد</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">مبلغ تسویه‌شده</span>
            <RialAmount value={result.settledRial} rate1000={resultRate1000} />
          </div>
          <Button size="action" className="w-full" onClick={resetForm}>
            پرداخت با سکه‌ی جدید
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {/* FE-099: مبلغ واردشده و ثبت‌نشده با ترک صفحه از بین می‌رود — هشدار پیش از آن */}
      <UnsavedChangesGuard
        when={coinTypeId !== null || count > 0n || marketUnitPriceRial > 0n || uncertain}
        submitting={isSubmitting}
      />
      <CardHeader>
        <CardTitle className="text-sm">پرداخت با سکه</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {coinTypesQuery.isLoading ? (
          <CardSkeleton lines={2} />
        ) : coinTypesQuery.isError ? (
          <ErrorState description="دریافت فهرست نوع سکه ناموفق بود." onRetry={() => void coinTypesQuery.refetch()} />
        ) : (
          <div className="space-y-1.5">
            <label htmlFor="coin-settlement-type" className="text-xs font-medium text-muted-foreground">
              نوع سکه
            </label>
            <Select
              id="coin-settlement-type"
              value={coinTypeId ?? ''}
              disabled={locked}
              onChange={(event) => setCoinTypeId(event.target.value || null)}
            >
              <option value="">انتخاب نوع سکه</option>
              {activeTypes.map((type) => (
                <option key={type.coinTypeId} value={type.coinTypeId}>
                  {type.title}
                </option>
              ))}
            </Select>
          </div>
        )}

        <CountInput label="تعداد" value={count} onChange={setCount} disabled={locked} />
        {grossWeightMg !== undefined ? (
          <p className="text-xs text-muted-foreground">معادل وزنی (فقط نمایشی): {formatGram(grossWeightMg)}</p>
        ) : null}

        <MoneyInput label="نرخ بازار" value={marketUnitPriceRial} onChange={setMarketUnitPriceRial} disabled={locked} />

        <div className="space-y-2 border-t border-border pt-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">معادل نمایشی</span>
            {settledRial !== undefined && rate1000 !== undefined ? (
              <AmountDisplay amount={dualFromRial(settledRial, rate1000)} size="sm" />
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">ارزش ذاتی (هر سکه)</span>
            {intrinsicValueRial !== undefined && rate1000 !== undefined ? (
              <AmountDisplay amount={dualFromRial(intrinsicValueRial, rate1000)} size="sm" />
            ) : (
              <span className="text-xs text-muted-foreground">مظنه در دسترس نیست</span>
            )}
          </div>
          {coin?.isCentralBankMinted ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">حباب (هر سکه)</span>
              {bubbleRial !== undefined && bubbleRial !== null && rate1000 !== undefined ? (
                <AmountDisplay amount={dualFromRial(bubbleRial, rate1000)} signed size="sm" />
              ) : (
                <span className="text-xs text-muted-foreground">نرخ بازار را وارد کنید</span>
              )}
            </div>
          ) : null}
          {receivableRial !== undefined && settledRial !== undefined && rate1000 !== undefined ? (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>مانده پس از این پرداخت</span>
              <AmountDisplay amount={dualFromRial(receivableRial - settledRial, rate1000)} signed size="sm" />
            </div>
          ) : null}
        </div>

        {error ? <ApiErrorNotice error={error} /> : null}
        <PendingSubmitNotice uncertain={uncertain} />

        <Button
          size="action"
          className="w-full"
          disabled={reason !== null || isSubmitting}
          onClick={() => void handleSubmit()}
        >
          {isSubmitting ? 'در حال ثبت…' : uncertain ? PENDING_SUBMIT_ACTION : 'ثبت پرداخت'}
        </Button>
        {reason !== null ? <p className="text-center text-xs text-muted-foreground">{reason}</p> : null}
      </CardContent>
    </Card>
  );
}
