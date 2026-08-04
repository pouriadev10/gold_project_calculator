import { BadRequestException } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/**
 * ورودی را با یک schema از Zod اعتبارسنجی می‌کند.
 *
 * نگاشت خطا اینجا حداقلی است و در BE-017 به قرارداد استاندارد
 * (`{ error: { code, message, fields, requestId } }`) منتقل می‌شود؛
 * فعلاً فقط تضمین می‌کند هیچ ورودی اعتبارسنجی‌نشده‌ای به Service نرسد.
 */
export type ValidationFields = Record<string, string[]>;

/** خطای Zod با fields پاک‌سازی‌شده برای filter قرارداد خطای سراسری. */
export class ZodValidationException extends BadRequestException {
  constructor(readonly fields: ValidationFields) {
    super('ورودی نامعتبر است');
  }
}

function validationFields(fieldErrors: Record<string, string[] | undefined>): ValidationFields {
  const fields: ValidationFields = {};

  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (messages !== undefined && messages.length > 0) {
      fields[field] = messages;
    }
  }

  return fields;
}

export class ZodValidationPipe<TSchema extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.infer<TSchema> {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      // `flatten` مقدار دریافتی را تکرار نمی‌کند، فقط مسیر و علت را —
      // پس یک فیلد حساس در بدنه‌ی درخواست از طریق پیام خطا برنمی‌گردد.
      throw new ZodValidationException(validationFields(result.error.flatten().fieldErrors));
    }

    return result.data;
  }
}
