import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { createParty } from '@/api/parties';
import { queryKeys } from '@/api/query-keys';
import type { CreatePartyInput, Party, PartyType } from '@/api/contracts';
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
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { normalizedInput } from '@/lib/persian-text';
import { toast } from '@/stores/toast-store';

/**
 * ثبت سریع شخص — FE-032.
 *
 * در حالت پیش‌فرض فقط سه فیلد سریع نوع، نام و موبایل اختیاری را نشان می‌دهد.
 * حالت `SELLER` برای مرحله‌ی فروشنده‌ی خرید دست‌دوم (FE-058) نوع را روی
 * مصرف‌کننده قفل می‌کند و کد ملی اختیاری را هم می‌گیرد؛ این داده فقط به
 * API فرستاده می‌شود و انتخاب‌گر نسخه‌ی خام آن را در storage نگه نمی‌دارد.
 *
 * schema محلی (نه `createPartySchema` مستقیم): آن schema مشترک `mobile`
 * را `min(1).optional()` می‌خواهد — یعنی رشته‌ی خالیِ input خالی (نه
 * `undefined`) رد اعتبارسنجی می‌شود. اینجا خالی مجاز است و پیش از ارسال
 * حذف می‌شود، دقیقاً همان قرارداد نهایی.
 */
const partyFormSchema = z.object({
  type: z.enum(['CONSUMER', 'BUSINESS']),
  displayName: normalizedInput(z.string().trim().min(1, 'نام الزامی است').max(200)),
  mobile: normalizedInput(z.string().trim().max(32, 'حداکثر ۳۲ نویسه')).optional(),
  nationalId: normalizedInput(z.string().trim().max(32, 'حداکثر ۳۲ نویسه')).optional(),
});
type PartyFormValues = z.infer<typeof partyFormSchema>;

const TYPE_LABEL: Record<PartyType, string> = { CONSUMER: 'مصرف‌کننده', BUSINESS: 'همکار' };

function toCreatePartyInput(values: PartyFormValues): CreatePartyInput {
  return {
    type: values.type,
    displayName: values.displayName,
    ...(values.mobile ? { mobile: values.mobile } : {}),
    ...(values.nationalId ? { nationalId: values.nationalId } : {}),
  };
}

export type CreatePartyDialogVariant = 'QUICK' | 'SELLER';

export interface CreatePartyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** بعد از ثبت موفق با شخص تازه صدا زده می‌شود — مثلاً برای انتخاب خودکار در `PartySelector` (FE-035). */
  onCreated?: (party: Party) => void;
  /** حالت فروشنده، ورودی هویتی لازم برای خرید دست‌دوم را بدون افزودن فیلدهای نامرتبط نشان می‌دهد. */
  variant?: CreatePartyDialogVariant;
}

export function CreatePartyDialog({
  open,
  onOpenChange,
  onCreated,
  variant = 'QUICK',
}: CreatePartyDialogProps) {
  const isSeller = variant === 'SELLER';
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<unknown>(null);

  const {
    register,
    handleSubmit,
    reset: resetFormValues,
    formState: { errors },
  } = useForm<PartyFormValues>({
    resolver: zodResolver(partyFormSchema),
    defaultValues: { type: 'CONSUMER', displayName: '', mobile: '', nationalId: '' },
  });

  const { submit, isSubmitting, reset: resetKey } = useIdempotentSubmit(
    (key: string, values: PartyFormValues) => createParty(toCreatePartyInput(values), key),
  );

  const close = () => {
    if (isSubmitting) return;
    onOpenChange(false);
    resetFormValues();
    setSubmitError(null);
  };

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const party = await submit(values);
      if (!party) return; // ضربه‌ی دوم حین ارسال قبلی — بی‌اثر، نه خطا

      await queryClient.invalidateQueries({ queryKey: queryKeys.parties.all() });
      toast.success('شخص ثبت شد', party.displayName);
      resetKey();
      onCreated?.(party);
      onOpenChange(false);
      resetFormValues();
    } catch (error) {
      // گفت‌وگو عمداً باز می‌ماند — کاربر باید بدون از دست دادن ورودی دوباره تلاش کند
      setSubmitError(error);
    }
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isSeller ? 'افزودن فروشنده' : 'افزودن شخص'}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {isSeller
              ? 'فروشنده به‌عنوان مصرف‌کننده ثبت می‌شود. کد ملی فعلاً اختیاری است.'
              : 'برای شروع همین سه فیلد کافی است؛ بقیه‌ی مشخصات را بعداً از صفحه‌ی شخص کامل کنید.'}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          {isSeller ? (
            <div className="rounded-md border border-border bg-muted px-3 py-2">
              <span className="block text-xs text-muted-foreground">نوع طرف حساب</span>
              <span className="text-sm font-medium">مصرف‌کننده</span>
              <input type="hidden" value="CONSUMER" {...register('type')} />
            </div>
          ) : (
            <div>
              <label htmlFor="party-type" className="mb-1.5 block text-sm font-medium">
                نوع طرف حساب
              </label>
              <Select id="party-type" disabled={isSubmitting} {...register('type')}>
                {Object.entries(TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <label htmlFor="party-name" className="mb-1.5 block text-sm font-medium">
              نام
            </label>
            <Input
              id="party-name"
              autoComplete="off"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.displayName)}
              {...register('displayName')}
            />
            {errors.displayName ? (
              <InlineError message={errors.displayName.message ?? 'نام الزامی است'} />
            ) : null}
          </div>

          <div>
            <label htmlFor="party-mobile" className="mb-1.5 block text-sm font-medium">
              موبایل (اختیاری)
            </label>
            <Input
              id="party-mobile"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.mobile)}
              {...register('mobile')}
            />
            {errors.mobile ? <InlineError message={errors.mobile.message ?? 'موبایل معتبر نیست'} /> : null}
          </div>

          {isSeller ? (
            <div>
              <label htmlFor="party-national-id" className="mb-1.5 block text-sm font-medium">
                کد ملی (اختیاری)
              </label>
              <Input
                id="party-national-id"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.nationalId)}
                aria-describedby="party-national-id-hint"
                {...register('nationalId')}
              />
              <p id="party-national-id-hint" className="mt-1 text-xs text-muted-foreground">
                پس از ثبت، مقدار کامل در این جریان دوباره نمایش داده نمی‌شود.
              </p>
              {errors.nationalId ? (
                <InlineError message={errors.nationalId.message ?? 'کد ملی معتبر نیست'} />
              ) : null}
            </div>
          ) : null}

          {submitError ? <ApiErrorNotice error={submitError} /> : null}

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={close}>
              انصراف
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              ثبت شخص
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
