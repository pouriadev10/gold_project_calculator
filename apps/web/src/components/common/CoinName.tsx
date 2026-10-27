import { useCoinTypes } from '@/api/queries';
import { cn } from '@/lib/utils';

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
 * (مثلاً `BAHAR_AZADI_NEW`) را می‌دهد؛ کاربر سکه را با عنوان فارسی‌اش می‌شناسد. عنوان از
 * `GET /inventory/coin-types` (نسخه‌ی مؤثر هر نوع، همان کش فرم‌های سکه) خوانده می‌شود. کد در
 * `title` می‌ماند تا برای پشتیبانی پیدا باشد.
 */
export function CoinName({ coinTypeId, code, className }: CoinNameProps) {
  const { data } = useCoinTypes();
  const title = data?.find((coin) => coin.coinTypeId === coinTypeId)?.title;
  return (
    <bdi className={cn(className)} title={title === undefined ? undefined : code}>
      {title ?? code}
    </bdi>
  );
}
