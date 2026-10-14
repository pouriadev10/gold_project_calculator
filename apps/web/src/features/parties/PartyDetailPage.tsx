import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Eye, EyeOff, Landmark, Loader2, Pencil, ReceiptText } from 'lucide-react';
import { dualFromPure, dualFromRial, formatCoinCount, formatGram, formatRial, toPersianDigits, toSafeNumber } from '@gold/core-calc';
import type { DualAmount } from '@gold/core-calc';
import { deactivateParty } from '@/api/parties';
import { queryKeys } from '@/api/query-keys';
import { useLatestPriceQuote, useParty, usePartyBalances, usePartyStatement } from '@/api/queries';
import type { Party, PartyBalances, PartyBalancesQuery } from '@/api/contracts';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import type { RawAmount } from '@/components/common/AmountDisplay';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/common/ResponsiveDialog';
import { UnitToggle } from '@/components/common/UnitToggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { formatJalaliDateTime } from '@/lib/date';
import { maskNationalIdForDisplay } from '@/lib/sensitive-identity';
import { toast } from '@/stores/toast-store';
import { useUnitStore } from '@/stores/unit-store';
import { PartyFormDialog } from './PartyFormDialog';
import { SOURCE_LABEL, debtorCreditorLabel } from './party-statement';

/**
 * صفحه‌ی جزئیات شخص — FE-034.
 *
 * سه بخش واقعی با API موجود می‌سازد: مشخصات (`GET /parties/:id`)،
 * مانده‌ی چندواحدی (`GET /parties/:id/balances`، BE-056) و آخرین
 * معاملات (`GET /parties/:id/statement`، BE-057؛ فقط ۵ ردیف آخر، بدون
 * فیلتر — همان بخش «صورت‌حساب» هم هست). دو بخش دیگر لینک به مسیرهایی
 * هستند که صفحه‌ی واقعی‌شان کار تسک جدایی است: «ثبت تسویه» به
 * `/parties/:partyId/settlements/new` (FE-055) و صورت‌حساب کامل با
 * فیلتر/pagination به `/parties/:partyId/statement` (FE-070).
 *
 * «ویرایش» همان `PartyFormDialog` ساخته‌ی FE-033 را باز می‌کند — این
 * صفحه دومین (و اولین واقعی، غیر از ردیف لیست) نقطه‌ی ورود آن است.
 *
 * بدون هیچ نقش‌محافظت‌شده‌ای عمداً: نه `PartiesController` (ویرایش،
 * غیرفعال‌سازی) و نه کنترلرهای تسویه (`@Roles('OWNER','MANAGER','CASHIER')`
 * — یعنی هر سه نقش) هیچ `@Roles` واقعی‌ای ندارند که یک نقش را از بقیه
 * جدا کند؛ ساختن یک محدودیت فرانت‌اندی اینجا فقط یک حدس بدون پشتوانه‌ی
 * سرور می‌شد (همان قاعده‌ی مستند در `lib/permissions.ts`: هر ثابت نقش
 * باید آینه‌ی یک `@Roles` واقعی باشد).
 */

const TYPE_LABEL: Record<Party['type'], string> = { CONSUMER: 'مصرف‌کننده', BUSINESS: 'همکار' };

function StatusBadge({ status }: { status: Party['status'] }) {
  return status === 'ACTIVE' ? (
    <Badge variant="outline">فعال</Badge>
  ) : (
    <Badge variant="secondary">غیرفعال</Badge>
  );
}

/** مقدار اصلی هر بُعد همیشه دیده می‌شود؛ معادل فقط یک نمای جداگانه است. */
function BalanceRow({
  label,
  raw,
  dual,
  rawKind,
}: {
  label: string;
  raw: bigint;
  dual: DualAmount | null;
  rawKind: 'rial' | 'gold';
}) {
  const activeUnit = useUnitStore((state) => state.unit);
  const rawAmount: DualAmount | RawAmount = dual ?? { kind: 'raw', value: raw, unit: rawKind };

  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-0.5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xs font-medium">{debtorCreditorLabel(raw)}</p>
      </div>
      <div className="min-w-0 space-y-2 sm:text-end">
        <div>
          <p className="text-xs text-muted-foreground">مانده اصلی</p>
          <AmountDisplay amount={rawAmount} unit={rawKind} size="md" />
        </div>
        {activeUnit !== rawKind ? (
          dual ? (
            <div>
              <p className="text-xs text-muted-foreground">معادل با واحد انتخابی</p>
              <AmountDisplay amount={dual} size="sm" />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              معادل واحد دیگر بدون مظنه در دسترس نیست
            </p>
          )
        ) : null}
      </div>
    </div>
  );
}

