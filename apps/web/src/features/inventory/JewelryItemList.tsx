import { ChevronLeft, ChevronRight, Gem, Pencil } from 'lucide-react';
import {
  DIGIT_SPECS,
  bigIntToDigits,
  formatCount,
  formatGram,
  formatKarat,
  formatRial,
  toPersianDigits,
} from '@gold/core-calc';
import type { JewelryItemVersion, JewelryWageType } from '@/api/contracts';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * فهرست کالای زیورآلات — FE-036.
 *
 * الگوی نمایش دقیقاً `PartyList.tsx` (FE-032) را تکرار می‌کند: کارت زیر
 * ۶۴۰px با حداکثر چهار فیلد کلیدی (عنوان، کد، وزن/عیار، اجرت)، جدول از
 * ۶۴۰px به بالا، دکمه‌ی ویرایش بیرون از لینک/محتوای اصلی هر ردیف تا
 * دو عنصر کلیک‌پذیر تودرتو نشوند.
 *
 * «وزن» ستون همیشه وزن **ناخالص** است (`grossWeightMg`) — قرارداد واقعی
 * وزن خالص را اصلاً برنمی‌گرداند (مشتق سه فیلد دیگر و عیار است، محاسبه
 * با `core-calc` در فرم انجام می‌شود، نه اینجا در فهرست).
 */

// باید با tailwind.config.ts → theme.screens.sm هم‌راستا بماند (همان ثابت ResponsiveDialog.tsx)
const DESKTOP_QUERY = '(min-width: 640px)';

/**
 * بدون `Math.ceil` — قاعده‌ی ESLint (بخش ۲-۱ CLAUDE.md) هرجا جز
 * `core-calc/rounding.ts` گرد کردن را خطا می‌دهد.
 */
function ceilDivide(dividend: number, divisor: number): number {
  const remainder = dividend % divisor;
  return remainder === 0 ? dividend / divisor : (dividend - remainder) / divisor + 1;
}

/**
 * نمایش اجرت — با `bigIntToDigits`/`DIGIT_SPECS.percent` همان تبدیل
 * مقیاس ×۱۰۰ کیپد را عبور می‌دهد تا هرگز دو قاعده‌ی گرد کردن جدا برای
 * یک عدد وجود نداشته باشد.
 */
export function formatWage(wageType: JewelryWageType, wageValueRaw: string): string {
  const value = BigInt(wageValueRaw);
  if (wageType === 'PERCENT_X100') {
    const digits = bigIntToDigits(value, DIGIT_SPECS.percent) || '0';
    return `${toPersianDigits(digits.replace('.', '٫'))}٪`;
  }
  return wageType === 'PER_GRAM' ? `${formatRial(value)} ریال/گرم` : `${formatRial(value)} ریال`;
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? null : <Badge variant="secondary">غیرفعال</Badge>;
}

/** دکمه‌ی ویرایش — همیشه بیرون از عنصر اصلیِ ردیف، تا دو عنصر کلیک‌پذیر تودرتو نشوند (همان قاعده‌ی PartyList). */
function EditButton({ item, onEdit }: { item: JewelryItemVersion; onEdit: (item: JewelryItemVersion) => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`ویرایش ${item.title}`}
      onClick={() => onEdit(item)}
    >
      <Pencil className="size-4" aria-hidden="true" />
    </Button>
  );
}

export interface JewelryItemPage {
  items: readonly JewelryItemVersion[];
  total: number;
  limit: number;
  offset: number;
}

interface JewelryItemListProps {
  data: JewelryItemPage | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onOffsetChange: (offset: number) => void;
  onEdit: (item: JewelryItemVersion) => void;
}

export function JewelryItemList({
  data,
  isLoading,
  isError,
  onRetry,
  onOffsetChange,
  onEdit,
}: JewelryItemListProps) {
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
    return <ErrorState description="دریافت فهرست کالا ناموفق بود." onRetry={onRetry} />;
  }

  if (data === undefined || data.items.length === 0) {
    return (
      <EmptyState
        icon={Gem}
        title="کالایی پیدا نشد"
        description="با این فیلترها کالایی ثبت نشده — فیلترها را تغییر دهید یا کالای تازه اضافه کنید."
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
                <TableHead>کد</TableHead>
                <TableHead>عنوان</TableHead>
                <TableHead>وزن</TableHead>
                <TableHead>عیار</TableHead>
                <TableHead>اجرت</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead className="w-0">
                  <span className="sr-only">عملیات</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => (
                <TableRow key={item.jewelryItemId}>
                  <TableCell className="tabular-nums" dir="ltr">
                    {item.code}
                  </TableCell>
                  <TableCell className="font-medium">{item.title}</TableCell>
                  <TableCell className="tabular-nums">{formatGram(BigInt(item.grossWeightMg))}</TableCell>
                  <TableCell className="tabular-nums">{formatKarat(item.karat)}</TableCell>
                  <TableCell className="tabular-nums">{formatWage(item.wageType, item.wageValue)}</TableCell>
                  <TableCell>
                    <StatusBadge active={item.active} />
                  </TableCell>
                  <TableCell>
                    <EditButton item={item} onEdit={onEdit} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="space-y-2">
          {data.items.map((item) => (
            <Card key={item.jewelryItemId}>
              <CardContent className="flex items-center gap-3 pt-6">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate font-medium">{item.title}</p>
                  <p className="truncate text-xs tabular-nums text-muted-foreground" dir="ltr">
                    {item.code}
                  </p>
                  <p className="tabular-nums text-xs text-muted-foreground">
                    {formatGram(BigInt(item.grossWeightMg))} — عیار {formatKarat(item.karat)}
                  </p>
                  <p className="tabular-nums text-xs text-muted-foreground">
                    {formatWage(item.wageType, item.wageValue)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <StatusBadge active={item.active} />
                  <EditButton item={item} onEdit={onEdit} />
                </div>
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
