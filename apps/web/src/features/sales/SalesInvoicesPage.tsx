import { useState } from 'react';
import { FilterX, Search } from 'lucide-react';
import { toLatinDigits } from '@gold/core-calc';
import type { SalesInvoiceListQuery, SalesInvoiceStatus } from '@/api/contracts';
import { PageHeader } from '@/components/common/PageHeader';
import { UnitToggle } from '@/components/common/UnitToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { SalesInvoiceList } from './SalesInvoiceList';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_LABEL: Record<SalesInvoiceStatus, string> = {
  DRAFT: 'پیش‌نویس',
  FINALIZED: 'نهایی',
};

function startOfLocalDay(date: string): string {
  return new Date(`${date}T00:00:00.000`).toISOString();
}

function endOfLocalDay(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

/**
 * فهرست فاکتورهای فروش — FE-064.
 *
 * فیلترها و pagination سرورمحورند. تبدیل مبلغ با نرخ قفل‌شده‌ی همان
 * ردیف انجام می‌شود، نه مظنه‌ی زنده؛ به همین دلیل UnitToggle روی تاریخچه
 * نتیجه‌ای پایدار نشان می‌دهد.
 */
export default function SalesInvoicesPage() {
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [status, setStatus] = useState<SalesInvoiceStatus | ''>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [offset, setOffset] = useState(0);

  const debouncedInvoiceNumber = useDebouncedValue(invoiceNumber, SEARCH_DEBOUNCE_MS).trim();
  const debouncedPartySearch = useDebouncedValue(partySearch, SEARCH_DEBOUNCE_MS).trim();
  const normalizedInvoiceNumber = toLatinDigits(debouncedInvoiceNumber).replace(/[^0-9]/gu, '');
  const invalidDateRange = fromDate !== '' && toDate !== '' && fromDate > toDate;

  const query: SalesInvoiceListQuery = {
    limit: PAGE_SIZE,
    offset,
    ...(normalizedInvoiceNumber && { invoiceNumber: normalizedInvoiceNumber }),
    ...(debouncedPartySearch && { partySearch: debouncedPartySearch }),
    ...(status && { status }),
    ...(!invalidDateRange && fromDate ? { from: startOfLocalDay(fromDate) } : {}),
    ...(!invalidDateRange && toDate ? { to: endOfLocalDay(toDate) } : {}),
  };

  const hasFilters =
    invoiceNumber !== '' || partySearch !== '' || status !== '' || fromDate !== '' || toDate !== '';

  function resetPage(): void {
    setOffset(0);
  }

  function clearFilters(): void {
    setInvoiceNumber('');
    setPartySearch('');
    setStatus('');
    setFromDate('');
    setToDate('');
    setOffset(0);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="فاکتورهای فروش">
        <UnitToggle />
      </PageHeader>

      <main className="flex-1 space-y-4 p-4 pb-6">
        <section className="space-y-3" aria-labelledby="invoice-filters-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="invoice-filters-title" className="text-sm font-semibold">
              جست‌وجو و فیلتر
            </h2>
            {hasFilters ? (
              <Button type="button" variant="ghost" className="min-h-touch" onClick={clearFilters}>
                <FilterX className="size-4" aria-hidden="true" />
                پاک‌کردن فیلترها
              </Button>
            ) : null}
          </div>

          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              inputMode="numeric"
              autoComplete="off"
              aria-label="جست‌وجوی شماره فاکتور"
              placeholder="شماره فاکتور"
              className="ps-9"
              value={invoiceNumber}
              onChange={(event) => {
                setInvoiceNumber(event.target.value);
                resetPage();
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <label htmlFor="invoice-party-filter" className="block text-sm font-medium">
                شخص
              </label>
              <Input
                id="invoice-party-filter"
                type="search"
                inputMode="search"
                autoComplete="off"
                placeholder="نام شخص"
                value={partySearch}
                onChange={(event) => {
                  setPartySearch(event.target.value);
                  resetPage();
                }}
              />
            </div>

            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <label htmlFor="invoice-status-filter" className="block text-sm font-medium">
                وضعیت
              </label>
              <Select
                id="invoice-status-filter"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as SalesInvoiceStatus | '');
                  resetPage();
                }}
              >
                <option value="">همه‌ی وضعیت‌ها</option>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="min-w-0 space-y-1.5">
              <label htmlFor="invoice-from-date" className="block text-sm font-medium">
                از تاریخ
              </label>
              <Input
                id="invoice-from-date"
                type="date"
                className="min-w-0"
                value={fromDate}
                onChange={(event) => {
                  setFromDate(event.target.value);
                  resetPage();
                }}
              />
            </div>

            <div className="min-w-0 space-y-1.5">
              <label htmlFor="invoice-to-date" className="block text-sm font-medium">
                تا تاریخ
              </label>
              <Input
                id="invoice-to-date"
                type="date"
                className="min-w-0"
                value={toDate}
                onChange={(event) => {
                  setToDate(event.target.value);
                  resetPage();
                }}
              />
            </div>
          </div>

          {invalidDateRange ? (
            <p className="text-sm text-destructive" role="alert">
              تاریخ پایان نمی‌تواند پیش از تاریخ شروع باشد.
            </p>
          ) : null}
        </section>

        {!invalidDateRange ? <SalesInvoiceList query={query} onOffsetChange={setOffset} /> : null}
      </main>
    </div>
  );
}
