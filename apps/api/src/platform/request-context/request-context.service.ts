import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { MissingRequestContextError } from './request-context.errors';

/**
 * آنچه در طول یک درخواست همه‌جا در دسترس است.
 *
 * عمداً کوچک نگه داشته شده: هرچه اینجا بیاید به‌طور ضمنی به هر لایه‌ای
 * تزریق می‌شود و ردیابی وابستگی‌ها را سخت می‌کند. `requestId` در BE-017
 * و اطلاعات کاربر در BE-011 اضافه می‌شوند.
 */
export interface RequestContextStore {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly userId: string | undefined;
}

/**
 * مستأجر و کاربر جاری درخواست — BE-008.
 *
 * چرا `AsyncLocalStorage` و نه پاس دادن دستی؟ چون قاعده‌ی این تسک
 * می‌گوید «هیچ Service دامنه‌ای tenant را از body دریافت نکند». اگر
 * `tenantId` یک پارامتر معمولی بود، دیر یا زود جایی از ورودی کاربر پر
 * می‌شد و یک مستأجر داده‌ی مستأجر دیگر را می‌دید. اینجا تنها منبعش
 * میان‌افزار است و هیچ مسیر دیگری برای نوشتنش وجود ندارد.
 */
@Injectable()
export class RequestContextService {
  readonly #storage = new AsyncLocalStorage<RequestContextStore>();

  /**
   * تابع را داخل یک context اجرا می‌کند.
   *
   * `run` است نه `enterWith` — `enterWith` context را روی زنجیره‌ی جاری
   * می‌نشاند و مرز پایانش مبهم است؛ برای سیستمی که مستأجرها نباید داده‌ی
   * هم را ببینند، نشت context بدترین حالت ممکن است. `run` دامنه‌ی دقیق
   * و بسته دارد.
   */
  run<T>(store: RequestContextStore, callback: () => T): T {
    return this.#storage.run(store, callback);
  }

  /**
   * شناسه‌ی مستأجر جاری.
   *
   * نبودِ context خطاست، نه `undefined`: هر کدی که این را صدا می‌زند
   * فرض کرده داخل یک درخواست است. برگرداندن `undefined` یعنی آن فرض
   * بی‌سروصدا نقض شود و کوئری بدون فیلتر مستأجر اجرا شود.
   */
  getTenantId(): string {
    return this.#requireStore().tenantId;
  }

  /** نام یکتای مستأجر جاری — برای لاگ و پیام خطا. */
  getTenantSlug(): string {
    return this.#requireStore().tenantSlug;
  }

  /** کاربر جاری. تا BE-011 همیشه `undefined` است. */
  getUserId(): string | undefined {
    return this.#requireStore().userId;
  }

  /** آیا اصلاً داخل یک درخواست هستیم؟ برای کدی که هر دو حالت را می‌پذیرد. */
  hasContext(): boolean {
    return this.#storage.getStore() !== undefined;
  }

  #requireStore(): RequestContextStore {
    const store = this.#storage.getStore();

    if (store === undefined) {
      throw new MissingRequestContextError();
    }

    return store;
  }
}
