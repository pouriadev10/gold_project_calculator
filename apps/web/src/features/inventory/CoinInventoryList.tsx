import { Coins } from 'lucide-react';
import {
  bubble,
  dualFromRial,
  formatCoinCount,
  grossUg,
  intrinsicValue,
  karat as toKarat,
  rial,
  type CoinType,
} from '@gold/core-calc';
import type { CoinTypeVersion } from '@/api/contracts';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MoneyInput } from '@/components/keypad/MoneyInput';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * فهرست موجودی سکه — FE-038.
 *
 * برخلاف `JewelryItemList` (FE-036) هیچ صفحه‌بندی یا جست‌وجویی ندارد — تعداد
 * انواع سکه‌ی فاز ۱ ثابت و کم است (تمام است وقتی هم چیزی درباره‌ی
 * صفحه‌بندی نمی‌گوید)، پس همه‌ی ردیف‌ها یک‌جا رندر می‌شوند.
 *
 * «قیمت بازار» فیلدی نوشتنی و **فقط سمت کلاینت** است — در هیچ endpoint‌ی
 * ذخیره نمی‌شود؛ فقط برای پیش‌نمایش زنده‌ی ارزش ذاتی/حباب همین صفحه است
 * (دقیقاً همان طراحی BE-043: «قیمت بازار واقعیت بازار است، از فرمول
 * محاسبه‌پذیر نیست»). ارزش ذاتی نیازی به این ورودی ندارد و همیشه نمایش
 * داده می‌شود (وقتی مظنه موجود باشد)؛ فقط حباب به آن نیاز دارد.
 *
 * قانون حباب (بخش ۲-۳ CLAUDE.md) با نوع اجبار می‌شود: `bubble()` فقط
 * `CentralBankMintedCoinType` می‌پذیرد. `toCoinType` با یک ternary (نه یک
 * object literal با فیلد boolean) دقیقاً همان الگویی است که BE-043 برای
 * همین دلیل استفاده کرد — یک لیترال در هر شاخه لازم است تا TypeScript
 * union را واقعاً narrow کند.
 */

const DESKTOP_QUERY = '(min-width: 640px)';

function toCoinType(version: CoinTypeVersion): CoinType {
  const shared = {
    kind: 'coin' as const,
    id: version.coinTypeId,
    label: version.title,
    grossWeightUg: grossUg(BigInt(version.grossWeightUg)),
    karat: toKarat(version.karat),
  };
  return version.isCentralBankMinted
    ? { ...shared, isCentralBankMinted: true }
    : { ...shared, isCentralBankMinted: false };
}

export interface CoinInventoryRow {
  readonly coinType: CoinTypeVersion;
  /** مانده‌ی جاری — از `GET /inventory/balances` ادغام‌شده؛ نبودن ردیف در پاسخ یعنی صفر. */
  readonly count: number;
}

interface CoinInventoryListProps {
  rows: readonly CoinInventoryRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** نرخ گرم طلای خالص ۱۰۰۰ برای محاسبه‌ی ارزش ذاتی — `undefined` یعنی مظنه هنوز در دسترس نیست. */
  rate1000: bigint | undefined;
  marketPrices: Readonly<Record<string, bigint>>;
  onMarketPriceChange: (coinTypeId: string, value: bigint) => void;
}

function IntrinsicValueCell({ coin, rate1000 }: { coin: CoinType; rate1000: bigint | undefined }) {
  if (rate1000 === undefined) {
    return <span className="text-xs text-muted-foreground">مظنه در دسترس نیست</span>;
  }
  const value = intrinsicValue(coin, rial(rate1000));
  return <AmountDisplay amount={dualFromRial(value, rate1000)} size="sm" />;
}

function BubbleCell({
  coin,
  rate1000,
  marketPrice,
}: {
  coin: CoinType;
  rate1000: bigint | undefined;
  marketPrice: bigint;
}) {
  if (!coin.isCentralBankMinted) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (rate1000 === undefined || marketPrice <= 0n) {
    return <span className="text-xs text-muted-foreground">قیمت بازار را وارد کنید</span>;
  }
  const value = bubble(coin, rial(marketPrice), rial(rate1000));
  return <AmountDisplay amount={dualFromRial(value, rate1000)} signed size="sm" />;
}

