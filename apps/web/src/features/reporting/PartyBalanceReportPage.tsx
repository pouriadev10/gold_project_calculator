import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Search, TrendingUp, Users } from 'lucide-react';
import { formatCoinCount, formatCount } from '@gold/core-calc';
import { useLatestPriceQuote, usePartyBalanceReport } from '@/api/queries';
import type { PartyBalanceReport, PartyBalanceReportQuery, PartyReportDirection } from '@/api/contracts';
import { AmountDisplay, RateDisplay } from '@/components/common/AmountDisplay';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { UnitToggle } from '@/components/common/UnitToggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { debtorCreditorLabel } from '@/features/parties/party-statement';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatJalaliDateTime } from '@/lib/date';
import type { MoneyUnit } from '@/stores/unit-store';
import {
  CONVERTIBLE_DIRECTION_LABEL,
  REPORT_COPY,
  convertibleBalance,
  listedByCoinOnly,
  magnitude,
  magnitudeDual,
  type PartyBalanceReportItem,
  type ReportCopy,
} from './party-balance-report';

/**
 * فهرست بدهکاران (FE-072) و بستانکاران (FE-073) — روی
 * `GET /reporting/debtors|creditors` (BE-058). یک پیاده‌سازی با `direction`،
 * تا دو فهرست هرگز در منطق از هم جدا نشوند؛ همه‌ی تفاوت متنی در
 * `REPORT_COPY` است.
 *
 * جست‌وجو، مرتب‌سازی و pagination سرورمحورند. سرور ریال و طلای خالص را با
 * مظنه‌ی مرجع (آخرین مظنه، که صریحاً با `referenceQuoteId` فرستاده می‌شود)
 * مقایسه و به اندازه‌ی مانده مرتب می‌کند؛ ترتیب به واحد نمایش بستگی ندارد.
 * پس درخواست همیشه با `displayUnit: 'GOLD'` ثابت می‌رود و کلید طلا/ریال فقط
 * نمایش را عوض می‌کند — بدون درخواست تازه و بدون جابه‌جایی ردیف‌ها.
 *
 * هیچ عددی با علامت منفی معنا نمی‌دهد: هر مبلغ — مانده‌ی معادل، ریال، طلای
 * خالص و تعداد هر سکه — با اندازه و برچسب جهت (بدهکار/بستانکار/تسویه) نشان
 * داده می‌شود. ابعاد اصلی خام و در واحد خودشان می‌مانند و هر نوع سکه مستقل
 * است؛ شخصی ممکن است فقط به‌خاطر سکه‌ی هم‌جهت در فهرست باشد.
 */

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MAX_LENGTH = 200;
const DESKTOP_QUERY = '(min-width: 640px)';
/** واحد درخواست ثابت است؛ چهره‌ی دیگر سمت کلاینت از مقادیر خام ساخته می‌شود. */
const REQUEST_DISPLAY_UNIT = 'GOLD';

function ceilDivide(dividend: number, divisor: number): number {
  const remainder = dividend % divisor;
  return remainder === 0 ? dividend / divisor : (dividend - remainder) / divisor + 1;
}

function PartyLink({ item }: { item: PartyBalanceReportItem }) {
  return (
    <Link
      to="/parties/$partyId"
      params={{ partyId: item.party.id }}
      className="inline-flex min-h-touch cursor-pointer items-center rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="break-words">{item.party.displayName}</span>
    </Link>
  );
}

function ConvertibleBalance({
  item,
  report,
  copy,
}: {
  item: PartyBalanceReportItem;
  report: PartyBalanceReport;
  copy: ReportCopy;
}) {
  return (
    <span className="space-y-0.5">
      <AmountDisplay amount={magnitudeDual(convertibleBalance(item, report))} size="sm" />
      <span className="block text-xs font-medium">
        {CONVERTIBLE_DIRECTION_LABEL[item.convertibleDirection]}
      </span>
      {listedByCoinOnly(item, report.direction) ? (
        <span className="block text-xs text-muted-foreground">{copy.coinOnlyNote}</span>
      ) : null}
    </span>
  );
}

