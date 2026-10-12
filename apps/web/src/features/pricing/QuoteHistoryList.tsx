import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import { useState } from 'react';
import { formatCount } from '@gold/core-calc';
import { usePriceQuoteHistory } from '@/api/queries';
import type { PriceQuoteSource } from '@/api/contracts';
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
 * جدول وجود ندارد»). هر دو نما از همان صفحه‌ی جاری (`paginate`) می‌خوانند —
 * یک منبع حقیقت برای pagination، نه دو منطق موازی که ممکن است از هم جدا بیفتند.
 *
 * بک‌اند صفحه‌بندی سرور-محور ندارد (`priceQuoteQuerySchema` فقط
 * `quoteType` اختیاری دارد؛ `list()` در `price-quotes.service.ts` کل
 * فهرست tenant را برمی‌گرداند). همان آرایه‌ی کامل سمت کلاینت صفحه می‌شود.
 *
 * FE-087: قبلاً `@tanstack/react-table` این کار را می‌کرد — ۱۴٫۶KB gzip در
 * چانک صفحه‌ی مظنه برای سه ستون ثابت و برش ده‌تایی. حالا برش ساده است و
 * مثل قبل با رسیدن داده‌ی تازه (مثلاً پس از ثبت مظنه) به صفحه‌ی اول برمی‌گردد.
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

/** آرایه را به صفحه‌های `size`تایی می‌شکند. خالی → هیچ صفحه‌ای. */
export function paginate<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    pages.push(items.slice(start, start + size));
  }
  return pages;
}

export function QuoteHistoryList() {
  const { data, isLoading, isError, refetch } = usePriceQuoteHistory('MAZNEH');
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  // شماره‌ی صفحه به همان آرایه‌ای گره خورده که رویش انتخاب شد؛ داده‌ی تازه = صفحه‌ی اول.
  const [page, setPage] = useState<{ source: unknown; index: number }>({ source: undefined, index: 0 });

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

  const pages = paginate(data, PAGE_SIZE);
  const pageCount = pages.length;
  const pageIndex = page.source === data ? Math.min(page.index, pageCount - 1) : 0;
  const quotes = pages[pageIndex] ?? [];
  const goToPage = (index: number) => setPage({ source: data, index });

  return (
    <div className="space-y-3">
      {isDesktop ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>زمان</TableHead>
                <TableHead>مبلغ</TableHead>
                <TableHead>منبع</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((quote) => (
                <TableRow key={quote.id}>
                  <TableCell>{formatJalaliDateTime(new Date(quote.observedAt))}</TableCell>
                  <TableCell>
                    <RateDisplay value={quote.amountRial} size="sm" />
                  </TableCell>
                  <TableCell>{SOURCE_LABEL[quote.source]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="space-y-2">
          {quotes.map((quote) => (
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
          ))}
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pageIndex === 0}
            onClick={() => goToPage(pageIndex - 1)}
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
            disabled={pageIndex >= pageCount - 1}
            onClick={() => goToPage(pageIndex + 1)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            بعدی
          </Button>
        </div>
      ) : null}
    </div>
  );
}
