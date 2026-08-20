import { useEffect, useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Gem, Plus, Search, X } from 'lucide-react';
import { formatCount, formatGram, formatKarat, toSafeNumber } from '@gold/core-calc';
import { generateUuid } from '@/api/client';
import { useInventoryBalances, useJewelryItems } from '@/api/queries';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WeightInput } from '@/components/keypad/WeightInput';
import { KaratInput } from '@/components/keypad/KaratInput';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { normalizeTextForStorage } from '@/lib/persian-text';
import { cn } from '@/lib/utils';
import { useRecentJewelryItemsStore, type RecentJewelryItem } from '@/stores/recent-jewelry-items-store';
import type { SaleDraftItemLine } from '@/stores/sale-draft-store';

/**
 * انتخاب‌گر کالای فروش زیورآلات — FE-042.
 *
 * الگوی جست‌وجو+اخیر+کیبورد دقیقاً از `PartySelector` (FE-035) وام
 * گرفته شده؛ الگوی «چندانتخابی، گفت‌وگو بعد از افزودن باز می‌ماند» از
 * `JewelryLineSelector` (FE-039). با این‌حال یک کپی از هیچ‌کدام نیست:
 *
 * - برخلاف `JewelryLineSelector` (که هر کالا را با «تعداد» دِدوپ
 *   می‌کند)، اینجا انتخاب دوباره‌ی همان کالا یک **ردیف تازه** می‌سازد،
 *   نه افزایش تعداد یک ردیف. نتایج جست‌وجو هم کالای از‌قبل‌انتخاب‌شده
 *   را حذف نمی‌کنند. دلیل در `sale-draft-store.ts` (`SaleDraftItemLine`)
 *   مستند است: هر ردیف یک قطعه‌ی فیزیکی مجزاست، چون قرارداد واقعی
 *   فروش اصلاً فیلد تعداد ندارد.
 * - «کالای موردی»: بخش پایینی گفت‌وگو، همیشه در دسترس (نه پشت یک
 *   toggle) چون هدف صریح تسک «ورود سریع» است. هیچ معادل بک‌اندی برای
 *   این مفهوم وجود ندارد — جزئیات در `SaleDraftItemLine` مستند است.
 * - «نمایش موجودی»: `GET /inventory/balances?itemType=JEWELRY` با
 *   همان الگوی ادغام `CoinInventoryPage` (FE-038) — کالای بدون حرکت
 *   اصلاً در پاسخ نیست، نه اینکه صفر باشد. عدد نمایش‌داده‌شده علاوه‌بر
 *   آن، تعداد همان کالا که همین حالا در سبد این فروش است را هم کم
 *   می‌کند (`remainingStock`) — یک محاسبه‌ی نمایشی محض (تفریق عدد صحیح)،
 *   نه منطق حسابداری؛ مانده‌ی واقعی همیشه سمت سرور در لحظه‌ی ثبت
 *   بررسی می‌شود.
 */

const SEARCH_DEBOUNCE_MS = 300;
const MAX_RESULTS = 20;

interface JewelryResultRow {
  readonly jewelryItemId: string;
  readonly code: string;
  readonly title: string;
  readonly grossWeightMg: string;
  readonly karat: number;
  readonly active: boolean;
}

function toResultRow(item: RecentJewelryItem): JewelryResultRow {
  return item;
}

export interface JewelryItemSelectorProps {
  items: readonly SaleDraftItemLine[];
  onChange: (items: readonly SaleDraftItemLine[]) => void;
  disabled?: boolean;
}

