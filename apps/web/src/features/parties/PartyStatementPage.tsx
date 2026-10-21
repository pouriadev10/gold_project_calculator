import { useCallback, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, FilterX, ReceiptText } from 'lucide-react';
import { formatCount } from '@gold/core-calc';
import { getPartyStatementPdf } from '@/api/parties';
import { useParty, usePartyStatement } from '@/api/queries';
import type { PartyStatementQuery, PartyStatementSourceType } from '@/api/contracts';
import { RateDisplay } from '@/components/common/AmountDisplay';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { JalaliDateRangeFilter } from '@/components/common/JalaliDateRangeFilter';
import { PageHeader } from '@/components/common/PageHeader';
import { PdfDocumentActions } from '@/components/common/PdfDocumentActions';
import { UnitToggle } from '@/components/common/UnitToggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useTenantTimeZone } from '@/hooks/useTenantTimeZone';
import { formatJalaliDateTime } from '@/lib/date';
import { EMPTY_JALALI_RANGE, jalaliRangeToIso, type JalaliDateRange } from '@/lib/jalali';
import {
  SOURCE_LABEL,
  collectDimensions,
  debtorCreditorLabel,
  dimensionLabel,
  lockedStatementRate,
} from './party-statement';
import type { LockedStatementRate, PartyStatementDimension, PartyStatementEntry } from './party-statement';
import { LockedEquivalent, RawQuantity } from './StatementQuantity';

/**
 * صورت‌حساب کامل شخص — FE-070، روی `GET /parties/:id/statement` (BE-057).
 *
 * بازه‌ی تاریخ، نوع سند، بُعد و pagination همه سرورمحورند. مانده‌ی جاری را
 * سرور روی کل دفتر شخص *پیش از* فیلتر و صفحه‌بندی حساب می‌کند، پس فیلتر
 * کردن مانده را عوض نمی‌کند — فرانت هیچ مانده‌ای را خودش جمع نمی‌زند.
 *
 * هر بُعد مقدار خام خودش را نگه می‌دارد. معادل طلا/ریال فقط با نرخِ قفل‌شده‌ی
 * همان سند ساخته می‌شود (قاعده‌ی ۲-۸)، نه با مظنه‌ی امروز؛ ردیف بدون
 * snapshot قابل‌استفاده فقط مقدار خام را نشان می‌دهد. سکه هرگز تبدیل نمی‌شود.
 *
 * بازه‌ی تاریخ با فیلتر مشترک شمسی FE-071 انتخاب و با مرز روزِ منطقه‌ی
 * مستأجر به `from`/`to` تبدیل می‌شود. PDF صورت‌حساب (FE-078) نسخه‌ی کامل
 * سرور است — همه‌ی رویدادها، بدون فیلتر و صفحه‌بندی.
 */

const PAGE_SIZE = 20;
const DESKTOP_QUERY = '(min-width: 640px)';

function ceilDivide(dividend: number, divisor: number): number {
  const remainder = dividend % divisor;
  return remainder === 0 ? dividend / divisor : (dividend - remainder) / divisor + 1;
}

function RateSnapshot({ rate }: { rate: LockedStatementRate | null }) {
  if (rate === null) return <span className="text-xs text-muted-foreground">بدون نرخ سند</span>;
  return (
    <span className="space-y-0.5">
      <RateDisplay value={rate.maznehRial} size="sm" />
      {rate.observedAt ? (
        <span className="block text-xs text-muted-foreground tabular-nums">
          {formatJalaliDateTime(new Date(rate.observedAt))}
        </span>
      ) : null}
    </span>
  );
}

function DocumentReference({ entry }: { entry: PartyStatementEntry }) {
  const shortId = entry.source.id.slice(0, 8);
  if (entry.source.type === 'SALES_INVOICE') {
    return (
      <Link
        to="/sales/invoices/$invoiceId"
        params={{ invoiceId: entry.source.id }}
        className="inline-flex min-h-touch cursor-pointer items-center rounded-sm font-mono text-xs underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`مشاهده فاکتور ${shortId}`}
      >
        <bdi dir="ltr">{shortId}</bdi>
      </Link>
    );
  }
  return (
    <bdi dir="ltr" className="font-mono text-xs text-muted-foreground">
      {shortId}
    </bdi>
  );
}

