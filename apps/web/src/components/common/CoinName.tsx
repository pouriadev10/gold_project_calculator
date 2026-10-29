import { useMemo } from 'react';
import { useCoinTypes } from '@/api/queries';
import { cn } from '@/lib/utils';

/**
 * عنوان فارسی هر نوع سکه، با کلید `coinTypeId` — از `GET /inventory/coin-types` (نسخه‌ی مؤثر هر
 * نوع، همان کش فرم‌های سکه). تا رسیدن فهرست خالی است؛ مصرف‌کننده کد را به‌جایش نشان می‌دهد.
 * برای جاهایی که متن ساده لازم است، مثل `<option>` (M-32).
 */
export function useCoinTitles(): ReadonlyMap<string, string> {
  const { data } = useCoinTypes();
  return useMemo(() => new Map((data ?? []).map((coin) => [coin.coinTypeId, coin.title] as const)), [data]);
}

export interface CoinNameProps {
  readonly coinTypeId: string;
  /** کد ثابت نوع سکه؛ تا رسیدن فهرست انواع (یا اگر نوع در آن نبود) همین نشان داده می‌شود. */
  readonly code: string;
  readonly className?: string;
}

/**
 * نام نوع سکه برای مانده‌ها و موجودی — M-28، مسئله‌ی #27.
 *
 * قرارداد مانده‌ی اشخاص، گزارش بدهکار/بستانکار و داشبورد فقط `coinTypeId` و `code` ِ ثابت
 * (مثلاً `BAHAR_AZADI_NEW`) را می‌دهد؛ کاربر سکه را با عنوان فارسی‌اش می‌شناسد. کد در `title`
 * می‌ماند تا برای پشتیبانی پیدا باشد.
 */
export function CoinName({ coinTypeId, code, className }: CoinNameProps) {
  const title = useCoinTitles().get(coinTypeId);
  return (
    <bdi className={cn(className)} title={title === undefined ? undefined : code}>
      {title ?? code}
    </bdi>
  );
}
