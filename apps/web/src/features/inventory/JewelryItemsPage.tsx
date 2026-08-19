import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { toSafeNumber } from '@gold/core-calc';
import { useJewelryItems } from '@/api/queries';
import type { JewelryItemQuery, JewelryItemVersion } from '@/api/contracts';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { KaratInput } from '@/components/keypad/KaratInput';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { JewelryItemFormDialog } from './JewelryItemFormDialog';
import { JewelryItemList, type JewelryItemPage } from './JewelryItemList';

/**
 * صفحه‌ی کالای زیورآلات — FE-036.
 *
 * صفحه‌بندی برای «جست‌وجو»/«فیلتر وضعیت» سرور-محور واقعی است (همان
 * `PartiesPage.tsx`)، ولی «فیلتر عیار» را قرارداد واقعی
 * (`jewelryItemQuerySchema`) اصلاً پشتیبانی نمی‌کند — فقط `search`/`active`
 * دارد. وقتی فیلتر عیار فعال است، این صفحه دقیقاً همان راهی را می‌رود
 * که `QuoteHistoryList` (FE-031) برای نبودِ صفحه‌بندی سرور-محور رفت:
 * یک دسته‌ی بزرگ‌تر (`limit` به سقف واقعی سرور، `MAX_PAGE_SIZE=200`)
 * می‌گیرد و خودش عیار را فیلتر و صفحه‌بندی می‌کند. برای یک مغازه‌ی خرده‌فروشی
 * (پرسونای فاز ۱)، ۲۰۰ ردیف کل کاتالوگ یک فرض معقول است؛ اگر روزی این
 * فرض نقض شود، قرارداد نیاز به فیلتر عیار واقعی سمت سرور دارد، نه اصلاح
 * این صفحه.
 *
 * «فیلتر عیار» با `KaratInput` است، نه یک `<select>` از عیارهای موجود:
 * ساختن آن گزینه‌ها از داده‌ی همین صفحه (فقط یک صفحه از نتایج) فهرست
 * ناقصی از عیارهای واقعاً موجود در کاتالوگ می‌داد. صفر یعنی «بدون
 * فیلتر» — همان قرارداد خودِ `KaratInput` (FE-022).
 */

const PAGE_SIZE = 10;
const KARAT_FILTER_BATCH = 200; // MAX_PAGE_SIZE واقعی — packages/contracts/src/common/pagination.ts
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_LABEL: Record<'true' | 'false', string> = { true: 'فعال', false: 'غیرفعال' };

export default function JewelryItemsPage() {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'' | 'true' | 'false'>('');
  const [karatFilter, setKaratFilter] = useState(0n);
  const [offset, setOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<JewelryItemVersion | null>(null);
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS).trim();

  const karatActive = karatFilter > 0n;
  const karatValue = karatActive ? toSafeNumber(karatFilter) : null;

  const query: JewelryItemQuery = {
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(activeFilter && { active: activeFilter === 'true' }),
    limit: karatActive ? KARAT_FILTER_BATCH : PAGE_SIZE,
    offset: karatActive ? 0 : offset,
  };

  const { data, isLoading, isError, refetch } = useJewelryItems(query);

  const displayed: JewelryItemPage | undefined = useMemo(() => {
    if (!data) return undefined;
    if (!karatActive) return data;

    const filtered = data.items.filter((item) => item.karat === karatValue);
    return {
      items: filtered.slice(offset, offset + PAGE_SIZE),
      total: filtered.length,
      limit: PAGE_SIZE,
      offset,
    };
  }, [data, karatActive, karatValue, offset]);

  const resetPage = () => setOffset(0);

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="کالای زیورآلات" />

      <div className="flex-1 space-y-4 p-4 pb-action">
        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              inputMode="search"
              placeholder="جست‌وجوی کد یا عنوان"
              aria-label="جست‌وجوی کالا"
              className="ps-9"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                resetPage();
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select
              aria-label="فیلتر وضعیت"
              value={activeFilter}
              onChange={(event) => {
                setActiveFilter(event.target.value as '' | 'true' | 'false');
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
            <KaratInput
              label="فیلتر عیار"
              value={karatFilter}
              onChange={(value) => {
                setKaratFilter(value);
                resetPage();
              }}
              hint="صفر یعنی بدون فیلتر"
            />
          </div>
        </div>

        <JewelryItemList
          data={displayed}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
          onOffsetChange={setOffset}
          onEdit={setEditingItem}
        />
      </div>

      {/* منطقه‌ی شست — همان الگوی PartiesPage.tsx */}
      <div className="fixed inset-x-0 bottom-above-nav z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm lg:static lg:border-0 lg:bg-transparent lg:px-4 lg:pb-4">
        <Button type="button" size="action" onClick={() => setCreateOpen(true)}>
          <Plus className="size-5" aria-hidden="true" />
          کالای جدید
        </Button>
      </div>

      <JewelryItemFormDialog open={createOpen} onOpenChange={setCreateOpen} />

      {editingItem ? (
        <JewelryItemFormDialog
          key={editingItem.jewelryItemId}
          open
          onOpenChange={(open) => {
            if (!open) setEditingItem(null);
          }}
          item={editingItem}
        />
      ) : null}

      <NumericKeypad />
    </div>
  );
}
