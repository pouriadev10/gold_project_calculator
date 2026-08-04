import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import { idempotencyRecords } from '../database/schema';
import { withTenantTransaction } from '../database/tenant-transaction';
import { IdempotencyKeyConflictError } from './idempotency.errors';
import { requireIdempotencyKey } from './idempotency-key';
import { hashIdempotencyRequest } from './request-hash';
import type { Database } from '../database/connect';
import type { StoredJson } from '../database/schema';
import type { TenantTransaction } from '../database/tenant-transaction';
import type { IdempotencyRequest } from './request-hash';

/** پاسخ HTTP که همراه اثر اصلی در همان تراکنش ذخیره می‌شود. */
export interface IdempotencyResponse<TBody extends StoredJson> {
  readonly body: TBody;
  readonly status: number;
}

/** نتیجه‌ی اجرا یا بازپخش. `replayed` برای telemetry است، نه پاسخ کاربر. */
export interface IdempotencyResult<TBody extends StoredJson> {
  readonly replayed: boolean;
  readonly response: IdempotencyResponse<TBody>;
}

export interface ExecuteIdempotentRequest<TBody extends StoredJson> {
  /** از request context یا ورودی معتبر job می‌آید؛ هرگز از body مالی نه. */
  readonly tenantId: string;
  readonly key: string | undefined;
  readonly request: IdempotencyRequest;
  /**
   * همه‌ی insert/updateهای اثر اصلی باید فقط با `transaction` انجام شوند.
   * در نتیجه ثبت کلید، اثر مالی و پاسخ ذخیره‌شده همگی یک commit یا rollback دارند.
   */
  readonly execute: (transaction: TenantTransaction) => Promise<IdempotencyResponse<TBody>>;
}

/** نگه‌داری پاسخ برای یک روز؛ یک سیاست زیرساختی است، نه مقدار صنفی. */
const IDEMPOTENCY_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;

/**
 * مرز واحد idempotency برای عملیات‌های نوشتنی — BE-013.
 *
 * `ON CONFLICT DO NOTHING` به‌جای «اول SELECT کن» استفاده شده است. در نتیجه
 * محدودیت یکتا خود PostgreSQL رقابت را حل می‌کند؛ درخواست دوم پس از commit
 * درخواست اول پاسخ ذخیره‌شده را می‌خواند و callback آن هرگز اجرا نمی‌شود.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async execute<TBody extends StoredJson>(
    input: ExecuteIdempotentRequest<TBody>,
  ): Promise<IdempotencyResult<TBody>> {
    const key = requireIdempotencyKey(input.key);
    const requestHash = hashIdempotencyRequest(input.request);

    return withTenantTransaction(this.db, input.tenantId, async (transaction) => {
      const now = new Date();
      /*
       * همان key بعد از انقضا باید دوباره قابل استفاده باشد. پاک‌سازی داخل
       * همان transaction است تا درخواست رقیب هنوز با unique constraint داوری شود.
       */
      await transaction
        .delete(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.tenantId, input.tenantId),
            eq(idempotencyRecords.key, key),
            lt(idempotencyRecords.expiresAt, now),
          ),
        );

      const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MILLISECONDS);
      const [claimed] = await transaction
        .insert(idempotencyRecords)
        .values({
          tenantId: input.tenantId,
          key,
          requestHash,
          status: 'PENDING',
          expiresAt,
        })
        .onConflictDoNothing({
          target: [idempotencyRecords.tenantId, idempotencyRecords.key],
        })
        .returning();

      if (claimed === undefined) {
        const [existing] = await transaction
          .select()
          .from(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.tenantId, input.tenantId),
              eq(idempotencyRecords.key, key),
            ),
          )
          .limit(1);

        /*
         * unique conflict فقط بعد از commit درخواست رقیب دیده می‌شود. نبودن
         * رکورد، یک خطای زیرساختی است و نباید به‌صورت پاسخ ساختگی پنهان شود.
         */
        if (existing === undefined) {
          throw new Error('رکورد Idempotency بعد از برخورد یکتا پیدا نشد');
        }

        if (existing.requestHash !== requestHash) {
          throw new IdempotencyKeyConflictError();
        }

        if (existing.status !== 'COMPLETED' || existing.responseStatus === null) {
          throw new Error('رکورد Idempotency کامل نشده است');
        }

        return {
          replayed: true,
          response: {
            status: existing.responseStatus,
            body: existing.responseBody as TBody,
          },
        };
      }

      const response = await input.execute(transaction);

      await transaction
        .update(idempotencyRecords)
        .set({
          status: 'COMPLETED',
          responseStatus: response.status,
          responseBody: response.body,
        })
        .where(eq(idempotencyRecords.id, claimed.id));

      return { replayed: false, response };
    });
  }
}
