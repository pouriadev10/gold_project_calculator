import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { formatCount } from '@gold/core-calc';
import { useParties } from '@/api/queries';
import type { Party, PartyListQuery, PartyType } from '@/api/contracts';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * فهرست اشخاص — FE-032.
 *
 * برخلاف `QuoteHistoryList` (FE-031)، صفحه‌بندی اینجا **سرور-محور** است:
 * `useParties` همان `limit`/`offset` را که `PartiesPage` نگه می‌دارد به
 * `GET /parties` واقعی می‌فرستد (`partyListQuerySchema` واقعاً این دو را
 * می‌پذیرد) — پس هیچ `useReactTable`/صفحه‌بندی سمت کلاینت لازم نیست.
 *
 * «مانده‌ی خلاصه» در کارت/جدول عمداً نیست: `partySchema` واقعی (BE-024)
 * مانده‌ی هر شخص را برنمی‌گرداند — آن مانده‌ی تجمیعی سراسری
 * (`/parties/balance-summary`, BE-056/BE-058) است، نه مانده‌ی تک‌تک؛ نمایش
 * عددی که از سرور نیامده همان چیزی است که بخش ۲-۸ CLAUDE.md منع می‌کند.
 * به‌جایش وضعیت (فعال/غیرفعال) به‌عنوان چهارمین فیلد کلیدی نشان داده
 * می‌شود — FE-069 وقتی BE-056 آمد این را با مانده‌ی واقعی جایگزین می‌کند.
 */

// باید با tailwind.config.ts → theme.screens.sm هم‌راستا بماند (همان ثابت ResponsiveDialog.tsx)
const DESKTOP_QUERY = '(min-width: 640px)';

const TYPE_LABEL: Record<PartyType, string> = { CONSUMER: 'مصرف‌کننده', BUSINESS: 'همکار' };

/**
 * بدون `Math.ceil` — قاعده‌ی ESLint (بخش ۲-۱ CLAUDE.md) هرجا جز
 * `core-calc/rounding.ts` گرد کردن را خطا می‌دهد. اینجا فقط شمارش صفحه
 * است (عدد صحیح، نه پول/وزن)، پس تقسیم صحیح دستی جایگزین کافی است.
 */
function ceilDivide(dividend: number, divisor: number): number {
  const remainder = dividend % divisor;
  return remainder === 0 ? dividend / divisor : (dividend - remainder) / divisor + 1;
}

interface PartyListProps {
  query: PartyListQuery;
  onOffsetChange: (offset: number) => void;
}

function PartyName({ party }: { party: Party }) {
  return (
    <Link
      to="/parties/$partyId"
      params={{ partyId: party.id }}
      className="rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {party.displayName}
    </Link>
  );
}

function StatusBadge({ status }: { status: Party['status'] }) {
  if (status === 'ACTIVE') return null;
  return <Badge variant="secondary">غیرفعال</Badge>;
}

export function PartyList({ query, onOffsetChange }: PartyListProps) {
  const { data, isLoading, isError, refetch } = useParties(query);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <CardSkeleton lines={2} />
        <CardSkeleton lines={2} />
        <CardSkeleton lines={2} />
      </div>
    );
  }

  if (isError) {
    return <ErrorState description="دریافت فهرست اشخاص ناموفق بود." onRetry={() => void refetch()} />;
  }

  if (data === undefined || data.items.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="شخصی پیدا نشد"
        description="با این فیلترها شخصی ثبت نشده — فیلترها را تغییر دهید یا شخص تازه اضافه کنید."
      />
    );
  }

  const pageCount = Math.max(1, ceilDivide(data.total, data.limit));
  const currentPage = ceilDivide(data.offset + 1, data.limit);

  return (
    <div className="space-y-3">
      {isDesktop ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>نام</TableHead>
                <TableHead>موبایل</TableHead>
                <TableHead>نوع</TableHead>
                <TableHead>وضعیت</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((party) => (
                <TableRow key={party.id}>
                  <TableCell>
                    <PartyName party={party} />
                  </TableCell>
                  <TableCell className="tabular-nums" dir="ltr">
                    {party.mobile ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{TYPE_LABEL[party.type]}</Badge>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={party.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="space-y-2">
          {data.items.map((party) => (
            <Link
              key={party.id}
              to="/parties/$partyId"
              params={{ partyId: party.id }}
              className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Card className="transition-colors active:bg-muted/50">
                <CardContent className="flex items-center justify-between gap-3 pt-6">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium">{party.displayName}</p>
                    <p className="tabular-nums text-xs text-muted-foreground" dir="ltr">
                      {party.mobile ?? '—'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={party.status} />
                    <Badge variant="outline">{TYPE_LABEL[party.type]}</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={data.offset === 0}
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
            size="sm"
            disabled={data.offset + data.limit >= data.total}
            onClick={() => onOffsetChange(data.offset + data.limit)}
          >
            بعدی
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
