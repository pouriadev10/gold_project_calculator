import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import { flexRender, getCoreRowModel, getPaginationRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import { formatCount } from '@gold/core-calc';
import { usePriceQuoteHistory } from '@/api/queries';
import type { PriceQuote, PriceQuoteSource } from '@/api/contracts';
import { RateDisplay } from '@/components/common/AmountDisplay';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatJalaliDateTime } from '@/lib/date';

/**
 * تاریخچه‌ی مظنه — FE-031.
 *
 * زیر ۶۴۰px کارت، از ۶۴۰px به بالا جدول (بخش ۶ CLAUDE.md: «زیر ۶۴۰px
 * جدول وجود ندارد»). هر دو نما از همان صفحه‌ی جاریِ یک `useReactTable`
 * می‌خوانند — یک منبع حقیقت برای pagination، نه دو منطق موازی که ممکن
 * است از هم جدا بیفتند.
 *
 * بک‌اند صفحه‌بندی سرور-محور ندارد (`priceQuoteQuerySchema` فقط
 * `quoteType` اختیاری دارد؛ `list()` در `price-quotes.service.ts` کل
 * فهرست tenant را برمی‌گرداند). `getPaginationRowModel` همان آرایه‌ی
 * کامل را سمت کلاینت صفحه می‌کند.
 */

// باید با tailwind.config.ts → theme.screens.sm هم‌راستا بماند (همان ثابت ResponsiveDialog.tsx)
const DESKTOP_QUERY = '(min-width: 640px)';

const PAGE_SIZE = 10;

/**
 * همان دو مقدار `SOURCE_LABEL` که `MaznehBar.tsx` دارد — عمداً اینجا هم
 * تکرار شده، نه import بین Feature (قاعده‌ی مرز Feature، `STRUCTURE.md`):
 * یک شیء دوکلیدی ارزش استخراج به یک ماژول مشترک را ندارد.
 */
const SOURCE_LABEL: Record<PriceQuoteSource, string> = { MANUAL: 'دستی', FEED: 'فید' };

// `useReactTable` نوع `data` را `TData[]` می‌خواهد، نه `readonly TData[]` — تغییرناپذیری‌اش با عدم mutate تضمین می‌شود، نه با نوع.
const EMPTY_QUOTES: PriceQuote[] = [];

const columns: ColumnDef<PriceQuote>[] = [
  {
    accessorKey: 'observedAt',
    header: 'زمان',
    cell: ({ getValue }) => formatJalaliDateTime(new Date(getValue<string>())),
  },
  {
    accessorKey: 'amountRial',
    header: 'مبلغ',
    cell: ({ getValue }) => <RateDisplay value={getValue<bigint>()} size="sm" />,
  },
  {
    accessorKey: 'source',
    header: 'منبع',
    cell: ({ getValue }) => SOURCE_LABEL[getValue<PriceQuoteSource>()],
  },
];

export function QuoteHistoryList() {
  const { data, isLoading, isError, refetch } = usePriceQuoteHistory('MAZNEH');
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  const table = useReactTable({
    data: data ?? EMPTY_QUOTES,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE } },
  });

  if (isLoading) {
    return <CardSkeleton lines={4} />;
  }

  if (isError) {
    return (
      <ErrorState description="دریافت تاریخچه‌ی مظنه ناموفق بود." onRetry={() => void refetch()} />
    );
  }

  if (data === undefined || data.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="تاریخچه‌ای وجود ندارد"
        description="هنوز هیچ مظنه‌ای ثبت نشده است."
      />
    );
  }

  const rows = table.getRowModel().rows;
  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;

  return (
    <div className="space-y-3">
      {isDesktop ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const quote = row.original;
            return (
              <Card key={quote.id}>
                <CardContent className="flex items-center justify-between gap-3 pt-6">
                  <div className="space-y-1">
                    <RateDisplay value={quote.amountRial} size="sm" />
                    <p className="text-xs text-muted-foreground">
                      {formatJalaliDateTime(new Date(quote.observedAt))}
                    </p>
                  </div>
                  <Badge variant="secondary">{SOURCE_LABEL[quote.source]}</Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
            قبلی
          </Button>
          <span className="text-xs text-muted-foreground">
            صفحه {formatCount(pageIndex + 1)} از {formatCount(pageCount)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            بعدی
          </Button>
        </div>
      ) : null}
    </div>
  );
}
