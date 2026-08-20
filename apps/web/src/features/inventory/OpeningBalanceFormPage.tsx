import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { formatCoinCount, formatGram, toSafeNumber } from '@gold/core-calc';
import { useCoinTypes } from '@/api/queries';
import { createOpeningBalance } from '@/api/opening-balances';
import { queryKeys } from '@/api/query-keys';
import type { CreateOpeningBalanceInput, OpeningBalance, OpeningBalanceLine } from '@/api/contracts';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/common/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { CountInput } from '@/components/keypad/CountInput';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { WeightInput } from '@/components/keypad/WeightInput';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { toast } from '@/stores/toast-store';
import { JewelryLineSelector, type SelectedJewelryLine } from './JewelryLineSelector';

/**
 * ثبت موجودی افتتاحیه — FE-039.
 *
 * فقط OWNER/MANAGER به این مسیر می‌رسند (`beforeLoad: requireRole` در
 * `router.tsx`) — این کامپوننت خودش دوباره نقش را چک نمی‌کند، چون تا
 * وقتی مانت شود کاربر از قبل مجاز است. مرز امنیتی واقعی همیشه سرور است
 * (`@Roles('OWNER', 'MANAGER')` روی خودِ endpoint).
 *
 * **تغییرناپذیر**: سند ثبت‌شده هیچ endpoint ویرایش یا حذفی ندارد (بخش
 * ۲-۷ CLAUDE.md) — به همین دلیل گفت‌وگوی تأیید هشدار صریح دارد، نه فقط
 * یک خلاصه‌ی خنثی مثل `ManualQuoteForm`.
 *
 * `effectiveAt` را خودِ فرم انتخاب نمی‌کند — «قابلیت‌ها»ی این تسک انتخاب
 * تاریخ را نمی‌خواهد (برخلاف مبلغ/تعداد/کالا) و ساخت یک ورودی تاریخ
 * جلالی سفارشی کار این تسک نیست (`lib/date.ts` عمداً `date-fns-jalali`
 * را از بسته‌ی production بیرون نگه می‌دارد). لحظه‌ی ارسال («همین حالا»)
 * به‌عنوان لحظه‌ی مؤثر فرستاده می‌شود.
 *
 * هر سه بخش (زیورآلات/آبشده/سکه) اختیاری‌اند — فقط مجموع خط‌ها نباید صفر
 * باشد (`createOpeningBalanceSchema.lines.min(1)`). خط‌های با تعداد صفر
 * اصلاً به بدنه‌ی درخواست نمی‌روند، نه اینکه رد شوند: `positiveBigIntStringSchema`
 * سرور صفر را قبول نمی‌کند.
 */

const DESCRIPTION_MAX = 2_000;

function buildLines(
  jewelryLines: readonly SelectedJewelryLine[],
  meltedGoldMg: bigint,
  coinCounts: Readonly<Record<string, bigint>>,
): OpeningBalanceLine[] {
  const lines: OpeningBalanceLine[] = [];

  for (const line of jewelryLines) {
    if (line.quantity > 0n) {
      lines.push({ itemType: 'JEWELRY', itemId: line.jewelryItemId, quantity: line.quantity.toString() });
    }
  }
  if (meltedGoldMg > 0n) {
    lines.push({ itemType: 'MELTED_GOLD', quantity: meltedGoldMg.toString() });
  }
  for (const [coinTypeId, count] of Object.entries(coinCounts)) {
    if (count > 0n) {
      lines.push({ itemType: 'COIN', itemId: coinTypeId, quantity: count.toString() });
    }
  }

  return lines;
}

