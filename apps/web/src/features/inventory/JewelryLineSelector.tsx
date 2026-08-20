import { useId, useState } from 'react';
import { Gem, Plus, Search, X } from 'lucide-react';
import { useJewelryItems } from '@/api/queries';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/common/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CountInput } from '@/components/keypad/CountInput';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

/**
 * انتخاب‌گر خط‌های زیورآلات موجودی افتتاحیه — FE-039.
 *
 * الگوی جست‌وجو+افزودن دقیقاً از `PartySelector` (FE-035) وام گرفته شده،
 * ولی ساده‌تر: اینجا **چندانتخابی** است (هر قلم با تعداد خودش)، بدون
 * «اخیر» (مفهومی ندارد — این فرم یک‌بارمصرف است) و بدون «ایجاد کالای
 * جدید» (کالا باید از قبل با FE-036/037 ساخته شده باشد؛ موجودی افتتاحیه
 * فقط نسبت‌دادن مقدار اولیه به کالای موجود است).
 *
 * فقط کالای **فعال** جست‌وجو می‌شود — ثبت موجودی برای نسخه‌ی غیرفعال
 * بی‌معناست. گفت‌وگو بعد از افزودن باز می‌ماند تا چند قلم پشت‌سرهم اضافه
 * شوند؛ نتایج جست‌وجو خودشان قلم‌های از‌قبل‌انتخاب‌شده را حذف می‌کنند تا
 * دوباره‌افزودن ممکن نباشد.
 */

export interface SelectedJewelryLine {
  readonly jewelryItemId: string;
  readonly code: string;
  readonly title: string;
  readonly quantity: bigint;
}

const SEARCH_DEBOUNCE_MS = 300;
const MAX_RESULTS = 20;

export interface JewelryLineSelectorProps {
  lines: readonly SelectedJewelryLine[];
  onChange: (lines: readonly SelectedJewelryLine[]) => void;
  disabled?: boolean;
}

export function JewelryLineSelector({ lines, onChange, disabled = false }: JewelryLineSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS).trim();
  const isSearching = debouncedSearch.length > 0;
  const listboxId = useId();

  const searchQuery = useJewelryItems({
    active: true,
    limit: MAX_RESULTS,
    offset: 0,
    ...(isSearching && { search: debouncedSearch }),
  });

  const selectedIds = new Set(lines.map((l) => l.jewelryItemId));
  const results = (searchQuery.data?.items ?? []).filter((item) => !selectedIds.has(item.jewelryItemId));

  function add(item: { jewelryItemId: string; code: string; title: string }) {
    onChange([...lines, { jewelryItemId: item.jewelryItemId, code: item.code, title: item.title, quantity: 1n }]);
  }

  function remove(jewelryItemId: string) {
    onChange(lines.filter((l) => l.jewelryItemId !== jewelryItemId));
  }

  function setQuantity(jewelryItemId: string, quantity: bigint) {
    onChange(lines.map((l) => (l.jewelryItemId === jewelryItemId ? { ...l, quantity } : l)));
  }

  return (
    <div className="space-y-3">
      <Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden="true" />
        افزودن کالای زیورآلات
      </Button>

      {lines.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">هنوز هیچ کالای زیورآلاتی افزوده نشده.</p>
      ) : (
        <ul className="space-y-2">
          {lines.map((line) => (
            <li
              key={line.jewelryItemId}
              className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{line.title}</p>
                <p className="truncate text-xs text-muted-foreground" dir="ltr">
                  {line.code}
                </p>
                {line.quantity <= 0n ? (
                  <p className="text-xs text-destructive">تعداد صفر — این قلم ثبت نمی‌شود</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <CountInput
                  label="تعداد"
                  value={line.quantity}
                  onChange={(next) => setQuantity(line.jewelryItemId, next)}
                  disabled={disabled}
                  className="w-32"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={`حذف ${line.title}`}
                  onClick={() => remove(line.jewelryItemId)}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>افزودن کالای زیورآلات</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              جست‌وجو کنید و روی نتیجه بزنید تا با تعداد ۱ اضافه شود — تعداد را بعداً می‌شود تغییر داد.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                inputMode="search"
                role="combobox"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-label="جست‌وجوی کد یا عنوان"
                autoComplete="off"
                className="ps-9"
                placeholder="جست‌وجوی کد یا عنوان"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            {searchQuery.isLoading ? <CardSkeleton lines={3} /> : null}
            {searchQuery.isError ? (
              <ErrorState description="جست‌وجوی کالا ناموفق بود." onRetry={() => void searchQuery.refetch()} />
            ) : null}
            {!searchQuery.isLoading && !searchQuery.isError && results.length === 0 ? (
              <EmptyState
                icon={Gem}
                title="کالایی پیدا نشد"
                description={
                  isSearching ? 'با این جست‌وجو نتیجه‌ای نبود.' : 'همه‌ی کالاهای فعال از قبل اضافه شده‌اند.'
                }
              />
            ) : null}

            {results.length > 0 ? (
              <ul id={listboxId} role="listbox" aria-label="نتایج جست‌وجوی کالا" className="max-h-[50vh] space-y-1 overflow-y-auto">
                {results.map((item) => (
                  <li
                    key={item.jewelryItemId}
                    role="option"
                    aria-selected={false}
                    onClick={() => add(item)}
                    className="flex min-h-touch cursor-pointer items-center justify-between gap-2 rounded-md px-3 transition-colors hover:bg-accent/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      <span className="block truncate text-xs tabular-nums text-muted-foreground" dir="ltr">
                        {item.code}
                      </span>
                    </span>
                    <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
