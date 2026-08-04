import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { AUTH_PAYLOAD_KEY } from './auth.constants';
import type { AuthenticatedRequest } from './jwt-auth.guard';
import type { AccessTokenPayload } from './token.service';

/**
 * payload توکن درخواست جاری.
 *
 * فقط روی مسیرهایی معنا دارد که `JwtAuthGuard` محافظتشان می‌کند؛ بدون
 * نگهبان، مقدارش `undefined` است و نوع خروجی این را پنهان نمی‌کند تا
 * استفاده‌ی اشتباه در زمان کامپایل دیده شود.
 */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessTokenPayload | undefined => {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    return req[AUTH_PAYLOAD_KEY];
  },
);
