import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { formatGram, toSafeNumber } from '@gold/core-calc';
import {
  createJewelryItemSchema,
  updateJewelryItemSchema,
  type CreateJewelryItemInput,
  type JewelryItemVersion,
  type JewelryWageType,
  type UpdateJewelryItemInput,
} from '@/api/contracts';
import { createJewelryItem, updateJewelryItem } from '@/api/jewelry-items';
import { queryKeys } from '@/api/query-keys';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { InlineError } from '@/components/common/InlineError';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/common/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { KaratInput } from '@/components/keypad/KaratInput';
import { MoneyInput } from '@/components/keypad/MoneyInput';
import { PercentInput } from '@/components/keypad/PercentInput';
import { WeightInput } from '@/components/keypad/WeightInput';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { toast } from '@/stores/toast-store';

/**
 * فرم ایجاد/ویرایش کالای زیورآلات — FE-036.
 *
 * عمداً فقط شش فیلد اصلی (کد، عنوان، وزن ناخالص، عیار، نوع و مقدار
 * اجرت) دارد — نه نُه فیلد کامل `createJewelryItemSchema`. وزن نگین و
 * سایر کسورات اینجا نیستند، دقیقاً همان مرزی که خودِ `WeightInput`
 * (FE-020) از قبل مستند کرده: «دغدغه‌ی فرم کالای زیورآلات (FE-037) است،
 * نه این کامپوننت پایه». قرارداد واقعی هم این حذف را عمداً پیش‌بینی
 * کرده — `createJewelryItemSchema` این دو فیلد را `.default('0')` دارد،
 * یعنی نفرستادنشان از روز اول یک حالت معتبر و پیش‌بینی‌شده است، نه یک
 * میان‌بر ناقص. پیش‌نمایش وزن خالص اینجا فقط از `WeightInput`ی که خودش
 * می‌سازد می‌آید (بدون کسر نگین) — پیش‌نمایش **دقیق** (با کسورات) کار
 * FE-037 است.
 *
 * اعتبارسنجی مستقیم روی خودِ schema واقعی (`createJewelryItemSchema`/
 * `updateJewelryItemSchema`) اجرا می‌شود، نه یک schema محلی — همان الگوی
 * `ManualQuoteForm.tsx` (FE-030). فیلدهای عددی هم مثل آن‌جا state ساده‌ی
 * خودشان را دارند، نه `react-hook-form`: کامپوننت‌های کیپد (`WeightInput`/
 * `KaratInput`/`MoneyInput`/`PercentInput`) کاملاً controlled با
 * `value`/`onChange` روی `bigint` کار می‌کنند، نه با `register` روی یک
 * ورودی متنی.
 *
 * «کد» فقط در ایجاد قابل‌تایپ است — `updateJewelryItemSchema` اصلاً این
 * فیلد را ندارد چون کد هویت کالاست، نه بخشی از نسخه (`jewelry-items.ts`
 * در `@gold/contracts`، کامنت بالای همان schema). تغییر نوع اجرت مقدار
 * را صفر می‌کند — مقیاس «۳۵۰۰۰۰۰» به‌عنوان درصد بی‌معناست.
 *
 * ⚠️ این کامپوننت خودش `<NumericKeypad />` رندر **نمی‌کند**. آن استور
 * (`keypad-store.ts`) سراسری است؛ اگر هر مصرف‌کننده‌ی این دیالوگ خودش
 * هم یک نمونه بسازد، وقتی چند نمونه هم‌زمان mount باشند (این دیالوگ +
 * صفحه‌ای که آن را باز می‌کند) کیپد دوبار رندر می‌شود. هر صفحه‌ای که این
 * دیالوگ را استفاده می‌کند باید خودش **دقیقاً یک** `<NumericKeypad />`
 * جایی در درخت داشته باشد (نمونه: `JewelryItemsPage.tsx`). کیپد با
 * `z-[60]` (بالاتر از `z-50` دیالوگ‌ها، `NumericKeypad.tsx`) رندر
 * می‌شود، پس حتی اگر بیرون از پورتال این دیالوگ باشد باز هم رویش دیده
 * می‌شود.
 */

