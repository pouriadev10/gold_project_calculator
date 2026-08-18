import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { createParty, updateParty } from '@/api/parties';
import { queryKeys } from '@/api/query-keys';
import type { CreatePartyInput, Party, PartyType, UpdatePartyInput } from '@/api/contracts';
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
import { Textarea } from '@/components/ui/textarea';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { normalizedInput } from '@/lib/persian-text';
import { toast } from '@/stores/toast-store';

/**
 * فرم کامل ایجاد/ویرایش شخص — FE-033.
 *
 * برخلاف `CreatePartyDialog` (FE-032، سه فیلد سریع برای شروع بی‌درنگ)،
 * این‌جا هر پنج فیلد `partySchema` حاضرند و یک کامپوننت هر دو عملیات را
 * پوشش می‌دهد — چون فیلدها، اعتبارسنجی و نرمال‌سازی بین ایجاد و ویرایش
 * عیناً یکی است؛ تنها تفاوت متد HTTP و مقدار پیش‌فرض فیلدهاست. این برخلاف
 * مرجوعی B2B/B2C (بخش ۲-۵ CLAUDE.md) نیست: آن دو از نظر حسابداری دو
 * عملیات متفاوتند، این دو فقط دو مسیر یک شیء واحدند.
 *
 * `party` تعیین‌کننده‌ی حالت است: نبودش یعنی ایجاد (`POST /parties`)،
 * بودنش یعنی ویرایش (`PATCH /parties/:id`). فراخوان باید هنگام تغییر شخص
 * هدف (مثلاً کلیک ویرایش روی یک ردیف دیگر) کامپوننت را با `key={party.id}`
 * دوباره mount کند — این‌جا هیچ `useEffect` برای همگام‌سازی مجدد
 * `defaultValues` با props بعدی نیست، عمداً.
 *
 * فیلدهای اختیاری در ایجاد اگر خالی بمانند از payload حذف می‌شوند
 * (`createPartySchema` آن‌ها را `optional()` می‌خواهد، نه `nullable()`)؛
 * در ویرایش همان خالی بودن یعنی «پاک شود» و صریح `null` ارسال می‌شود
 * (`updatePartySchema` دقیقاً همین قرارداد را دارد).
 */

const TYPE_LABEL: Record<PartyType, string> = { CONSUMER: 'مصرف‌کننده', BUSINESS: 'همکار' };

const partyFormSchema = z.object({
  type: z.enum(['CONSUMER', 'BUSINESS']),
  displayName: normalizedInput(z.string().trim().min(1, 'نام الزامی است').max(200, 'حداکثر ۲۰۰ نویسه')),
  mobile: normalizedInput(z.string().trim().max(32, 'حداکثر ۳۲ نویسه')).optional(),
  nationalId: normalizedInput(z.string().trim().max(32, 'حداکثر ۳۲ نویسه')).optional(),
  notes: normalizedInput(z.string().trim().max(2000, 'حداکثر ۲۰۰۰ نویسه')).optional(),
});
type PartyFormValues = z.infer<typeof partyFormSchema>;

function toDefaultValues(party: Party | undefined): PartyFormValues {
  if (!party) return { type: 'CONSUMER', displayName: '', mobile: '', nationalId: '', notes: '' };
  return {
    type: party.type,
    displayName: party.displayName,
    mobile: party.mobile ?? '',
    nationalId: party.nationalId ?? '',
    notes: party.notes ?? '',
  };
}

function toCreateInput(values: PartyFormValues): CreatePartyInput {
  return {
    type: values.type,
    displayName: values.displayName,
    ...(values.mobile ? { mobile: values.mobile } : {}),
    ...(values.nationalId ? { nationalId: values.nationalId } : {}),
    ...(values.notes ? { notes: values.notes } : {}),
  };
}

function toUpdateInput(values: PartyFormValues): UpdatePartyInput {
  return {
    type: values.type,
    displayName: values.displayName,
    mobile: values.mobile ? values.mobile : null,
    nationalId: values.nationalId ? values.nationalId : null,
    notes: values.notes ? values.notes : null,
  };
}

export interface PartyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** نبود = ایجاد؛ حضور = ویرایش همین شخص. */
  party?: Party;
}

export function PartyFormDialog({ open, onOpenChange, party }: PartyFormDialogProps) {
  const isEdit = party !== undefined;
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<unknown>(null);

  const {
    register,
    handleSubmit,
    reset: resetFormValues,
    formState: { errors },
  } = useForm<PartyFormValues>({
    resolver: zodResolver(partyFormSchema),
    defaultValues: toDefaultValues(party),
  });

  const { submit, isSubmitting, reset: resetKey } = useIdempotentSubmit(
    (key: string, values: PartyFormValues) =>
      isEdit ? updateParty(party.id, toUpdateInput(values), key) : createParty(toCreateInput(values), key),
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
      const result = await submit(values);
      if (!result) return; // ضربه‌ی دوم حین ارسال قبلی — بی‌اثر، نه خطا

      await queryClient.invalidateQueries({ queryKey: queryKeys.parties.all() });
      toast.success(isEdit ? 'تغییرات ذخیره شد' : 'شخص ثبت شد', result.displayName);
      resetKey();
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
          <ResponsiveDialogTitle>{isEdit ? 'ویرایش شخص' : 'شخص جدید'}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {isEdit
              ? 'مشخصات این شخص را به‌روزرسانی کنید.'
              : 'مشخصات کامل شخص را وارد کنید؛ فقط نام الزامی است.'}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <div>
            <label htmlFor="party-form-type" className="mb-1.5 block text-sm font-medium">
              نوع طرف حساب
            </label>
            <Select id="party-form-type" disabled={isSubmitting} {...register('type')}>
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label htmlFor="party-form-name" className="mb-1.5 block text-sm font-medium">
              نام
            </label>
            <Input
              id="party-form-name"
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
            <label htmlFor="party-form-mobile" className="mb-1.5 block text-sm font-medium">
              موبایل (اختیاری)
            </label>
            <Input
              id="party-form-mobile"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.mobile)}
              {...register('mobile')}
            />
            {errors.mobile ? <InlineError message={errors.mobile.message ?? 'موبایل معتبر نیست'} /> : null}
          </div>

          <div>
            <label htmlFor="party-form-national-id" className="mb-1.5 block text-sm font-medium">
              کد ملی (اختیاری)
            </label>
            <Input
              id="party-form-national-id"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.nationalId)}
              {...register('nationalId')}
            />
            {errors.nationalId ? (
              <InlineError message={errors.nationalId.message ?? 'کد ملی معتبر نیست'} />
            ) : null}
          </div>

          <div>
            <label htmlFor="party-form-notes" className="mb-1.5 block text-sm font-medium">
              یادداشت (اختیاری)
            </label>
            <Textarea
              id="party-form-notes"
              rows={3}
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.notes)}
              {...register('notes')}
            />
            {errors.notes ? <InlineError message={errors.notes.message ?? 'یادداشت معتبر نیست'} /> : null}
          </div>

          {submitError ? <ApiErrorNotice error={submitError} /> : null}

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={close}>
              انصراف
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {isEdit ? 'ذخیره تغییرات' : 'ایجاد شخص'}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
