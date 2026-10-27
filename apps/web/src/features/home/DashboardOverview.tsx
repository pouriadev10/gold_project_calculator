import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { dualFromPure, formatCoinCount, formatCount } from '@gold/core-calc';
import type { Dashboard } from '@/api/contracts';
import { useDashboard } from '@/api/queries';
import { AmountDisplay, RateDisplay } from '@/components/common/AmountDisplay';
import { CoinName } from '@/components/common/CoinName';
import { RetryPanel } from '@/components/common/RetryPanel';
import { Skeleton } from '@/components/ui/skeleton';
import { formatJalaliDateTime } from '@/lib/date';
import { cn } from '@/lib/utils';
import { dashboardAmount, magnitudeOf } from './dashboard-amounts';

/**
 * داشبورد اصلی — FE-074، روی `GET /reporting/dashboard` (BE-059).
 *
 * کارت‌ها: فروش/خرید/دریافت/پرداخت امروز، تعداد فاکتور، بدهکاران،
 * بستانکاران، موجودی آبشده و انواع سکه. مظنه‌ی جاری را `MaznehBar` بالای
 * همین صفحه نشان می‌دهد؛ این‌جا همان مظنه‌ای که معادل‌ها با آن ساخته شده‌اند
 * زیر کارت‌ها نوشته می‌شود.
 *
 * درخواست همیشه با `displayUnit: 'GOLD'` ثابت است (همان کلید کشِ داشبورد
 * موجودی FE-040). چهره‌ی دیگر از مقادیر خام و مظنه‌ی جاری پاسخ ساخته
 * می‌شود، پس کلید طلا/ریال فقط نمایش را عوض می‌کند، بدون درخواست تازه.
 * بدون مظنه‌ی جاری، کارت‌های امروز مقدار خام ریالی را نشان می‌دهند و مانده‌ی
 * اشخاص (که ریال و طلا را با مظنه می‌سنجد) «قابل محاسبه نیست» می‌شود.
 *
 * نقره و شمش در پاسخ سرور نیستند و این‌جا هم ساخته نمی‌شوند. نمودار ندارد.
 * اسکلت دقیقاً همان شبکه و همان ارتفاع کاشی‌ها را دارد تا بارگذاری صفحه
 * را جابه‌جا نکند.
 */

/** ارتفاع ثابت هر کاشی — هم برای اسکلت و هم برای محتوا. */
const TILE = 'min-h-[5.5rem] rounded-lg border border-border bg-card p-3';

function Section({ title, children, caption }: { title: string; children: ReactNode; caption?: ReactNode }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {children}
      {caption ? <p className="text-xs leading-5 text-muted-foreground">{caption}</p> : null}
    </section>
  );
}

