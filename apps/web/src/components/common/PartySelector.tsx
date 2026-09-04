import { useEffect, useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Plus, Search, UserRound, X } from 'lucide-react';
import { useParties } from '@/api/queries';
import type { Party, PartyType } from '@/api/contracts';
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
import {
  CreatePartyDialog,
  type CreatePartyDialogVariant,
} from '@/features/parties/CreatePartyDialog';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { maskMobileForDisplay, maskNationalIdForDisplay } from '@/lib/sensitive-identity';
import { cn } from '@/lib/utils';
import { useRecentPartiesStore, type PartySelection } from '@/stores/recent-parties-store';

/**
 * انتخاب‌گر طرف حساب — FE-035.
 *
 * `components/common/` است، نه `features/parties/`، چون هدفش دقیقاً
 * «مشترک بین فرم‌های فروش، خرید و تسویه» است (سه Feature جدا، هنوز
 * هیچ‌کدام ساخته نشده — این component زودتر از مصرف‌کننده‌هایش می‌آید،
 * مثل توابع `core-calc`). با این‌حال `CreatePartyDialog` را مستقیم از
 * `features/parties/` وارد می‌کند — یک استثنای عمدی روی جهت معمول
 * وابستگی (معمولاً Feature از common می‌خواند، نه برعکس)، چون
 * `CreatePartyDialog` دقیقاً همان primitive «ثبت سریع میان‌کار» است که
 * خودش برای همین سناریو ساخته شده (نگاه کنید به کامنت بالای آن فایل) و
 * بازنویسی‌اش اینجا یعنی دو نسخه از یک منطق که ممکن است از هم جدا بیفتند.
 *
 * جست‌وجو با `useParties` است، نه `usePartySearch` (که در کدبیس هیچ
 * مصرف‌کننده‌ای ندارد و یک باگ نهفته دارد: رشته‌ی جست‌وجوی خالی را بدون
 * گارد به سرور واقعی می‌فرستد که با `min(1)` آن را رد می‌کند) — `useParties`
 * از قبل امتحان‌شده است (`PartiesPage`، FE-032) و علاوه‌بر آن فیلتر
 * `status: 'ACTIVE'` هم دارد که این‌جا حیاتی است: طبق قاعده‌ی مستندشده در
 * FE-033، «شخص غیرفعال باید از انتخاب معاملات جدید حذف شود» — همان‌جا
 * این کار به همین‌جا موکول شده بود.
 *
 * «اخیر» یک concept کاملاً سمت کلاینت است (`recent-parties-store.ts`) —
 * هیچ endpoint بک‌اندی برایش وجود ندارد. چون این رونوشت می‌تواند از
 * واقعیت سرور عقب بیفتد (مثلاً شخص بعداً غیرفعال شده)، انتخاب یک ردیف
 * «اخیرِ» غیرفعال هم درست مثل نتیجه‌ی جست‌وجو رد می‌شود — نمایش داده
 * می‌شود (برچسب غیرفعال)، ولی قابل‌انتخاب نیست.
 *
 * «ایجاد شخص جدید داخل Sheet»: عمداً به‌صورت **متوالی** پیاده شده، نه
 * دو دیالوگ تودرتو هم‌زمان — گفت‌وگوی جست‌وجو اول بسته می‌شود، بعد
 * `CreatePartyDialog` باز می‌شود. دو `ResponsiveDialog` واقعاً باز، چون
 * از پورتال رندر می‌شوند، بصری روی هم می‌نشینند و تعامل ناشناخته‌ای با
 * باگ شناخته‌شده‌ی گیرکردن دیالوگ هنگام بسته‌شدن (`FrontTasks.md`، ردیف
 * FE-034) می‌سازند که ارزش ریسکش را نداشت. `onCreated` (تازه به
 * `CreatePartyDialog` اضافه شد) شخص تازه را مستقیم انتخاب می‌کند —
 * دقیقاً همان «تمام است وقتی» این تسک.
 */

const TYPE_LABEL: Record<PartyType, string> = { CONSUMER: 'مصرف‌کننده', BUSINESS: 'همکار' };
const SEARCH_DEBOUNCE_MS = 300;
const MAX_RESULTS = 20;

export type { PartySelection };

export interface PartySelectorProps {
  /** برچسب فیلد — هر مصرف‌کننده متن خودش را می‌دهد («مشتری»، «فروشنده»، «طرف حساب»). */
  label: string;
  value: PartySelection | null;
  onChange: (party: PartySelection | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** فرم inline را برای زمینه‌ی جاری تنظیم می‌کند؛ فروشنده کد ملی اختیاری و نوع ثابت مصرف‌کننده دارد. */
  inlineCreateVariant?: CreatePartyDialogVariant;
}

type PartyCandidate = PartySelection & Partial<Pick<Party, 'nationalId'>>;

/** فقط snapshot حداقلی و امن را به store/caller تحویل می‌دهد؛ propertyهای اضافی پاسخ API نشت نمی‌کنند. */
function toPartySelection(party: PartyCandidate): PartySelection {
  const rawNationalId = party.nationalId;
  return {
    id: party.id,
    displayName: party.displayName,
    mobile: party.mobile,
    nationalIdMasked: rawNationalId
      ? maskNationalIdForDisplay(rawNationalId)
      : (party.nationalIdMasked ?? null),
    type: party.type,
    status: party.status,
  };
}

export function PartySelector({
  label,
  value,
  onChange,
  placeholder = 'انتخاب شخص',
  disabled = false,
  inlineCreateVariant = 'QUICK',
}: PartySelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS).trim();
  const isSearching = debouncedSearch.length > 0;

