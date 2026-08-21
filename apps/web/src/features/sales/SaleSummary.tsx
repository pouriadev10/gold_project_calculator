import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { dualFromRial, formatCount, formatGram, gramRate1000 } from '@gold/core-calc';
import type { PriceQuoteSource } from '@/api/contracts';
import { AmountDisplay, RateDisplay } from '@/components/common/AmountDisplay';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatJalaliDateTime } from '@/lib/date';
import { useMazneh } from '@/features/home/useMazneh';
import { useSaleDraftStore, type SaleDraftItemLine } from '@/stores/sale-draft-store';
import { calculateLinePricing, type LinePricingResult } from './sale-line-pricing';

/**
 * خلاصه‌ی فاکتور فروش — مرحله‌ی «مرور و ثبت» — FE-044.
 *
 * فقط نمایش است، هیچ فیلد قابل‌ویرایشی ندارد؛ ویرایش هر بخش از همان
 * مرحله‌ی خودش (مشتری، اقلام) با دکمه‌ی «قبلی» انجام می‌شود. ثبت واقعی
 * فاکتور کار FE-045 است.
 *
 * ⚠️ **قفل نرخ**: اولین باری که این کامپوننت mount می‌شود (یعنی اولین
 * ورود به مرور)، مظنه‌ی زنده‌ی همان لحظه در `sale-draft-store.lockedMazneh`
 * قفل می‌شود و تا `reset` (فروش بعدی) دیگر عوض نمی‌شود — حتی اگر کاربر
 * برگردد و دوباره مرور را باز کند یا مظنه‌ی بازار در این فاصله تغییر
 * کند. همه‌ی محاسبات این صفحه از همان نرخ قفل‌شده می‌آیند، نه مظنه‌ی زنده؛
 * قاعده‌ی صریح تسک: «تغییر مظنه بازار preview ثبت‌شده را بی‌صدا عوض نکند».
 * اگر مظنه‌ی بازار از لحظه‌ی قفل‌شدن جلوتر رفته باشد، فقط یک هشدار
 * اطلاع‌رسان نشان داده می‌شود — نرخ فاکتور دست‌نخورده می‌ماند.
 *
 * ردیف‌های بدون قیمت‌گذاری (`line.pricing === null` — از FE-042/FE-043
 * ممکن است هنوز رخ دهد، چون مرحله‌ی اقلام فقط «حداقل یک قلم» را شرط
 * می‌کند، نه «همه قیمت‌گذاری‌شده») از جمع کل کنار گذاشته می‌شوند و یک
 * هشدار جداگانه نشانشان می‌دهد — جمع کل ساکت غلط نشان داده نمی‌شود.
 *
 * «معادل طلا/ریال» یک ردیف جداست که **همیشه هر دو واحد** را با هم نشان
 * می‌دهد (`unit="gold"` و `unit="rial"` صریح روی `AmountDisplay`)،
 * برخلاف «مبلغ نهایی» بالای آن که از کلید تعویض واحد سراسری پیروی
 * می‌کند — دقیقاً چیزی که قاعده‌ی ۲-۴ CLAUDE.md می‌خواهد: خودِ گزاره‌ی
 * ارزش («طلا واحد پایه است») روی مهم‌ترین عدد فاکتور صریح دیده شود.
 */

const PARTY_TYPE_LABEL: Record<'CONSUMER' | 'BUSINESS', string> = {
  CONSUMER: 'مصرف‌کننده',
  BUSINESS: 'همکار',
};

const SOURCE_LABEL: Record<PriceQuoteSource, string> = { MANUAL: 'دستی', FEED: 'فید' };

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function SummaryLineRow({
  line,
  result,
  rate1000,
}: {
  line: SaleDraftItemLine;
  result: LinePricingResult | undefined;
  rate1000: bigint | undefined;
}) {
  return (
    <li className="flex items-center justify-between gap-2 py-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium">{line.title}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {line.code ? (
            <span className="truncate tabular-nums text-xs text-muted-foreground" dir="ltr">
              {line.code}
            </span>
          ) : null}
          {line.kind === 'ADHOC' ? <Badge variant="outline">موردی</Badge> : null}
        </div>
      </div>
      <div className="shrink-0 text-end">
        {result === undefined ? (
          <span className="text-xs text-warning">قیمت‌گذاری نشده</span>
        ) : !result.ok ? (
          <span className="text-xs text-destructive">{result.error}</span>
        ) : rate1000 !== undefined ? (
          <AmountDisplay amount={dualFromRial(result.calc.payableRial, rate1000)} size="sm" />
        ) : null}
      </div>
    </li>
  );
}

