import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../shared/validation';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';
import { loginSchema, refreshSchema } from './auth.dto';
import {
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  TenantSuspendedError,
} from './auth.errors';
import { AuthService } from './auth.service';
import { CurrentAuth } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthSession } from './auth.service';
import type { LoginInput, RefreshInput } from './auth.dto';
import type { AccessTokenPayload } from './token.service';

/**
 * پاسخ نشست.
 *
 * صریح ساخته می‌شود، نه با پخش کردن رکورد کاربر: قاعده‌ی BE-011 می‌گوید
 * «پاسخ‌ها اطلاعات حساس نداشته باشند»، و اگر فردا ستونی به `users` اضافه
 * شود، با spread بی‌صدا به بیرون درز می‌کرد. `passwordHash` هرگز از این
 * مرز رد نمی‌شود.
 */
interface SessionResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
  readonly user: { readonly id: string; readonly email: string; readonly displayName: string };
  readonly tenant: { readonly id: string; readonly slug: string; readonly name: string };
  readonly role: string;
}

function toSessionResponse(session: AuthSession): SessionResponse {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    user: {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
    },
    tenant: {
      id: session.tenant.id,
      slug: session.tenant.slug,
      name: session.tenant.name,
    },
    role: session.role,
  };
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
  ): Promise<SessionResponse> {
    try {
      return toSessionResponse(await this.auth.login(body));
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException(error.message);
      }
      if (error instanceof TenantSuspendedError) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
  ): Promise<SessionResponse> {
    try {
      return toSessionResponse(await this.auth.refresh(body.refreshToken));
    } catch (error) {
      if (error instanceof InvalidRefreshTokenError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }
  }

  /**
   * خروج.
   *
   * توکن **تمدید** را می‌گیرد نه توکن دسترسی، چون همان است که نشست را
   * زنده نگه می‌دارد. توکن دسترسی تا انقضای کوتاهش معتبر می‌ماند —
   * قیمتی که برای بدون‌حالت بودنش می‌دهیم.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentAuth() auth: AccessTokenPayload | undefined): Promise<{
    user: { id: string; email: string; displayName: string };
    tenant: { id: string; slug: string; name: string };
    role: string;
  }> {
    // نگهبان تضمینش می‌کند؛ این بررسی فقط نوع را باریک می‌کند.
    if (auth === undefined) {
      throw new UnauthorizedException();
    }

    const described = await this.auth.describe(auth.sub, auth.tid);

    /*
     * توکن معتبر ولی عضویت ناموجود یعنی دسترسی بعد از صدور توکن گرفته
     * شده. پاسخ ۴۰۱ است تا کلاینت مسیر ورود دوباره را برود.
     */
    if (described === undefined) {
      throw new UnauthorizedException('دسترسی این حساب دیگر معتبر نیست');
    }

    return {
      user: {
        id: described.user.id,
        email: described.user.email,
        displayName: described.user.displayName,
      },
      tenant: {
        id: described.tenant.id,
        slug: described.tenant.slug,
        name: described.tenant.name,
      },
      role: described.role,
    };
  }
}
