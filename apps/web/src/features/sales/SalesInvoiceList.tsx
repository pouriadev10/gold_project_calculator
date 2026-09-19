import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, ReceiptText } from 'lucide-react';
import { dualFromRial, formatCount } from '@gold/core-calc';
import type { SalesInvoiceListItem, SalesInvoiceListQuery } from '@/api/contracts';
import { useSalesInvoices } from '@/api/queries';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatJalaliDateTime } from '@/lib/date';

const DESKTOP_QUERY = '(min-width: 640px)';

function ceilDivide(dividend: number, divisor: number): number {
  const remainder = dividend % divisor;
  return remainder === 0 ? dividend / divisor : (dividend - remainder) / divisor + 1;
}

function StatusBadge({ status }: { readonly status: SalesInvoiceListItem['status'] }) {
  return status === 'FINALIZED' ? (
    <Badge variant="outline">نهایی</Badge>
  ) : (
    <Badge variant="secondary">پیش‌نویس</Badge>
  );
}

function VersionBadges({ invoice }: { readonly invoice: SalesInvoiceListItem }) {
  if (invoice.currentVersion === 0) return null;
  return (
    <>
      <Badge variant="outline">نسخه {formatCount(invoice.currentVersion)}</Badge>
      {invoice.currentVersion > 1 ? <Badge variant="secondary">اصلاح‌شده</Badge> : null}
    </>
  );
}

function InvoiceAmount({ invoice }: { readonly invoice: SalesInvoiceListItem }) {
  if (invoice.payableRial === null || invoice.goldRatePerGramRial === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <AmountDisplay
      amount={dualFromRial(BigInt(invoice.payableRial), BigInt(invoice.goldRatePerGramRial))}
      size="sm"
    />
  );
}

function InvoiceNumber({ invoice }: { readonly invoice: SalesInvoiceListItem }) {
  return invoice.invoiceNumber === null ? (
    <span>بدون شماره</span>
  ) : (
    <span className="tabular-nums">{formatCount(invoice.invoiceNumber)}</span>
  );
}

interface SalesInvoiceListProps {
  readonly query: SalesInvoiceListQuery;
  readonly onOffsetChange: (offset: number) => void;
}

export function SalesInvoiceList({ query, onOffsetChange }: SalesInvoiceListProps) {
  const { data, isLoading, isError, refetch } = useSalesInvoices(query);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  if (isLoading) {
    return (
      <div className="space-y-3" aria-label="در حال دریافت فاکتورها">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={3} />
        <CardSkeleton lines={3} />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        description="دریافت فهرست فاکتورهای فروش ناموفق بود."
        onRetry={() => void refetch()}
      />
    );
  }

  if (data === undefined || data.items.length === 0) {
    return (
      <EmptyState
        icon={ReceiptText}
        title="فاکتوری پیدا نشد"
        description="با این فیلترها فاکتوری وجود ندارد؛ فیلترها را تغییر دهید."
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
                <TableHead>شماره</TableHead>
                <TableHead>شخص</TableHead>
                <TableHead>مبلغ</TableHead>
                <TableHead>تاریخ</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead>نسخه جاری</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>
                    <Link
                      to="/sales/invoices/$invoiceId"
                      params={{ invoiceId: invoice.id }}
                      className="inline-flex min-h-touch cursor-pointer items-center rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <InvoiceNumber invoice={invoice} />
                    </Link>
                  </TableCell>
                  <TableCell>{invoice.party.displayName}</TableCell>
                  <TableCell>
                    <InvoiceAmount invoice={invoice} />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatJalaliDateTime(new Date(invoice.occurredAt))}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={invoice.status} />
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1.5">
                      <VersionBadges invoice={invoice} />
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="space-y-2">
          {data.items.map((invoice) => (
            <Link
              key={invoice.id}
              to="/sales/invoices/$invoiceId"
              params={{ invoiceId: invoice.id }}
              className="block cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`مشاهده فاکتور ${invoice.invoiceNumber ?? 'پیش‌نویس'}`}
            >
              <Card>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">
                      فاکتور <InvoiceNumber invoice={invoice} />
                    </p>
                    <span className="flex flex-wrap gap-1.5">
                      <StatusBadge status={invoice.status} />
                      <VersionBadges invoice={invoice} />
                    </span>
                  </div>
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">شخص</dt>
                    <dd className="truncate font-medium">{invoice.party.displayName}</dd>
                    <dt className="text-muted-foreground">مبلغ</dt>
                    <dd>
                      <InvoiceAmount invoice={invoice} />
                    </dd>
                    <dt className="text-muted-foreground">تاریخ</dt>
                    <dd className="tabular-nums">
                      {formatJalaliDateTime(new Date(invoice.occurredAt))}
                    </dd>
                  </dl>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between gap-2" aria-label="صفحه‌بندی فاکتورها">
          <Button
            type="button"
            variant="outline"
            className="min-h-touch"
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
            className="min-h-touch"
            disabled={data.offset + data.limit >= data.total}
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
