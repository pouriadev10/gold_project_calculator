import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import {
  AlertTriangle,
  ChevronRight,
  Download,
  FilePenLine,
  Loader2,
  Package,
  RotateCcw,
  Scale,
  Settings2,
  UserRound,
} from 'lucide-react';
import {
  dualFromRial,
  formatCount,
  formatGram,
  formatKarat,
  formatScaled,
  toSafeNumber,
} from '@gold/core-calc';
import type { SalesInvoiceDetail } from '@/api/contracts';
import type { InvoiceAmendmentPreflight } from '@gold/contracts';
import { useInvoiceAmendmentPolicy, useSalesInvoiceDetail } from '@/api/queries';
import { getSalesInvoicePdf } from '@/api/sales';
import { AmountDisplay, RateDisplay } from '@/components/common/AmountDisplay';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { UnitToggle } from '@/components/common/UnitToggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatJalaliDateTime } from '@/lib/date';
import { InvoiceVersionHistory } from './InvoiceVersionHistory';

type InvoiceVersion = SalesInvoiceDetail['versions'][number];

const POLICY_RESTRICTION_LABEL: Readonly<
  Record<InvoiceAmendmentPreflight['restrictions'][number], string>
> = {
  INVOICE_NOT_FINALIZED: 'فاکتور هنوز نهایی نشده است.',
  UNSUPPORTED_ITEMS: 'ترکیب اقلام این فاکتور با مسیر اصلاح فعلی پشتیبانی نمی‌شود.',
  OUTSIDE_CORRECTION_WINDOW: 'مهلت اصلاح عادی این فاکتور گذشته است.',
  BUSINESS_DAY_CLOSED: 'روز کاری این فاکتور بسته شده است.',
  SETTLED_INVOICE: 'برای طرف‌حساب این فاکتور تسویه ثبت شده است.',
  VARIANCE_EXCEEDS_MANAGER_THRESHOLD: 'اختلاف مبلغ از حد مجاز اصلاح عادی بیشتر است.',
};

function currentVersion(detail: SalesInvoiceDetail): InvoiceVersion | undefined {
  return detail.versions.find((version) => version.version === detail.currentVersion);
}

function DetailRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-end text-sm font-medium">{children}</dd>
    </div>
  );
}

