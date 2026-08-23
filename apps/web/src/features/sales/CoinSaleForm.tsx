import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  coinPositionValue,
  dualFromRial,
  formatCount,
  formatRial,
  grossUg,
  karat as toKarat,
  rial,
  toSafeNumber,
  type CoinType,
} from '@gold/core-calc';
import type { CoinTypeVersion, CreateCoinSaleInput } from '@/api/contracts';
import { createCoinSale } from '@/api/sales';
import { useCoinTypes, useInventoryBalances } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { PartySelector } from '@/components/common/PartySelector';
import { UnitToggle } from '@/components/common/UnitToggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { CountInput } from '@/components/keypad/CountInput';
import { MoneyInput } from '@/components/keypad/MoneyInput';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { useMazneh } from '@/features/home/useMazneh';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { toast } from '@/stores/toast-store';
import type { PartySelection } from '@/stores/recent-parties-store';
import { CoinPositionSummary } from './CoinPositionSummary';

/**
 * فرم فروش سکه — FE-048.
 *
 * برخلاف فروش زیورآلات (`SaleWizardPage`) یک ویزارد چندمرحله‌ای نیست —
 * قرارداد بک‌اند (`createCoinSaleSchema`، BE-043) دقیقاً یک نوع سکه در هر
 * فراخوانی می‌گیرد و «پرداخت» هم یک فیلد ساده است، نه دو مسیر نقدی/نسیه‌ی
 * جدا مثل زیورآلات (FE-045/FE-047) — پس یک صفحه‌ی تخت با یک دکمه‌ی ثبت
 * کافی است؛ اضافه‌کردن یک store یا wizard جدا برای این شکل ساده‌تر،
 * پیچیدگی بی‌دلیل بود.
 *
 * **سکه هرگز به وزن تبدیل نمی‌شود** (بخش ۲-۲ CLAUDE.md): `count` یک
 * `CountInput` مستقل است، نه گرم؛ در payload هم `number` صحیح می‌رود
 * (تنها استثنای این قاعده در کل سیستم که در `createCoinSaleSchema` واقعی
 * هم همین‌طور تعریف شده، نه `bigint` رشته‌ای).
 *
 * **موقعیت، ارزش ذاتی و حباب** — از `CoinPositionSummary` (FE-049) می‌آید،
 * یک کامپوننت گزارشی خالص که تعداد قبل/فروش/بعد و ارزش بازار/ذاتی/حباب را
 * از روی `coin`، موجودی جاری و ورودی‌های همین فرم می‌سازد؛ اینجا فقط
 * `toCoinType` (کپی محلی هشت‌خطی، همان الگوی `CoinInventoryList` FE-038)
 * برای تبدیل کاتالوگ به `CoinType` است. قانون حباب همان‌جا با امضای
 * `bubble()` اجبار می‌شود، نه با شرط زمان اجرا اینجا.
 *
 * **موجودی همان نوع** فقط نمایش داده می‌شود، ثبت را مسدود نمی‌کند — نه
 * «تمام است وقتی» و نه سرویس واقعی (`CoinSalesService`) چنین سقفی ندارند؛
 * فقط سرویس واقعی روی «پرداختی بیشتر از مبلغ فاکتور» رد می‌کند
 * (`CoinSalePaidRialExceedsPayableError`) که همینجا هم پیش از ارسال بررسی
 * می‌شود تا کاربر زودتر از پاسخ سرور بفهمد.
 *
 * **مظنه قفل نمی‌شود** — برخلاف `SaleSummary` (FE-044) این یک صفحه‌ی
 * تک‌مرحله‌ای است، نه یک مرور پس از چند قدم؛ نرخ زنده تا لحظه‌ی ثبت
 * می‌آید و `quoteId`/زمان همان لحظه در payload می‌رود — دقیقاً همان الگوی
 * `CoinInventoryList` پیش از FE-044.
 */

type SubmitBlockReason =
  | 'NO_PARTY'
  | 'NO_COIN_TYPE'
  | 'NO_QUOTE'
  | 'INVALID_COUNT'
  | 'INVALID_PRICE'
  | 'PAID_EXCEEDS_PAYABLE';