export default function OpeningBalanceFormPage() {
  const queryClient = useQueryClient();
  const coinTypesQuery = useCoinTypes();

  const [jewelryLines, setJewelryLines] = useState<readonly SelectedJewelryLine[]>([]);
  const [meltedGoldMg, setMeltedGoldMg] = useState(0n);
  const [coinCounts, setCoinCounts] = useState<Record<string, bigint>>({});
  const [description, setDescription] = useState('موجودی افتتاحیه');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [lastRegistered, setLastRegistered] = useState<OpeningBalance | null>(null);

  const { submit, isSubmitting, reset } = useIdempotentSubmit((key: string, input: CreateOpeningBalanceInput) =>
    createOpeningBalance(input, key),
  );

  const lines = useMemo(
    () => buildLines(jewelryLines, meltedGoldMg, coinCounts),
    [jewelryLines, meltedGoldMg, coinCounts],
  );
  const trimmedDescription = description.trim();
  const descriptionValid = trimmedDescription.length > 0 && trimmedDescription.length <= DESCRIPTION_MAX;
  const canSubmit = lines.length > 0 && descriptionValid;

  const jewelryPieceCount = jewelryLines.reduce((sum, l) => sum + (l.quantity > 0n ? l.quantity : 0n), 0n);
  const coinLineCount = Object.values(coinCounts).filter((c) => c > 0n).length;
  const coinTotalCount = Object.values(coinCounts).reduce((sum, c) => sum + (c > 0n ? c : 0n), 0n);

  const handleConfirm = async () => {
    setSubmitError(null);
    try {
      const input: CreateOpeningBalanceInput = {
        effectiveAt: new Date().toISOString(),
        description: trimmedDescription,
        lines,
      };
      const created = await submit(input);
      if (!created) return; // ضربه‌ی دوم حین ارسال قبلی — بی‌اثر، نه خطا

      await queryClient.invalidateQueries({ queryKey: queryKeys.inventoryBalances.all() });
      toast.success('موجودی افتتاحیه ثبت شد', created.description);
      setLastRegistered(created);
      setConfirmOpen(false);
      reset();
      setJewelryLines([]);
      setMeltedGoldMg(0n);
      setCoinCounts({});
      setDescription('موجودی افتتاحیه');
    } catch (error) {
      // گفت‌وگو بسته می‌شود ولی فرم دست‌نخورده می‌ماند — کاربر نباید ورودی‌های
      // دقیق (چند قلم زیورآلات، چند نوع سکه) را دوباره از صفر بسازد
      setSubmitError(error);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="ثبت موجودی افتتاحیه" />

      <div className="flex-1 space-y-4 p-4 pb-nav">
        {lastRegistered ? (
          <div role="status" className="rounded-lg border border-credit/40 bg-credit/10 p-3 text-sm">
            <p className="font-medium text-credit">موجودی افتتاحیه با موفقیت ثبت شد.</p>
            <p className="mt-1 text-muted-foreground">{lastRegistered.description}</p>
          </div>
        ) : null}

        {submitError ? <ApiErrorNotice error={submitError} /> : null}

        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-semibold">کالای زیورآلات</h2>
            <JewelryLineSelector lines={jewelryLines} onChange={setJewelryLines} disabled={isSubmitting} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-semibold">وزن آبشده</h2>
            <WeightInput
              label="وزن آبشده (طلای خالص ۱۰۰۰)"
              value={meltedGoldMg}
              onChange={setMeltedGoldMg}
              disabled={isSubmitting}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-semibold">تعداد انواع سکه</h2>
            {coinTypesQuery.isLoading ? <CardSkeleton lines={2} /> : null}
            {coinTypesQuery.isError ? (
              <ErrorState description="دریافت انواع سکه ناموفق بود." onRetry={() => void coinTypesQuery.refetch()} />
            ) : null}
            {coinTypesQuery.data
              ?.filter((coinType) => coinType.active)
              .map((coinType) => (
                <CountInput
                  key={coinType.coinTypeId}
                  label={coinType.title}
                  value={coinCounts[coinType.coinTypeId] ?? 0n}
                  onChange={(next) =>
                    setCoinCounts((prev) => ({ ...prev, [coinType.coinTypeId]: next }))
                  }
                  disabled={isSubmitting}
                />
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 pt-6">
            <label htmlFor="opening-balance-description" className="block text-sm font-semibold">
              توضیحات
            </label>
            <Textarea
              id="opening-balance-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={isSubmitting}
              maxLength={DESCRIPTION_MAX}
            />
          </CardContent>
        </Card>

        <Button
          type="button"
          size="action"
          disabled={!canSubmit || isSubmitting}
          onClick={() => setConfirmOpen(true)}
        >
          مرور و ثبت موجودی افتتاحیه
        </Button>
      </div>

      <ResponsiveDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          // حین ارسال بسته نشود — نتیجه باید دیده شود، نه گم شود وسط درخواست
          if (!isSubmitting) setConfirmOpen(open);
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>تأیید نهایی موجودی افتتاحیه</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              این خلاصه را با دقت مرور کنید — بعد از تأیید، سند ساخته می‌شود.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              این سند پس از ثبت هرگز قابل ویرایش یا حذف نیست. اصلاح احتمالی فقط با یک سند جدید و جداگانه
              ممکن است.
            </p>
          </div>

          <dl className="space-y-2 rounded-lg bg-muted p-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">کالای زیورآلات</dt>
              <dd className="tabular-nums">
                {formatCoinCount(jewelryLines.filter((l) => l.quantity > 0n).length)} قلم ·{' '}
                {formatCoinCount(toSafeNumber(jewelryPieceCount))} عدد
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">وزن آبشده</dt>
              <dd className="tabular-nums">{formatGram(meltedGoldMg)} گرم</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">انواع سکه</dt>
              <dd className="tabular-nums">
                {formatCoinCount(coinLineCount)} نوع · {formatCoinCount(toSafeNumber(coinTotalCount))} عدد
              </dd>
            </div>
          </dl>

          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setConfirmOpen(false)}
            >
              انصراف
            </Button>
            <Button type="button" disabled={isSubmitting} onClick={() => void handleConfirm()}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              تأیید و ثبت
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <NumericKeypad />
    </div>
  );
}
