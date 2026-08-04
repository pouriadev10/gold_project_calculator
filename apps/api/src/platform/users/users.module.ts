import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MembershipService } from './membership.service';
import { UserService } from './user.service';

/**
 * کاربران و عضویت در مستأجر — BE-010.
 *
 * هر دو سرویس صادر می‌شوند: BE-011 برای ورود به `UserService` نیاز دارد
 * و BE-012 برای تشخیص نقش به `MembershipService`.
 *
 * هنوز هیچ controller ای ندارد. برخلاف BE-007، این تسک endpoint موقت
 * توسعه نمی‌خواهد؛ مسیرهای واقعی کاربر با احراز هویت BE-011 می‌آیند.
 */
@Module({
  imports: [AuditModule],
  providers: [UserService, MembershipService],
  exports: [UserService, MembershipService],
})
export class UsersModule {}
