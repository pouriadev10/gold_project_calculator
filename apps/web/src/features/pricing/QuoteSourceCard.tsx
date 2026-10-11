import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import type { PriceFeedFailure, PriceFeedRefreshResult, PriceQuote, PriceQuoteSource } from '@/api/contracts';
import { refreshPriceFeed } from '@/api/pricing';
import { usePriceFeedStatus } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import { RateDisplay } from '@/components/common/AmountDisplay';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { ErrorState } from '@/components/common/ErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useHasRole } from '@/hooks/useHasRole';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { formatJalaliDateTime, formatJalaliDistance } from '@/lib/date';
import { PRICE_FEED_REFRESH_ROLES } from '@/lib/permissions';

/**
 * منبع مظنه و وضعیت فید — FE-082، روی `GET /pricing/feed/status` و
 * `POST /pricing/feed/refresh`.
 *
 * - **منبع فعال** = منبع آخرین مظنه‌ی ذخیره‌شده؛ فروش و خرید با شناسه‌ی همین
 *   رکورد قیمت می‌خورند (`quoteId`)، پس این کارت دقیقاً همان چیزی را نشان
 *   می‌دهد که فاکتور بعدی استفاده می‌کند.
 * - **وضعیت فید:** پیکربندی بودن adapter و آخرین مظنه‌ای که از فید رسیده.
 * - **fallback:** شکست فید خطا نیست؛ نتیجه می‌گوید کدام مظنه‌ی ذخیره‌شده
 *   همچنان معتبر است، یا اینکه باید دستی ثبت شود (فرم پایین همین صفحه).
 * - **عدم وابستگی فروش:** هیچ فرم فروشی این کارت یا فید را صدا نمی‌زند؛ قطع
 *   فید فقط یعنی مظنه‌ی تازه از آن نمی‌آید.
 */

const SOURCE_LABEL: Record<PriceQuoteSource, string> = { MANUAL: 'دستی', FEED: 'فید' };

const FAILURE_LABEL: Record<PriceFeedFailure, string> = {
  NOT_CONFIGURED: 'هیچ فیدی پیکربندی نشده است',
  PROVIDER_ERROR: 'منبع فید پاسخ معتبر نداد',
  PROVIDER_TIMEOUT: 'منبع فید در زمان مقرر پاسخ نداد',
};

function QuoteLine({ label, quote, empty }: { label: string; quote: PriceQuote | null; empty: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-end">
        {quote ? (
          <div className="space-y-0.5">
            <RateDisplay value={quote.amountRial} size="sm" />
            <p className="text-xs text-muted-foreground tabular-nums">
              {formatJalaliDateTime(new Date(quote.observedAt))} · {formatJalaliDistance(new Date(quote.observedAt))}
            </p>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{empty}</span>
        )}
      </dd>
    </div>
  );
}

function RefreshOutcome({ result }: { result: PriceFeedRefreshResult }) {
  if (result.outcome === 'FEED') {
    return <p className="text-sm font-medium">مظنه‌ی تازه از فید ذخیره شد و از همین لحظه مبنای معامله‌هاست.</p>;
  }
  if (result.outcome === 'FALLBACK') {
    return (
      <p className="text-sm leading-6">
        {FAILURE_LABEL[result.failure]}. آخرین مظنه‌ی ذخیره‌شده (منبع {SOURCE_LABEL[result.quote.source]}،{' '}
        {formatJalaliDateTime(new Date(result.quote.observedAt))}) همچنان مبنای فروش و خرید است.
      </p>
    );
  }
  return (
    <p className="text-sm leading-6 text-destructive">
      {FAILURE_LABEL[result.failure]} و هیچ مظنه‌ی ذخیره‌شده‌ای هم نیست؛ مظنه را با فرم پایین دستی ثبت کنید.
    </p>
  );
}

export function QuoteSourceCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = usePriceFeedStatus('MAZNEH');
  const canRefresh = useHasRole(PRICE_FEED_REFRESH_ROLES);
  const [result, setResult] = useState<PriceFeedRefreshResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { submit, isSubmitting, reset } = useIdempotentSubmit((key: string) => refreshPriceFeed(key));

  async function refresh(): Promise<void> {
    setError(null);
    setResult(null);
    try {
      const outcome = await submit(null);
      if (!outcome) return;
      setResult(outcome);
      // هر «دریافت از فید» تلاش تازه‌ای است؛ کلید فقط تکرارِ همین تلاش را یکی می‌کند.
      reset();
      await queryClient.invalidateQueries({ queryKey: queryKeys.pricing.all() });
    } catch (caught: unknown) {
      setError(caught);
    }
  }

  if (isLoading) return <CardSkeleton lines={4} />;
  if (isError || !data) {
    return <ErrorState description="دریافت وضعیت منبع مظنه ناموفق بود." onRetry={() => void refetch()} />;
  }

  const active = data.activeQuote;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6" aria-label="منبع مظنه">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">منبع مظنه</h2>
          {active ? <Badge variant="secondary">منبع فعال: {SOURCE_LABEL[active.source]}</Badge> : null}
        </div>

        <dl className="space-y-3">
          <QuoteLine
            label="مظنه‌ی فعال (مبنای معامله‌ی بعدی)"
            quote={active}
            empty="هنوز مظنه‌ای ثبت نشده — پیش از اولین فروش، دستی ثبت کنید."
          />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <dt className="text-xs text-muted-foreground">وضعیت فید</dt>
            <dd className="text-sm font-medium">
              {data.providerConfigured ? 'پیکربندی شده' : 'پیکربندی نشده — فقط ورود دستی'}
            </dd>
          </div>
          <QuoteLine label="آخرین مظنه از فید" quote={data.latestFeedQuote} empty="هنوز مظنه‌ای از فید نیامده" />
          <QuoteLine label="آخرین مظنه‌ی دستی" quote={data.latestManualQuote} empty="هنوز مظنه‌ی دستی ثبت نشده" />
        </dl>

        <p className="rounded-md bg-muted/60 p-3 text-xs leading-5 text-muted-foreground" role="note">
          فروش و خرید همیشه با آخرین مظنه‌ی ذخیره‌شده قیمت می‌خورند و به اتصال فید وابسته نیستند. اگر فید قطع
          باشد، همان آخرین مظنه معتبر می‌ماند؛ برای نرخ تازه، مظنه را دستی ثبت کنید.
        </p>

        {canRefresh ? (
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void refresh()}
              disabled={isSubmitting || !data.providerConfigured}
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-4" aria-hidden="true" />
              )}
              دریافت از فید
            </Button>
            {!data.providerConfigured ? (
              <p className="text-xs text-muted-foreground">تا وقتی فیدی پیکربندی نشده، مظنه فقط دستی ثبت می‌شود.</p>
            ) : null}
          </div>
        ) : null}

        <div role="status" aria-live="polite">
          {result ? <RefreshOutcome result={result} /> : null}
        </div>
        {error ? <ApiErrorNotice error={error} /> : null}
      </CardContent>
    </Card>
  );
}