function RunningBalance({ entry }: { entry: PartyStatementEntry }) {
  const value = BigInt(entry.runningBalance);
  return (
    <span className="space-y-0.5">
      <RawQuantity dimension={entry.dimension} value={value} />
      <span className="block text-xs font-medium">{debtorCreditorLabel(value)}</span>
    </span>
  );
}

function StatementCard({ entry }: { entry: PartyStatementEntry }) {
  const quantity = BigInt(entry.quantity);
  const rate = lockedStatementRate(entry);
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">{SOURCE_LABEL[entry.source.type]}</p>
          <Badge variant="outline">{dimensionLabel(entry.dimension)}</Badge>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">تاریخ</dt>
          <dd className="tabular-nums">{formatJalaliDateTime(new Date(entry.effectiveAt))}</dd>
          <dt className="text-muted-foreground">اثر</dt>
          <dd className="min-w-0 space-y-0.5">
            <RawQuantity dimension={entry.dimension} value={quantity} signed />
            <LockedEquivalent dimension={entry.dimension} value={quantity} rate={rate} />
          </dd>
          <dt className="text-muted-foreground">مانده</dt>
          <dd className="min-w-0 space-y-0.5">
            <RunningBalance entry={entry} />
            <LockedEquivalent
              dimension={entry.dimension}
              value={BigInt(entry.runningBalance)}
              rate={rate}
            />
          </dd>
          <dt className="text-muted-foreground">شماره سند</dt>
          <dd>
            <DocumentReference entry={entry} />
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}

