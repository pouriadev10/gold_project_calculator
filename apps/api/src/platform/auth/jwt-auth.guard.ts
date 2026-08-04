import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AUTH_PAYLOAD_KEY } from './auth.constants';
import { TokenService } from './token.service';
import type { AccessTokenPayload } from './token.service';

const BEARER_PREFIX = 'Bearer ';

/** درخواستی که نگهبان روی آن payload توکن را می‌نشاند. */
export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  [AUTH_PAYLOAD_KEY]?: AccessTokenPayload;
}

function readBearerToken(req: AuthenticatedRequest): string | undefined {
  const header = req.headers['authorization'];

  // هدر تکراری ابهام است، نه چیزی که بشود یکی‌اش را انتخاب کرد.
  if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
    return undefined;
  }

  const token = header.slice(BEARER_PREFIX.length).trim();

  return token === '' ? undefined : token;
}

/**
 * احراز هویت — BE-011.
 *
 * فقط می‌گوید «این درخواست از طرف کیست»، نه «اجازه دارد یا نه». مجوزدهی
 * نقش‌محور کار BE-012 است و روی همین payload بنا می‌شود.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(TokenService) private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readBearerToken(req);

    if (token === undefined) {
      throw new UnauthorizedException('توکن دسترسی ارائه نشده است');
    }

    const payload = await this.tokens.verifyAccessToken(token);

    if (payload === undefined) {
      throw new UnauthorizedException('توکن دسترسی معتبر نیست یا منقضی شده است');
    }

    req[AUTH_PAYLOAD_KEY] = payload;

    return true;
  }
}