function Tile({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn(TILE, 'flex min-w-0 flex-col justify-between gap-2', className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function TodayAmount({ card, dashboard }: { card: Dashboard['today']['sales']; dashboard: Dashboard }) {
  const amount = dashboardAmount(card, dashboard);
  return amount ? (
    <AmountDisplay amount={amount} size="md" className="flex-wrap" />
  ) : (
    <AmountDisplay amount={{ kind: 'raw', value: BigInt(card.raw.rial), unit: 'rial' }} size="md" className="flex-wrap" />
  );
}

function TileLink({ to, children }: { to: '/reporting/debtors' | '/reporting/creditors' | '/inventory'; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-touch cursor-pointer items-center gap-1 rounded-md text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {children}
      <ChevronLeft className="size-4" aria-hidden="true" />
    </Link>
  );
}

function PartyBalanceTile({
  label,
  directionLabel,
  card,
  dashboard,
  to,
}: {
  label: string;
  directionLabel: string;
  card: Dashboard['today']['sales'];
  dashboard: Dashboard;
  to: '/reporting/debtors' | '/reporting/creditors';
}) {
  const amount = dashboardAmount(card, dashboard);
  return (
    <Tile label={label}>
      {amount ? <AmountDisplay amount={magnitudeOf(amount)} size="md" className="flex-wrap" /> : null}
      <p className="text-xs text-muted-foreground">{directionLabel}</p>
      <TileLink to={to}>مشاهده فهرست</TileLink>
    </Tile>
  );
}

export function DashboardOverviewSkeleton() {
  return (
    <div className="space-y-4" aria-label="در حال دریافت داشبورد" aria-busy="true">
      {[4, 2, 2].map((tiles, section) => (
        <div key={section} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: tiles + (section === 0 ? 1 : 0) }, (_, index) => (
              <div key={index} className={cn(TILE, section === 0 && index === tiles && 'col-span-2 lg:col-span-4')}>
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-4 h-6 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardOverview() {
  const { data, isLoading, isError, refetch } = useDashboard('GOLD');

  if (isLoading) return <DashboardOverviewSkeleton />;
  if (isError || data === undefined) {
    return <RetryPanel message="دریافت داشبورد ناموفق بود." onRetry={() => void refetch()} />;
  }

  const rate1000 = data.currentMazneh ? BigInt(data.currentMazneh.goldRatePerGramRial) : null;
  const meltedGoldMg = BigInt(data.inventory.meltedGoldPureMg);

  return (
    <div className="space-y-4">
      <Section
        title="امروز"
        caption={
          <>
            از {formatJalaliDateTime(new Date(data.dayStartsAt))} تا{' '}
            {formatJalaliDateTime(new Date(data.dayEndsAt))}.
            {data.currentMazneh ? null : ' بدون مظنه جاری فقط مبلغ ریالی نمایش داده می‌شود.'}
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="فروش امروز">
            <TodayAmount card={data.today.sales} dashboard={data} />
          </Tile>
          <Tile label="خرید امروز">
            <TodayAmount card={data.today.purchases} dashboard={data} />
          </Tile>
          <Tile label="دریافت امروز">
            <TodayAmount card={data.today.receipts} dashboard={data} />
          </Tile>
          <Tile label="پرداخت امروز">
            <TodayAmount card={data.today.payments} dashboard={data} />
          </Tile>
          <Tile label="تعداد فاکتور امروز" className="col-span-2 lg:col-span-4">
            <p className="text-base font-semibold tabular-nums">
              {formatCount(data.today.invoiceCount)}
              <span className="ms-1 text-xs font-normal text-muted-foreground">فاکتور</span>
            </p>
          </Tile>
        </div>
      </Section>

      <Section
        title="مانده اشخاص"
        caption={data.partyBalances ? 'سکه‌ها در این جمع نیستند؛ مانده هر نوع سکه در صفحه هر شخص جداست.' : undefined}
      >
        {data.partyBalances ? (
          <div className="grid grid-cols-2 gap-3">
            <PartyBalanceTile
              label="بدهکاران"
              directionLabel="طلب فروشگاه از اشخاص"
              card={data.partyBalances.debtors}
              dashboard={data}
              to="/reporting/debtors"
            />
            <PartyBalanceTile
              label="بستانکاران"
              directionLabel="بدهی فروشگاه به اشخاص"
              card={data.partyBalances.creditors}
              dashboard={data}
              to="/reporting/creditors"
            />
          </div>
        ) : (
          <div className={TILE}>
            <p className="text-sm text-muted-foreground">
              بدون مظنه جاری، جمع بدهکاران و بستانکاران قابل محاسبه نیست؛ ریال و طلا فقط با مظنه
              مقایسه‌پذیرند.
            </p>
          </div>
        )}
      </Section>

      <Section title="موجودی">
        <div className="grid grid-cols-2 gap-3">
          <Tile label="موجودی آبشده">
            {rate1000 !== null && rate1000 > 0n ? (
              <AmountDisplay amount={dualFromPure(meltedGoldMg, rate1000)} size="md" className="flex-wrap" />
            ) : (
              <AmountDisplay amount={{ kind: 'raw', value: meltedGoldMg, unit: 'gold' }} size="md" className="flex-wrap" />
            )}
            <TileLink to="/inventory">موجودی</TileLink>
          </Tile>
          <Tile label="موجودی سکه">
            {data.inventory.coins.length === 0 ? (
              <p className="text-sm text-muted-foreground">سکه‌ای موجود نیست</p>
            ) : (
              <ul className="space-y-1" aria-label="موجودی انواع سکه">
                {data.inventory.coins.map((coin) => (
                  <li key={coin.coinTypeId} className="flex items-baseline justify-between gap-2 text-sm">
                    <CoinName coinTypeId={coin.coinTypeId} code={coin.code} className="truncate" />
                    <span className="shrink-0 font-semibold tabular-nums">
                      {formatCoinCount(coin.count)}
                      <span className="ms-1 text-xs font-normal text-muted-foreground">عدد</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Tile>
        </div>
      </Section>

      <p className="text-xs leading-5 text-muted-foreground">
        {data.currentMazneh ? (
          <>
            معادل طلا/ریال با مظنه جاری <RateDisplay value={BigInt(data.currentMazneh.amountRial)} size="sm" /> (
            {formatJalaliDateTime(new Date(data.currentMazneh.observedAt))}) ساخته شده است.
          </>
        ) : (
          'هنوز مظنه‌ای ثبت نشده است؛ معادل طلا/ریال در دسترس نیست.'
        )}
      </p>
    </div>
  );
}