function StatementTable({ items }: { items: PartyStatementEntry[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>تاریخ</TableHead>
            <TableHead>نوع سند</TableHead>
            <TableHead>بُعد</TableHead>
            <TableHead>اثر</TableHead>
            <TableHead>مانده</TableHead>
            <TableHead>نرخ سند</TableHead>
            <TableHead>شماره سند</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((entry) => {
            const quantity = BigInt(entry.quantity);
            const rate = lockedStatementRate(entry);
            return (
              <TableRow key={`${entry.ledgerTransactionId}:${entry.dimension.id}`}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {formatJalaliDateTime(new Date(entry.effectiveAt))}
                </TableCell>
                <TableCell>{SOURCE_LABEL[entry.source.type]}</TableCell>
                <TableCell>{dimensionLabel(entry.dimension)}</TableCell>
                <TableCell>
                  <RawQuantity dimension={entry.dimension} value={quantity} signed />
                  <LockedEquivalent dimension={entry.dimension} value={quantity} rate={rate} />
                </TableCell>
                <TableCell>
                  <RunningBalance entry={entry} />
                  <LockedEquivalent
                    dimension={entry.dimension}
                    value={BigInt(entry.runningBalance)}
                    rate={rate}
                  />
                </TableCell>
                <TableCell>
                  <RateSnapshot rate={rate} />
                </TableCell>
                <TableCell>
                  <DocumentReference entry={entry} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function StatementResults({
  partyId,
  query,
  onOffsetChange,
}: {
  partyId: string;
  query: PartyStatementQuery;
  onOffsetChange: (offset: number) => void;
}) {
  const { data, isLoading, isError, isPlaceholderData, refetch } = usePartyStatement(partyId, query);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  if (isLoading) {
    return (
      <div className="space-y-3" aria-label="در حال دریافت صورت‌حساب">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={3} />
      </div>
    );
  }

  if (isError) {
    return <ErrorState description="دریافت صورت‌حساب ناموفق بود." onRetry={() => void refetch()} />;
  }

  if (data === undefined) return null;

  if (data.partyId !== partyId) {
    return (
      <p role="alert" className="text-sm text-destructive">
        پاسخ صورت‌حساب به این شخص تعلق ندارد.
      </p>
    );
  }

  if (data.items.length === 0) {
    return (
      <EmptyState
        icon={ReceiptText}
        title="رویدادی پیدا نشد"
        description="با این بازه و فیلترها رویدادی در دفتر این شخص نیست."
      />
    );
  }

  const pageCount = Math.max(1, ceilDivide(data.total, data.limit));
  const currentPage = ceilDivide(data.offset + 1, data.limit);

  return (
    <div className="space-y-3" aria-busy={isPlaceholderData}>
      <p className="text-xs text-muted-foreground">
        {formatCount(data.total)} رویداد · به ترتیب زمان، از قدیمی به جدید. مانده‌ی هر ردیف مانده‌ی
        همان بُعد پس از آن رویداد است و با فیلترها تغییر نمی‌کند.
      </p>

      <div className={isPlaceholderData ? 'opacity-60' : undefined}>
        {isDesktop ? (
          <StatementTable items={data.items} />
        ) : (
          <ul className="space-y-2">
            {data.items.map((entry) => (
              <li key={`${entry.ledgerTransactionId}:${entry.dimension.id}`}>
                <StatementCard entry={entry} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between gap-2" aria-label="صفحه‌بندی صورت‌حساب">
          <Button
            type="button"
            variant="outline"
            className="min-h-touch"
            disabled={data.offset === 0 || isPlaceholderData}
            onClick={() => onOffsetChange(Math.max(0, data.offset - data.limit))}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
            قبلی
          </Button>
          <span className="text-xs text-muted-foreground">
            صفحه {formatCount(currentPage)} از {formatCount(pageCount)}
          </span>
          <Button
            type="button"
            variant="outline"
            className="min-h-touch"
            disabled={data.offset + data.limit >= data.total || isPlaceholderData}
            onClick={() => onOffsetChange(data.offset + data.limit)}
          >
            بعدی
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}

/**
 * PDF صورت‌حساب شخص — FE-078، `GET /parties/:id/statement/pdf`. سرور همه‌ی
 * ردیف‌های دفتر شخص را بدون فیلتر و صفحه‌بندی می‌گذارد (`getStatementForExport`)
 * تا فایل هرگز ردیفی را بی‌صدا جا نیندازد؛ فیلترهای این صفحه روی آن اثری
 * ندارند و متن زیر دکمه‌ها همین را صریح می‌گوید. نام سرور (`invoice-<uuid>`)
 * گویا نیست، پس نام فایل از نام شخص ساخته می‌شود.
 */
function StatementPdf({ partyId, displayName }: { partyId: string; displayName: string | null }) {
  const fetchFile = useCallback(
    (signal: AbortSignal) => getPartyStatementPdf(partyId, signal),
    [partyId],
  );
  const fileName = `statement-${displayName ?? partyId.slice(0, 8)}`;

  return (
    <section className="space-y-2" aria-label="PDF صورت‌حساب">
      <PdfDocumentActions
        idPrefix="statement"
        fetchFile={fetchFile}
        preferredFileName={fileName}
        fallbackFileName={`statement-${partyId.slice(0, 8)}`}
        shareTitle={displayName ? `صورت‌حساب ${displayName}` : 'صورت‌حساب شخص'}
        resetKey={partyId}
        previewTitle={displayName ? `پیش‌نمایش صورت‌حساب ${displayName}` : 'پیش‌نمایش صورت‌حساب'}
        description="PDF همه‌ی رویدادهای دفتر این شخص را دارد — بدون فیلتر و صفحه‌بندی؛ فیلترهای این صفحه روی آن اثری ندارند."
        size="default"
      />
    </section>
  );
}

/** فقط برای فهرست بُعدها؛ سرور آن را مستقل از صفحه می‌دهد، پس یک ردیف کافی است. */
const DIMENSION_SOURCE_QUERY: PartyStatementQuery = { limit: 1, offset: 0 };

export default function PartyStatementPage() {
  const { partyId } = useParams({ from: '/app-shell/parties/$partyId/statement' });
  const party = useParty(partyId);

  const [dateRange, setDateRange] = useState<JalaliDateRange>(EMPTY_JALALI_RANGE);
  const timeZone = useTenantTimeZone();
  const [sourceType, setSourceType] = useState<PartyStatementSourceType | ''>('');
  const [dimension, setDimension] = useState<PartyStatementDimension | null>(null);
  const [offset, setOffset] = useState(0);

  // گزینه‌ها از `dimensions` ِ پاسخ‌اند که سرور از کل دفتر شخص می‌سازد (M-15)؛ پیش‌تر از
  // ۲۰۰ ردیف اول ساخته می‌شدند و بُعدی که بعدتر آمده بود در فیلتر نبود. بُعد انتخاب‌شده هم می‌ماند.
  const dimensionSource = usePartyStatement(partyId, DIMENSION_SOURCE_QUERY);
  const dimensionOptions = collectDimensions(
    dimensionSource.data?.partyId === partyId ? dimensionSource.data.dimensions : [],
    [dimension],
  );

  const isoRange = jalaliRangeToIso(dateRange, timeZone);
  const query: PartyStatementQuery = {
    limit: PAGE_SIZE,
    offset,
    ...isoRange,
    ...(sourceType ? { sourceType } : {}),
    ...(dimension ? { dimensionId: dimension.id } : {}),
  };
  const hasFilters =
    dateRange.from !== null || dateRange.to !== null || sourceType !== '' || dimension !== null;

  function clearFilters(): void {
    setDateRange(EMPTY_JALALI_RANGE);
    setSourceType('');
    setDimension(null);
    setOffset(0);
  }

  const title = party.data ? `صورت‌حساب ${party.data.displayName}` : 'صورت‌حساب شخص';

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title={title}>
        <UnitToggle className="shrink-0" />
      </PageHeader>

      <div className="flex-1 space-y-4 p-4 pb-6">
        <Link
          to="/parties/$partyId"
          params={{ partyId }}
          className="inline-flex min-h-touch cursor-pointer items-center gap-1 rounded-md px-2 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
          بازگشت به جزئیات شخص
        </Link>

        <StatementPdf partyId={partyId} displayName={party.data?.displayName ?? null} />

        {party.isError ? (
          <ErrorState description="دریافت اطلاعات شخص ناموفق بود." onRetry={() => void party.refetch()} />
        ) : null}

        <section className="space-y-3" aria-labelledby="statement-filters-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="statement-filters-title" className="text-sm font-semibold">
              بازه و فیلتر
            </h2>
            {hasFilters ? (
              <Button type="button" variant="ghost" className="min-h-touch" onClick={clearFilters}>
                <FilterX className="size-4" aria-hidden="true" />
                پاک‌کردن فیلترها
              </Button>
            ) : null}
          </div>

          <JalaliDateRangeFilter
            idPrefix="statement-date"
            value={dateRange}
            timeZone={timeZone}
            onChange={(next) => {
              setDateRange(next);
              setOffset(0);
            }}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0 space-y-1.5">
              <label htmlFor="statement-source-type" className="block text-sm font-medium">
                نوع سند
              </label>
              <Select
                id="statement-source-type"
                value={sourceType}
                onChange={(event) => {
                  setSourceType(event.target.value as PartyStatementSourceType | '');
                  setOffset(0);
                }}
              >
                <option value="">همه‌ی انواع سند</option>
                {Object.entries(SOURCE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="min-w-0 space-y-1.5">
              <label htmlFor="statement-dimension" className="block text-sm font-medium">
                بُعد
              </label>
              <Select
                id="statement-dimension"
                value={dimension?.id ?? ''}
                onChange={(event) => {
                  const next = dimensionOptions.find((option) => option.id === event.target.value);
                  setDimension(next ?? null);
                  setOffset(0);
                }}
              >
                <option value="">همه‌ی بُعدها</option>
                {dimensionOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {dimensionLabel(option)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

        </section>

        {isoRange !== null ? (
          <StatementResults partyId={partyId} query={query} onOffsetChange={setOffset} />
        ) : null}
      </div>
    </div>
  );
}
