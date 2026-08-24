import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { dualFromRial, formatRial } from '@gold/core-calc';
import { useParty, usePartyBalances } from '@/api/queries';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { UnitToggle } from '@/components/common/UnitToggle';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { useMazneh } from '@/features/home/useMazneh';
import { CoinSettlementForm } from '@/features/payments/CoinSettlementForm';
import { GoldSettlementForm } from '@/features/payments/GoldSettlementForm';
import { MixedSettlementForm } from '@/features/payments/MixedSettlementForm';
import { PaymentMethodSelector, type PaymentMethod } from '@/features/payments/PaymentMethodSelector';
import { RialSettlementForm } from '@/features/payments/RialSettlementForm';

/**
 * ثبت تسویه‌ی شخص — FE-055، مسیر `/parties/:partyId/settlements/new`.
 * تنها کار این صفحه **اسمبل کردن** Milestone 12 است — مانده فعلی، انتخاب
 * روش (FE-050) و رندر فرم همان روش (FE-051..054)، همه‌شان از قبل ساخته
 * و مستقل شده بودند.
 *
 * **«نسیه» از انتخاب‌گر کنار گذاشته شد** (`methods` prop، FE-050): نسیه
 * یعنی الان پول نگرفتن روی یک فروش تازه (واژه‌ی خودِ `FE-047`)، نه روی
 * بدهی‌ای که همین الان دارد تسویه می‌شود — و هیچ endpoint تسویه‌ی مستقلی
 * هم برایش نیست. «مانده اعتباری» مفهوم دیگری است که فقط به‌عنوان یک نوع
 * ردیف داخل تسویه‌ی ترکیبی (`COMBINED`) وجود دارد.
 *
 * **«preview مانده بعد» را این صفحه نمی‌سازد** — هر چهار فرم زیرمجموعه
 * (`RialSettlementForm`، `GoldSettlementForm`، `CoinSettlementForm`،
 * `MixedSettlementForm`) از قبل خودشان موجودی جاری را می‌خوانند و ردیف
 * «مانده پس از این پرداخت»/«باقی‌مانده» را کنار فیلدهای خودشان نشان
 * می‌دهند — دوباره‌سازی همان چیز در این صفحه یعنی دو منبع حقیقت برای یک
 * عدد. «مانده فعلی» بالای صفحه فقط زمینه‌ی کلی است، مستقل از فرم فعال.
 *
 * **invalidate کردن مانده/statement کار این صفحه نیست** — هر چهار فرم
 * از قبل بعد از موفقیت `queryKeys.parties.all()` را invalidate می‌کنند
 * (که `balances` و `statement` هر دو زیرمجموعه‌اش‌اند)، دقیقاً «تمام است
 * وقتی» همین تسک. تکرارش اینجا فقط یک invalidate اضافه‌ی بی‌اثر بود.
 *
 * **«تأیید نهایی»** دکمه‌ی ثبت خودِ هر فرم است — هر چهارتا از قبل کامل و
 * خودکفا هستند (شامل idempotency و پنل موفقیت)؛ یک لایه‌ی تأیید دوم روی
 * آن‌ها فقط منطق ثبت را تکراری می‌کرد.
 */

const SETTLEMENT_METHODS: readonly PaymentMethod[] = ['RIAL', 'GOLD', 'COIN', 'COMBINED'];

export default function SettlementsNewPage() {
  const { partyId } = useParams({ from: '/app-shell/parties/$partyId/settlements/new' });
  const partyQuery = useParty(partyId);
  const balancesQuery = usePartyBalances(partyId, {});
  const mazneh = useMazneh();
  const [method, setMethod] = useState<PaymentMethod | null>(null);

  const rate1000 = mazneh.data?.gram1000;
  const receivableRial = balancesQuery.data ? BigInt(balancesQuery.data.rawBalances.rial) : undefined;

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title={partyQuery.data ? `ثبت تسویه — ${partyQuery.data.displayName}` : 'ثبت تسویه'}>
        <UnitToggle />
      </PageHeader>

      <div className="flex-1 space-y-4 p-4 pb-nav">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">مانده فعلی</CardTitle>
          </CardHeader>
          <CardContent>
            {balancesQuery.isLoading ? (
              <CardSkeleton lines={1} />
            ) : balancesQuery.isError ? (
              <ErrorState description="دریافت مانده ناموفق بود." onRetry={() => void balancesQuery.refetch()} />
            ) : receivableRial !== undefined ? (
              rate1000 !== undefined ? (
                <AmountDisplay amount={dualFromRial(receivableRial, rate1000)} signed size="lg" />
              ) : (
                <span className="tabular-nums text-lg font-bold">{formatRial(receivableRial)} ریال</span>
              )
            ) : null}
          </CardContent>
        </Card>

        <PaymentMethodSelector value={method} onChange={setMethod} methods={SETTLEMENT_METHODS} />

        {method === 'RIAL' ? <RialSettlementForm partyId={partyId} /> : null}
        {method === 'GOLD' ? <GoldSettlementForm partyId={partyId} /> : null}
        {method === 'COIN' ? <CoinSettlementForm partyId={partyId} /> : null}
        {method === 'COMBINED' ? <MixedSettlementForm partyId={partyId} /> : null}
      </div>

      <NumericKeypad />
    </div>
  );
}