export function JewelryItemSelector({ items, onChange, disabled = false }: JewelryItemSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [adhocTitle, setAdhocTitle] = useState('');
  const [adhocCode, setAdhocCode] = useState('');
  const [adhocWeight, setAdhocWeight] = useState(0n);
  const [adhocKarat, setAdhocKarat] = useState(0n);

  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS).trim();
  const isSearching = debouncedSearch.length > 0;

  const recent = useRecentJewelryItemsStore((s) => s.recent);
  const recordSelection = useRecentJewelryItemsStore((s) => s.recordSelection);
  const balancesQuery = useInventoryBalances('JEWELRY');

  const searchQuery = useJewelryItems(
    {
      active: true,
      limit: MAX_RESULTS,
      offset: 0,
      ...(isSearching && { search: debouncedSearch }),
    },
    isSearching,
  );

  const results: readonly JewelryResultRow[] = isSearching
    ? (searchQuery.data?.items ?? []).map((item) => ({
        jewelryItemId: item.jewelryItemId,
        code: item.code,
        title: item.title,
        grossWeightMg: item.grossWeightMg,
        karat: item.karat,
        active: item.active,
      }))
    : recent.map(toResultRow);

  const listboxId = useId();

  // فهرست تازه (جست‌وجوی تازه یا برگشت به «اخیر») همیشه highlight را از صفر شروع می‌کند
  useEffect(() => {
    setHighlightedIndex(0);
  }, [isSearching, results.length]);

  function remainingStock(jewelryItemId: string): number | undefined {
    if (!balancesQuery.data) return undefined;
    const balance = balancesQuery.data.find((b) => b.itemId === jewelryItemId);
    const countInCart = items.filter(
      (line) => line.kind === 'CATALOG' && line.jewelryItemId === jewelryItemId,
    ).length;
    return (balance ? toSafeNumber(BigInt(balance.quantity)) : 0) - countInCart;
  }

  function addCatalogItem(row: JewelryResultRow) {
    if (!row.active) return; // قاعده‌ی این تسک — رد خاموش، نه خطا؛ ردیف هم disabled است
    recordSelection({
      jewelryItemId: row.jewelryItemId,
      code: row.code,
      title: row.title,
      grossWeightMg: row.grossWeightMg,
      karat: row.karat,
      active: row.active,
    });
    onChange([
      ...items,
      { lineId: generateUuid(), kind: 'CATALOG', jewelryItemId: row.jewelryItemId, code: row.code, title: row.title },
    ]);
    // گفت‌وگو باز می‌ماند — چندانتخابی، همان الگوی JewelryLineSelector
  }

  const adhocValid = adhocTitle.trim().length > 0 && adhocWeight > 0n && adhocKarat >= 1n && adhocKarat <= 1000n;

  function addAdhocItem() {
    if (!adhocValid) return;
    onChange([
      ...items,
      {
        lineId: generateUuid(),
        kind: 'ADHOC',
        jewelryItemId: null,
        code: adhocCode.trim(),
        title: normalizeTextForStorage(adhocTitle.trim()),
        grossWeightMg: adhocWeight.toString(),
        karat: toSafeNumber(adhocKarat),
      },
    ]);
    setAdhocTitle('');
    setAdhocCode('');
    setAdhocWeight(0n);
    setAdhocKarat(0n);
  }

  function removeLine(lineId: string) {
    onChange(items.filter((line) => line.lineId !== lineId));
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[highlightedIndex];
      if (target) addCatalogItem(target);
    }
  }

  return (
    <div className="space-y-3">
      <Button type="button" variant="outline" className="w-full" disabled={disabled} onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden="true" />
        افزودن کالا
      </Button>

      {items.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">هنوز کالایی برای فروش انتخاب نشده.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((line) => (
            <li
              key={line.lineId}
              className="flex items-center justify-between gap-2 rounded-lg border border-border p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm font-medium">{line.title}</p>
                {line.code ? (
                  <p className="truncate text-xs tabular-nums text-muted-foreground" dir="ltr">
                    {line.code}
                  </p>
                ) : null}
                {line.kind === 'ADHOC' ? (
                  <p className="tabular-nums text-xs text-muted-foreground">
                    {formatGram(BigInt(line.grossWeightMg))} — عیار {formatKarat(line.karat)}
                  </p>
                ) : null}
                {line.kind === 'ADHOC' ? <Badge variant="outline">موردی</Badge> : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                aria-label={`حذف ${line.title}`}
                onClick={() => removeLine(line.lineId)}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>افزودن کالا</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              جست‌وجو کنید یا از فهرست اخیر انتخاب کنید — می‌توانید چند قلم پشت‌سرهم اضافه کنید.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="space-y-4">
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
                  aria-activedescendant={
                    results[highlightedIndex] ? `${listboxId}-${results[highlightedIndex].jewelryItemId}` : undefined
                  }
                  aria-label="جست‌وجوی کد یا عنوان"
                  autoComplete="off"
                  className="ps-9"
                  placeholder="جست‌وجوی کد یا عنوان"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={onSearchKeyDown}
                />
              </div>

              {!isSearching && recent.length > 0 ? (
                <p className="px-1 text-xs text-muted-foreground">اخیر</p>
              ) : null}

              {isSearching && searchQuery.isLoading ? <CardSkeleton lines={3} /> : null}
              {isSearching && searchQuery.isError ? (
                <ErrorState description="جست‌وجوی کالا ناموفق بود." onRetry={() => void searchQuery.refetch()} />
              ) : null}
              {isSearching && !searchQuery.isLoading && !searchQuery.isError && results.length === 0 ? (
                <EmptyState icon={Gem} title="کالایی پیدا نشد" description="با این جست‌وجو نتیجه‌ای نبود." />
              ) : null}
              {!isSearching && results.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                  برای جست‌وجو تایپ کنید — هنوز کالایی اخیراً انتخاب نشده.
                </p>
              ) : null}

              {results.length > 0 ? (
                <ul
                  id={listboxId}
                  role="listbox"
                  aria-label="نتایج جست‌وجوی کالا"
                  className="max-h-[40vh] space-y-1 overflow-y-auto"
                >
                  {results.map((row, index) => {
                    const inactive = !row.active;
                    const highlighted = index === highlightedIndex;
                    const stock = remainingStock(row.jewelryItemId);
                    return (
                      // خودِ `option` عنصر کلیک‌پذیر است، نه یک `button` تودرتویش — همان
                      // الگوی استاندارد ARIA combobox که PartySelector (FE-035) مستند کرده.
                      <li
                        key={`${row.jewelryItemId}-${index}`}
                        id={`${listboxId}-${row.jewelryItemId}`}
                        role="option"
                        aria-selected={highlighted}
                        aria-disabled={inactive}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        onClick={() => addCatalogItem(row)}
                        className={cn(
                          'flex min-h-touch items-center justify-between gap-2 rounded-md px-3 py-2 transition-colors',
                          inactive ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                          highlighted && !inactive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{row.title}</span>
                          <span className="block truncate text-xs tabular-nums text-muted-foreground" dir="ltr">
                            {row.code}
                          </span>
                          <span className="block tabular-nums text-xs text-muted-foreground">
                            {formatGram(BigInt(row.grossWeightMg))} — عیار {formatKarat(row.karat)}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          {inactive ? <Badge variant="secondary">غیرفعال</Badge> : null}
                          {stock !== undefined ? (
                            <span
                              className={cn('text-xs tabular-nums', stock <= 0 ? 'text-warning' : 'text-muted-foreground')}
                            >
                              موجودی: {formatCount(stock)}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground">کالای موردی (بدون کد کاتالوگ)</p>
              <Input
                aria-label="عنوان کالای موردی"
                placeholder="عنوان — مثلاً «طلای دست‌دوم مشتری»"
                value={adhocTitle}
                onChange={(event) => setAdhocTitle(event.target.value)}
              />
              <Input
                aria-label="کد کالای موردی (اختیاری)"
                placeholder="کد (اختیاری)"
                dir="ltr"
                value={adhocCode}
                onChange={(event) => setAdhocCode(event.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <WeightInput label="وزن ناخالص" value={adhocWeight} onChange={setAdhocWeight} karat={adhocKarat} />
                <KaratInput label="عیار" value={adhocKarat} onChange={setAdhocKarat} />
              </div>
              <Button type="button" variant="outline" className="w-full" disabled={!adhocValid} onClick={addAdhocItem}>
                <Plus className="size-4" aria-hidden="true" />
                افزودن کالای موردی
              </Button>
            </div>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
