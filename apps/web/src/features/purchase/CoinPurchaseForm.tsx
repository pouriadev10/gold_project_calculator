import { useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { dualFromRial, formatCoinCount, grossUg, karat as toKarat, toSafeNumber, type CoinType } from '@gold/core-calc';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { PartySelector } from '@/components/common/PartySelector';
import { UnitToggle } from '@/components/common/UnitToggle';
import { CountInput } from '@/components/keypad/CountInput';
import { MoneyInput } from '@/components/keypad/MoneyInput';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { useCoinTypes, useInventoryBalances } from '@/api/queries';
import type { CoinTypeVersion } from '@/api/contracts';
import { MaznehBar } from '@/features/home/MaznehBar';
import { useMazneh } from '@/features/home/useMazneh';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type { PartySelection } from '@/stores/recent-parties-store';
import { CoinPurchaseSummary } from './CoinPurchaseSummary';
import { PurchaseKindTabs } from './PurchaseKindTabs';
import { useCoinPurchaseSubmit } from './useCoinPurchaseSubmit';

function toCoinType(version: CoinTypeVersion): CoinType {
  const shared = { kind: 'coin' as const, id: version.coinTypeId, label: version.title,
    grossWeightUg: grossUg(BigInt(version.grossWeightUg)), karat: toKarat(version.karat) };
  return version.isCentralBankMinted ? { ...shared, isCentralBankMinted: true } : { ...shared, isCentralBankMinted: false };
}

export default function CoinPurchaseForm() {
  const isOnline = useOnlineStatus();
  const mazneh = useMazneh();
  const coinTypesQuery = useCoinTypes();
  const balancesQuery = useInventoryBalances('COIN');
  const [party, setParty] = useState<PartySelection | null>(null);
  const [coinTypeId, setCoinTypeId] = useState<string | null>(null);
  const [count, setCount] = useState(0n);
  const [purchaseUnitPriceRial, setPurchaseUnitPriceRial] = useState(0n);
  const [paidRial, setPaidRial] = useState(0n);

  function resetForm() { setParty(null); setCoinTypeId(null); setCount(0n); setPurchaseUnitPriceRial(0n); setPaidRial(0n); }
  const submission = useCoinPurchaseSubmit(resetForm);
  const locked = submission.isSubmitting || submission.attempt !== null;
  const activeTypes = (coinTypesQuery.data ?? []).filter((type) => type.active);
  const selectedVersion = activeTypes.find((type) => type.coinTypeId === coinTypeId);
  const coin = selectedVersion ? toCoinType(selectedVersion) : undefined;
  const countNumber = count > 0n && count <= BigInt(Number.MAX_SAFE_INTEGER) ? toSafeNumber(count) : 0;
  const amountRial = countNumber > 0 ? purchaseUnitPriceRial * BigInt(countNumber) : 0n;
  const currentBalance = balancesQuery.data?.find((balance) => balance.itemId === coinTypeId);
  const currentCount = currentBalance ? toSafeNumber(BigInt(currentBalance.quantity)) : 0;
  const nonConsumer = party !== null && party.type !== 'CONSUMER';
  const invalidCount = count === 0n ? undefined : countNumber === 0 ? 'تعداد واردشده بیش از حد مجاز است.' : undefined;
  const overpaid = paidRial > amountRial;
  const hasProgress = party !== null || coinTypeId !== null || count > 0n || purchaseUnitPriceRial > 0n || paidRial > 0n;
  useBlocker(() => true, !submission.receipt && hasProgress);

  const hasReadyAttempt = submission.attempt !== null;
  const hasReadyDraft = !locked && !nonConsumer && party?.status === 'ACTIVE' && coin !== undefined
    && mazneh.data !== null && mazneh.data !== undefined && countNumber > 0 && purchaseUnitPriceRial > 0n && !overpaid;
  const canSubmit = isOnline && !submission.isSubmitting && (hasReadyAttempt || hasReadyDraft);

  async function submit() {
    if (!canSubmit || !party || !coinTypeId || !mazneh.data) return;
    await submission.submit({ partyId: party.id, coinTypeId, count: countNumber,
      purchaseUnitPriceRial: purchaseUnitPriceRial.toString(), quoteId: mazneh.data.quoteId,
      paidRial: paidRial.toString(), effectiveAt: new Date().toISOString() }, mazneh.data.gram1000);
  }

  if (submission.receipt) {
    const { purchase, rate1000 } = submission.receipt;
    const receiptCoin = activeTypes.find((type) => type.coinTypeId === purchase.coinTypeId);
    return <div className="flex min-h-dvh flex-col">
      <PageHeader title="خرید سکه"><UnitToggle /></PageHeader>
      <main className="flex-1 space-y-4 p-4 pb-action"><PurchaseKindTabs />
        <Card aria-label="رسید خرید سکه"><CardHeader><CardTitle className="text-credit">خرید سکه ثبت شد</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm" role="status">
            <p className="text-muted-foreground">موجودی {receiptCoin?.title ?? 'نوع سکه'} افزایش یافت.</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3">
              <dt className="text-muted-foreground">شناسه خرید</dt><dd className="min-w-0 break-all font-medium" dir="ltr">{purchase.secondHandPurchaseId}</dd>
              <dt className="text-muted-foreground">تعداد ثبت‌شده</dt><dd className="font-semibold tabular-nums">{formatCoinCount(purchase.count)} عدد</dd>
              <dt className="text-muted-foreground">نرخ خرید هر سکه</dt><dd><AmountDisplay amount={dualFromRial(BigInt(purchase.purchaseUnitPriceRial), rate1000)} size="sm" /></dd>
              <dt className="text-muted-foreground">مبلغ خرید</dt><dd><AmountDisplay amount={dualFromRial(BigInt(purchase.purchaseAmountRial), rate1000)} size="sm" /></dd>
              <dt className="text-muted-foreground">پرداخت‌شده</dt><dd><AmountDisplay amount={dualFromRial(BigInt(purchase.paidRial), rate1000)} size="sm" /></dd>
              <dt className="text-muted-foreground">مانده بستانکاری فروشنده</dt><dd><AmountDisplay amount={dualFromRial(BigInt(purchase.payableRial), rate1000)} size="sm" /></dd>
              <dt className="text-muted-foreground">ارزش ذاتی هر سکه</dt><dd><AmountDisplay amount={dualFromRial(BigInt(purchase.intrinsicValueRial), rate1000)} size="sm" /></dd>
              {purchase.bubbleRial !== null ? <><dt className="text-muted-foreground">حباب هر سکه</dt><dd><AmountDisplay amount={dualFromRial(BigInt(purchase.bubbleRial), rate1000)} signed size="sm" /></dd></> : null}
            </dl>
          </CardContent></Card>
      </main>
      <div className="fixed inset-x-0 bottom-above-nav z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm lg:static lg:border-0 lg:bg-transparent"><Button size="action" onClick={submission.clearReceipt}>خرید سکه جدید</Button></div>
    </div>;
  }

  return <div className="flex min-h-dvh flex-col">
    <PageHeader title="خرید سکه از مصرف‌کننده"><UnitToggle /></PageHeader>
    <main className="flex-1 space-y-4 p-4 pb-action"><PurchaseKindTabs />
      <fieldset disabled={locked} className="min-w-0 space-y-4 disabled:opacity-70">
        <PartySelector label="فروشنده" value={party} onChange={setParty} inlineCreateVariant="SELLER" disabled={locked} />
        {nonConsumer ? <p role="alert" className="text-sm text-destructive">خرید از همکار در فاز فعلی فعال نیست؛ فروشنده باید مصرف‌کننده باشد.</p> : null}
        <Card><CardHeader><CardTitle className="text-sm">مشخصات سکه</CardTitle></CardHeader><CardContent className="space-y-3">
          {coinTypesQuery.isLoading ? <CardSkeleton lines={2} /> : coinTypesQuery.isError
            ? <ErrorState description="دریافت انواع سکه ناموفق بود." onRetry={() => void coinTypesQuery.refetch()} />
            : <div className="space-y-1.5"><label htmlFor="coin-purchase-type" className="text-xs font-medium text-muted-foreground">نوع سکه</label><Select id="coin-purchase-type" value={coinTypeId ?? ''} onChange={(event) => setCoinTypeId(event.target.value || null)}><option value="">انتخاب نوع سکه</option>{activeTypes.map((type) => <option key={type.coinTypeId} value={type.coinTypeId}>{type.title}</option>)}</Select></div>}
          <CountInput label="تعداد" value={count} onChange={setCount} {...(invalidCount ? { error: invalidCount } : {})} />
          <MoneyInput label="نرخ خرید هر سکه" value={purchaseUnitPriceRial} onChange={setPurchaseUnitPriceRial} hint="این نرخ مستقل از نرخ فروش است و فقط برای همین خرید ثبت می‌شود." />
        </CardContent></Card>
        <MaznehBar isOnline={isOnline} />
        {coin ? <CoinPurchaseSummary coin={coin} countBefore={currentCount} countPurchased={countNumber} purchaseUnitPriceRial={purchaseUnitPriceRial} rate1000={mazneh.data?.gram1000} /> : null}
        <Card><CardHeader><CardTitle className="text-sm">پرداخت یا مانده</CardTitle></CardHeader><CardContent className="space-y-3">
          {amountRial > 0n && mazneh.data ? <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">مبلغ کل خرید</span><AmountDisplay amount={dualFromRial(amountRial, mazneh.data.gram1000)} /></div> : null}
          <MoneyInput label="پرداخت اکنون" value={paidRial} onChange={setPaidRial} {...(overpaid ? { error: 'پرداخت نمی‌تواند بیشتر از مبلغ خرید باشد.' } : {})} hint="باقی‌مانده به‌عنوان بستانکاری فروشنده ثبت می‌شود." />
          <Button type="button" variant="outline" disabled={amountRial <= 0n} onClick={() => setPaidRial(amountRial)}>پرداخت کامل</Button>
          {!overpaid && amountRial > 0n && mazneh.data ? <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">مانده بستانکاری</span><AmountDisplay amount={dualFromRial(amountRial - paidRial, mazneh.data.gram1000)} /></div> : null}
        </CardContent></Card>
      </fieldset>
      {!isOnline ? <p role="alert" className="text-sm text-destructive">برای ثبت خرید به اینترنت متصل شوید.</p> : null}
      {submission.attempt && !submission.isSubmitting ? <p role="status" className="text-sm text-warning">نتیجه درخواست قبلی مشخص نیست؛ همان خرید با همان شناسه دوباره بررسی می‌شود.</p> : null}
      {submission.error ? <ApiErrorNotice error={submission.error} /> : null}
    </main>
    <div className="fixed inset-x-0 bottom-above-nav z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm lg:static lg:border-0 lg:bg-transparent"><Button size="action" disabled={!canSubmit} onClick={() => void submit()} aria-busy={submission.isSubmitting}>{submission.isSubmitting ? 'در حال ثبت…' : submission.attempt ? 'بررسی نتیجه خرید' : 'ثبت خرید سکه'}</Button></div>
    <NumericKeypad />
  </div>;
}
