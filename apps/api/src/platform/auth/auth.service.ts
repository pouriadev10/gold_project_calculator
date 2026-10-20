import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import { refreshTokens } from '../database/schema';
import { MembershipService } from '../users/membership.service';
import { TenantService } from '../tenant/tenant.service';
import { UserService } from '../users/user.service';
import { REFRESH_TOKEN_TTL_SECONDS } from './auth.constants';
import {
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  TenantSuspendedError,
} from './auth.errors';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import type { Database } from '../database/connect';
import type { TenantTransaction } from '../database/tenant-transaction';
import type { RoleCode, Tenant, User } from '../database/schema';
import type { LoginInput } from './auth.dto';

/** یک نشست تازه — همان چیزی که ورود و تمدید هر دو برمی‌گردانند. */
export interface AuthSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly user: User;
  readonly tenant: Tenant;
  readonly role: RoleCode;
}

@Injectable()
export class AuthService {
  /**
   * هش ساختگی برای یکسان کردن زمان پاسخ وقتی کاربر وجود ندارد.
   *
   * بدون این، مسیر «ایمیل ناموجود» بدون اجرای Argon2 برمی‌گردد و
   * محسوس‌تر سریع‌تر است — یعنی با اندازه‌گیری زمان می‌شود فهمید کدام
   * ایمیل‌ها در سامانه ثبت‌اند، هرچند پیام خطا یکسان باشد. یک بار
   * ساخته و کش می‌شود.
   */
  #dummyHash: Promise<string> | undefined;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(UserService) private readonly users: UserService,
    @Inject(TenantService) private readonly tenants: TenantService,
    @Inject(MembershipService) private readonly memberships: MembershipService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  /**
   * ورود.
   *
   * ترتیب بررسی‌ها عمدی است: اول رمز، بعد عضویت، و **آخر** وضعیت مستأجر.
   * فقط به این ترتیب است که پیام صریح «مستأجر معلق است» تنها به کسی
   * می‌رسد که ثابت کرده صاحب حساب است.
   */
  async login(input: LoginInput): Promise<AuthSession> {
    const user = await this.users.findByEmail(input.email);
    const passwordMatches = await this.#verifyPassword(user, input.password);

    if (!user || !passwordMatches || user.status !== 'ACTIVE') {
      throw new InvalidCredentialsError();
    }

    const tenant = await this.tenants.findBySlug(input.tenantSlug);

    if (!tenant) {
      throw new InvalidCredentialsError();
    }

    const role = await this.memberships.findRole(tenant.id, user.id);

    if (!role) {
      throw new InvalidCredentialsError();
    }

    // قاعده‌ی BE-011: «tenant غیرفعال نتواند session فعال ایجاد کند».
    if (tenant.status !== 'ACTIVE') {
      throw new TenantSuspendedError();
    }

    return this.#issueSession(user, tenant, role);
  }

  /**
   * تمدید نشست، با چرخش توکن.
   *
   * توکن قبلی همیشه باطل می‌شود — قاعده‌ی BE-011. اگر توکن مصرف‌شده
   * دوباره بیاید، دیگر کار نمی‌کند؛ یعنی توکن دزدیده‌شده حداکثر تا اولین
   * تمدید قانونی عمر دارد.
   *
   * وضعیت کاربر و مستأجر دوباره خوانده می‌شوند: کسی که حین اعتبار نشست
   * غیرفعال شده نباید بتواند با تمدید، دسترسی‌اش را تازه کند.
   */
  async refresh(rawToken: string): Promise<AuthSession> {
    const tokenHash = this.tokens.hashRefreshToken(rawToken);

    /*
     * مصرف توکن **اتمی** است (M-07): پیش‌تر SELECT ِ «باطل‌نشده» جدا از UPDATE ِ باطل‌سازی
     * بود و نتیجه‌ی UPDATE بررسی نمی‌شد؛ چند تمدید هم‌زمان با یک توکن — مثلاً توکن
     * دزدیده‌شده کنار کاربر واقعی — همه موفق می‌شدند و هر کدام نشست مستقل می‌گرفتند.
     * حالا UPDATE ... RETURNING قفل ردیف می‌گیرد؛ درخواست هم‌زمان پس از commit ِ اولی
     * شرط `revoked_at IS NULL` را دوباره می‌سنجد و هیچ ردیفی برنمی‌گرداند. صدور توکن
     * تازه در همان تراکنش است: اگر بررسی بعدی شکست بخورد، باطل‌سازی هم برمی‌گردد.
     */
    return this.db.transaction(async (transaction) => {
      const [claimed] = await transaction
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.tokenHash, tokenHash),
            isNull(refreshTokens.revokedAt),
            gt(refreshTokens.expiresAt, new Date()),
          ),
        )
        .returning({ userId: refreshTokens.userId, tenantId: refreshTokens.tenantId });

      if (!claimed) {
        throw new InvalidRefreshTokenError();
      }

      const user = await this.users.findById(claimed.userId);
      const tenant = await this.tenants.findById(claimed.tenantId);

      if (!user || user.status !== 'ACTIVE' || !tenant || tenant.status !== 'ACTIVE') {
        throw new InvalidRefreshTokenError();
      }

      const role = await this.memberships.findRole(tenant.id, user.id);

      if (!role) {
        throw new InvalidRefreshTokenError();
      }

      return this.#issueSession(user, tenant, role, transaction);
    });
  }

  /**
   * خروج.
   *
   * توکن ناموجود هم موفق حساب می‌شود: پاسخ متفاوت به مهاجم می‌گفت کدام
   * توکن‌ها واقعی‌اند، و از دید کاربر نتیجه در هر حال یکی است — آن نشست
   * دیگر کار نمی‌کند.
   */
  async logout(rawToken: string): Promise<void> {
    await this.#revoke(this.tokens.hashRefreshToken(rawToken));
  }

  /** اطلاعات کاربر جاری برای `GET /auth/me`. */
  async describe(
    userId: string,
    tenantId: string,
  ): Promise<{ user: User; tenant: Tenant; role: RoleCode } | undefined> {
    const user = await this.users.findById(userId);
    const tenant = await this.tenants.findById(tenantId);

    if (!user || !tenant) {
      return undefined;
    }

    const role = await this.memberships.findRole(tenantId, userId);

    return role ? { user, tenant, role } : undefined;
  }

  async #issueSession(
    user: User,
    tenant: Tenant,
    role: RoleCode,
    executor: Database | TenantTransaction = this.db,
  ): Promise<AuthSession> {
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      tid: tenant.id,
      role,
    });

    const { token, tokenHash } = this.tokens.generateRefreshToken();

    await executor.insert(refreshTokens).values({
      userId: user.id,
      tenantId: tenant.id,
      tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    });

    return { accessToken, refreshToken: token, user, tenant, role };
  }

  async #revoke(tokenHash: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
  }

  /** همیشه Argon2 را اجرا می‌کند، حتی وقتی کاربر وجود ندارد. */
  async #verifyPassword(user: User | undefined, password: string): Promise<boolean> {
    if (!user?.passwordHash) {
      await this.passwords.verify(await this.#getDummyHash(), password);
      return false;
    }

    return this.passwords.verify(user.passwordHash, password);
  }

  async #getDummyHash(): Promise<string> {
    this.#dummyHash ??= this.passwords.hash('گذرواژه‌ی ساختگی برای یکسان‌سازی زمان پاسخ');

    return this.#dummyHash;
  }
}