const WAGE_TYPE_LABEL: Record<JewelryWageType, string> = {
  PER_GRAM: 'ریال به ازای هر گرم',
  PERCENT_X100: 'درصدی از ارزش طلا',
  FLAT: 'مبلغ ثابت',
};

export interface JewelryItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** نبود = ایجاد؛ حضور = ویرایش همین کالا. */
  item?: JewelryItemVersion;
}

export function JewelryItemFormDialog({ open, onOpenChange, item }: JewelryItemFormDialogProps) {
  const isEdit = item !== undefined;
  const queryClient = useQueryClient();

  const [code, setCode] = useState(item?.code ?? '');
  const [title, setTitle] = useState(item?.title ?? '');
  const [grossWeightMg, setGrossWeightMg] = useState(item ? BigInt(item.grossWeightMg) : 0n);
  const [karat, setKarat] = useState(item ? BigInt(item.karat) : 0n);
  const [wageType, setWageType] = useState<JewelryWageType>(item?.wageType ?? 'PER_GRAM');
  const [wageValue, setWageValue] = useState(item ? BigInt(item.wageValue) : 0n);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const trimmedCode = code.trim();
  const trimmedTitle = title.trim();

  const validation = isEdit
    ? updateJewelryItemSchema.safeParse({
        title: trimmedTitle,
        grossWeightMg: grossWeightMg.toString(),
        karat: toSafeNumber(karat),
        wageType,
        wageValue: wageValue.toString(),
      } satisfies UpdateJewelryItemInput)
    : // بدون `satisfies CreateJewelryItemInput`: آن نوع **پس از** اعمال پیش‌فرض‌های
      // zod است (`stoneWeightMg`/`otherDeductionWeightMg` همیشه رشته‌اند)، ولی اینجا
      // عمداً نفرستادنشان به خودِ schema سپرده می‌شود — دقیقاً همان چیزی که
      // `createJewelryItemSchema`ی واقعی هم برایش `.default('0')` گذاشته.
      createJewelryItemSchema.safeParse({
        code: trimmedCode,
        title: trimmedTitle,
        grossWeightMg: grossWeightMg.toString(),
        karat: toSafeNumber(karat),
        wageType,
        wageValue: wageValue.toString(),
      });

  const { submit, isSubmitting, reset: resetKey } = useIdempotentSubmit((key: string) => {
    // در عمل هرگز رخ نمی‌دهد — دکمه‌ی ثبت تا وقتی validation.success نشود disabled است؛
    // این فقط برای narrow کردن نوع `validation.data` به TypeScript لازم است.
    if (!validation.success) throw new Error('فرم نامعتبر است');
    return isEdit
      ? updateJewelryItem(item.jewelryItemId, validation.data as UpdateJewelryItemInput, key)
      : createJewelryItem(validation.data as CreateJewelryItemInput, key);
  });

  const resetForm = () => {
    setCode(item?.code ?? '');
    setTitle(item?.title ?? '');
    setGrossWeightMg(item ? BigInt(item.grossWeightMg) : 0n);
    setKarat(item ? BigInt(item.karat) : 0n);
    setWageType(item?.wageType ?? 'PER_GRAM');
    setWageValue(item ? BigInt(item.wageValue) : 0n);
    setSubmitError(null);
  };

  const close = () => {
    if (isSubmitting) return;
    onOpenChange(false);
    resetForm();
  };

  const onWageTypeChange = (next: JewelryWageType) => {
    setWageType(next);
    // مقیاس مقدار قبلی برای نوع تازه بی‌معناست — «۳٬۵۰۰٬۰۰۰» به‌عنوان درصد یعنی ۳۵۰۰۰٪
    setWageValue(0n);
  };

  const onSubmit = async () => {
    setSubmitError(null);
    if (!validation.success) return;
    try {
      const result = await submit(undefined);
      if (!result) return; // ضربه‌ی دوم حین ارسال قبلی — بی‌اثر، نه خطا

      await queryClient.invalidateQueries({ queryKey: queryKeys.jewelryItems.all() });
      toast.success(isEdit ? 'کالا ویرایش شد' : 'کالا ثبت شد', result.title);
      resetKey();
      onOpenChange(false);
      resetForm();
    } catch (error) {
      // گفت‌وگو عمداً باز می‌ماند — کاربر باید بدون از دست دادن ورودی دوباره تلاش کند
      setSubmitError(error);
    }
  };

  const pureMgPreview =
    grossWeightMg > 0n && karat >= 1n && karat <= 1000n
      ? (grossWeightMg * karat) / 1000n
      : undefined;

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEdit ? 'ویرایش کالا' : 'کالای جدید'}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {isEdit
              ? 'تغییر وزن، عیار یا اجرت یک نسخه‌ی تازه می‌سازد — نسخه‌ی قبلی و فاکتورهای قدیمی دست‌نخورده می‌مانند.'
              : 'وزن نگین و سایر کسورات را می‌شود بعداً از فرم کامل کالا اضافه کرد.'}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4">
          <div>
            <label htmlFor="jewelry-code" className="mb-1.5 block text-sm font-medium">
              کد کالا
            </label>
            <Input
              id="jewelry-code"
              autoComplete="off"
              disabled={isSubmitting || isEdit}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            {isEdit ? (
              <p className="mt-1 text-xs text-muted-foreground">کد بعد از ایجاد قابل‌تغییر نیست.</p>
            ) : null}
          </div>

          <div>
            <label htmlFor="jewelry-title" className="mb-1.5 block text-sm font-medium">
              عنوان
            </label>
            <Input
              id="jewelry-title"
              autoComplete="off"
              disabled={isSubmitting}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <WeightInput
            label="وزن ناخالص"
            value={grossWeightMg}
            onChange={setGrossWeightMg}
            karat={karat}
            disabled={isSubmitting}
          />

          <KaratInput label="عیار" value={karat} onChange={setKarat} disabled={isSubmitting} />

          <div>
            <label htmlFor="jewelry-wage-type" className="mb-1.5 block text-sm font-medium">
              نوع اجرت
            </label>
            <Select
              id="jewelry-wage-type"
              disabled={isSubmitting}
              value={wageType}
              onChange={(event) => onWageTypeChange(event.target.value as JewelryWageType)}
            >
              {Object.entries(WAGE_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          {wageType === 'PERCENT_X100' ? (
            <PercentInput label="مقدار اجرت" value={wageValue} onChange={setWageValue} disabled={isSubmitting} />
          ) : (
            <MoneyInput
              label="مقدار اجرت"
              value={wageValue}
              onChange={setWageValue}
              {...(wageType === 'PER_GRAM' && { hint: 'به ازای هر گرم وزن مشمول' })}
              disabled={isSubmitting}
            />
          )}

          {pureMgPreview !== undefined ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              وزن خالص (بدون کسر نگین): {formatGram(pureMgPreview)}
            </p>
          ) : null}

          {!validation.success && (trimmedCode || trimmedTitle || grossWeightMg > 0n) ? (
            <InlineError message={validation.error.issues[0]?.message ?? 'مقادیر فرم معتبر نیست'} />
          ) : null}

          {submitError ? <ApiErrorNotice error={submitError} /> : null}
        </div>

        <ResponsiveDialogFooter>
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={close}>
            انصراف
          </Button>
          <Button type="button" disabled={isSubmitting || !validation.success} onClick={() => void onSubmit()}>
            {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {isEdit ? 'ذخیره تغییرات' : 'ثبت کالا'}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
