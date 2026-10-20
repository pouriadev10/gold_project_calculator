import { BadRequestException } from '@nestjs/common';
import { persianZodErrorMap } from '@gold/contracts';
import type { PipeTransform } from '@nestjs/common';
import type { ZodIssue, ZodTypeAny, z } from 'zod';

/**
 * ورودی را با یک schema از Zod اعتبارسنجی می‌کند و خطا را به شکل قرارداد
 * (`{ error: { code, message, fields, requestId } }`) آماده می‌کند.
 */
export type ValidationFields = Record<string, string[]>;

/** پیام عمومی وقتی خطایی در ریشه‌ی ورودی نیست — همه‌ی جزئیات در `fields` است. */
export const DEFAULT_VALIDATION_MESSAGE = 'ورودی نامعتبر است';

/** خطای Zod با fields پاک‌سازی‌شده برای filter قرارداد خطای سراسری. */
export class ZodValidationException extends BadRequestException {
  /**
   * @param fields خطای هر فیلد با مسیر کامل («lines.1.amountRial»).
   * @param summary پیام خطاهای ریشه‌ی ورودی (مثل «فیلد ناشناخته: …» یا «حداقل یک فیلد…»)،
   *   یا پیام عمومی. پیش‌تر خطای ریشه کاملاً دور ریخته می‌شد و پاسخ ۴۰۰ هیچ توضیحی نداشت.
   */
  constructor(
    readonly fields: ValidationFields,
    readonly summary: string = DEFAULT_VALIDATION_MESSAGE,
  ) {
    super(summary);
  }
}

function addMessage(target: ValidationFields, key: string, message: string): void {
  const messages = (target[key] ??= []);
  if (!messages.includes(message)) messages.push(message);
}

/**
 * مسئله‌های Zod → fields + خلاصه.
 *
 * کلید هر فیلد مسیر کامل است، نه فقط سطح اول (`flatten` خطای `lines[1].amountRial`
 * را فقط زیر `lines` می‌گذاشت و معلوم نبود کدام ردیف). مقدار دریافتی هرگز در پیام
 * تکرار نمی‌شود — فقط مسیر و علت — پس فیلد حساس بدنه از طریق خطا برنمی‌گردد.
 */
export function validationErrorParts(issues: readonly ZodIssue[]): {
  readonly fields: ValidationFields;
  readonly summary: string;
} {
  const fields: ValidationFields = {};
  const rootMessages: string[] = [];
  for (const issue of issues) {
    if (issue.path.length === 0) {
      if (!rootMessages.includes(issue.message)) rootMessages.push(issue.message);
    } else {
      addMessage(fields, issue.path.join('.'), issue.message);
    }
  }
  return {
    fields,
    summary: rootMessages.length > 0 ? rootMessages.join('؛ ') : DEFAULT_VALIDATION_MESSAGE,
  };
}

export class ZodValidationPipe<TSchema extends ZodTypeAny> implements PipeTransform {
  /** عمومی است تا مستند OpenAPI (BE-070) schema ِ واقعی همین مسیر را بخواند. */
  constructor(readonly schema: TSchema) {}

  transform(value: unknown): z.infer<TSchema> {
    // پیام‌های پیش‌فرض Zod انگلیسی‌اند؛ پیام صریح schema همچنان برنده است.
    const result = this.schema.safeParse(value, { errorMap: persianZodErrorMap });

    if (!result.success) {
      const { fields, summary } = validationErrorParts(result.error.issues);
      throw new ZodValidationException(fields, summary);
    }

    return result.data;
  }
}