/** یک بُعد خام در واحد خودش: اندازه + جهت. */
function RawDimension({ value, unit }: { value: string; unit: MoneyUnit }) {
  const raw = BigInt(value);
  return (
    <span className="space-y-0.5">
      <AmountDisplay amount={{ kind: 'raw', value: magnitude(raw), unit }} size="sm" />
      <span className="block text-xs text-muted-foreground">{debtorCreditorLabel(raw)}</span>
    </span>
  );
}

function CoinPositions({ item }: { item: PartyBalanceReportItem }) {
  if (item.rawBalances.coins.length === 0) {
    return <span className="text-xs text-muted-foreground">بدون سکه</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="مانده سکه‌ها">
      {item.rawBalances.coins.map((coin) => (
        <li
          key={coin.coinTypeId}
          className="inline-flex items-baseline gap-1 rounded-md border border-border px-2 py-1 text-xs"
        >
          <bdi className="font-medium">{coin.code}</bdi>
          <span className="tabular-nums font-semibold" data-raw={String(coin.count)}>
            {formatCoinCount(coin.count < 0 ? -coin.count : coin.count)}
          </span>
          <span className="text-muted-foreground">عدد · {debtorCreditorLabel(BigInt(coin.count))}</span>
        </li>
      ))}
    </ul>
  );
}

