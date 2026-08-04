import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TenantModule } from '../tenant/tenant.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * احراز هویت، توکن دسترسی و refresh — BE-011 و BE-012.
 *
 * `JwtModule` بدون کلید ثبت می‌شود: کلید در `TokenService` و در لحظه‌ی
 * امضا از `AppConfig` معتبرشده خوانده می‌شود. با `registerAsync` هم
 * می‌شد، ولی آن‌وقت کلید در پیکربندی ماژول کش می‌ماند و چرخاندنش
 * راه‌اندازی دوباره‌ی کل ماژول را لازم داشت.
 *
 * `PasswordService` و `TokenService` صادر می‌شوند چون BE-012 و مسیر
 * ساخت کاربر به آن‌ها نیاز پیدا می‌کنند.
 */
@Module({
  imports: [JwtModule.register({}), UsersModule, TenantModule],
  providers: [AuthService, PasswordService, TokenService, JwtAuthGuard],
  controllers: [AuthController],
  exports: [AuthService, PasswordService, TokenService, JwtAuthGuard],
})
export class AuthModule {}
