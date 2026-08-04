import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import { isUniqueViolation } from '../database/pg-errors';
import { users } from '../database/schema';
import { normalizeTextForStorage } from '../../shared/validation';
import { UserEmailConflictError } from './user.errors';
import type { Database } from '../database/connect';
import type { User } from '../database/schema';
import type { CreateUserInput } from './user.dto';

/**
 * کاربران — BE-010.
 *
 * `users` جدول مستأجری نیست و RLS ندارد، پس کوئری‌هایش از
 * `withTenantTransaction` عبور نمی‌کنند. دلیلش در `schema/users.ts`
 * توضیح داده شده: کاربر یک شخص است و می‌تواند عضو چند مستأجر باشد.
 */
@Injectable()
export class UserService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * کاربر جدید می‌سازد.
   *
   * ایمیل پیش از رسیدن به اینجا در `createUserSchema` به حروف کوچک
   * تبدیل شده؛ یکتایی را دیتابیس تشخیص می‌دهد نه یک `SELECT` قبلی.
   */
  async create(input: CreateUserInput): Promise<User> {
    const normalizedInput = {
      ...input,
      displayName: normalizeTextForStorage(input.displayName),
    };

    try {
      const [created] = await this.db.insert(users).values(normalizedInput).returning();

      return created!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new UserEmailConflictError(normalizedInput.email);
      }
      throw error;
    }
  }

  /**
   * هش رمز عبور را می‌نشاند — BE-011.
   *
   * ورودی **هش** است نه رمز خام: این سرویس چیزی درباره‌ی Argon2 نمی‌داند
   * و نباید بداند. هش کردن کار `PasswordService` است، و همین مرز باعث
   * می‌شود رمز خام هرگز از این لایه عبور نکند.
   */
  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  }

  async findById(id: string): Promise<User | undefined> {
    const [found] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);

    return found;
  }

  /** ورودی با همان نرمال‌سازی schema کوچک می‌شود تا جست‌وجو با ذخیره هم‌خوان بماند. */
  async findByEmail(email: string): Promise<User | undefined> {
    const [found] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .limit(1);

    return found;
  }

  /**
   * نام ذخیره‌شده و عبارت جست‌وجو با یک تابع canonical می‌شوند؛ بنابراین
   * «علي» و «علی»، یا «۱۲۳۴» و «1234»، دقیقاً همان کاربر را می‌یابند.
   */
  async findByDisplayName(displayName: string): Promise<User | undefined> {
    const [found] = await this.db
      .select()
      .from(users)
      .where(eq(users.displayName, normalizeTextForStorage(displayName)))
      .limit(1);

    return found;
  }
}
