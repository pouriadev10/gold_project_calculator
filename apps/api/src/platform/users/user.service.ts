import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import { isUniqueViolation } from '../database/pg-errors';
import { users } from '../database/schema';
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
    try {
      const [created] = await this.db.insert(users).values(input).returning();

      return created!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new UserEmailConflictError(input.email);
      }
      throw error;
    }
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
}
