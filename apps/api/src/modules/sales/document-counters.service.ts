import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../platform/database/database.module';
import { documentCounters } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import type { Database } from '../../platform/database/connect';
import type { DocumentType } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

export interface NextDocumentNumberInput {
  readonly tenantId: string;
  readonly documentType: DocumentType;
  readonly periodKey: string;
}

/**
 * سال جلالیِ مؤثر یک تاریخ — استراتژی دوره‌ای فاز ۱ برای شماره‌گذاری اسناد.
 *
 * با `Intl` بومی، نه `date-fns-jalali`: همان تصمیمی که وب برای نمایش
 * تاریخ گرفت (`apps/web/src/lib/date.ts`) اینجا هم صادق است — تقویم
 * جلالی از ICU خود Node می‌آید، بدون وابستگی تازه و بدون ریسک واگرایی
 * دو پیاده‌سازی تقویم از هم. لوکیل پایه عمداً `en-US` است تا رقم همیشه
 * لاتین باشد؛ فقط تقویم (`u-ca-persian`) عوض می‌شود.
 */
export function jalaliYearPeriodKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric' }).formatToParts(
    date,
  );
  const year = parts.find((part) => part.type === 'year')?.value;

  if (year === undefined) {
    throw new Error('Could not resolve the Jalali year for period keying');
  }

  return year;
}

/**
 * شماره‌ی سند بدون شکاف — BE-038.
 *
 * الگوریتم دقیقاً طبق تسک: یک `INSERT ... ON CONFLICT DO NOTHING`
 * ردیف شمارنده را فقط اگر نبود می‌سازد (idempotent، بدون شرط رقابتی روی
 * خودِ ساختنِ ردیف)، سپس `SELECT ... FOR UPDATE` قفل ردیفی می‌گیرد، سپس
 * `UPDATE` مصرف می‌کند.
 *
 * چون این متد `TenantTransaction` را از فراخوان می‌گیرد و خودش تراکنش
 * تازه باز نمی‌کند، rollback فراخوان (مثلاً چون بقیه‌ی ثبت فاکتور شکست
 * خورد) همین افزایش `current_value` را هم برمی‌گرداند — شماره مصرف‌نشده
 * برای تلاش بعدی باقی می‌ماند. دقیقاً همین چیزی است که با
 * PostgreSQL `SEQUENCE` ممکن نیست: `nextval` مستقل از تراکنش فراخوان
 * است و rollback هرگز آن را برنمی‌گرداند.
 */
@Injectable()
export class DocumentCountersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async getNextNumber(input: NextDocumentNumberInput): Promise<number> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.getNextNumberInTransaction(transaction, input),
    );
  }

  async getNextNumberInTransaction(
    transaction: TenantTransaction,
    input: NextDocumentNumberInput,
  ): Promise<number> {
    await transaction
      .insert(documentCounters)
      .values({
        tenantId: input.tenantId,
        documentType: input.documentType,
        periodKey: input.periodKey,
        currentValue: 0,
      })
      .onConflictDoNothing({
        target: [
          documentCounters.tenantId,
          documentCounters.documentType,
          documentCounters.periodKey,
        ],
      });

    const [locked] = await transaction
      .select({ id: documentCounters.id, currentValue: documentCounters.currentValue })
      .from(documentCounters)
      .where(
        and(
          eq(documentCounters.tenantId, input.tenantId),
          eq(documentCounters.documentType, input.documentType),
          eq(documentCounters.periodKey, input.periodKey),
        ),
      )
      .for('update');

    if (locked === undefined) {
      throw new Error('Document counter row was not created before locking');
    }

    const [updated] = await transaction
      .update(documentCounters)
      .set({ currentValue: locked.currentValue + 1 })
      .where(eq(documentCounters.id, locked.id))
      .returning({ currentValue: documentCounters.currentValue });

    return updated!.currentValue;
  }
}