export function SaleSummary() {
  const party = useSaleDraftStore((s) => s.party);
  const items = useSaleDraftStore((s) => s.items);
  const lockedMazneh = useSaleDraftStore((s) => s.lockedMazneh);
  const lockMazneh = useSaleDraftStore((s) => s.lockMazneh);
  const mazneh = useMazneh();

  useEffect(() => {
    if (lockedMazneh === null && mazneh.data) {
      lockMazneh({
        mazneh: mazneh.data.mazneh.toString(),
        source: mazneh.data.source,
        observedAt: mazneh.data.observedAt.toISOString(),
      });
    }
  }, [lockedMazneh, mazneh.data, lockMazneh]);

  const rateRial = lockedMazneh ? BigInt(lockedMazneh.mazneh) : undefined;
  const rate1000 = rateRial !== undefined ? gramRate1000(rateRial) : undefined;
  const rateChanged = Boolean(mazneh.data && rateRial !== undefined && mazneh.data.mazneh !== rateRial);

  const results = items.map((line) =>
    line.pricing && rateRial !== undefined ? calculateLinePricing(line.pricing, rateRial) : undefined,
  );
  const okCalcs = results
    .filter((r): r is Extract<LinePricingResult, { ok: true }> => r?.ok === true)
    .map((r) => r.calc);
  const allPriced = items.length > 0 && okCalcs.length === items.length;

  const totals = okCalcs.reduce(
    (acc, calc) => ({
      pureWeightMg: acc.pureWeightMg + calc.pureWeightMg,
      wageRial: acc.wageRial + calc.wageRial,
      profitRial: acc.profitRial + calc.profitRial,
      taxRial: acc.taxRial + calc.taxRial,
      payableRial: acc.payableRial + calc.payableRial,
    }),
    { pureWeightMg: 0n, wageRial: 0n, profitRial: 0n, taxRial: 0n, payableRial: 0n },
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">مشتری</CardTitle>
        </CardHeader>
        <CardContent>
          {party ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{party.displayName}</span>
              <Badge variant="outline">{PARTY_TYPE_LABEL[party.type]}</Badge>
              {party.mobile ? (
                <span className="tabular-nums text-xs text-muted-foreground" dir="ltr">
                  {party.mobile}
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">مشتری انتخاب نشده</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">نرخ این فاکتور</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {lockedMazneh ? (
            <>
              <SummaryRow label="مظنه‌ی ثبت‌شده برای این فاکتور">
                <RateDisplay value={BigInt(lockedMazneh.mazneh)} size="md" />
              </SummaryRow>
              <p className="text-xs text-muted-foreground">
                {SOURCE_LABEL[lockedMazneh.source]} — {formatJalaliDateTime(new Date(lockedMazneh.observedAt))}
              </p>
              {rateChanged ? (
                <p className="flex items-start gap-1.5 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  نرخ بازار از زمان ورود به این مرحله تغییر کرده؛ این فاکتور همچنان با نرخ بالا محاسبه می‌شود.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">در انتظار دریافت مظنه...</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">اقلام ({formatCount(items.length)})</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">هیچ قلمی ثبت نشده</p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((line, index) => (
                <SummaryLineRow key={line.lineId} line={line} result={results[index]} rate1000={rate1000} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">جمع کل</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!allPriced && items.length > 0 ? (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              برخی اقلام هنوز قیمت‌گذاری نشده‌اند — در جمع زیر لحاظ نشده‌اند.
            </p>
          ) : null}

          {rate1000 !== undefined ? (
            <>
              <SummaryRow label="مجموع وزن خالص">
                <span className="tabular-nums text-sm font-semibold">{formatGram(totals.pureWeightMg)}</span>
              </SummaryRow>
              <SummaryRow label="اجرت">
                <AmountDisplay amount={dualFromRial(totals.wageRial, rate1000)} size="sm" />
              </SummaryRow>
              <SummaryRow label="سود">
                <AmountDisplay amount={dualFromRial(totals.profitRial, rate1000)} size="sm" />
              </SummaryRow>
              <SummaryRow label="مالیات">
                <AmountDisplay amount={dualFromRial(totals.taxRial, rate1000)} size="sm" />
              </SummaryRow>
              <div className="space-y-2 border-t border-border pt-2">
                <SummaryRow label="مبلغ نهایی">
                  <AmountDisplay amount={dualFromRial(totals.payableRial, rate1000)} size="lg" />
                </SummaryRow>
                <SummaryRow label="معادل">
                  <div className="flex items-center gap-3">
                    <AmountDisplay amount={dualFromRial(totals.payableRial, rate1000)} unit="gold" size="sm" />
                    <AmountDisplay amount={dualFromRial(totals.payableRial, rate1000)} unit="rial" size="sm" />
                  </div>
                </SummaryRow>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">در انتظار دریافت مظنه...</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">روش پرداخت</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">هنوز انتخاب نشده — در مرحله‌ی «پرداخت» مشخص می‌شود.</p>
        </CardContent>
      </Card>
    </div>
  );
}
