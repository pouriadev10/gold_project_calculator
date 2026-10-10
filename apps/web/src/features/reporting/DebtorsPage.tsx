import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Search, TrendingUp, Users } from 'lucide-react';
import { formatCoinCount, formatCount } from '@gold/core-calc';
import { useLatestPriceQuote, usePartyBalanceReport } from '@/api/queries';
import type { PartyBalanceReport, PartyBalanceReportQuery } from '@/api/contracts';
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
import {
  CONVERTIBLE_DIRECTION_LABEL,
  convertibleBalance,
  listedByCoinOnly,
  type PartyBalanceReportItem,
} from './party-balance-report';

/**
 * فهرست بدهکاران — FE-072، روی `GET /reporting/debtors` (BE-058).
 *
 * جست‌وجو، مرتب‌سازی و pagination سرورمحورند. سرور ریال و طلای خالص را با
 * مظنه‌ی مرجع (آخرین مظنه، که صریحاً با `referenceQuoteId` فرستاده می‌شود)
 * مقایسه و مرتب می‌کند؛ ترتیب به واحد نمایش بستگی ندارد. پس درخواست همیشه با
 * `displayUnit: 'GOLD'` ثابت می‌رود و کلید طلا/ریال فقط نمایش را عوض می‌کند —
 * بدون درخواست تازه و بدون جابه‌جایی ردیف‌ها.
 *
 * ابعاد اصلی (ریال، طلای خالص) همیشه خام و در واحد خودشان نمایش داده
 * می‌شوند. هر نوع سکه مستقل با تعداد و جهت خودش می‌ماند و در جمع ادغام
 * نمی‌شود؛ شخصی ممکن است فقط به‌خاطر سکه‌ی بدهکار در این فهرست باشد.
 */

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MAX_LENGTH = 200;
const DESKTOP_QUERY = '(min-width: 640px)';
/** واحد درخواست ثابت است؛ چهره‌ی دیگر سمت کلاینت از مقادیر خام ساخته می‌شود. */
const REQUEST_DISPLAY_UNIT = 'GOLD';

const SORT_LABEL: Record<PartyBalanceReportQuery['sortDirection'], string> = {
  DESC: 'بیشترین بدهی',
  ASC: 'کمترین بدهی',
};

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
}: {
  item: PartyBalanceReportItem;
  report: PartyBalanceReport;
}) {
  return (
    <span className="space-y-0.5">
      <AmountDisplay amount={convertibleBalance(item, report)} size="sm" />
      <span className="block text-xs font-medium">
        {CONVERTIBLE_DIRECTION_LABEL[item.convertibleDirection]}
      </span>
      {listedByCoinOnly(item, 'DEBTOR') ? (
        <span className="block text-xs text-muted-foreground">به‌خاطر سکه‌ی بدهکار در فهرست است</span>
      ) : null}
    </span>
  );
}

function RawRial({ item }: { item: PartyBalanceReportItem }) {
  return (
    <AmountDisplay amount={{ kind: 'raw', value: BigInt(item.rawBalances.rial), unit: 'rial' }} size="sm" />
  );
}

function RawGold({ item }: { item: PartyBalanceReportItem }) {
  return (
    <AmountDisplay
      amount={{ kind: 'raw', value: BigInt(item.rawBalances.pureGoldMg), unit: 'gold' }}
      size="sm"
    />
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
          <span className="font-medium">{coin.code}</span>
          <span className="tabular-nums font-semibold">{formatCoinCount(coin.count)}</span>
          <span className="text-muted-foreground">عدد · {debtorCreditorLabel(BigInt(coin.count))}</span>
        </li>
      ))}
    </ul>
  );
}

function DebtorCard({ item, report }: { item: PartyBalanceReportItem; report: PartyBalanceReport }) {
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
            <ConvertibleBalance item={item} report={report} />
          </dd>
          <dt className="text-muted-foreground">ریال</dt>
          <dd className="min-w-0">
            <RawRial item={item} />
          </dd>
          <dt className="text-muted-foreground">طلای خالص</dt>
          <dd className="min-w-0">
            <RawGold item={item} />
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

function DebtorTable({ report }: { report: PartyBalanceReport }) {
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
                <ConvertibleBalance item={item} report={report} />
              </TableCell>
              <TableCell>
                <RawRial item={item} />
              </TableCell>
              <TableCell>
                <RawGold item={item} />
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

function DebtorResults({
  query,
  onOffsetChange,
}: {
  query: PartyBalanceReportQuery;
  onOffsetChange: (offset: number) => void;
}) {
  const { data, isLoading, isError, isPlaceholderData, refetch } = usePartyBalanceReport('DEBTOR', query);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  if (isLoading) {
    return (
      <div className="space-y-3" aria-label="در حال دریافت بدهکاران">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={3} />
      </div>
    );
  }

  if (isError) {
    return <ErrorState description="دریافت فهرست بدهکاران ناموفق بود." onRetry={() => void refetch()} />;
  }

  if (data === undefined) return null;

  if (data.direction !== 'DEBTOR') {
    return (
      <p role="alert" className="text-sm text-destructive">
        پاسخ دریافتی فهرست بدهکاران نیست.
      </p>
    );
  }

  if (data.items.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="بدهکاری پیدا نشد"
        description={
          query.search ? 'با این جست‌وجو بدهکاری وجود ندارد.' : 'در حال حاضر هیچ شخصی به فروشگاه بدهکار نیست.'
        }
      />
    );
  }

  const pageCount = Math.max(1, ceilDivide(data.total, data.limit));
  const currentPage = ceilDivide(data.offset + 1, data.limit);

  return (
    <div className="space-y-3" aria-busy={isPlaceholderData}>
      <p className="text-xs leading-5 text-muted-foreground">
        {formatCount(data.total)} بدهکار · مقایسه و معادل با مظنه مرجع{' '}
        <RateDisplay value={BigInt(data.referenceMazneh.amountRial)} size="sm" />
        {' '}({formatJalaliDateTime(new Date(data.referenceMazneh.observedAt))}). ریال و طلای خالص مانده
        اصلی‌اند؛ سکه‌ها در جمع معادل نیستند.
      </p>

      <div className={isPlaceholderData ? 'opacity-60' : undefined}>
        {isDesktop ? (
          <DebtorTable report={data} />
        ) : (
          <ul className="space-y-2">
            {data.items.map((item) => (
              <li key={item.party.id}>
                <DebtorCard item={item} report={data} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between gap-2" aria-label="صفحه‌بندی بدهکاران">
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

export default function DebtorsPage() {
  const [search, setSearch] = useState('');
  const [sortDirection, setSortDirection] = useState<PartyBalanceReportQuery['sortDirection']>('DESC');
  const [offset, setOffset] = useState(0);
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS).trim();
  const latestQuote = useLatestPriceQuote('MAZNEH');

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
          description="فهرست بدهکاران ریال و طلا را با مظنه مرجع مقایسه می‌کند؛ ابتدا یک مظنه ثبت کنید."
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
    return <DebtorResults query={query} onOffsetChange={setOffset} />;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="بدهکاران">
        <UnitToggle className="shrink-0" />
      </PageHeader>

      <main className="flex-1 space-y-4 p-4 pb-6">
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
            <label htmlFor="debtors-sort" className="block text-sm font-medium">
              مرتب‌سازی
            </label>
            <Select
              id="debtors-sort"
              value={sortDirection}
              onChange={(event) => {
                setSortDirection(event.target.value as PartyBalanceReportQuery['sortDirection']);
                setOffset(0);
              }}
            >
              {Object.entries(SORT_LABEL).map(([value, label]) => (
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
