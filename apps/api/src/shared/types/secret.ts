import { inspect } from 'node:util';

const REDACTED = '[REDACTED]';

/**
 * پوششی برای مقادیر حساس که نشت لاگ را **از نظر ساختاری** غیرممکن می‌کند.
 *
 * رمز دیتابیس و کلید امضای توکن نباید هرگز در لاگ ظاهر شوند، ولی تکیه بر
 * «یادت باشد لاگ نکنی» جواب نمی‌دهد: یک `console.log(config)` هنگام عیب‌یابی،
 * یا یک گزارش خطای ساختاریافته که کل context را سریالایز می‌کند، کافی است.
 *
 * این کلاس هر سه مسیری را که یک مقدار تصادفاً از آن‌ها بیرون می‌زند می‌بندد:
 * تبدیل به رشته، `JSON.stringify` و `util.inspect` (همان چیزی که
 * `console.log` روی شیء صدا می‌زند). مقدار واقعی در فیلد `#private` است،
 * پس نه با `Object.keys`، نه با spread و نه با سریال‌سازی بیرون نمی‌آید —
 * تنها راه، فراخوانی صریح `reveal()` است.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** تنها راه دسترسی به مقدار. عمداً پرسروصداست تا در review دیده شود. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}