function ReportCard({
  item,
  report,
  copy,
}: {
  item: PartyBalanceReportItem;
  report: PartyBalanceReport;
  copy: ReportCopy;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PartyLink item={item} />
          {item.party.status === 'INACTIVE' ? <Badge variant="secondary">غیرفعال</Badge> : null}
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">مانده معادل</dt>
          <dd className="min-w-0">
            <ConvertibleBalance item={item} report={report} copy={copy} />
          </dd>
          <dt className="text-muted-foreground">ریال</dt>
          <dd className="min-w-0">
            <RawDimension value={item.rawBalances.rial} unit="rial" />
          </dd>
          <dt className="text-muted-foreground">طلای خالص</dt>
          <dd className="min-w-0">
            <RawDimension value={item.rawBalances.pureGoldMg} unit="gold" />
          </dd>
          <dt className="text-muted-foreground">سکه‌ها</dt>
          <dd className="min-w-0">
            <CoinPositions item={item} />
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}

function ReportTable({ report, copy }: { report: PartyBalanceReport; copy: ReportCopy }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>شخص</TableHead>
            <TableHead>مانده معادل</TableHead>
            <TableHead>ریال</TableHead>
            <TableHead>طلای خالص</TableHead>
            <TableHead>سکه‌ها</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.items.map((item) => (
            <TableRow key={item.party.id}>
              <TableCell>
                <PartyLink item={item} />
                {item.party.status === 'INACTIVE' ? (
                  <Badge variant="secondary" className="ms-2">
                    غیرفعال
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>
                <ConvertibleBalance item={item} report={report} copy={copy} />
              </TableCell>
              <TableCell>
                <RawDimension value={item.rawBalances.rial} unit="rial" />
              </TableCell>
              <TableCell>
                <RawDimension value={item.rawBalances.pureGoldMg} unit="gold" />
              </TableCell>
              <TableCell>
                <CoinPositions item={item} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ReportResults({
  direction,
  query,
  onOffsetChange,
}: {
  direction: PartyReportDirection;
  query: PartyBalanceReportQuery;
  onOffsetChange: (offset: number) => void;
}) {
  const copy = REPORT_COPY[direction];
  const { data, isLoading, isError, isPlaceholderData, refetch } = usePartyBalanceReport(direction, query);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  if (isLoading) {
    return (
      <div className="space-y-3" aria-label={copy.loading}>
        <CardSkeleton lines={3} />
        <CardSkeleton lines={3} />
      </div>
    );
  }

  if (isError) {
    return <ErrorState description={copy.loadError} onRetry={() => void refetch()} />;
  }

  if (data === undefined) return null;

  if (data.direction !== direction) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {copy.mismatch}
      </p>
    );
  }

  if (data.items.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={copy.emptyTitle}
        description={query.search ? copy.emptySearch : copy.emptyIdle}
      />
    );
  }

  const pageCount = Math.max(1, ceilDivide(data.total, data.limit));
  const currentPage = ceilDivide(data.offset + 1, data.limit);

  return (
    <div className="space-y-3" aria-busy={isPlaceholderData}>
      <p className="text-xs leading-5 text-muted-foreground">
        {formatCount(data.total)} {copy.countNoun} · مقایسه و معادل با مظنه مرجع{' '}
        <RateDisplay value={BigInt(data.referenceMazneh.amountRial)} size="sm" />
        {' '}({formatJalaliDateTime(new Date(data.referenceMazneh.observedAt))}). ریال و طلای خالص مانده
        اصلی‌اند؛ سکه‌ها در جمع معادل نیستند.
      </p>

      <div className={isPlaceholderData ? 'opacity-60' : undefined}>
        {isDesktop ? (
          <ReportTable report={data} copy={copy} />
        ) : (
          <ul className="space-y-2">
            {data.items.map((item) => (
              <li key={item.party.id}>
                <ReportCard item={item} report={data} copy={copy} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between gap-2" aria-label={copy.pagination}>
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

export function PartyBalanceReportPage({ direction }: { direction: PartyReportDirection }) {
  const copy = REPORT_COPY[direction];
  const [search, setSearch] = useState('');
  const [sortDirection, setSortDirection] = useState<PartyBalanceReportQuery['sortDirection']>('DESC');
  const [offset, setOffset] = useState(0);
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS).trim();
  const latestQuote = useLatestPriceQuote('MAZNEH');
  const sortId = `${direction.toLowerCase()}-sort`;

  function renderResults() {
    if (latestQuote.isLoading) return <CardSkeleton lines={3} />;
    if (latestQuote.isError) {
      return (
        <ErrorState
          description="دریافت مظنه مرجع ناموفق بود؛ بدون آن مقایسه‌ی ریال و طلا ممکن نیست."
          onRetry={() => void latestQuote.refetch()}
        />
      );
    }
    if (!latestQuote.data) {
      return (
        <EmptyState
          icon={TrendingUp}
          title="مظنه‌ای ثبت نشده"
          description={copy.noMazneh}
          action={
            <Button asChild variant="outline">
              <Link to="/pricing">رفتن به مظنه</Link>
            </Button>
          }
        />
      );
    }

    const query: PartyBalanceReportQuery = {
      limit: PAGE_SIZE,
      offset,
      displayUnit: REQUEST_DISPLAY_UNIT,
      referenceQuoteId: latestQuote.data.id,
      sortDirection,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    };
    return <ReportResults direction={direction} query={query} onOffsetChange={setOffset} />;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title={copy.title}>
        <UnitToggle className="shrink-0" />
      </PageHeader>

      <main className="flex-1 space-y-4 p-4 pb-6">
        <p className="text-sm text-muted-foreground">{copy.meaning}</p>

        <section className="space-y-3" aria-label="جست‌وجو و مرتب‌سازی">
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              inputMode="search"
              autoComplete="off"
              maxLength={SEARCH_MAX_LENGTH}
              aria-label="جست‌وجوی نام شخص"
              placeholder="نام شخص"
              className="ps-9"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
            />
          </div>

          <div className="space-y-1.5 sm:max-w-xs">
            <label htmlFor={sortId} className="block text-sm font-medium">
              مرتب‌سازی
            </label>
            <Select
              id={sortId}
              value={sortDirection}
              onChange={(event) => {
                setSortDirection(event.target.value as PartyBalanceReportQuery['sortDirection']);
                setOffset(0);
              }}
            >
              {Object.entries(copy.sort).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </section>

        {renderResults()}
      </main>
    </div>
  );
}
