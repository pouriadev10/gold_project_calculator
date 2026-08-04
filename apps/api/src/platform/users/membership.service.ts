import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DRIZZLE } from '../database/database.module';
import { isForeignKeyViolation, isUniqueViolation } from '../database/pg-errors';
import { tenantMemberships } from '../database/schema';
import { withTenantTransaction } from '../database/tenant-transaction';
import {
  MembershipAlreadyExistsError,
  MembershipNotFoundError,
  MembershipReferenceError,
} from './user.errors';
import type { Database } from '../database/connect';
import type { RoleCode, TenantMembership } from '../database/schema';
import type { TenantTransaction } from '../database/tenant-transaction';
import type { AddMembershipInput } from './user.dto';
import type { ChangeMembershipRoleInput } from './user.dto';

/**
 * عضویت کاربران در مستأجرها — BE-010.
 *
 * برخلاف `UserService`، همه‌ی کوئری‌های اینجا از `withTenantTransaction`
 * عبور می‌کنند. `tenant_memberships` جدول داده‌ی مستأجر است و RLS دارد
 * (مهاجرت ۰۰۰۵)، پس بدون آن helper کوئری با کاربر سوپرکاربر اجرا می‌شد و
 * سیاست کاملاً دور زده می‌شد — همان تله‌ای که BE-009 رویش بنا شده.
 *
 * `tenantId` صریح پارامتر است و از context خوانده نمی‌شود، چون این سرویس
 * از مسیرهای بدون درخواست هم صدا زده می‌شود (seed، تست، ابزار مدیریتی).
 * لایه‌ی HTTP خودش `requestContext.getTenantId()` را پاس می‌دهد.
 */
@Injectable()
export class MembershipService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * کاربر را با یک نقش به مستأجر متصل می‌کند.
   *
   * تکراری بودن را محدودیت یکتای `(tenant_id, user_id)` تشخیص می‌دهد،
   * و ارجاع به کاربر یا نقش ناموجود را کلید خارجی — هر دو در دیتابیس،
   * نه با بررسی‌های جداگانه‌ای که بین‌شان شرط رقابتی باز می‌شود.
   */
  async add(tenantId: string, input: AddMembershipInput): Promise<TenantMembership> {
    try {
      return await withTenantTransaction(this.db, tenantId, async (tx) => {
        const [created] = await tx
          .insert(tenantMemberships)
          .values({ tenantId, userId: input.userId, roleCode: input.roleCode })
          .returning();

        return created!;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new MembershipAlreadyExistsError(tenantId, input.userId);
      }
      if (isForeignKeyViolation(error)) {
        throw new MembershipReferenceError();
      }
      throw error;
    }
  }

  /**
   * عضویت‌های یک مستأجر.
   *
   * کوئری عمداً هیچ شرط `tenant_id` ندارد — فیلتر کار سیاست RLS است.
   * اگر روزی helper از مسیر حذف شود، این تابع بی‌صدا عضویت‌های همه‌ی
   * مستأجرها را برمی‌گرداند؛ تست جداسازی دقیقاً برای گرفتن همان است.
   */
  async listForTenant(tenantId: string): Promise<TenantMembership[]> {
    return withTenantTransaction(this.db, tenantId, async (tx) =>
      tx.select().from(tenantMemberships),
    );
  }

  /** نقش یک کاربر در یک مستأجر — BE-012 برای مجوزدهی لازمش دارد. */
  async findRole(tenantId: string, userId: string): Promise<RoleCode | undefined> {
    return withTenantTransaction(this.db, tenantId, async (tx) => {
      const [found] = await tx
        .select({ roleCode: tenantMemberships.roleCode })
        .from(tenantMemberships)
        .where(eq(tenantMemberships.userId, userId))
        .limit(1);

      return found?.roleCode;
    });
  }

  /**
   * تغییر نقش همراه با audit. نسخه‌ی transaction-aware برای endpointهای مالی و
   * مدیریتی است که باید نقش، ردّ ممیزی و idempotency را در یک commit نگه دارند.
   */
  async changeRoleInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    actorUserId: string,
    userId: string,
    input: ChangeMembershipRoleInput,
  ): Promise<TenantMembership> {
    const [before] = await transaction
      .select()
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)),
      )
      .limit(1);

    if (before === undefined) {
      throw new MembershipNotFoundError();
    }

    if (before.roleCode === input.roleCode) {
      return before;
    }

    const [updated] = await transaction
      .update(tenantMemberships)
      .set({ roleCode: input.roleCode })
      .where(
        and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)),
      )
      .returning();

    await this.audit.recordInTransaction(transaction, {
      tenantId,
      actorUserId,
      action: 'ROLE_CHANGED',
      entityType: 'tenant_membership',
      entityId: updated!.id,
      beforeData: { roleCode: before.roleCode, userId: before.userId },
      afterData: { roleCode: updated!.roleCode, userId: updated!.userId },
    });

    return updated!;
  }

  /** تغییر نقش مستقل، برای job یا مسیرهایی که transaction بیرونی ندارند. */
  async changeRole(
    tenantId: string,
    actorUserId: string,
    userId: string,
    input: ChangeMembershipRoleInput,
  ): Promise<TenantMembership> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      this.changeRoleInTransaction(transaction, tenantId, actorUserId, userId, input),
    );
  }
}
