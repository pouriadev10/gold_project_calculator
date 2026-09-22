import { ChevronDown, History } from 'lucide-react';
import { dualFromRial, formatCount, formatGram, formatKarat, toSafeNumber } from '@gold/core-calc';
import type { SalesInvoiceAmendmentHistory, SalesInvoiceVersionHistory } from '@gold/contracts';
import { useInvoiceAmendments, useInvoiceVersions } from '@/api/queries';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { ErrorState } from '@/components/common/ErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatJalaliDateTime } from '@/lib/date';

type InvoiceVersion = SalesInvoiceVersionHistory['versions'][number];
type InvoiceAmendment = SalesInvoiceAmendmentHistory['amendments'][number];

const REASON_LABEL: Readonly<Record<string, string>> = {
  WEIGHT_ERROR: 'اصلاح وزن',
  KARAT_ERROR: 'اصلاح عیار',
  WAGE_ERROR: 'اصلاح اجرت',
  PARTY_ERROR: 'اصلاح مشتری',
  PAYMENT_ERROR: 'اصلاح پرداخت',
  OTHER: 'سایر',
};

function VersionDetails({ version, rate1000 }: { version: InvoiceVersion; rate1000: bigint }) {
  return (
    <div className="space-y-3 border-t border-border pt-3 text-sm">
      <dl className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-muted p-3">
          <dt className="text-xs text-muted-foreground">مبلغ ثبت‌شده همین نسخه</dt>
          <dd className="mt-1">
            {version.payableRial === null ? (
              'در snapshot ثبت نشده'
            ) : (
              <AmountDisplay
                amount={dualFromRial(BigInt(version.payableRial), rate1000)}
                size="sm"
              />
            )}
          </dd>
        </div>
        <div className="rounded-lg bg-muted p-3">
          <dt className="text-xs text-muted-foreground">وزن خالص ثبت‌شده</dt>
          <dd className="mt-1 tabular-nums font-medium">
            {version.pureWeightMg === null
              ? '—'
              : `${formatGram(BigInt(version.pureWeightMg))} گرم`}
          </dd>
        </div>
      </dl>
      <div>
        <h3 className="font-semibold">اقلام این نسخه</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {version.items.map((item) => (
            <li
              key={`${item.itemType}-${item.itemId}`}
              className="min-w-0 rounded-lg border border-border p-3"
            >
              <p className="font-medium">{item.itemType === 'COIN' ? 'سکه' : 'زیورآلات'}</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                شناسه کالا: {item.itemId}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">تعداد</dt>
                  <dd className="tabular-nums font-medium">
                    {formatCount(toSafeNumber(BigInt(item.quantity)))}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">عیار</dt>
                  <dd className="tabular-nums font-medium">
                    {item.karat === null ? '—' : formatKarat(item.karat)}
                  </dd>
                </div>
                {item.pureWeightMg !== null ? (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">وزن خالص</dt>
                    <dd className="tabular-nums font-medium">
                      {formatGram(BigInt(item.pureWeightMg))} گرم
                    </dd>
                  </div>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        این نسخه و اثرهای حسابداری آن فقط خواندنی‌اند؛ اصلاح با ثبت نسخه جدید انجام می‌شود.
      </p>
    </div>
  );
}

function AmendmentDifference({
  amendment,
  rate1000,
}: {
  amendment: InvoiceAmendment;
  rate1000: bigint;
}) {
  return (
    <dl className="mt-3 grid gap-2 border-t border-border pt-3 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-xs text-muted-foreground">اختلاف مبلغ</dt>
        <dd className="mt-1">
          {amendment.changes.payableRial.delta === null ? (
            'نامشخص'
          ) : (
            <AmountDisplay
              amount={dualFromRial(BigInt(amendment.changes.payableRial.delta), rate1000)}
              signed
              size="sm"
            />
          )}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">اختلاف وزن خالص</dt>
        <dd className="mt-1 tabular-nums font-medium">
          {amendment.changes.pureWeightMg.delta === null
            ? '—'
            : `${formatGram(BigInt(amendment.changes.pureWeightMg.delta))} گرم`}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">تغییر عیار</dt>
        <dd className="mt-1 tabular-nums font-medium">
          {amendment.changes.karat.before === null || amendment.changes.karat.after === null
            ? '—'
            : `${formatKarat(amendment.changes.karat.before)} ← ${formatKarat(amendment.changes.karat.after)}`}
        </dd>
      </div>
    </dl>
  );
}

export function InvoiceVersionHistory({
  invoiceId,
  rate1000,
}: {
  invoiceId: string;
  rate1000: bigint;
}) {
  const versionsQuery = useInvoiceVersions(invoiceId);
  const amendmentsQuery = useInvoiceAmendments(invoiceId);
  const versions = [...(versionsQuery.data?.versions ?? [])].sort((a, b) => b.version - a.version);
  const currentVersion = versions[0]?.version;
  const amendments = new Map(amendmentsQuery.data?.amendments.map((item) => [item.version, item]));

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <History className="size-5 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">تاریخچه نسخه‌ها</h2>
      </CardHeader>
      <CardContent>
        {versionsQuery.isLoading ? <CardSkeleton lines={3} /> : null}
        {versionsQuery.isError ? (
          <ErrorState
            description="دریافت نسخه‌های فاکتور ناموفق بود."
            onRetry={() => void versionsQuery.refetch()}
          />
        ) : null}
        {versionsQuery.data && versionsQuery.data.invoiceId !== invoiceId ? (
          <p role="alert" className="text-sm text-destructive">
            پاسخ تاریخچه به این فاکتور تعلق ندارد.
          </p>
        ) : null}
        {versionsQuery.data?.invoiceId === invoiceId && versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">هنوز نسخه‌ای ثبت نشده است.</p>
        ) : null}
        {amendmentsQuery.isError ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-warning">
            <p>اختلاف اصلاح‌ها دریافت نشد؛ نسخه‌ها همچنان قابل مشاهده‌اند.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void amendmentsQuery.refetch()}
            >
              تلاش دوباره
            </Button>
          </div>
        ) : null}
        {versionsQuery.data?.invoiceId === invoiceId ? (
          <ol className="space-y-3">
            {versions.map((version) => {
              const amendment =
                amendmentsQuery.data?.invoiceId === invoiceId
                  ? amendments.get(version.version)
                  : undefined;
              return (
                <li key={version.version} className="min-w-0 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-sm font-semibold">
                        نسخه {formatCount(version.version)}
                      </span>
                      <Badge variant={version.version === currentVersion ? 'default' : 'outline'}>
                        {version.version === currentVersion ? 'جاری' : 'قبلی'}
                      </Badge>
                    </span>
                    <time
                      className="tabular-nums text-xs text-muted-foreground"
                      dateTime={version.createdAt}
                    >
                      {formatJalaliDateTime(new Date(version.createdAt))}
                    </time>
                  </div>
                  <p className="mt-2 text-sm">
                    {version.reason === null
                      ? 'صدور اولیه'
                      : (REASON_LABEL[version.reason] ?? version.reason)}
                  </p>
                  {version.reasonDetail ? (
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {version.reasonDetail}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-muted-foreground">
                    ثبت توسط {version.actor?.displayName ?? 'کاربر نامشخص'}
                  </p>
                  {amendment ? (
                    <AmendmentDifference amendment={amendment} rate1000={rate1000} />
                  ) : null}
                  {version.version > 1 && amendmentsQuery.isLoading ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      در حال دریافت اختلاف اصلاح…
                    </p>
                  ) : null}
                  <details className="group mt-3 border-t border-border pt-1">
                    <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 rounded-md px-2 text-sm font-medium text-primary transition-colors active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                      <span>مشاهده جزئیات نسخه {formatCount(version.version)}</span>
                      <ChevronDown
                        className="size-4 shrink-0 group-open:rotate-180"
                        aria-hidden="true"
                      />
                    </summary>
                    <VersionDetails version={version} rate1000={rate1000} />
                  </details>
                </li>
              );
            })}
          </ol>
        ) : null}
      </CardContent>
    </Card>
  );
}
