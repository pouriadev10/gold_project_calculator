import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import { tenants } from '../database/schema';
import { TenantSlugConflictError } from './tenant.errors';
import type { Database } from '../database/connect';
import type { Tenant } from '../database/schema';
import type { CreateTenantInput } from './tenant.dto';

/** کد خطای PostgreSQL برای نقض محدودیت یکتایی. */
const UNIQUE_VIOLATION = '23505';

/**
 * سقف پیمایش زنجیره‌ی `cause` — نگهبان در برابر زنجیره‌ی حلقوی.
 * در عمل عمق واقعی یک است (wrapper درزل روی خطای pg).
 */
const MAX_CAUSE_DEPTH = 5;

/**
 * آیا این خطا نقض محدودیت یکتایی است؟
 *
 * زنجیره‌ی `cause` پیموده می‌شود چون drizzle خطای درایور `pg` را در
 * `DrizzleQueryError` می‌پیچد و `code` روی شیء بیرونی وجود ندارد. نسخه‌ی
 * اول همین تابع فقط سطح اول را می‌دید و نتیجه‌اش ۵۰۰ به‌جای ۴۰۹ بود —
 * تستِ slug تکراری آن را گرفت.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }

    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) {
      return true;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

@Injectable()
export class TenantService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * مستأجر جدید می‌سازد.
   *
   * یکتایی slug **با محدودیت دیتابیس** تشخیص داده می‌شود، نه با یک
   * `SELECT` قبل از `INSERT`. آن الگو یک شرط رقابتی کلاسیک است: دو
   * درخواست هم‌زمان هر دو خالی بودن را می‌بینند و هر دو درج می‌کنند.
   * اینجا دیتابیس داور است و ما فقط خطایش را ترجمه می‌کنیم.
   */
  async create(input: CreateTenantInput): Promise<Tenant> {
    try {
      /*
       * وقتی timezone نیامده، کلید اصلاً به شیء اضافه نمی‌شود تا
       * `DEFAULT` ستون عمل کند. اگر `undefined` پاس داده شود، drizzle
       * ستون را در INSERT می‌آورد و پیش‌فرض دیتابیس دور زده می‌شود.
       */
      const [created] = await this.db
        .insert(tenants)
        .values(
          input.timezone === undefined
            ? { name: input.name, slug: input.slug }
            : { name: input.name, slug: input.slug, timezone: input.timezone },
        )
        .returning();

      // `returning()` روی درج موفق همیشه دقیقاً یک ردیف می‌دهد.
      return created!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new TenantSlugConflictError(input.slug);
      }
      throw error;
    }
  }

  /** مستأجر را با شناسه می‌خواند. نبودنش خطا نیست — `undefined` است. */
  async findById(id: string): Promise<Tenant | undefined> {
    const [found] = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);

    return found;
  }

  /** مستأجر را با slug می‌خواند — BE-008 برای تبدیل هدر به مستأجر لازمش دارد. */
  async findBySlug(slug: string): Promise<Tenant | undefined> {
    const [found] = await this.db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);

    return found;
  }
}