/**
 * فقط سکه‌ی بانک مرکزی حباب دارد، و قیمت بازار فقط برای همان محاسبه به
 * کار می‌رود — برای بقیه، خودِ ورودی را هم نشان نمی‌دهیم؛ نگه‌داشتنش
 * یعنی کاربر عددی تایپ می‌کند که هیچ اثری روی صفحه ندارد و توضیحی هم
 * برایش نیست (بخش ۲-۳ CLAUDE.md، همان قاعده‌ای که `BubbleCell` را هم
 * محدود می‌کند).
 */
function MarketPriceCell({
  coin,
  coinTypeId,
  value,
  onChange,
}: {
  coin: CoinType;
  coinTypeId: string;
  value: bigint;
  onChange: (coinTypeId: string, value: bigint) => void;
}) {
  if (!coin.isCentralBankMinted) {
    return <span className="text-xs text-muted-foreground">بی‌ربط — این نوع حباب ندارد</span>;
  }
  return (
    <MoneyInput
      label="قیمت بازار"
      value={value}
      onChange={(next) => onChange(coinTypeId, next)}
      hint="اختیاری — فقط برای پیش‌نمایش، ذخیره نمی‌شود"
      className="min-w-40"
    />
  );
}

export function CoinInventoryList({
  rows,
  isLoading,
  isError,
  onRetry,
  rate1000,
  marketPrices,
  onMarketPriceChange,
}: CoinInventoryListProps) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={3} />
      </div>
    );
  }

  if (isError) {
    return <ErrorState description="دریافت موجودی سکه ناموفق بود." onRetry={onRetry} />;
  }

  if (rows === undefined || rows.length === 0) {
    return (
      <EmptyState
        icon={Coins}
        title="نوع سکه‌ای پیدا نشد"
        description="هنوز هیچ نوع سکه‌ای در سامانه تعریف نشده است."
      />
    );
  }

  if (isDesktop) {
    return (
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>نوع سکه</TableHead>
              <TableHead>تعداد</TableHead>
              <TableHead>قیمت بازار</TableHead>
              <TableHead>ارزش ذاتی</TableHead>
              <TableHead>حباب</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ coinType, count }) => {
              const coin = toCoinType(coinType);
              const marketPrice = marketPrices[coinType.coinTypeId] ?? 0n;
              return (
                <TableRow key={coinType.coinTypeId}>
                  <TableCell className="font-medium">{coinType.title}</TableCell>
                  <TableCell className="tabular-nums">
                    <span className={count < 0 ? 'text-debit' : undefined}>{formatCoinCount(count)}</span>
                  </TableCell>
                  <TableCell>
                    <MarketPriceCell
                      coin={coin}
                      coinTypeId={coinType.coinTypeId}
                      value={marketPrice}
                      onChange={onMarketPriceChange}
                    />
                  </TableCell>
                  <TableCell>
                    <IntrinsicValueCell coin={coin} rate1000={rate1000} />
                  </TableCell>
                  <TableCell>
                    <BubbleCell coin={coin} rate1000={rate1000} marketPrice={marketPrice} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map(({ coinType, count }) => {
        const coin = toCoinType(coinType);
        const marketPrice = marketPrices[coinType.coinTypeId] ?? 0n;
        return (
          <Card key={coinType.coinTypeId}>
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{coinType.title}</p>
                <span className={`tabular-nums text-sm ${count < 0 ? 'text-debit' : ''}`}>
                  {formatCoinCount(count)} عدد
                </span>
              </div>

              <MarketPriceCell
                coin={coin}
                coinTypeId={coinType.coinTypeId}
                value={marketPrice}
                onChange={onMarketPriceChange}
              />

              <div className="flex items-center justify-between gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground">ارزش ذاتی</p>
                  <IntrinsicValueCell coin={coin} rate1000={rate1000} />
                </div>
                <div className="text-end">
                  <p className="text-muted-foreground">حباب</p>
                  <BubbleCell coin={coin} rate1000={rate1000} marketPrice={marketPrice} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
