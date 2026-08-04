import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import { isUniqueViolation } from '../database/pg-errors';
import { tenants } from '../database/schema';
import { TenantSlugConflictError } from './tenant.errors';
import type { Database } from '../database/connect';
import type { Tenant } from '../database/schema';
import type { CreateTenantInput } from './tenant.dto';

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