  const recent = useRecentPartiesStore((s) => s.recent);
  const recordSelection = useRecentPartiesStore((s) => s.recordSelection);

  const searchQuery = useParties(
    {
      status: 'ACTIVE',
      limit: MAX_RESULTS,
      offset: 0,
      ...(isSearching && { search: debouncedSearch }),
    },
    isSearching,
  );

  const results: readonly PartySelection[] = isSearching ? (searchQuery.data?.items ?? []) : recent;

  const listboxId = useId();
  const triggerId = useId();

  // فهرست تازه (جست‌وجوی تازه یا برگشت به «اخیر») همیشه highlight را از صفر شروع می‌کند
  useEffect(() => {
    setHighlightedIndex(0);
  }, [isSearching, results.length]);

  function select(party: PartyCandidate) {
    if (party.status === 'INACTIVE') return; // قاعده‌ی FE-033 — رد خاموش، نه خطا؛ دکمه هم disabled است
    const selection = toPartySelection(party);
    recordSelection(selection);
    onChange(selection);
    setOpen(false);
    setSearch('');
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
      if (target) select(target);
    }
  }

  return (
    <div>
      <label htmlFor={triggerId} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <button
          id={triggerId}
          type="button"
          disabled={disabled}
          onClick={() => {
            setSearch('');
            setOpen(true);
          }}
          className="flex min-h-touch flex-1 cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-start text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {value ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{value.displayName}</span>
              {value.status === 'INACTIVE' ? <Badge variant="secondary">غیرفعال</Badge> : null}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label="پاک‌کردن انتخاب"
            onClick={() => onChange(null)}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{label}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              جست‌وجو کنید یا از فهرست اخیر انتخاب کنید.
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
                aria-activedescendant={
                  results[highlightedIndex] ? `${listboxId}-${results[highlightedIndex].id}` : undefined
                }
                aria-label="جست‌وجوی نام یا موبایل"
                autoComplete="off"
                className="ps-9"
                placeholder="جست‌وجوی نام یا موبایل"
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
              <ErrorState description="جست‌وجو ناموفق بود." onRetry={() => void searchQuery.refetch()} />
            ) : null}
            {isSearching && !searchQuery.isLoading && !searchQuery.isError && results.length === 0 ? (
              <EmptyState icon={UserRound} title="شخصی پیدا نشد" description="با این جست‌وجو نتیجه‌ای نبود." />
            ) : null}
            {!isSearching && results.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                برای جست‌وجو تایپ کنید — هنوز شخصی اخیراً انتخاب نشده.
              </p>
            ) : null}

            {results.length > 0 ? (
              <ul id={listboxId} role="listbox" aria-label={label} className="max-h-[50vh] space-y-1 overflow-y-auto">
                {results.map((party, index) => {
                  const inactive = party.status === 'INACTIVE';
                  const highlighted = index === highlightedIndex;
                  return (
                    // خودِ `option` عنصر کلیک‌پذیر است، نه یک `button` تودرتویش — چون
                    // فوکوس واقعی همیشه روی input جست‌وجو می‌ماند و ردیف‌ها فقط با
                    // `aria-activedescendant` (بالا) «فوکوس مجازی» می‌گیرند، دقیقاً الگوی
                    // استاندارد ARIA combobox. یک `button` تودرتو یک ایست Tab اضافه و
                    // ناخواسته می‌ساخت که آن الگو را می‌شکند.
                    <li
                      key={party.id}
                      id={`${listboxId}-${party.id}`}
                      role="option"
                      aria-selected={highlighted}
                      aria-disabled={inactive}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onClick={() => select(party)}
                      className={cn(
                        'flex min-h-touch items-center justify-between gap-2 rounded-md px-3 transition-colors',
                        inactive ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                        highlighted && !inactive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{party.displayName}</span>
                        {party.mobile ? (
                          <span className="block truncate text-xs tabular-nums text-muted-foreground" dir="ltr">
                            {maskMobileForDisplay(party.mobile)}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {inactive ? <Badge variant="secondary">غیرفعال</Badge> : null}
                        <Badge variant="outline">{TYPE_LABEL[party.type]}</Badge>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              ایجاد شخص جدید
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <CreatePartyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={select}
        variant={inlineCreateVariant}
      />
    </div>
  );
}