const BLOCK_MESSAGE: Record<SubmitBlockReason, string> = {
  NO_PARTY: 'مشتری انتخاب نشده است.',
  NO_COIN_TYPE: 'نوع سکه انتخاب نشده است.',
  NO_QUOTE: 'مظنه هنوز دریافت نشده — چند لحظه صبر کنید.',
  INVALID_COUNT: 'تعداد باید بزرگ‌تر از صفر باشد.',
  INVALID_PRICE: 'قیمت واحد بازار باید بزرگ‌تر از صفر باشد.',
  PAID_EXCEEDS_PAYABLE: 'مبلغ پرداختی نمی‌تواند از مبلغ قابل‌پرداخت بیشتر باشد.',
};

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

interface CoinSaleResult {
  readonly invoiceId: string;
  readonly invoiceNumber: number;
  readonly payableRial: bigint;
  readonly receivableRial: bigint;
  readonly intrinsicValueRial: bigint;
  readonly bubbleRial: bigint | null;
}

export default function CoinSaleForm() {
  const coinTypesQuery = useCoinTypes();
  const balancesQuery = useInventoryBalances('COIN');
  const mazneh = useMazneh();
  const queryClient = useQueryClient();

  const [party, setParty] = useState<PartySelection | null>(null);
  const [coinTypeId, setCoinTypeId] = useState<string | null>(null);
  const [count, setCount] = useState(0n);
  const [marketUnitPriceRial, setMarketUnitPriceRial] = useState(0n);
  const [paidRial, setPaidRial] = useState(0n);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<CoinSaleResult | null>(null);

  const { submit: runSubmit, isSubmitting, reset: resetKey } = useIdempotentSubmit(
    (key: string, input: CreateCoinSaleInput) => createCoinSale(input, key),
  );

  const activeTypes = (coinTypesQuery.data ?? []).filter((c) => c.active);
  const selectedType = activeTypes.find((c) => c.coinTypeId === coinTypeId);
  const coin = selectedType ? toCoinType(selectedType) : undefined;
  const rate1000 = mazneh.data?.gram1000;

  const payableRial =
    count > 0n && marketUnitPriceRial > 0n ? coinPositionValue(toSafeNumber(count), rial(marketUnitPriceRial)) : undefined;

  const currentBalance = balancesQuery.data?.find((b) => b.itemId === coinTypeId);
  const currentCount = currentBalance ? toSafeNumber(BigInt(currentBalance.quantity)) : 0;

  function blockReason(): SubmitBlockReason | null {
    if (party === null) return 'NO_PARTY';
    if (coinTypeId === null || coin === undefined) return 'NO_COIN_TYPE';
    if (mazneh.data === null || mazneh.data === undefined) return 'NO_QUOTE';
    if (count <= 0n) return 'INVALID_COUNT';
    if (marketUnitPriceRial <= 0n) return 'INVALID_PRICE';
    if (payableRial !== undefined && paidRial > payableRial) return 'PAID_EXCEEDS_PAYABLE';
    return null;
  }

  const reason = blockReason();

  function resetForm() {
    setParty(null);
    setCoinTypeId(null);
    setCount(0n);
    setMarketUnitPriceRial(0n);
    setPaidRial(0n);
    setError(null);
    setResult(null);
    resetKey();
  }

  async function handleSubmit() {
    if (reason !== null || party === null || mazneh.data === undefined || mazneh.data === null) return;

    setError(null);
    const input: CreateCoinSaleInput = {
      partyId: party.id,
      coinTypeId: coinTypeId!,
      count: toSafeNumber(count),
      marketUnitPriceRial: marketUnitPriceRial.toString(),
      quoteId: mazneh.data.quoteId,
      effectiveAt: new Date().toISOString(),
      paidRial: paidRial.toString(),
    };

    try {
      const sale = await runSubmit(input);
      if (!sale) return;

      setResult({
        invoiceId: sale.invoiceId,
        invoiceNumber: sale.invoiceNumber,
        payableRial: sale.payableRial,
        receivableRial: sale.receivableRial,
        intrinsicValueRial: sale.intrinsicValueRial,
        bubbleRial: sale.bubbleRial,
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.inventoryBalances.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.parties.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventoryMovements.all() }),
      ]);

      toast.success('فروش سکه ثبت شد', `${formatRial(sale.payableRial)} ریال`);
    } catch (caught) {
      setError(caught);
    }
  }

  if (result) {
    return (
      <div className="flex min-h-dvh flex-col">
        <PageHeader title="فروش سکه">
          <UnitToggle />
        </PageHeader>
        <div className="flex-1 space-y-4 p-4 pb-nav">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">فاکتور شماره {formatCount(result.invoiceNumber)} ثبت شد</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">مبلغ قابل‌پرداخت</span>
                {rate1000 !== undefined ? (
                  <AmountDisplay amount={dualFromRial(result.payableRial, rate1000)} size="sm" />
                ) : (
                  <span className="tabular-nums">{formatRial(result.payableRial)} ریال</span>
                )}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">مانده</span>
                {rate1000 !== undefined ? (
                  <AmountDisplay amount={dualFromRial(result.receivableRial, rate1000)} size="sm" />
                ) : (
                  <span className="tabular-nums">{formatRial(result.receivableRial)} ریال</span>
                )}
              </div>
            </CardContent>
          </Card>
          <Button size="action" className="w-full" onClick={resetForm}>
            فروش سکه‌ی جدید
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="فروش سکه">
        <UnitToggle />
      </PageHeader>

      <div className="flex-1 space-y-4 p-4 pb-action">
        <PartySelector label="مشتری" value={party} onChange={setParty} />

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">سکه</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {coinTypesQuery.isLoading ? (
              <CardSkeleton lines={2} />
            ) : coinTypesQuery.isError ? (
              <ErrorState description="دریافت فهرست نوع سکه ناموفق بود." onRetry={() => void coinTypesQuery.refetch()} />
            ) : (
              <div className="space-y-1.5">
                <label htmlFor="coin-sale-type" className="text-xs font-medium text-muted-foreground">
                  نوع سکه
                </label>
                <Select
                  id="coin-sale-type"
                  value={coinTypeId ?? ''}
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

            <CountInput label="تعداد" value={count} onChange={setCount} />
            <MoneyInput label="قیمت واحد بازار" value={marketUnitPriceRial} onChange={setMarketUnitPriceRial} />
          </CardContent>
        </Card>

        {/* خلاصه‌ی موقعیت — FE-049. گزارش خالص است؛ storage را دست نمی‌زند */}
        {coin ? (
          <CoinPositionSummary
            coin={coin}
            countBefore={currentCount}
            countSold={toSafeNumber(count)}
            marketUnitPriceRial={marketUnitPriceRial}
            rate1000={rate1000}
          />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">پرداخت</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/*
              مقدار این فیلد فقط از `paidRial` محلی می‌آید، هرگز از عددی
              مشتق‌شده‌ای که با تایپ در تعداد/قیمت پیوسته عوض می‌شود.
              دلیل — همان تله‌ی FE-047 (`SalePaymentInput`): وقتی `value`
              یک `NumericField` روی هر رندر عوض شود و `onChange`‌اش state
              را می‌نویسد، افکت مقداردهی اولیه‌ی خودِ فیلد یک اعلان
              onChange «ساختگی» می‌سازد — همان لحظه‌ای که کاربر هنوز
              چیزی تایپ نکرده. اینجا دقیقاً همین اتفاق افتاد: هنوز وسط
              تایپ «قیمت واحد بازار» بودیم که فیلد پرداخت با یک عدد
              میانی (نه مبلغ نهایی) «لمس‌شده» علامت می‌خورد و برای همیشه
              از آن عدد ناقص یخ می‌زد. «پرداخت کامل» حالا یک کپی یک‌باره‌ی
              دستی است، نه یک هم‌گامی پیوسته.
            */}
            <MoneyInput label="مبلغ پرداختی" value={paidRial} onChange={setPaidRial} />
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={payableRial === undefined}
                onClick={() => setPaidRial(payableRial ?? 0n)}
              >
                پرداخت کامل
              </Button>
              {payableRial !== undefined && paidRial < payableRial ? (
                <span className="text-xs text-warning">باقی‌مانده به حساب همین مشتری می‌نشیند.</span>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {error ? <ApiErrorNotice error={error} /> : null}

        <div className="space-y-1.5">
          <Button size="action" className="w-full" disabled={reason !== null || isSubmitting} onClick={() => void handleSubmit()}>
            {isSubmitting ? 'در حال ثبت…' : 'ثبت فروش'}
          </Button>
          {reason !== null ? <p className="text-center text-xs text-muted-foreground">{BLOCK_MESSAGE[reason]}</p> : null}
        </div>
      </div>

      <NumericKeypad />
    </div>
  );
}
