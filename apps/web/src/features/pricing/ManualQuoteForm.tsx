import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { formatRial } from '@gold/core-calc';
import { priceQuoteAmountRialSchema, type PriceQuote } from '@/api/contracts';
import { createManualPriceQuote } from '@/api/pricing';
import { queryKeys } from '@/api/query-keys';
import { RateDisplay } from '@/components/common/AmountDisplay';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/common/ResponsiveDialog';
import { MoneyInput } from '@/components/keypad/MoneyInput';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { formatJalaliDistance } from '@/lib/date';
import { toast } from '@/stores/toast-store';

/**
 * فرم ثبت مظنه دستی — FE-030.
 *
 * تنها فیلد واقعی «مبلغ مظنه» است. قرارداد `POST /pricing/quotes/manual`
 * (`createManualPriceQuoteSchema` در `@gold/contracts`, `.strict()`) فقط
 * `quoteType` و `amountRial` می‌پذیرد — نه «زمان مشاهده» (سرور خودش
 * `observedAt` را در لحظه‌ی درج می‌سازد، `price-quotes.service.ts`)، نه
 * «توضیح» (چنین ستونی در `price_quotes` اصلاً وجود ندارد). زمان مشاهده
 * پس از ثبت، از پاسخ سرور، به‌عنوان بخشی از نتیجه نمایش داده می‌شود — نه
 * به‌عنوان فیلد ورودی از پیش.
 *
 * «تأیید» با یک گفت‌وگوی جدا پیاده شده، نه یک مرحله‌ی دوم داخل همان فرم:
 * این مقدار پایه‌ی محاسبه‌ی هر فاکتور بعدی می‌شود (بخش ۲-۸ CLAUDE.md)، پس
 * فرصت بازبینی پیش از ارسال قطعی ارزش یک گام جدا را دارد.
 */
export function ManualQuoteForm() {
  const [amount, setAmount] = useState(0n);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [lastRegistered, setLastRegistered] = useState<PriceQuote | null>(null);
  const queryClient = useQueryClient();

  const { submit, isSubmitting, reset } = useIdempotentSubmit((key: string, value: bigint) =>
    createManualPriceQuote(value, key),
  );

  // همان قاعده‌ی priceQuoteAmountRialSchema سرور — رقم دوباره اینجا تعریف نمی‌شود
  const isValid = priceQuoteAmountRialSchema.safeParse(amount.toString()).success;

  const handleAmountChange = (value: bigint) => {
    setAmount(value);
    // مقدار در حال ویرایش است — نتیجه/خطای مربوط به ثبت قبلی دیگر معتبر نیست
    setLastRegistered(null);
    setSubmitError(null);
  };

  const handleConfirm = async () => {
    setSubmitError(null);
    try {
      const quote = await submit(amount);
      if (!quote) return; // ضربه‌ی دوم حین ارسال قبلی — بی‌اثر، نه خطا

      await queryClient.invalidateQueries({ queryKey: queryKeys.pricing.all() });
      toast.success('مظنه ثبت شد', `${formatRial(quote.amountRial)} ریال`);
      setLastRegistered(quote);
      setConfirmOpen(false);
      reset();
    } catch (error) {
      // گفت‌وگو همیشه بسته می‌شود — پیام خطا در صفحه (`ApiErrorNotice`) می‌ماند،
      // نه پشت یک مودال باز که خودش جلوی دیده‌شدنش را می‌گیرد.
      setSubmitError(error);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <MoneyInput
            label="مظنه مثقال"
            value={amount}
            onChange={handleAmountChange}
            hint="این مبلغ از لحظه‌ی ثبت، پایه‌ی محاسبه‌ی فاکتورهای جدید می‌شود."
          />

          {submitError ? <ApiErrorNotice error={submitError} /> : null}

          {lastRegistered ? (
            <div
              role="status"
              className="rounded-lg border border-credit/40 bg-credit/10 p-3 text-sm"
            >
              <p className="font-medium text-credit">مظنه با موفقیت ثبت شد.</p>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-muted-foreground">
                <RateDisplay value={lastRegistered.amountRial} size="sm" />
                <span>— {formatJalaliDistance(new Date(lastRegistered.observedAt))}</span>
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Button type="button" size="action" disabled={!isValid} onClick={() => setConfirmOpen(true)}>
        ثبت مظنه
      </Button>

      <ResponsiveDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          // حین ارسال بسته نشود — نتیجه باید دیده شود، نه گم شود وسط درخواست
          if (!isSubmitting) setConfirmOpen(open);
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>تأیید مظنه</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              این عدد بلافاصله جایگزین مظنه‌ی فعلی می‌شود و مبنای محاسبه‌ی فاکتورهای بعدی خواهد بود.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="rounded-lg bg-muted px-4 py-3">
            <RateDisplay value={amount} size="lg" />
          </div>

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
