import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from './load-env';

const LONG_SECRET = 'a'.repeat(40);

/** حداقل محیط معتبر — فقط متغیرهای اجباری. */
function validEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgresql://gold:hunter2@localhost:5432/gold',
    JWT_ACCESS_SECRET: LONG_SECRET,
    JWT_REFRESH_SECRET: LONG_SECRET,
    ...overrides,
  };
}

describe('loadEnv — محیط معتبر', () => {
  it('برای متغیرهای اختیاری پیش‌فرض می‌گذارد', () => {
    const config = loadEnv(validEnv());

    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
  });

  it('PORT را از رشته به عدد تبدیل می‌کند', () => {
    expect(loadEnv(validEnv({ PORT: '8080' })).port).toBe(8080);
  });

  it('مقادیر حساس را در Secret می‌پیچد', () => {
    const config = loadEnv(validEnv());

    expect(config.jwtAccessSecret.reveal()).toBe(LONG_SECRET);
    expect(config.databaseUrl.reveal()).toBe('postgresql://gold:hunter2@localhost:5432/gold');
  });

  it('نتیجه تغییرناپذیر است', () => {
    expect(Object.isFrozen(loadEnv(validEnv()))).toBe(true);
  });
});

describe('loadEnv — متغیر اجباری غایب', () => {
  it.each(['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])(
    'بدون %s شکست می‌خورد و نام همان متغیر را می‌گوید',
    (name) => {
      const env = validEnv();
      delete env[name];

      expect(() => loadEnv(env)).toThrow(EnvValidationError);

      try {
        loadEnv(env);
        expect.unreachable('باید خطا می‌داد');
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        expect((error as EnvValidationError).names).toContain(name);
        expect((error as EnvValidationError).message).toContain(name);
      }
    },
  );

  it('محیط کاملاً خالی هر سه متغیر اجباری را گزارش می‌کند', () => {
    try {
      loadEnv({});
      expect.unreachable('باید خطا می‌داد');
    } catch (error) {
      expect((error as EnvValidationError).names).toEqual(
        expect.arrayContaining(['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']),
      );
    }
  });
});

describe('loadEnv — مقدار نامعتبر', () => {
  it.each([
    ['PORT غیرعددی', { PORT: 'abc' }],
    ['PORT صفر', { PORT: '0' }],
    ['PORT بزرگ‌تر از ۶۵۵۳۵', { PORT: '70000' }],
    ['PORT اعشاری', { PORT: '3000.5' }],
    ['NODE_ENV ناشناخته', { NODE_ENV: 'prod' }],
    ['LOG_LEVEL ناشناخته', { LOG_LEVEL: 'verbose' }],
    ['DATABASE_URL با پروتکل اشتباه', { DATABASE_URL: 'mysql://localhost:3306/gold' }],
    ['کلید کوتاه‌تر از ۳۲ کاراکتر', { JWT_ACCESS_SECRET: 'short' }],
  ])('%s را رد می‌کند', (_label, overrides) => {
    expect(() => loadEnv(validEnv(overrides))).toThrow(EnvValidationError);
  });
});

describe('loadEnv — نشت نکردن secret', () => {
  const WEAK = 'a-short-but-recognisable-secret';

  it('پیام خطا مقدار کلید نامعتبر را تکرار نمی‌کند', () => {
    try {
      loadEnv(validEnv({ JWT_ACCESS_SECRET: WEAK }));
      expect.unreachable('باید خطا می‌داد');
    } catch (error) {
      const message = (error as EnvValidationError).message;

      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).not.toContain(WEAK);
    }
  });

  it('پیام خطا رمز داخل DATABASE_URL را تکرار نمی‌کند', () => {
    try {
      loadEnv(validEnv({ DATABASE_URL: 'mysql://gold:hunter2@localhost:3306/gold' }));
      expect.unreachable('باید خطا می‌داد');
    } catch (error) {
      expect((error as EnvValidationError).message).not.toContain('hunter2');
    }
  });

  it('چاپ کل تنظیمات هیچ مقدار حساسی را نشان نمی‌دهد', () => {
    const config = loadEnv(validEnv());

    expect(inspect(config)).not.toContain(LONG_SECRET);
    expect(inspect(config)).not.toContain('hunter2');
    expect(JSON.stringify(config)).not.toContain(LONG_SECRET);
    expect(JSON.stringify(config)).not.toContain('hunter2');
  });
});
