import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { APP_CONFIG } from '../config/config.module';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_BYTES } from './auth.constants';
import type { AppConfig } from '../config/env.schema';
import type { RoleCode } from '../database/schema';

/**
 * محتوای توکن دسترسی.
 *
 * `tid` عمدی است: قاعده‌ی BE-011 می‌گوید «tenant فعال در token مشخص
 * باشد». بدون آن، توکنِ کاربری که عضو دو طلافروشی است معلوم نمی‌کرد
 * درخواست به کدام‌شان مربوط است.
 *
 * چیزی جز شناسه و نقش داخل توکن نمی‌رود — payload توکن base64 است، نه
 * رمزنگاری‌شده، و هرکسی که توکن را ببیند می‌تواند بخواندش.
 */
export interface AccessTokenPayload {
  /** شناسه‌ی کاربر. */
  readonly sub: string;
  /** شناسه‌ی مستأجر فعالِ این نشست. */
  readonly tid: string;
  /** نقش کاربر در همان مستأجر. */
  readonly role: RoleCode;
}

/** توکن تمدیدِ خام به‌همراه هشی که در دیتابیس می‌نشیند. */
export interface GeneratedRefreshToken {
  readonly token: string;
  readonly tokenHash: string;
}

@Injectable()
export class TokenService {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.jwtAccessSecret.reveal(),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  /**
   * توکن دسترسی را می‌سنجد.
   *
   * امضای نامعتبر یا انقضا `undefined` می‌دهد نه استثنا، چون از دید
   * فراخوان هر دو یک معنا دارند: این درخواست احراز هویت نشده است.
   */
  async verifyAccessToken(token: string): Promise<AccessTokenPayload | undefined> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.jwtAccessSecret.reveal(),
      });
    } catch {
      return undefined;
    }
  }

  /**
   * توکن تمدید تصادفی می‌سازد.
   *
   * برخلاف توکن دسترسی، JWT نیست: هیچ ادعایی حمل نمی‌کند و فقط یک
   * اشاره‌گر مبهم به ردیفی در `refresh_tokens` است. یعنی حقیقتِ نشست در
   * دیتابیس است و باطل کردنش فوری اثر می‌کند — چیزی که با JWT خودبسنده
   * ممکن نبود.
   */
  generateRefreshToken(): GeneratedRefreshToken {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');

    return { token, tokenHash: this.hashRefreshToken(token) };
  }

  /** همان هشی که در `refresh_tokens.token_hash` ذخیره می‌شود. */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