function InvoiceOverview({
  detail,
  version,
}: {
  detail: SalesInvoiceDetail;
  version: InvoiceVersion | undefined;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <h2 className="text-sm font-semibold">مشخصات فاکتور</h2>
        <span className="flex flex-wrap justify-end gap-1.5">
          <Badge variant={detail.status === 'FINALIZED' ? 'outline' : 'secondary'}>
            {detail.status === 'FINALIZED' ? 'نهایی' : 'پیش‌نویس'}
          </Badge>
          {detail.currentVersion > 0 ? (
            <Badge variant="default">نسخه جاری {formatCount(detail.currentVersion)}</Badge>
          ) : null}
          {detail.currentVersion > 1 ? <Badge variant="secondary">اصلاح‌شده</Badge> : null}
        </span>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border">
          <DetailRow label="شماره فاکتور">
            <span className="tabular-nums text-lg font-bold">
              {detail.invoiceNumber === null ? 'هنوز صادر نشده' : formatCount(detail.invoiceNumber)}
            </span>
          </DetailRow>
          <DetailRow label="مشتری">
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
              {detail.party.displayName}
            </span>
          </DetailRow>
          <DetailRow label="نوع طرف حساب">
            {detail.party.type === 'CONSUMER' ? 'مصرف‌کننده' : 'همکار'}
          </DetailRow>
          <DetailRow label="زمان سند">
            <span className="tabular-nums">
              {formatJalaliDateTime(new Date(detail.occurredAt))}
            </span>
          </DetailRow>
          {version?.actor ? (
            <DetailRow label="ثبت‌کننده">{version.actor.displayName}</DetailRow>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function PaymentCard({ version, rate1000 }: { version: InvoiceVersion; rate1000: bigint }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold">مبالغ و پرداخت</h2>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border">
          <DetailRow label="جمع فاکتور">
            <AmountDisplay amount={dualFromRial(BigInt(version.payableRial), rate1000)} size="lg" />
          </DetailRow>
          <DetailRow label="پرداخت‌شده">
            <AmountDisplay amount={dualFromRial(BigInt(version.paidRial), rate1000)} size="sm" />
          </DetailRow>
          <DetailRow label="مانده">
            <AmountDisplay
              amount={dualFromRial(BigInt(version.receivableRial), rate1000)}
              size="sm"
            />
          </DetailRow>
          {version.pureWeightMg !== null ? (
            <DetailRow label="وزن خالص">
              <span className="tabular-nums">{formatGram(BigInt(version.pureWeightMg))} گرم</span>
            </DetailRow>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function QuoteCard({ snapshot }: { snapshot: NonNullable<SalesInvoiceDetail['quoteSnapshot']> }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <Scale className="size-5 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">مظنه قفل‌شده</h2>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border">
          <DetailRow label="مظنه سند">
            <RateDisplay value={BigInt(snapshot.amountRial)} size="sm" />
          </DetailRow>
          <DetailRow label="نرخ گرم طلای خالص">
            <RateDisplay value={BigInt(snapshot.goldRatePerGramRial)} size="sm" />
          </DetailRow>
          <DetailRow label="زمان مشاهده نرخ">
            <span className="tabular-nums">
              {formatJalaliDateTime(new Date(snapshot.observedAt))}
            </span>
          </DetailRow>
        </dl>
        <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
          تبدیل طلا و ریال این صفحه فقط با همین نرخ تاریخی انجام می‌شود؛ نرخ امروز اثری ندارد.
        </p>
      </CardContent>
    </Card>
  );
}

function ItemsCard({ version, rate1000 }: { version: InvoiceVersion; rate1000: bigint }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <span className="flex items-center gap-2">
          <Package className="size-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold">اقلام</h2>
        </span>
        <Badge variant="outline">{formatCount(version.items.length)} قلم</Badge>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3 sm:grid-cols-2">
          {version.items.map((item) => (
            <li
              key={`${item.itemType}-${item.itemId}`}
              className="rounded-lg border border-border p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.itemType === 'COIN' ? 'سکه' : 'زیورآلات'}
                  </p>
                </div>
                <AmountDisplay
                  amount={dualFromRial(BigInt(item.payableRial), rate1000)}
                  size="sm"
                />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">تعداد</dt>
                  <dd className="mt-1 tabular-nums font-medium">
                    {formatCount(toSafeNumber(BigInt(item.quantity)))}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">عیار</dt>
                  <dd className="mt-1 tabular-nums font-medium">
                    {item.karat === null ? '—' : formatKarat(item.karat)}
                  </dd>
                </div>
                {item.pureWeightMg !== null ? (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">وزن خالص</dt>
                    <dd className="mt-1 tabular-nums font-medium">
                      {formatGram(BigInt(item.pureWeightMg))} گرم
                    </dd>
                  </div>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SettingsCard({ version }: { version: InvoiceVersion }) {
  const settings = version.settingsSnapshot;
  const hasSettings = Object.values(settings).some((value) => value !== null);

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <Settings2 className="size-5 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">تنظیمات محاسبه همین نسخه</h2>
      </CardHeader>
      <CardContent>
        {hasSettings ? (
          <dl className="grid gap-x-6 sm:grid-cols-2">
            {settings.baseQuoteKarat !== null ? (
              <DetailRow label="عیار مبنای مظنه">
                {formatKarat(toSafeNumber(BigInt(settings.baseQuoteKarat)))}
              </DetailRow>
            ) : null}
            {settings.mithqalGramsX10k !== null ? (
              <DetailRow label="وزن مثقال">
                <span className="tabular-nums">
                  {formatScaled(BigInt(settings.mithqalGramsX10k), 4)} گرم
                </span>
              </DetailRow>
            ) : null}
            {settings.profitRateBps !== null ? (
              <DetailRow label="نرخ سود">
                <span className="tabular-nums">
                  {formatScaled(BigInt(settings.profitRateBps), 2)}٪
                </span>
              </DetailRow>
            ) : null}
            {settings.taxRateBps !== null ? (
              <DetailRow label="نرخ مالیات">
                <span className="tabular-nums">
                  {formatScaled(BigInt(settings.taxRateBps), 2)}٪
                </span>
              </DetailRow>
            ) : null}
            {settings.roundingUnitRial !== null ? (
              <DetailRow label="واحد گردکردن">
                <RateDisplay value={BigInt(settings.roundingUnitRial)} size="sm" />
              </DetailRow>
            ) : null}
            {settings.roundingPolicy !== null ? (
              <DetailRow label="روش گردکردن">
                {settings.roundingPolicy === 'ROUND_HALF_UP'
                  ? 'نیم رو به بالا'
                  : settings.roundingPolicy}
              </DetailRow>
            ) : null}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            برای این نوع فاکتور تنظیم محاسباتی جداگانه‌ای ثبت نشده است.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function LedgerCard({ version }: { version: InvoiceVersion }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <h2 className="text-sm font-semibold">خلاصه دفترکل</h2>
        <Badge variant={version.ledgerSummary.balanced ? 'outline' : 'destructive'}>
          {version.ledgerSummary.balanced ? 'تراز' : 'نیازمند بررسی'}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-muted p-3">
            <p className="text-xs text-muted-foreground">اسناد حسابداری</p>
            <p className="mt-1 tabular-nums font-semibold">
              {formatCount(version.ledgerSummary.transactionCount)}
            </p>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <p className="text-xs text-muted-foreground">ردیف‌های دفترکل</p>
            <p className="mt-1 tabular-nums font-semibold">
              {formatCount(version.ledgerSummary.entryCount)}
            </p>
          </div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          برای حفظ سادگی و کنترل دسترسی، فقط وضعیت تراز و تعداد اثرها نمایش داده می‌شود.
        </p>
      </CardContent>
    </Card>
  );
}

function InvoiceActions({ detail }: { detail: SalesInvoiceDetail }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const amendmentPolicy = useInvoiceAmendmentPolicy(detail.id);
  const policy =
    amendmentPolicy.data?.invoiceId === detail.id &&
    amendmentPolicy.data.invoiceVersion === detail.currentVersion
      ? amendmentPolicy.data
      : null;
  const canStartAmendment =
    !amendmentPolicy.isFetching && !amendmentPolicy.isError && policy?.allowed === true;
  const version = currentVersion(detail);
  const canBuyBack =
    detail.status === 'FINALIZED' &&
    detail.party.type === 'CONSUMER' &&
    detail.party.status === 'ACTIVE' &&
    version?.items.some((item) => item.itemType === 'JEWELRY') === true;

  async function downloadPdf(): Promise<void> {
    if (detail.invoiceNumber === null || isDownloading) return;
    setDownloadError(null);
    setIsDownloading(true);
    try {
      const file = await getSalesInvoicePdf(detail.id);
      const url = URL.createObjectURL(file.content);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.fileName ?? `invoice-${detail.invoiceNumber}.pdf`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      setDownloadError(error);
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="invoice-actions-title">
      <h2 id="invoice-actions-title" className="text-sm font-semibold">
        اقدامات
      </h2>
      {downloadError ? <ApiErrorNotice error={downloadError} /> : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <Button
          type="button"
          size="action"
          onClick={() => void downloadPdf()}
          disabled={detail.status !== 'FINALIZED' || isDownloading}
        >
          {isDownloading ? (
            <Loader2
              className="size-5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <Download className="size-5" aria-hidden="true" />
          )}
          دریافت PDF
        </Button>

        {canBuyBack ? (
          <Button asChild type="button" size="action" variant="outline">
            <Link to="/sales/invoices/$invoiceId/b2c-buyback" params={{ invoiceId: detail.id }}>
              <RotateCcw className="size-5" aria-hidden="true" />
              خرید مجدد B2C
            </Link>
          </Button>
        ) : (
          <Button type="button" size="action" variant="outline" disabled>
            <RotateCcw className="size-5" aria-hidden="true" />
            خرید مجدد B2C
          </Button>
        )}

        {canStartAmendment ? (
          <Button asChild size="action" variant="outline">
            <Link to="/sales/invoices/$invoiceId/amend" params={{ invoiceId: detail.id }}>
              <FilePenLine className="size-5" aria-hidden="true" />
              اصلاح فاکتور
            </Link>
          </Button>
        ) : (
          <Button type="button" size="action" variant="outline" disabled aria-describedby="invoice-amendment-policy-status">
            <FilePenLine className="size-5" aria-hidden="true" />
            اصلاح فاکتور
          </Button>
        )}
      </div>
      <div
        id="invoice-amendment-policy-status"
        className="space-y-2 text-sm leading-6"
        aria-live="polite"
      >
        {amendmentPolicy.isFetching ? <p>در حال بررسی مجوز اصلاح در سرور…</p> : null}
        {amendmentPolicy.isError ? (
          <div className="flex flex-wrap items-center gap-2">
            <p>مجوز اصلاح دریافت نشد؛ اقدام تا پاسخ معتبر سرور غیرفعال است.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void amendmentPolicy.refetch()}
            >
              تلاش دوباره
            </Button>
          </div>
        ) : null}
        {!amendmentPolicy.isFetching && !amendmentPolicy.isError && policy === null ? (
          <p>پاسخ مجوز با نسخه جاری فاکتور سازگار نیست؛ اصلاح غیرفعال است.</p>
        ) : null}
        {!amendmentPolicy.isFetching && !amendmentPolicy.isError && policy ? (
          <>
            <p className={policy.allowed ? 'text-credit' : 'text-warning'}>
              {policy.allowed
                ? policy.requiresManagerAuthorization
                  ? 'اصلاح با مجوز مدیر برای این حساب مجاز است.'
                  : 'شروع اصلاح برای این حساب مجاز است.'
                : policy.requiresManagerAuthorization
                  ? 'اصلاح به مجوز مدیر یا مالک نیاز دارد.'
                  : 'اصلاح این فاکتور فعلاً مجاز نیست.'}
            </p>
            {policy.restrictions.length > 0 ? (
              <ul className="list-disc space-y-1 ps-5">
                {policy.restrictions.map((restriction) => (
                  <li key={restriction}>{POLICY_RESTRICTION_LABEL[restriction]}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
        {canStartAmendment ? <p>هنگام ثبت، سرور دلیل و اختلاف مبلغ واقعی را دوباره بررسی می‌کند.</p> : null}
      </div>
      {!canBuyBack ? (
        <p className="text-xs leading-5 text-muted-foreground">
          خرید مجدد فقط برای فاکتور نهاییِ زیورآلاتِ مصرف‌کننده فعال است.
        </p>
      ) : null}
    </section>
  );
}

export function SalesInvoiceDetailView({ detail }: { readonly detail: SalesInvoiceDetail }) {
  const version = currentVersion(detail);
  const rate1000 = detail.quoteSnapshot ? BigInt(detail.quoteSnapshot.goldRatePerGramRial) : null;

  return (
    <>
      <InvoiceOverview detail={detail} version={version} />

      {detail.status === 'DRAFT' || version === undefined || rate1000 === null ? (
        <Card>
          <CardContent className="flex items-start gap-2 py-5 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            این پیش‌نویس هنوز نهایی نشده و snapshot مالی، اقلام قطعی یا PDF ندارد.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <PaymentCard version={version} rate1000={rate1000} />
            <QuoteCard snapshot={detail.quoteSnapshot!} />
          </div>
          <ItemsCard version={version} rate1000={rate1000} />
          <div className="grid gap-4 lg:grid-cols-2">
            <SettingsCard version={version} />
            <LedgerCard version={version} />
          </div>
          <InvoiceVersionHistory invoiceId={detail.id} rate1000={rate1000} />
        </>
      )}

      <InvoiceActions detail={detail} />
    </>
  );
}

export default function SalesInvoiceDetailPage() {
  const { invoiceId } = useParams({ from: '/app-shell/sales/invoices/$invoiceId' });
  const detail = useSalesInvoiceDetail(invoiceId);

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="جزئیات فاکتور">
        <UnitToggle />
      </PageHeader>

      <main className="flex-1 space-y-4 p-4 pb-6">
        <Link
          to="/sales/invoices"
          className="inline-flex min-h-touch cursor-pointer items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
          فاکتورهای فروش
        </Link>

        {detail.isLoading ? (
          <div className="space-y-3" aria-label="در حال دریافت جزئیات فاکتور">
            <CardSkeleton lines={4} />
            <CardSkeleton lines={4} />
            <CardSkeleton lines={3} />
          </div>
        ) : null}

        {detail.isError ? (
          <ErrorState
            description="دریافت جزئیات فاکتور ناموفق بود."
            onRetry={() => void detail.refetch()}
          />
        ) : null}

        {detail.data ? <SalesInvoiceDetailView detail={detail.data} /> : null}
      </main>
    </div>
  );
}