function PartyBalanceCard({ partyId }: { partyId: string }) {
  const latestQuote = useLatestPriceQuote('MAZNEH');
  const referenceQuoteId = latestQuote.data?.id;
  const balancesQuery: PartyBalancesQuery = referenceQuoteId ? { referenceQuoteId } : {};
  // مقدار خام حتی بدون مظنه یا هنگام بارگذاری آن باید از دفترکل دریافت شود.
  const balances = usePartyBalances(partyId, balancesQuery);

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-sm">مانده چندواحدی</CardTitle>
        <UnitToggle />
      </CardHeader>
      <CardContent>
        <PartyBalanceCardBody balances={balances} partyId={partyId} />
        {latestQuote.isLoading ? (
          <p className="mt-2 text-xs text-muted-foreground">
            در حال دریافت مظنه مرجع برای نمایش معادل…
          </p>
        ) : null}
        {latestQuote.isError ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-warning">
            <p>مظنه مرجع دریافت نشد؛ مانده‌های اصلی همچنان معتبرند.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void latestQuote.refetch()}
            >
              تلاش دوباره
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PartyBalanceCardBody({
  balances,
  partyId,
}: {
  partyId: string;
  balances: {
    data: PartyBalances | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => unknown;
  };
}) {
  if (balances.isLoading) return <CardSkeleton lines={3} />;
  if (balances.isError) {
    return (
      <ErrorState
        description="دریافت مانده ناموفق بود."
        onRetry={() => void balances.refetch()}
      />
    );
  }
  if (!balances.data) return null;
  if (balances.data.partyId !== partyId) {
    return (
      <p role="alert" className="text-sm text-destructive">
        پاسخ مانده به این شخص تعلق ندارد.
      </p>
    );
  }

  const { rawBalances, convertedView } = balances.data;
  const rial = BigInt(rawBalances.rial);
  const pureGoldMg = BigInt(rawBalances.pureGoldMg);
  const referenceRate = convertedView
    ? BigInt(convertedView.referenceMazneh.goldRatePerGramRial)
    : null;
  const rate1000 = referenceRate !== null && referenceRate > 0n ? referenceRate : null;
  const totalGoldMg = convertedView ? BigInt(convertedView.totalGoldDisplayPureMg) : null;
  const totalRial = rate1000 ? rial + dualFromPure(pureGoldMg, rate1000).rial : null;

  return (
    <div className="divide-y divide-border">
      <BalanceRow
        label="ریال"
        raw={rial}
        rawKind="rial"
        dual={rate1000 ? dualFromRial(rial, rate1000) : null}
      />
      <BalanceRow
        label="طلای خالص"
        raw={pureGoldMg}
        rawKind="gold"
        dual={rate1000 ? dualFromPure(pureGoldMg, rate1000) : null}
      />
      {rate1000 && totalGoldMg !== null && totalRial !== null ? (
        <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold">مانده کل معادل</p>
            <p className="text-xs text-muted-foreground">{debtorCreditorLabel(totalGoldMg)}</p>
          </div>
          <AmountDisplay amount={{ rial: totalRial, pureMg: totalGoldMg, rate1000 }} size="lg" />
        </div>
      ) : (
        <p className="py-2 text-xs text-muted-foreground">
          مظنه مرجع معتبر در دسترس نیست — مانده کل معادل قابل‌محاسبه نیست.
        </p>
      )}

      {rawBalances.coins.length > 0 ? (
        <div className="space-y-2 py-3">
          <p className="text-sm font-semibold">سکه‌ها · مانده اصلی هر نوع</p>
          {rawBalances.coins.map((coin) => (
            <div
              key={coin.coinTypeId}
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3"
            >
              <span className="min-w-0 text-sm">
                <bdi className="block break-all font-medium">{coin.code}</bdi>
                <span className="text-xs text-muted-foreground">
                  {debtorCreditorLabel(BigInt(coin.count))}
                </span>
              </span>
              <span className="tabular-nums text-sm font-semibold">
                {formatCoinCount(coin.count)}
                <span className="ms-1 text-xs font-normal text-muted-foreground">عدد</span>
              </span>
            </div>
          ))}
          <p className="text-xs leading-5 text-muted-foreground">
            سکه‌ها در جمع طلا و ریال ادغام نمی‌شوند؛ مظنه طلا به‌تنهایی قیمت بازار و حباب هر نوع
            سکه را تعیین نمی‌کند.
          </p>
        </div>
      ) : null}
      {convertedView && rate1000 !== null ? (
        <p className="py-2 text-xs leading-5 text-muted-foreground">
          معادل‌ها با مظنه مرجعِ{' '}
          {formatJalaliDateTime(new Date(convertedView.referenceMazneh.observedAt))} نمایش داده
          می‌شوند؛ مانده‌های اصلی دفترکل تغییر نمی‌کنند.
        </p>
      ) : null}
    </div>
  );
}

function statementQuantityText(dimension: { kind: 'RIAL' | 'GOLD' | 'SILVER' | 'COIN' }, quantity: bigint): string {
  if (dimension.kind === 'RIAL') return `${formatRial(quantity)} ریال`;
  if (dimension.kind === 'COIN') return `${formatCoinCount(toSafeNumber(quantity))} عدد`;
  return `${formatGram(quantity)} گرم`;
}

function RecentActivityCard({ partyId }: { partyId: string }) {
  const { data, isLoading, isError, refetch } = usePartyStatement(partyId, { limit: 5, offset: 0 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">آخرین معاملات</CardTitle>
        <p className="text-xs text-muted-foreground">
          فقط ۵ رویداد؛ صورت‌حساب کامل با بازه، فیلتر و مانده‌ی جاری در صفحه‌ی جدا است.
        </p>
        <Link
          to="/parties/$partyId/statement"
          params={{ partyId }}
          className="inline-flex min-h-touch cursor-pointer items-center gap-1 self-start rounded-md text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          مشاهده صورت‌حساب کامل
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? <CardSkeleton lines={3} /> : null}
        {isError ? (
          <ErrorState description="دریافت صورت‌حساب ناموفق بود." onRetry={() => void refetch()} />
        ) : null}
        {!isLoading && !isError && data?.items.length === 0 ? (
          <EmptyState icon={ReceiptText} title="معامله‌ای ثبت نشده" description="هنوز هیچ رویدادی در دفتر این شخص نیست." />
        ) : null}
        {data && data.items.length > 0 ? (
          <ul className="divide-y divide-border">
            {data.items.map((entry) => {
              const quantity = BigInt(entry.quantity);
              return (
                <li key={entry.ledgerTransactionId + entry.dimension.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-sm font-medium">{SOURCE_LABEL[entry.source.type]}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatJalaliDateTime(new Date(entry.effectiveAt))}
                    </p>
                  </div>
                  <span
                    className={
                      quantity > 0n
                        ? 'tabular-nums text-sm font-semibold text-credit'
                        : quantity < 0n
                          ? 'tabular-nums text-sm font-semibold text-debit'
                          : 'tabular-nums text-sm font-semibold text-muted-foreground'
                    }
                  >
                    {statementQuantityText(entry.dimension, quantity)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DeactivateSection({ party }: { party: Party }) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { submit, isSubmitting, reset } = useIdempotentSubmit((key: string) => deactivateParty(party.id, key));

  if (party.status === 'INACTIVE') return null;

  const onConfirm = async () => {
    setError(null);
    try {
      const result = await submit(undefined);
      if (!result) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.parties.all() });
      toast.success('شخص غیرفعال شد', result.displayName);
      reset();
      setConfirmOpen(false);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setConfirmOpen(true)}>
        غیرفعال‌سازی
      </Button>

      <ResponsiveDialog open={confirmOpen} onOpenChange={(open) => (isSubmitting ? null : setConfirmOpen(open))}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>غیرفعال‌سازی {party.displayName}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              این شخص از انتخاب معاملات جدید حذف می‌شود؛ سوابق و مانده‌ی قبلی حفظ
              می‌ماند و می‌توانید بعداً دوباره ویرایشش کنید. این عملیات برگشت‌پذیر
              (فعال‌سازی مجدد) در حال حاضر ندارد.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          {error ? <ApiErrorNotice error={error} /> : null}

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => setConfirmOpen(false)}>
              انصراف
            </Button>
            <Button type="button" variant="destructive" disabled={isSubmitting} onClick={() => void onConfirm()}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              غیرفعال شود
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}

/**
 * کد ملی — FE-101. پیش‌فرض پوشانده (همان `maskNationalIdForDisplay` ِ انتخابگر شخص)؛ مقدار کامل
 * فقط با ضربه‌ی صریح در DOM می‌آید، نه با hover، و با ترک صفحه دوباره پوشانده است. صفحه‌ی پیشخوان
 * رو به مشتری است — شماره‌ی هویتی کامل نباید پیش‌فرض روی صفحه بماند.
 */
function RevealableNationalId({ nationalId }: { nationalId: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span className="flex items-center gap-1">
      <span className="tabular-nums" dir="ltr">
        {revealed ? toPersianDigits(nationalId) : maskNationalIdForDisplay(nationalId)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-pressed={revealed}
        aria-label={revealed ? 'پنهان کردن کد ملی' : 'نمایش کامل کد ملی'}
        onClick={() => setRevealed((value) => !value)}
      >
        {revealed ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </Button>
    </span>
  );
}

function PartyProfileCard({ party, onEdit }: { party: Party; onEdit: () => void }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">مشخصات</CardTitle>
        <Button type="button" variant="ghost" size="icon" aria-label="ویرایش" onClick={onEdit}>
          <Pencil className="size-4" aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{TYPE_LABEL[party.type]}</Badge>
          <StatusBadge status={party.status} />
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">موبایل</dt>
            <dd className="tabular-nums" dir="ltr">
              {party.mobile ? toPersianDigits(party.mobile) : '—'}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">کد ملی</dt>
            <dd>{party.nationalId ? <RevealableNationalId nationalId={party.nationalId} /> : '—'}</dd>
          </div>
          {party.notes ? (
            <div className="space-y-1">
              <dt className="text-muted-foreground">یادداشت</dt>
              <dd className="whitespace-pre-wrap">{party.notes}</dd>
            </div>
          ) : null}
        </dl>
        <div className="pt-1">
          <DeactivateSection party={party} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function PartyDetailPage() {
  const { partyId } = useParams({ from: '/app-shell/parties/$partyId' });
  const { data: party, isLoading, isError, refetch } = useParty(partyId);
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title={party?.displayName ?? 'جزئیات شخص'}>
        <Link
          to="/parties"
          className="inline-flex min-h-touch cursor-pointer items-center gap-1 rounded-md px-2 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
          اشخاص
        </Link>
      </PageHeader>

      <div className="flex-1 space-y-4 p-4 pb-action">
        {isLoading ? (
          <div className="space-y-3">
            <CardSkeleton lines={3} />
            <CardSkeleton lines={3} />
          </div>
        ) : null}

        {isError ? (
          <ErrorState description="دریافت اطلاعات شخص ناموفق بود." onRetry={() => void refetch()} />
        ) : null}

        {party ? (
          <>
            <PartyProfileCard party={party} onEdit={() => setEditOpen(true)} />
            <PartyBalanceCard partyId={party.id} />
            <RecentActivityCard partyId={party.id} />
          </>
        ) : null}
      </div>

      {party ? (
        <div className="fixed inset-x-0 bottom-above-nav z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm lg:static lg:border-0 lg:bg-transparent lg:px-4 lg:pb-4">
          <Button size="action" asChild>
            <Link to="/parties/$partyId/settlements/new" params={{ partyId: party.id }}>
              <Landmark className="size-5" aria-hidden="true" />
              ثبت تسویه
            </Link>
          </Button>
        </div>
      ) : null}

      {party ? (
        <PartyFormDialog key={party.id} open={editOpen} onOpenChange={setEditOpen} party={party} />
      ) : null}
    </div>
  );
}
