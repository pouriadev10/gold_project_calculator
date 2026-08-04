import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * ثبت تغییرناپذیر عملیات حساس — BE-014.
 *
 * داده‌ها پیش از ذخیره پاک‌سازی می‌شوند و خود جدول در PostgreSQL append-only است.
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
