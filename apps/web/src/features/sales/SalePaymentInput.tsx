import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { dualFromRial, gramRate1000 } from '@gold/core-calc';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MoneyInput } from '@/components/keypad/MoneyInput';
import { useSaleDraftStore } from '@/stores/sale-draft-store';

/**
 * مبلغ پرداختی این فروش — FE-047 («فروش نسیه ساده»).
 *
 * دو حالت، نه بیشتر: **پرداخت کامل** (`paidRial === null`) که فروش را
 * نقدی می‌کند، و **پرداخت ناقص** که هر مبلغی می‌گیرد و فروش را نسیه
 * می‌کند. اقساط، سررسید و چک عمداً وجود ندارند — بخش ۵ CLAUDE.md
 * «چک و نسیه‌ی پیچیده» را صریح بیرون فاز ۱ گذاشته و خودِ BE-042 هم
 * می‌گوید «پیچیدگی چک، قسط‌بندی و سررسیدهای چندگانه ساخته نشود».
 *
 * انتخاب روش پرداخت (نقد/کارت/طلا/سکه) کار FE-050 تا FE-054 است؛ اینجا
 * فقط **چقدر** پرسیده می‌شود، نه **با چه چیزی**.
 *
 * ⚠️ **مبلغ در state محلی نگه داشته می‌شود، نه مستقیم از store.**
 * دادن مقدار store به `value` یک `NumericField` که خودش با `onChange`
 * همان store را می‌نویسد، یک حلقه‌ی رندر می‌سازد: افکت مقداردهی اولیه‌ی
 * `NumericField` بافر کیپد را می‌نویسد، افکت اطلاع‌رسانی `onChange` را
 * صدا می‌زند، store عوض می‌شود، `value` تازه برمی‌گردد و چرخه از نو —
 * تا «Maximum update depth exceeded». پس مبلغ یک بار **سنکرون** در
 * `useState` مقداردهی می‌شود (نه در افکت پس از mount) و از آن به بعد
 * فقط ورودی کاربر عوضش می‌کند؛ store در همان لحظه هم‌زمان به‌روز می‌شود
 * تا `prepareJewelrySale` همیشه عدد جاری را ببیند.
 *
 * ⚠️ **مانده اینجا نهایی نیست.** عددی که زیر فیلد به‌عنوان مانده‌ی
 * تخمینی نشان داده می‌شود از جمع کل پیش‌نمایشی کلاینت می‌آید، و مبلغ
 * واقعی فاکتور را سرور می‌زند (نسخه‌ی کالا + `quoteId`). مانده‌ی قطعی
 * `receivableRial` پاسخ سرور است که روی رسید نشان داده می‌شود — به همین
 * دلیل این عدد صریح «تخمینی» برچسب خورده، نه اینکه بی‌نام رها شود.
 */
export function SalePaymentInput({ previewPayableRial }: { readonly previewPayableRial: bigint | undefined }) {
  const paidRial = useSaleDraftStore((s) => s.paidRial);
  const setPaidRial = useSaleDraftStore((s) => s.setPaidRial);
  const lockedMazneh = useSaleDraftStore((s) => s.lockedMazneh);

  // سنکرون، نه در افکت پس از mount — وگرنه مقدار اولیه بی‌صدا بازنویسی می‌شود
  const [draftPaid, setDraftPaid] = useState(() => (paidRial === null ? 0n : BigInt(paidRial)));

  const isFullPayment = paidRial === null;
  const rate1000 = lockedMazneh ? gramRate1000(BigInt(lockedMazneh.mazneh)) : undefined;
  const paid = isFullPayment ? previewPayableRial : draftPaid;
  const estimatedBalance =
    previewPayableRial !== undefined && paid !== undefined ? previewPayableRial - paid : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">پرداخت</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={isFullPayment ? 'default' : 'outline'}
            aria-pressed={isFullPayment}
            onClick={() => setPaidRial(null)}
          >
            پرداخت کامل
          </Button>
          <Button
            type="button"
            variant={isFullPayment ? 'outline' : 'default'}
            aria-pressed={!isFullPayment}
            // ورود به نسیه از صفر شروع می‌شود، نه از جمع کل: عدد پیش‌پرشده‌ی
            // برابر جمع کل یعنی کاربر باید اول پاکش کند تا بتواند مبلغ واقعی را بزند
            onClick={() => setPaidRial(draftPaid.toString())}
          >
            پرداخت ناقص (نسیه)
          </Button>
        </div>

        {isFullPayment ? (
          <p className="text-xs text-muted-foreground">
            کل مبلغ فاکتور همین حالا دریافت می‌شود و مانده‌ای برای مشتری نمی‌ماند.
          </p>
        ) : (
          <>
            <MoneyInput
              label="مبلغ دریافتی"
              value={draftPaid}
              onChange={(value) => {
                setDraftPaid(value);
                setPaidRial(value.toString());
              }}
              hint="باقی‌مانده به‌عنوان بدهی در حساب همین مشتری ثبت می‌شود."
            />

            {estimatedBalance !== undefined && rate1000 !== undefined ? (
              <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
                <span className="text-sm text-muted-foreground">مانده‌ی تخمینی</span>
                <div className="flex items-center gap-2">
                  <AmountDisplay amount={dualFromRial(estimatedBalance, rate1000)} size="sm" />
                  <span className="text-xs font-medium text-debit">
                    {estimatedBalance > 0n ? 'بدهکار' : estimatedBalance < 0n ? 'بستانکار' : 'تسویه'}
                  </span>
                </div>
              </div>
            ) : null}

            <p className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              این فروش نسیه ثبت می‌شود. مانده‌ی قطعی را سرور تعیین می‌کند و روی رسید نشان داده می‌شود.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
