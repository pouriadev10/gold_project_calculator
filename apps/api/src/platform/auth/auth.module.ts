import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { shouldRegisterDevEndpoints } from '../config/dev-endpoints';
import { TenantModule } from '../tenant/tenant.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DevAuthzController } from './dev-authz.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';
import { TokenService } from './token.service';
import type { Type } from '@nestjs/common';

const DEV_CONTROLLERS: Type[] = shouldRegisterDevEndpoints() ? [DevAuthzController] : [];

/**
 * احراز هویت و مجوزدهی — BE-011 و BE-012.
 *
 * `JwtModule` بدون کلید ثبت می‌شود: کلید در `TokenService` و در لحظه‌ی
 * امضا از `AppConfig` معتبرشده خوانده می‌شود. با `registerAsync` هم
 * می‌شد، ولی آن‌وقت کلید در پیکربندی ماژول کش می‌ماند و چرخاندنش
 * راه‌اندازی دوباره‌ی کل ماژول را لازم داشت.
 *
 * نگهبان‌ها **سراسری ثبت نمی‌شوند**. نگهبان سراسری یعنی هر مسیر جدید
 * به‌طور پیش‌فرض محافظت‌شده است — که امن‌تر به نظر می‌رسد — ولی آن‌وقت
 * `/health` و `/auth/login` باید با یک دکوریتور «عمومی» استثنا شوند، و
 * فراموش کردن آن دکوریتور سرویس را از کار می‌اندازد بدون اینکه هیچ
 * تستی بگیردش. اینجا محافظت صریح است و در خود controller دیده می‌شود.
 */
@Module({
  imports: [JwtModule.register({}), UsersModule, TenantModule],
  providers: [AuthService, PasswordService, TokenService, JwtAuthGuard, RolesGuard],
  controllers: [AuthController, ...DEV_CONTROLLERS],
  exports: [AuthService, PasswordService, TokenService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
