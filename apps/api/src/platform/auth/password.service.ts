import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/**
 * پارامترهای Argon2id.
 *
 * مرزهای امنیتی‌اند نه عدد صنفی، پس ثابت کد می‌مانند و رکورد نسخه‌دار
 * لازم ندارند (قاعده‌ی ۲-۶ درباره‌ی عیار و نرخ مالیات است).
 *
 * مقادیر از توصیه‌ی OWASP برای Argon2id می‌آیند: ۱۹ مگابایت حافظه و دو
 * تکرار. حافظه مهم‌تر از تکرار است — همان چیزی است که حمله با GPU را
 * گران می‌کند.
 */
const MEMORY_COST_KIB = 19_456;
const TIME_COST = 2;
const PARALLELISM = 1;

/**
 * هش و بررسی رمز عبور — BE-011.
 *
 * `@node-rs/argon2` استفاده می‌شود نه پکیج `argon2`: دومی به node-gyp و
 * زنجیره‌ی کامپایل نیاز دارد که در ایمیج alpine ما وجود ندارد، و اولی
 * باینری آماده‌ی musl دارد.
 */
@Injectable()
export class PasswordService {
  /**
   * رمز را با Argon2id هش می‌کند. نمک خودکار داخل خروجی می‌نشیند.
   *
   * `algorithm` صریح پاس داده نمی‌شود چون `Algorithm` در کتابخانه یک
   * ambient const enum است و با `isolatedModules` قابل ارجاع نیست؛ تنها
   * راهش cast بود. به‌جایش روی پیش‌فرض مستندشده‌ی کتابخانه (Argon2id)
   * تکیه می‌کنیم و **خروجی واقعی** را تست می‌سنجد: هش باید با
   * `$argon2id$` شروع شود. این ضمانت از یک ثابت زمان‌کامپایل قوی‌تر است،
   * چون اگر پیش‌فرض کتابخانه روزی عوض شود تست قرمز می‌شود.
   */
  async hash(plain: string): Promise<string> {
    return hash(plain, {
      memoryCost: MEMORY_COST_KIB,
      timeCost: TIME_COST,
      parallelism: PARALLELISM,
    });
  }

  /**
   * رمز را با هش ذخیره‌شده می‌سنجد.
   *
   * هش خراب یا نامعتبر `false` می‌دهد، نه استثنا: ورودی از دیتابیس می‌آید
   * و یک ردیف معیوب نباید کل مسیر ورود را با خطای ۵۰۰ بترکاند — نتیجه‌ی
   * درست همان «رمز نادرست» است.
   */
  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain);
    } catch {
      return false;
    }
  }
}
